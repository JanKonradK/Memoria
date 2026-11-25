//! Where Memoria keeps its files, and the careful reads and writes they need.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::core::CoreError;

/// The data folder, `%APPDATA%\memoria`. Never inside the install folder.
pub fn data_dir() -> PathBuf {
    let root = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    root.join("memoria")
}

/// Earlier names of the app kept their data beside it. A rename that ignored
/// them would look exactly like a first run while the real data sat one folder away.
pub fn migrate_legacy_data(data: &Path) -> io::Result<()> {
    let Some(root) = data.parent() else { return Ok(()) };
    for legacy in [root.join("void"), root.join("technogg")] {
        if !legacy.exists() {
            continue;
        }
        if !data.exists() {
            return fs::rename(&legacy, data);
        }
        let legacy_state = legacy.join("state.json");
        let state = data.join("state.json");
        if !legacy_state.exists() || state.exists() {
            continue;
        }
        let bytes = fs::read(&legacy_state)?;
        fs::write(&state, &bytes)?;
        if fs::read(&state)? != bytes {
            return Err(io::Error::other("Memoria could not verify the migrated state file."));
        }
        return Ok(());
    }
    Ok(())
}

/// The largest data file read in normal use. The state is held to 8 MB and
/// history.json to about 4 MB, so anything bigger is damaged or foreign.
pub const MAX_RAW_BYTES: u64 = 10_000_000;
/// How large a state.json from before history.json may be. Those versions kept
/// up to 16 MB of local history inside the state; reading it once lets the next
/// save split it into a small state.json and a bounded history.json.
pub const MAX_LEGACY_STATE_BYTES: u64 = 32_000_000;

/// A data file's text, or None when there is none yet.
pub fn read_raw(file: &Path) -> Result<Option<String>, CoreError> {
    read_limited(file, MAX_RAW_BYTES)
}

/// state.json's text, or None when there is none yet. Allows the larger size
/// of a legacy file that still carries its history, so it recovers instead of
/// refusing every sync; the history is stripped before anything uses it.
pub fn read_raw_state(file: &Path) -> Result<Option<String>, CoreError> {
    read_limited(file, MAX_LEGACY_STATE_BYTES)
}

fn read_limited(file: &Path, limit: u64) -> Result<Option<String>, CoreError> {
    let unreadable = || {
        CoreError::new(
            500,
            "The local state file could not be read. Restore a valid backup before syncing.",
        )
    };
    match fs::metadata(file) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(unreadable()),
        Ok(meta) if meta.len() > limit => return Err(unreadable()),
        Ok(_) => {}
    }
    fs::read_to_string(file).map(Some).map_err(|_| unreadable())
}

/// Write beside the file, then rename over it, so a crash never leaves half a file.
pub fn write_atomic(file: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = file.with_extension(format!(
        "{}tmp",
        file.extension()
            .map(|ext| format!("{}.", ext.to_string_lossy()))
            .unwrap_or_default()
    ));
    fs::write(&temporary, bytes)?;
    // Antivirus and the search indexer briefly hold the target on Windows.
    let mut attempt = 0;
    loop {
        match fs::rename(&temporary, file) {
            Ok(()) => return Ok(()),
            Err(error) if attempt >= 4 => return Err(error),
            Err(_) => {
                attempt += 1;
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

/// Announces outside changes to the state file (a folder sync tool, or a
/// person restoring a backup) through `changes`. Event-based: nothing polls.
/// The watcher stops when the returned value is dropped.
pub fn watch_state_file(
    data: &Path,
    changes: tokio::sync::broadcast::Sender<()>,
) -> Option<notify::RecommendedWatcher> {
    use notify::{RecursiveMode, Watcher};
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        // The write is a rename onto state.json, so watch the folder and match the name.
        if let Ok(event) = event
            && event
                .paths
                .iter()
                .any(|p| p.file_name().is_some_and(|n| n == "state.json"))
        {
            let _ = changes.send(());
        }
    })
    .ok()?;
    watcher.watch(data, RecursiveMode::NonRecursive).ok()?;
    Some(watcher)
}

/// A JSON file of settings, or None when it is missing or unreadable.
pub fn read_json(file: &Path) -> Option<serde_json::Value> {
    serde_json::from_slice(&fs::read(file).ok()?).ok()
}

pub fn write_json(file: &Path, value: &serde_json::Value) -> io::Result<()> {
    write_atomic(file, serde_json::to_string_pretty(value).unwrap_or_default().as_bytes())
}

/// 32 random bytes as base64url: 43 characters, the token shape the app and phone accept.
pub fn new_token() -> String {
    use base64::Engine;
    let mut bytes = [0u8; 32];
    rand::fill(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// The shape `new_token` makes. Only the tests check it: tokens that arrive are
/// compared with `secret_equals`, which needs no shape.
#[cfg(test)]
pub fn is_token(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Equal-time comparison for secrets.
pub fn secret_equals(actual: &str, expected: &str) -> bool {
    actual.len() == expected.len()
        && actual
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_have_the_accepted_shape() {
        let token = new_token();
        assert!(is_token(&token));
        assert!(!is_token("short"));
        assert!(secret_equals(&token, &token.clone()));
        assert!(!secret_equals(&token, &new_token()));
    }

    #[test]
    fn atomic_writes_replace_the_file() {
        let dir = std::env::temp_dir().join(format!("memoria-store-{}", std::process::id()));
        let file = dir.join("state.json");
        write_atomic(&file, b"one").unwrap();
        write_atomic(&file, b"two").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"two");
        assert!(!dir.join("state.json.tmp").exists());
        assert_eq!(read_raw(&dir.join("missing.json")).unwrap(), None);
    }

    #[test]
    fn only_state_reads_allow_a_legacy_sized_file() {
        let dir = std::env::temp_dir().join(format!("memoria-store-size-{}", std::process::id()));
        let file = dir.join("state.json");
        write_atomic(&file, &vec![b' '; (MAX_RAW_BYTES + 1) as usize]).unwrap();
        assert!(read_raw(&file).is_err());
        assert_eq!(read_raw_state(&file).unwrap().unwrap().len() as u64, MAX_RAW_BYTES + 1);
        write_atomic(&file, &vec![b' '; (MAX_LEGACY_STATE_BYTES + 1) as usize]).unwrap();
        assert!(read_raw_state(&file).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
