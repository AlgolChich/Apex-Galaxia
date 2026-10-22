//! The sidecar: the MCP server as one Node process whose stdin and stdout carry JSON-RPC, one
//! message per line (ADR 0010). No port is opened.
//!
//! Lifecycle:
//! - `spawn_initial` runs in `setup`, before the webview loads.
//! - A reader thread turns every stdout line into the `apex://message` event.
//! - When stdout reaches EOF and nobody asked for it, the process died: the thread reaps it,
//!   emits `apex://reset` with `running: false` and schedules a restart with backoff, at most
//!   `MAX_RESTARTS` in `RESTART_WINDOW`; past that the sidecar stays down until the Author
//!   presses restart (`sidecar_restart`), which always spawns and clears the crash window.
//! - Stopping closes stdin first: the MCP stdio transport treats EOF as the end of the session
//!   and Node exits by itself once nothing keeps its event loop alive. If a model call is still
//!   running after `STOP_GRACE`, the process is killed.
//! - The window closing and the app exiting both stop the sidecar (`shutdown`).
//!
//! Every spawn gets a generation number. The reader thread of an old generation that sees EOF
//! because we stopped the process on purpose finds a different generation (or none) in the
//! state and does nothing, so a deliberate stop never triggers a restart.

use std::collections::VecDeque;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{keychain, paths};

pub const MESSAGE_EVENT: &str = "apex://message";
pub const RESET_EVENT: &str = "apex://reset";

/// Unexpected exits tolerated inside `RESTART_WINDOW` before the sidecar stays down.
const MAX_RESTARTS: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(60);
/// Backoff before the first automatic restart; doubles with every crash in the window.
const RESTART_BACKOFF: Duration = Duration::from_millis(500);
/// How long a stop waits for Node to leave on its own after stdin closes.
const STOP_GRACE: Duration = Duration::from_millis(1500);
/// How long the reader thread waits for the exit status after stdout closed.
const REAP_GRACE: Duration = Duration::from_millis(1000);

/// Where the model key came from at spawn. Never the key.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum KeySource {
    Keychain,
    Env,
    EnvFile,
    None,
    #[default]
    Unknown,
}

/// The payload of `sidecar_status`, `sidecar_restart` and the `apex://reset` event.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub restarts: u32,
    pub key_source: KeySource,
}

struct Running {
    child: Child,
    stdin: ChildStdin,
    generation: u64,
}

#[derive(Default)]
struct Inner {
    running: Option<Running>,
    /// Bumped at every spawn; a reader thread compares it to tell a crash from a stop.
    generation: u64,
    /// Restarts since launch, automatic and requested.
    restarts: u32,
    key_source: KeySource,
    /// Instants of unexpected exits inside the last `RESTART_WINDOW`.
    crashes: VecDeque<Instant>,
    /// Set by `shutdown`: no restarts after this.
    shutting_down: bool,
    /// Why the last spawn failed, for the error of the next `apex_send`.
    last_error: Option<String>,
}

#[derive(Default)]
pub struct SidecarState(Arc<Mutex<Inner>>);

/// A poisoned mutex (a panic while holding it) still holds usable state for a process manager.
fn lock(shared: &Arc<Mutex<Inner>>) -> MutexGuard<'_, Inner> {
    shared
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn status_of(inner: &Inner) -> SidecarStatus {
    SidecarStatus {
        running: inner.running.is_some(),
        pid: inner.running.as_ref().map(|r| r.child.id()),
        restarts: inner.restarts,
        key_source: inner.key_source,
    }
}

fn emit_reset(app: &AppHandle, status: SidecarStatus) {
    if let Err(error) = app.emit(RESET_EVENT, status) {
        eprintln!("[sidecar] cannot emit {RESET_EVENT}: {error}");
    }
}

// ---------------------------------------------------------------------------------------------
// Where the sidecar comes from
// ---------------------------------------------------------------------------------------------

struct Launch {
    program: PathBuf,
    args: Vec<OsString>,
    resources: PathBuf,
    cwd: PathBuf,
    mode: &'static str,
}

fn sidecar_binary_name() -> &'static str {
    if cfg!(windows) {
        "apex-node.exe"
    } else {
        "apex-node"
    }
}

/// Production: the bundled Node runtime (the Tauri external binary next to the executable)
/// running the single-file server from the resource dir.
fn bundled_launch(app: &AppHandle) -> Option<Launch> {
    let exe = std::env::current_exe().ok()?;
    let node = exe.parent()?.join(sidecar_binary_name());
    let resources = paths::resources_dir(app).ok()?;
    let script = app.path().resource_dir().ok()?.join("apex-mcp.cjs");
    if !node.is_file() || !script.is_file() {
        return None;
    }
    Some(Launch {
        program: node,
        args: vec![script.into_os_string()],
        cwd: resources.clone(),
        resources,
        mode: "bundled",
    })
}

/// Dev: the system `node` running `packages/mcp-server/dist/bin.js` of this checkout.
fn dev_launch() -> Result<Launch, String> {
    let repo = paths::repo_root();
    let script = repo.join("packages/mcp-server/dist/bin.js");
    if !script.is_file() {
        return Err(format!(
            "{} is missing; run `pnpm build` at the repository root",
            script.display()
        ));
    }
    Ok(Launch {
        program: PathBuf::from("node"),
        args: vec![script.into_os_string()],
        resources: paths::non_empty_env(paths::RESOURCES_ENV)
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
            .unwrap_or_else(|| repo.clone()),
        cwd: repo,
        mode: "dev",
    })
}

fn resolve_launch(app: &AppHandle) -> Result<Launch, String> {
    if !cfg!(dev) {
        if let Some(launch) = bundled_launch(app) {
            return Ok(launch);
        }
        eprintln!("[sidecar] the bundled runtime is missing; trying the system node");
    }
    dev_launch()
}

/// The key for the child's environment: the keychain wins; otherwise the inherited
/// environment and the CLI's `.env` file are only reported, the core reads them itself.
fn model_key(app: &AppHandle) -> (Option<String>, KeySource) {
    match keychain::read() {
        Ok(Some(key)) => return (Some(key), KeySource::Keychain),
        Ok(None) => {}
        Err(message) => eprintln!("[sidecar] keychain: {message}"),
    }
    if paths::non_empty_env("ANTHROPIC_API_KEY").is_some() {
        return (None, KeySource::Env);
    }
    if paths::user_dir(app)
        .map(|dir| paths::env_file_has_key(&dir))
        .unwrap_or(false)
    {
        return (None, KeySource::EnvFile);
    }
    (None, KeySource::None)
}

// ---------------------------------------------------------------------------------------------
// Spawn, read, stop
// ---------------------------------------------------------------------------------------------

/// Spawn a sidecar into `inner` (the caller holds the lock) and start its reader thread.
fn spawn_locked(
    app: &AppHandle,
    shared: &Arc<Mutex<Inner>>,
    inner: &mut Inner,
) -> Result<(), String> {
    let launch = resolve_launch(app)?;
    let (key, key_source) = model_key(app);

    let mut command = Command::new(&launch.program);
    command
        .args(&launch.args)
        .current_dir(&launch.cwd)
        // The rest of the environment is inherited: APEX_GALAXIA_SCRIPTED, APEX_GALAXIA_HOME…
        .env(paths::RESOURCES_ENV, &launch.resources)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // The sidecar's diagnostics are the app's diagnostics.
        .stderr(Stdio::inherit());
    if let Some(key) = key {
        command.env("ANTHROPIC_API_KEY", key);
    }
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: no console window flashes for the child of a GUI process.
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    let mut child = command.spawn().map_err(|error| {
        format!(
            "cannot start the sidecar ({}): {error}",
            launch.program.display()
        )
    })?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let (stdin, stdout) = match (stdin, stdout) {
        (Some(stdin), Some(stdout)) => (stdin, stdout),
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("the sidecar started without stdio pipes".to_string());
        }
    };

    inner.generation += 1;
    let generation = inner.generation;
    inner.key_source = key_source;
    inner.last_error = None;
    eprintln!(
        "[sidecar] pid {} ({}): {} {}",
        child.id(),
        launch.mode,
        launch.program.display(),
        launch
            .args
            .iter()
            .map(|a| a.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ")
    );
    inner.running = Some(Running {
        child,
        stdin,
        generation,
    });

    let app = app.clone();
    let shared = Arc::clone(shared);
    let spawned = thread::Builder::new()
        .name(format!("apex-sidecar-stdout-{generation}"))
        .spawn(move || read_stdout(app, shared, stdout, generation));
    if let Err(error) = spawned {
        // Without a reader the process would be deaf to us; stop it and report.
        if let Some(running) = inner.running.take() {
            stop(running);
        }
        return Err(format!("cannot start the sidecar reader thread: {error}"));
    }
    Ok(())
}

/// The reader thread: one event per stdout line, then the exit handling at EOF.
fn read_stdout(app: AppHandle, shared: Arc<Mutex<Inner>>, stdout: ChildStdout, generation: u64) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        match line {
            Ok(line) => {
                if line.trim().is_empty() {
                    continue;
                }
                if let Err(error) = app.emit(MESSAGE_EVENT, line) {
                    eprintln!("[sidecar] cannot emit {MESSAGE_EVENT}: {error}");
                }
            }
            Err(error) => {
                eprintln!("[sidecar] stdout read error: {error}");
                break;
            }
        }
    }
    on_stdout_closed(&app, &shared, generation);
}

/// Wait for the exit status after stdout closed; kill a process that lingers.
fn reap(child: &mut Child) -> String {
    let deadline = Instant::now() + REAP_GRACE;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.to_string(),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            Ok(None) => break,
            Err(error) => return format!("unknown exit status ({error})"),
        }
    }
    let _ = child.kill();
    match child.wait() {
        Ok(status) => format!("{status} after closing stdout"),
        Err(error) => format!("unknown exit status ({error})"),
    }
}

/// EOF on stdout of generation `generation`: a crash unless the state says we stopped it.
fn on_stdout_closed(app: &AppHandle, shared: &Arc<Mutex<Inner>>, generation: u64) {
    let mut inner = lock(shared);
    let ours = inner
        .running
        .as_ref()
        .map(|running| running.generation == generation)
        .unwrap_or(false);
    if !ours || inner.shutting_down {
        // Stopped on purpose (restart or shutdown): the stopper reaps the process.
        return;
    }
    let Some(mut running) = inner.running.take() else {
        return;
    };
    let exit = reap(&mut running.child);
    drop(running.stdin);
    eprintln!("[sidecar] exited unexpectedly: {exit}");

    let now = Instant::now();
    inner
        .crashes
        .retain(|instant| now.duration_since(*instant) < RESTART_WINDOW);
    let crashes_in_window = inner.crashes.len();
    emit_reset(app, status_of(&inner));

    if crashes_in_window >= MAX_RESTARTS {
        eprintln!(
            "[sidecar] {MAX_RESTARTS} restarts in {}s already; staying down until a restart is requested",
            RESTART_WINDOW.as_secs()
        );
        inner.last_error = Some(format!(
            "the sidecar crashed {MAX_RESTARTS} times in {}s and stays down; press restart",
            RESTART_WINDOW.as_secs()
        ));
        return;
    }
    inner.crashes.push_back(now);
    // 0.5 s, 1 s, 2 s: enough for a transient failure, short enough for the Author to notice
    // nothing beyond a status change.
    let delay = RESTART_BACKOFF * (1u32 << crashes_in_window.min(8));
    drop(inner);

    let app = app.clone();
    let shared = Arc::clone(shared);
    let scheduled = thread::Builder::new()
        .name("apex-sidecar-restart".to_string())
        .spawn(move || {
            thread::sleep(delay);
            let mut inner = lock(&shared);
            if inner.shutting_down || inner.running.is_some() {
                // The app is closing, or the Author restarted meanwhile.
                return;
            }
            match spawn_locked(&app, &shared, &mut inner) {
                Ok(()) => inner.restarts += 1,
                Err(error) => {
                    eprintln!("[sidecar] restart failed: {error}");
                    inner.last_error = Some(error);
                }
            }
            emit_reset(&app, status_of(&inner));
        });
    if let Err(error) = scheduled {
        eprintln!("[sidecar] cannot schedule the restart: {error}");
    }
}

/// Stop a process we own: close stdin, give Node a moment to exit, then kill. Blocks for at
/// most `STOP_GRACE`.
fn stop(mut running: Running) {
    // Closing the pipe is the orderly way: the stdio transport ends the session on EOF.
    drop(running.stdin);
    let deadline = Instant::now() + STOP_GRACE;
    loop {
        match running.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            Ok(None) | Err(_) => break,
        }
    }
    // A model call in flight keeps the event loop busy: end it.
    let _ = running.child.kill();
    let _ = running.child.wait();
}

// ---------------------------------------------------------------------------------------------
// Entry points for lib.rs
// ---------------------------------------------------------------------------------------------

/// The first spawn, from `setup`. A failure is logged and kept for the next `apex_send`.
pub fn spawn_initial(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    let shared = Arc::clone(&state.0);
    let mut inner = lock(&shared);
    if let Err(error) = spawn_locked(app, &shared, &mut inner) {
        eprintln!("[sidecar] cannot start: {error}");
        inner.last_error = Some(error);
    }
}

/// Stop the sidecar for good. Safe to call more than once.
pub fn shutdown(app: &AppHandle) {
    let Some(state) = app.try_state::<SidecarState>() else {
        return;
    };
    let running = {
        let mut inner = lock(&state.0);
        inner.shutting_down = true;
        inner.running.take()
    };
    if let Some(running) = running {
        stop(running);
    }
}

// ---------------------------------------------------------------------------------------------
// Commands (async so the writes and waits run off the main thread)
// ---------------------------------------------------------------------------------------------

/// One JSON-RPC message to the sidecar's stdin, as one line.
#[tauri::command]
pub async fn apex_send(state: State<'_, SidecarState>, message: String) -> Result<(), String> {
    let mut inner = lock(&state.0);
    let Some(running) = inner.running.as_mut() else {
        let why = inner
            .last_error
            .clone()
            .unwrap_or_else(|| "it exited; press restart".to_string());
        return Err(format!("the sidecar is not running: {why}"));
    };
    // The protocol is one message per line; a stray newline would split a message in two.
    let line = message.replace(['\r', '\n'], " ");
    running
        .stdin
        .write_all(line.as_bytes())
        .and_then(|()| running.stdin.write_all(b"\n"))
        .and_then(|()| running.stdin.flush())
        .map_err(|error| format!("cannot write to the sidecar: {error}"))
}

#[tauri::command]
pub async fn sidecar_status(state: State<'_, SidecarState>) -> Result<SidecarStatus, String> {
    Ok(status_of(&lock(&state.0)))
}

/// Kill and respawn, on request (after a key change, or after the sidecar stayed down).
#[tauri::command]
pub async fn sidecar_restart(
    app: AppHandle,
    state: State<'_, SidecarState>,
) -> Result<SidecarStatus, String> {
    let shared = Arc::clone(&state.0);
    let mut inner = lock(&shared);
    if inner.shutting_down {
        return Err("the app is shutting down".to_string());
    }
    if let Some(running) = inner.running.take() {
        stop(running);
    }
    // A requested restart starts a fresh crash window.
    inner.crashes.clear();
    let result = spawn_locked(&app, &shared, &mut inner);
    inner.restarts += 1;
    let status = status_of(&inner);
    drop(inner);
    emit_reset(&app, status.clone());
    result.map(|()| status)
}
