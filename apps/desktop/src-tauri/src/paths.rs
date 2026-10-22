//! Where things are: the shipped data (`narrators/`, `prompts/`, `style/`, `evals/`), the
//! Author's user folder and the app's own data folder. The same answers feed the sidecar's
//! environment and the `app_paths` command.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// The CLI's user folder: `APEX_GALAXIA_HOME` or `~/.apex-galaxia` (`defaultUserDir` in the core).
pub const USER_DIR_ENV: &str = "APEX_GALAXIA_HOME";
/// Where the core looks for the shipped data (`RESOURCES_ENV` in the core).
pub const RESOURCES_ENV: &str = "APEX_GALAXIA_RESOURCES";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub resources: String,
    pub user_dir: String,
    pub app_data: String,
}

/// The repository root, derived at compile time from this crate's location. Used by
/// `tauri dev` and as a fallback when the bundled runtime is missing.
pub fn repo_root() -> PathBuf {
    let raw = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    raw.canonicalize().unwrap_or(raw)
}

/// The shipped data: the bundled resource dir in production, the repository root in dev. A
/// non-empty `APEX_GALAXIA_RESOURCES` that points at a folder wins in both, as it does for the CLI.
pub fn resources_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(explicit) = non_empty_env(RESOURCES_ENV) {
        let path = PathBuf::from(explicit);
        if path.is_dir() {
            return Ok(path);
        }
    }
    if cfg!(dev) {
        return Ok(repo_root());
    }
    app.path()
        .resource_dir()
        .map_err(|error| format!("cannot resolve the bundled resources: {error}"))
}

pub fn user_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(home) = non_empty_env(USER_DIR_ENV) {
        return Ok(PathBuf::from(home));
    }
    app.path()
        .home_dir()
        .map(|home| home.join(".apex-galaxia"))
        .map_err(|error| format!("cannot resolve the home directory: {error}"))
}

/// Whether the CLI's `.env` in the user folder carries a key (the core reads it itself; the
/// shell only reports the source). The value is never read into a variable.
pub fn env_file_has_key(user_dir: &Path) -> bool {
    std::fs::read_to_string(user_dir.join(".env"))
        .map(|text| {
            text.lines().any(|line| {
                let line = line.trim_start();
                line.starts_with("ANTHROPIC_API_KEY")
                    && line["ANTHROPIC_API_KEY".len()..]
                        .trim_start()
                        .strip_prefix('=')
                        .map(|value| !value.trim().trim_matches('"').is_empty())
                        .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

pub fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
}

#[tauri::command]
pub async fn app_paths(app: AppHandle) -> Result<AppPaths, String> {
    let resources = resources_dir(&app)?;
    let user_dir = user_dir(&app)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve the app data directory: {error}"))?;
    Ok(AppPaths {
        resources: resources.to_string_lossy().into_owned(),
        user_dir: user_dir.to_string_lossy().into_owned(),
        app_data: app_data.to_string_lossy().into_owned(),
    })
}
