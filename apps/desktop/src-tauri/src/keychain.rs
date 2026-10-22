//! The model key lives in the OS keychain (macOS Keychain, Windows Credential Manager, the
//! Secret Service on Linux) under one fixed service and account. The app never writes the key
//! to disk itself and never logs it: when the keychain is unavailable the commands return a
//! message and the Author can still use the CLI's `~/.apex-galaxia/.env`, written by hand.

use keyring::{Entry, Error};

const SERVICE: &str = "apex-galaxia";
const ACCOUNT: &str = "anthropic";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(describe)
}

/// A message for the frontend. It carries the platform's reason but never a secret.
fn describe(error: Error) -> String {
    match error {
        Error::NoStorageAccess(inner) => {
            format!("The OS keychain refused access ({inner}). The key was not stored.")
        }
        Error::PlatformFailure(inner) => format!(
            "The OS keychain is unavailable ({inner}). On Linux a Secret Service such as GNOME Keyring or KWallet must be running. The key was not stored; the CLI's ~/.apex-galaxia/.env still works."
        ),
        Error::NoEntry => "No key is stored in the keychain.".to_string(),
        Error::BadEncoding(_) => "The stored key is not valid text; delete it and set it again.".to_string(),
        Error::TooLong(attribute, limit) => {
            format!("The keychain limits {attribute} to {limit} characters.")
        }
        Error::Invalid(attribute, reason) => format!("The keychain rejected {attribute}: {reason}."),
        Error::Ambiguous(_) => {
            "More than one keychain item matches apex-galaxia/anthropic; remove the extra ones in the keychain app.".to_string()
        }
        other => format!("Keychain error: {other}"),
    }
}

/// The stored key, `None` when there is none. An unavailable keychain is an error, so the
/// caller can tell "no key" from "cannot know".
pub fn read() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(Error::NoEntry) => Ok(None),
        Err(error) => Err(describe(error)),
    }
}

#[tauri::command]
pub async fn key_set(key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("The key is empty.".to_string());
    }
    entry()?.set_password(key).map_err(describe)
}

#[tauri::command]
pub async fn key_exists() -> Result<bool, String> {
    read().map(|key| key.is_some())
}

#[tauri::command]
pub async fn key_delete() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(describe(error)),
    }
}
