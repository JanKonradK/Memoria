//! Starting a tracked game from its card. Ported from desktop/game-launch.mjs.
//!
//! The page names a game by id and never supplies a path. A path only enters
//! this file from the native dialog the player operates. Targets stay in
//! launch-targets.json beside the other per-PC files, out of state.json, so
//! they never reach a backup, a synced folder or a phone.

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::{Map, Value, json};

/// A program, or a shortcut to one. Scripts and documents are not launch targets.
pub const LAUNCH_EXTENSIONS: [&str; 3] = ["exe", "lnk", "url"];
const MAX_TARGETS: usize = 200;

fn valid_id(game_id: &str) -> bool {
    !game_id.is_empty() && game_id.encode_utf16().count() <= 160
}

fn valid_target(path: &str) -> bool {
    let path_ref = Path::new(path);
    path.encode_utf16().count() <= 1024
        && path_ref.is_absolute()
        && path_ref
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| LAUNCH_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

fn file_name(path: &str) -> String {
    Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_owned())
}

pub struct GameLaunch {
    file: PathBuf,
    /// Insertion order, as the Node Map kept it.
    targets: Option<Vec<(String, String)>>,
}

impl GameLaunch {
    pub fn new(data: &Path) -> Self {
        Self { file: data.join("launch-targets.json"), targets: None }
    }

    fn load(&mut self) -> &mut Vec<(String, String)> {
        let file = &self.file;
        self.targets.get_or_insert_with(|| {
            // No file yet, or an unreadable one: start empty rather than fail the card.
            let saved = fs::read_to_string(file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
            let Some(Value::Object(saved)) = saved else { return Vec::new() };
            saved
                .into_iter()
                .take(MAX_TARGETS)
                .filter_map(|(id, path)| {
                    let path = path.as_str()?.to_owned();
                    (valid_id(&id) && valid_target(&path)).then_some((id, path))
                })
                .collect()
        })
    }

    fn save(&mut self) -> Result<(), String> {
        let map: Map<String, Value> = self.load().iter().map(|(id, path)| (id.clone(), json!(path))).collect();
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let temporary = self.file.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(&Value::Object(map)).map_err(|e| e.to_string())?;
        fs::write(&temporary, text).map_err(|e| e.to_string())?;
        fs::rename(&temporary, &self.file).map_err(|e| e.to_string())
    }

    /// File names only. The card needs a label, not the layout of the player's disk.
    pub fn list(&mut self) -> Value {
        let targets: Map<String, Value> =
            self.load().iter().map(|(id, path)| (id.clone(), json!(file_name(path)))).collect();
        json!({ "targets": targets })
    }

    pub fn check_choice(&mut self, game_id: &str) -> Result<(), String> {
        if valid_id(game_id) { Ok(()) } else { Err("Choose a game first.".into()) }
    }

    /// Records the file picked in the dialog. `None` means the dialog was cancelled.
    pub fn choose(&mut self, game_id: &str, picked: Option<PathBuf>) -> Result<Value, String> {
        self.check_choice(game_id)?;
        let Some(picked) = picked else { return Ok(self.list()) };
        let path = picked.to_string_lossy().into_owned();
        if !valid_target(&path) {
            return Err("Choose a program (.exe) or a shortcut (.lnk, .url).".into());
        }
        let targets = self.load();
        if let Some(entry) = targets.iter_mut().find(|(id, _)| id == game_id) {
            entry.1 = path;
        } else if targets.len() >= MAX_TARGETS {
            return Err("Remove a launch target before adding another.".into());
        } else {
            targets.push((game_id.to_owned(), path));
        }
        self.save()?;
        Ok(self.list())
    }

    pub fn clear(&mut self, game_id: &str) -> Result<Value, String> {
        let targets = self.load();
        let before = targets.len();
        targets.retain(|(id, _)| id != game_id);
        if targets.len() != before {
            self.save()?;
        }
        Ok(self.list())
    }

    /// The path to start, after checking it is still there.
    pub fn target(&mut self, game_id: &str) -> Result<String, String> {
        let path = if valid_id(game_id) {
            self.load().iter().find(|(id, _)| id == game_id).map(|(_, p)| p.clone())
        } else {
            None
        };
        let path = path.ok_or("Choose what starts this game first.")?;
        if !Path::new(&path).exists() {
            return Err(format!("{} is no longer there. Choose it again.", file_name(&path)));
        }
        Ok(path)
    }
}

pub fn started(path: &str) -> Value {
    json!({ "started": file_name(path) })
}

pub fn start_failed(path: &str) -> String {
    format!("Windows could not start {}.", file_name(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_targets_on_this_pc_and_shows_only_names() {
        let temp = tempfile::tempdir().unwrap();
        let game = temp.path().join("Genshin Impact.lnk");
        fs::write(&game, "").unwrap();
        let mut launch = GameLaunch::new(temp.path());
        assert_eq!(launch.list(), json!({ "targets": {} }));
        assert_eq!(launch.choose("g1", None).unwrap(), json!({ "targets": {} }));
        let listed = launch.choose("g1", Some(game.clone())).unwrap();
        assert_eq!(listed, json!({ "targets": { "g1": "Genshin Impact.lnk" } }));
        assert_eq!(launch.target("g1").unwrap(), game.to_string_lossy());

        let mut reloaded = GameLaunch::new(temp.path());
        assert_eq!(reloaded.list(), listed);
        assert_eq!(reloaded.clear("g1").unwrap(), json!({ "targets": {} }));
        assert_eq!(reloaded.target("g1").unwrap_err(), "Choose what starts this game first.");
    }

    #[test]
    fn refuses_scripts_relative_paths_and_missing_files() {
        let temp = tempfile::tempdir().unwrap();
        let mut launch = GameLaunch::new(temp.path());
        let message = "Choose a program (.exe) or a shortcut (.lnk, .url).";
        assert_eq!(launch.choose("g1", Some(temp.path().join("run.bat"))).unwrap_err(), message);
        assert_eq!(launch.choose("g1", Some("game.exe".into())).unwrap_err(), message);
        assert_eq!(launch.choose("", Some(temp.path().join("a.exe"))).unwrap_err(), "Choose a game first.");
        launch.choose("g1", Some(temp.path().join("Gone.EXE"))).unwrap();
        assert_eq!(launch.target("g1").unwrap_err(), "Gone.EXE is no longer there. Choose it again.");
    }

    #[test]
    fn ignores_an_unreadable_or_tampered_file() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("launch-targets.json"), r#"{"a":"C:\\x.ps1","b":5,"c":"C:\\ok.url"}"#).unwrap();
        assert_eq!(GameLaunch::new(temp.path()).list(), json!({ "targets": { "c": "ok.url" } }));
        fs::write(temp.path().join("launch-targets.json"), "{ broken").unwrap();
        assert_eq!(GameLaunch::new(temp.path()).list(), json!({ "targets": {} }));
    }
}
