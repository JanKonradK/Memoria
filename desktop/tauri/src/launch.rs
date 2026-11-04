//! Starting a tracked game from its card.
//!
//! The window never supplies a path. It names a game; the only way a path
//! enters this file is the native file dialog the player operates. Targets
//! live beside the other per-PC files and stay out of state.json, so they
//! never reach a backup, a synced folder or a phone.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};

/// A program, or a shortcut to one. Scripts and documents are not launch targets.
pub const LAUNCH_EXTENSIONS: [&str; 3] = ["exe", "lnk", "url"];
const MAX_TARGETS: usize = 200;

fn valid_id(game_id: &str) -> bool {
    !game_id.is_empty() && game_id.len() <= 160
}

pub fn valid_target(path: &Path) -> bool {
    path.as_os_str().len() <= 1024
        && path.is_absolute()
        && path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| LAUNCH_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub struct GameLaunch {
    file: PathBuf,
    targets: Mutex<BTreeMap<String, PathBuf>>,
}

impl GameLaunch {
    pub fn new(data: &Path) -> Self {
        let file = data.join("launch-targets.json");
        let mut targets = BTreeMap::new();
        if let Some(Value::Object(saved)) = crate::store::read_json(&file) {
            for (game_id, path) in saved.into_iter().take(MAX_TARGETS) {
                if let Some(path) = path.as_str().map(PathBuf::from) {
                    if valid_id(&game_id) && valid_target(&path) {
                        targets.insert(game_id, path);
                    }
                }
            }
        }
        Self {
            file,
            targets: Mutex::new(targets),
        }
    }

    fn save(&self, targets: &BTreeMap<String, PathBuf>) -> Result<(), String> {
        let value: serde_json::Map<String, Value> = targets
            .iter()
            .map(|(id, path)| (id.clone(), json!(path.to_string_lossy())))
            .collect();
        crate::store::write_json(&self.file, &Value::Object(value)).map_err(|e| e.to_string())
    }

    /// File names only. The card needs a label, not the layout of the player's disk.
    pub fn list(&self) -> Value {
        let targets = self.targets.lock().unwrap();
        let names: serde_json::Map<String, Value> = targets
            .iter()
            .map(|(id, path)| (id.clone(), json!(file_name(path))))
            .collect();
        json!({ "targets": names })
    }

    /// Stores what the player picked. `None` means they cancelled.
    pub fn choose(&self, game_id: &str, picked: Option<PathBuf>) -> Result<Value, String> {
        if !valid_id(game_id) {
            return Err("Choose a game first.".into());
        }
        let Some(path) = picked else { return Ok(self.list()) };
        if !valid_target(&path) {
            return Err("Choose a program (.exe) or a shortcut (.lnk, .url).".into());
        }
        {
            let mut targets = self.targets.lock().unwrap();
            if !targets.contains_key(game_id) && targets.len() >= MAX_TARGETS {
                return Err("Remove a launch target before adding another.".into());
            }
            targets.insert(game_id.to_string(), path);
            self.save(&targets)?;
        }
        Ok(self.list())
    }

    pub fn clear(&self, game_id: &str) -> Result<Value, String> {
        {
            let mut targets = self.targets.lock().unwrap();
            if targets.remove(game_id).is_some() {
                self.save(&targets)?;
            }
        }
        Ok(self.list())
    }

    pub fn start(&self, game_id: &str) -> Result<Value, String> {
        let path = valid_id(game_id)
            .then(|| self.targets.lock().unwrap().get(game_id).cloned())
            .flatten();
        let Some(path) = path else {
            return Err("Choose what starts this game first.".into());
        };
        if !path.exists() {
            return Err(format!("{} is no longer there. Choose it again.", file_name(&path)));
        }
        // The shell starts it the way a double-click would, so a launcher that
        // needs elevation can ask for it.
        if !crate::shell_open(&path.to_string_lossy()) {
            return Err(format!("Windows could not start {}.", file_name(&path)));
        }
        Ok(json!({ "started": file_name(&path) }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_program_targets() {
        let dir = std::env::temp_dir().join(format!("memoria-launch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let launch = GameLaunch::new(&dir);
        assert!(launch.choose("g", Some(PathBuf::from(r"C:\Games\notes.txt"))).is_err());
        assert!(launch.choose("g", Some(PathBuf::from(r"relative\Game.exe"))).is_err());
        launch
            .choose("g", Some(PathBuf::from(r"C:\Games\Genshin\GenshinImpact.exe")))
            .unwrap();
        assert_eq!(launch.list()["targets"]["g"], "GenshinImpact.exe");
        assert_eq!(GameLaunch::new(&dir).list()["targets"]["g"], "GenshinImpact.exe");
        assert!(launch.start("g").unwrap_err().contains("no longer there"));
        launch.clear("g").unwrap();
        assert_eq!(launch.list()["targets"], json!({}));
    }
}
