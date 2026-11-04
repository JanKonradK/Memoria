//! Keeping Memoria around between play sessions: per-PC preferences for
//! starting with Windows and staying in the tray, and a watcher that notices
//! when a tracked game starts.
//!
//! The watcher only compares running program names against names the app
//! supplied for its games. Nothing about other programs leaves this file.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    /// Open Memoria when the player signs in to Windows.
    pub open_at_login: bool,
    /// Closing the window keeps Memoria in the tray.
    pub close_to_tray: bool,
    /// Show a notification when a tracked game starts.
    pub game_start_notices: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            open_at_login: true,
            close_to_tray: true,
            game_start_notices: true,
        }
    }
}

pub struct PreferenceFile {
    file: PathBuf,
    current: Mutex<Preferences>,
}

impl PreferenceFile {
    pub fn new(data: &Path) -> Self {
        let file = data.join("desktop-preferences.json");
        let mut current = Preferences::default();
        if let Some(Value::Object(saved)) = crate::store::read_json(&file) {
            let flag = |key: &str, fallback: bool| saved.get(key).and_then(Value::as_bool).unwrap_or(fallback);
            current = Preferences {
                open_at_login: flag("openAtLogin", current.open_at_login),
                close_to_tray: flag("closeToTray", current.close_to_tray),
                game_start_notices: flag("gameStartNotices", current.game_start_notices),
            };
        }
        Self {
            file,
            current: Mutex::new(current),
        }
    }

    pub fn get(&self) -> Preferences {
        *self.current.lock().unwrap()
    }

    /// Applies only known boolean keys and returns the full result.
    pub fn set(&self, changes: &Value) -> Preferences {
        let mut current = self.current.lock().unwrap();
        let mut next = *current;
        let flag = |key: &str| changes.get(key).and_then(Value::as_bool);
        if let Some(value) = flag("openAtLogin") {
            next.open_at_login = value;
        }
        if let Some(value) = flag("closeToTray") {
            next.close_to_tray = value;
        }
        if let Some(value) = flag("gameStartNotices") {
            next.game_start_notices = value;
        }
        if let Ok(json) = serde_json::to_value(next) {
            let _ = crate::store::write_json(&self.file, &json);
        }
        *current = next;
        next
    }
}

/// `Game.exe` and `game` name the same program.
pub fn program_name(value: &str) -> String {
    let value = value.trim();
    let value = if value.len() > 4 && value[value.len() - 4..].eq_ignore_ascii_case(".exe") {
        &value[..value.len() - 4]
    } else {
        value
    };
    value.to_lowercase()
}

const MAX_GAMES: usize = 200;
const MAX_NAMES: usize = 20;

/// Accepts `{ [gameId]: string[] }` from the window and drops anything malformed.
pub fn clean_watch_list(value: &Value) -> HashMap<String, HashSet<String>> {
    let mut watch = HashMap::new();
    let Some(object) = value.as_object() else { return watch };
    for (game_id, names) in object.iter().take(MAX_GAMES) {
        if game_id.is_empty() || game_id.len() > 160 {
            continue;
        }
        let Some(names) = names.as_array() else { continue };
        let clean: HashSet<String> = names
            .iter()
            .filter_map(Value::as_str)
            .filter(|name| !name.trim().is_empty() && name.len() <= 160)
            .take(MAX_NAMES)
            .map(program_name)
            .collect();
        if !clean.is_empty() {
            watch.insert(game_id.clone(), clean);
        }
    }
    watch
}

#[derive(Default)]
struct WatchState {
    watch: HashMap<String, HashSet<String>>,
    /// None until the first look.
    running: Option<HashSet<String>>,
    /// Games added since the last look. Their first look only records whether they run.
    fresh: HashSet<String>,
    active: bool,
}

/// Calls `on_start(game_id)` when a watched game goes from not running to running.
/// A game already running when watching begins does not count as starting.
#[derive(Clone)]
pub struct GameWatcher {
    state: Arc<Mutex<WatchState>>,
    on_start: Arc<dyn Fn(String) + Send + Sync>,
}

impl GameWatcher {
    pub fn new(on_start: impl Fn(String) + Send + Sync + 'static) -> Self {
        Self {
            state: Arc::default(),
            on_start: Arc::new(on_start),
        }
    }

    pub fn set_watch(&self, value: &Value) {
        let next = clean_watch_list(value);
        let mut state = self.state.lock().unwrap();
        let added: Vec<String> = next
            .keys()
            .filter(|id| !state.watch.contains_key(*id))
            .cloned()
            .collect();
        state.fresh.extend(added);
        state.watch = next;
    }

    /// One look at the running programs.
    pub fn tick(&self, programs: &HashSet<String>) {
        let started: Vec<String> = {
            let mut state = self.state.lock().unwrap();
            let now: HashSet<String> = state
                .watch
                .iter()
                .filter(|(_, names)| names.iter().any(|name| programs.contains(name)))
                .map(|(id, _)| id.clone())
                .collect();
            let started = match &state.running {
                Some(before) => now
                    .iter()
                    .filter(|id| !before.contains(*id) && !state.fresh.contains(*id))
                    .cloned()
                    .collect(),
                None => Vec::new(),
            };
            state.fresh.clear();
            state.running = Some(now);
            started
        };
        for game_id in started {
            (self.on_start)(game_id);
        }
    }

    pub fn start(&self) {
        {
            let mut state = self.state.lock().unwrap();
            if state.active {
                return;
            }
            state.active = true;
        }
        let watcher = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let watching = {
                    let state = watcher.state.lock().unwrap();
                    if !state.active {
                        break;
                    }
                    !state.watch.is_empty()
                };
                if watching {
                    if let Ok(Ok(programs)) = tokio::task::spawn_blocking(running_programs).await {
                        watcher.tick(&programs);
                    }
                }
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        });
    }

    pub fn stop(&self) {
        let mut state = self.state.lock().unwrap();
        state.active = false;
        state.running = None;
    }
}

/// Names of running programs, from a ToolHelp snapshot. Cheaper than tasklist.exe.
#[cfg(windows)]
fn running_programs() -> Result<HashSet<String>, ()> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let mut names = HashSet::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(());
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                let length = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                names.insert(program_name(&String::from_utf16_lossy(&entry.szExeFile[..length])));
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
    }
    Ok(names)
}

#[cfg(not(windows))]
fn running_programs() -> Result<HashSet<String>, ()> {
    Err(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn set(names: &[&str]) -> HashSet<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    #[test]
    fn names_and_watch_lists_are_cleaned() {
        assert_eq!(program_name(" GenshinImpact.EXE "), "genshinimpact");
        let watch = clean_watch_list(&json!({ "g": ["Game.exe", "", 5], "": ["x"], "h": "nope" }));
        assert_eq!(watch.len(), 1);
        assert_eq!(watch["g"], set(&["game"]));
    }

    #[test]
    fn notices_only_games_that_start_while_watched() {
        let started = Arc::new(Mutex::new(Vec::new()));
        let heard = started.clone();
        let watcher = GameWatcher::new(move |id| heard.lock().unwrap().push(id));
        watcher.set_watch(&json!({ "genshin": ["GenshinImpact"], "zzz": ["ZenlessZoneZero.exe"] }));
        // Already running at the first look: not a start.
        watcher.tick(&set(&["genshinimpact"]));
        watcher.tick(&set(&["genshinimpact", "zenlesszonezero"]));
        assert_eq!(*started.lock().unwrap(), vec!["zzz".to_string()]);
        // A game added while it already runs is not a start either.
        watcher.set_watch(&json!({ "genshin": ["GenshinImpact"], "zzz": ["ZenlessZoneZero"], "hsr": ["StarRail"] }));
        watcher.tick(&set(&["genshinimpact", "zenlesszonezero", "starrail"]));
        watcher.tick(&set(&[]));
        watcher.tick(&set(&["starrail"]));
        assert_eq!(*started.lock().unwrap(), vec!["zzz".to_string(), "hsr".to_string()]);
    }

    #[test]
    fn preferences_keep_known_flags() {
        let dir = std::env::temp_dir().join(format!("memoria-prefs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let prefs = PreferenceFile::new(&dir);
        assert_eq!(prefs.get(), Preferences::default());
        prefs.set(&json!({ "closeToTray": false, "openAtLogin": "yes", "other": true }));
        let reloaded = PreferenceFile::new(&dir).get();
        assert!(!reloaded.close_to_tray);
        assert!(reloaded.open_at_login);
    }
}
