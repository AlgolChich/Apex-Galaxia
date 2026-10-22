//! The Apex Galaxia desktop shell (ADR 0010): one Tauri 2 window around the MCP server, which
//! runs as a Node sidecar speaking JSON-RPC over stdio. The shell owns three things and nothing
//! else: the sidecar process (`sidecar`), the model key in the OS keychain (`keychain`) and the
//! app paths (`paths`). The frontend never touches files or the network itself; the native
//! dialog and opener plugins are the only other capabilities it is granted.
//!
//! The command and event contract is the table in `apps/desktop/README.md` and the comment in
//! `apps/desktop/src/api/transport.tauri.ts`; the two must stay in sync with this crate.

mod keychain;
mod paths;
mod sidecar;

use tauri::{Manager, RunEvent, WindowEvent};

/// Build and run the app. Called from `main.rs`.
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(sidecar::SidecarState::default())
        .invoke_handler(tauri::generate_handler![
            sidecar::apex_send,
            sidecar::sidecar_status,
            sidecar::sidecar_restart,
            keychain::key_set,
            keychain::key_exists,
            keychain::key_delete,
            paths::app_paths,
        ])
        .setup(|app| {
            // Spawn before the webview loads so the first `apex_send` finds a running sidecar.
            sidecar::spawn_initial(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            // The sidecar's lifetime is bound to the window: closing it ends the process.
            if let WindowEvent::Destroyed = event {
                sidecar::shutdown(window.app_handle());
            }
        })
        .build(tauri::generate_context!());

    let app = match app {
        Ok(app) => app,
        Err(error) => {
            eprintln!("Apex Galaxia could not start: {error}");
            std::process::exit(1);
        }
    };

    app.run(|handle, event| {
        // Belt and braces: whatever ends the app (last window closed, a quit from the OS)
        // passes through `Exit`, and shutting a stopped sidecar down again is a no-op.
        if let RunEvent::Exit = event {
            sidecar::shutdown(handle);
        }
    });
}
