//! Keeping Memoria around between play sessions: per-PC preferences for
//! starting with Windows (and the Run entry behind it) and staying in the tray,
//! and a watcher that notices when a tracked game starts and stops.
//!
//! The watcher only compares running program names against names the app
//! supplied for its games. Nothing about other programs leaves this file.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::locks::Locked;

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    /// Open Memoria when the player signs in to Windows.
    pub open_at_login: bool,
    /// Closing the window keeps Memoria in the tray.
    pub close_to_tray: bool,
    /// Show a notification when a tracked game starts.
    pub game_start_notices: bool,
    /// Device reminders, independent of the phone's choice. On for a new
    /// install; an install from before 4.1 keeps the off it was given.
    pub reminders_on_pc: bool,
    /// Open the quick card when a followed game closes. Off until the player turns it on.
    pub compact_pop_out_on_stop: bool,
    /// The quick card floats over other windows.
    pub compact_always_on_top: bool,
    /// The global shortcut that opens and closes the quick card. Off, and blank,
    /// until the player picks one, so it never takes a key another app uses.
    pub compact_shortcut_enabled: bool,
    /// Blank, or a normalised accelerator that `capture::parse_accelerator` accepts.
    pub compact_shortcut: String,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            open_at_login: true,
            close_to_tray: true,
            game_start_notices: true,
            reminders_on_pc: true,
            compact_pop_out_on_stop: false,
            compact_always_on_top: true,
            compact_shortcut_enabled: false,
            compact_shortcut: String::new(),
        }
    }
}

/// A saved quick-card shortcut, normalised, or blank when there is none or it no longer reads.
fn clean_shortcut(spec: &str) -> String {
    if spec.trim().is_empty() {
        return String::new();
    }
    crate::connectors::capture::parse_accelerator(spec).map_or_else(|_| String::new(), |parsed| parsed.display)
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
            let shortcut = clean_shortcut(saved.get("compactShortcut").and_then(Value::as_str).unwrap_or(""));
            current = Preferences {
                open_at_login: flag("openAtLogin", current.open_at_login),
                close_to_tray: flag("closeToTray", current.close_to_tray),
                game_start_notices: flag("gameStartNotices", current.game_start_notices),
                // Never switch reminders on silently for someone who already had the app.
                reminders_on_pc: flag("remindersOnPc", false),
                compact_pop_out_on_stop: flag("compactPopOutOnStop", current.compact_pop_out_on_stop),
                compact_always_on_top: flag("compactAlwaysOnTop", current.compact_always_on_top),
                // A shortcut that no longer reads is never held.
                compact_shortcut_enabled: !shortcut.is_empty() && flag("compactShortcutEnabled", false),
                compact_shortcut: shortcut,
            };
        }
        Self {
            file,
            current: Mutex::new(current),
        }
    }

    pub fn get(&self) -> Preferences {
        self.current.locked().clone()
    }

    /// Applies only known boolean keys and returns the full result. The quick
    /// card's shortcut changes only through `set_compact_shortcut`, which checks it.
    pub fn set(&self, changes: &Value) -> Preferences {
        let mut current = self.current.locked();
        let mut next = current.clone();
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
        if let Some(value) = flag("remindersOnPc") {
            next.reminders_on_pc = value;
        }
        if let Some(value) = flag("compactPopOutOnStop") {
            next.compact_pop_out_on_stop = value;
        }
        if let Some(value) = flag("compactAlwaysOnTop") {
            next.compact_always_on_top = value;
        }
        self.store(&mut current, next)
    }

    /// Turns the quick card's shortcut on or off, or changes it. `accelerator`
    /// None keeps the saved one; blank clears it, which also turns it off.
    pub fn set_compact_shortcut(&self, enabled: bool, accelerator: Option<&str>) -> Result<Preferences, String> {
        let mut current = self.current.locked();
        let shortcut = match accelerator {
            None => current.compact_shortcut.clone(),
            Some(spec) if spec.trim().is_empty() => String::new(),
            Some(spec) => crate::connectors::capture::parse_accelerator(spec)?.display,
        };
        if enabled && shortcut.is_empty() {
            return Err("Choose a shortcut first.".into());
        }
        let next = Preferences {
            compact_shortcut_enabled: enabled,
            compact_shortcut: shortcut,
            ..current.clone()
        };
        Ok(self.store(&mut current, next))
    }

    fn store(&self, current: &mut Preferences, next: Preferences) -> Preferences {
        if let Ok(json) = serde_json::to_value(&next) {
            let _ = crate::store::write_json(&self.file, &json);
        }
        *current = next.clone();
        next
    }
}

/// `Game.exe` and `game` name the same program.
pub fn program_name(value: &str) -> String {
    let value = value.trim();
    // `get` returns None off a character boundary, so non-ASCII names cannot panic.
    let value = match value.len().checked_sub(4).filter(|&cut| cut > 0) {
        Some(cut) if value.get(cut..).is_some_and(|s| s.eq_ignore_ascii_case(".exe")) => &value[..cut],
        _ => value,
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

/// A running game has stopped once it is missing from this many looks in a row...
const STOP_POLLS: u32 = 2;
/// ...over at least this long. A launcher handing over to the game, an update
/// restarting it or a crash and quick relaunch stays one session.
const STOP_GRACE: Duration = Duration::from_secs(20);
/// Between looks while no watched game runs, and while one runs or may have stopped.
const IDLE_POLL: Duration = Duration::from_secs(10);
const ACTIVE_POLL: Duration = Duration::from_secs(4);
/// A game Memoria started (Play) counts as the one running for this long: two
/// accounts of one game share its program, so the launch says which it is.
pub const LAUNCH_RECENCY: Duration = Duration::from_secs(12 * 60 * 60);

/// Of the games sharing one program, the account the player is on: the one
/// Memoria started last within LAUNCH_RECENCY, else the first by id, the same
/// every time.
pub fn pick_account<'a>(
    candidates: impl IntoIterator<Item = &'a String>,
    launched: &HashMap<String, Instant>,
    now: Instant,
) -> Option<String> {
    let candidates: Vec<&String> = candidates.into_iter().collect();
    let recent = |id: &String| {
        launched
            .get(id)
            .copied()
            .filter(|at| now.saturating_duration_since(*at) <= LAUNCH_RECENCY)
    };
    candidates
        .iter()
        .filter_map(|id| recent(id).map(|at| (at, *id)))
        .max_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.cmp(a.1)))
        .map(|(_, id)| id)
        .or_else(|| candidates.iter().min().copied())
        .cloned()
}

/// `ids` with each group of games that share a program reduced to the one
/// `pick_account` chooses, so one game starting or stopping is one notice.
fn one_per_program(
    ids: Vec<String>,
    watch: &HashMap<String, HashSet<String>>,
    launched: &HashMap<String, Instant>,
    now: Instant,
) -> Vec<String> {
    let shares = |a: &String, b: &String| match (watch.get(a), watch.get(b)) {
        (Some(left), Some(right)) => !left.is_disjoint(right),
        _ => a == b,
    };
    let mut kept = Vec::new();
    let mut covered: HashSet<&String> = HashSet::new();
    for id in &ids {
        if covered.contains(id) {
            continue;
        }
        let group: Vec<&String> = ids.iter().filter(|other| shares(id, other)).collect();
        covered.extend(group.iter().copied());
        if let Some(chosen) = pick_account(group, launched, now) {
            kept.push(chosen);
        }
    }
    kept
}

/// A running game missing from the latest looks: since when, and for how many looks.
#[derive(Clone, Copy)]
struct Missing {
    since: Instant,
    polls: u32,
}

#[derive(Default)]
struct WatchState {
    watch: HashMap<String, HashSet<String>>,
    /// Running or waiting out STOP_GRACE. None until the first look.
    running: Option<HashSet<String>>,
    /// Games added since the last look. Their first look only records whether they run.
    fresh: HashSet<String>,
    /// When each running game was first seen running.
    since: HashMap<String, Instant>,
    /// Running games missing from the latest looks, not yet counted as stopped.
    missing: HashMap<String, Missing>,
    /// The watched game whose window is in front, from the latest look.
    foreground: Option<String>,
    /// Game id to when Memoria last started it (Play), for `pick_account`.
    launched: HashMap<String, Instant>,
    /// The game last reported starting, stopping or started from Memoria.
    last_active: Option<(String, Instant)>,
    active: bool,
    /// Bumped by each start, so a loop from before a quick stop and start ends
    /// instead of running beside the new one.
    generation: u64,
}

/// Calls `on_start(game_id)` when a watched game goes from not running to running,
/// and `on_stop(game_id, ran)` once it has been gone for STOP_POLLS looks over
/// STOP_GRACE. A game already running when watching begins does not count as
/// starting; its run is measured from the first look.
#[derive(Clone)]
pub struct GameWatcher {
    state: Arc<Mutex<WatchState>>,
    on_start: Arc<dyn Fn(String) + Send + Sync>,
    on_stop: Arc<dyn Fn(String, Duration) + Send + Sync>,
}

impl GameWatcher {
    pub fn new(
        on_start: impl Fn(String) + Send + Sync + 'static,
        on_stop: impl Fn(String, Duration) + Send + Sync + 'static,
    ) -> Self {
        Self {
            state: Arc::default(),
            on_start: Arc::new(on_start),
            on_stop: Arc::new(on_stop),
        }
    }

    pub fn set_watch(&self, value: &Value) {
        let next = clean_watch_list(value);
        let mut state = self.state.locked();
        let added: Vec<String> = next
            .keys()
            .filter(|id| !state.watch.contains_key(*id))
            .cloned()
            .collect();
        state.fresh.extend(added);
        state.watch = next;
    }

    /// One look at the running programs, now, with nothing known to be in front.
    #[allow(dead_code)] // The watch loop knows the window in front, so it calls tick_at.
    pub fn tick(&self, programs: &HashSet<String>) {
        self.tick_at(programs, Instant::now(), None);
    }

    /// One look at the running programs at `now`, with the program whose
    /// window is in front, if any.
    pub fn tick_at(&self, programs: &HashSet<String>, now: Instant, foreground: Option<&str>) {
        let (started, stopped): (Vec<String>, Vec<(String, Duration)>) = {
            let mut state = self.state.locked();
            let present: HashSet<String> = state
                .watch
                .iter()
                .filter(|(_, names)| names.iter().any(|name| programs.contains(name)))
                .map(|(id, _)| id.clone())
                .collect();
            // A game back before its grace ran out never stopped, so it does not start again.
            let started = match &state.running {
                Some(before) => present
                    .iter()
                    .filter(|id| !before.contains(*id) && !state.fresh.contains(*id))
                    .cloned()
                    .collect(),
                None => Vec::new(),
            };
            for id in &present {
                state.since.entry(id.clone()).or_insert(now);
                state.missing.remove(id);
            }
            let gone: Vec<String> = state.since.keys().filter(|id| !present.contains(*id)).cloned().collect();
            let mut stopped = Vec::new();
            for id in gone {
                // A game removed from the watch list did not stop.
                if !state.watch.contains_key(&id) {
                    state.since.remove(&id);
                    state.missing.remove(&id);
                    continue;
                }
                let missing = state.missing.entry(id.clone()).or_insert(Missing { since: now, polls: 0 });
                missing.polls += 1;
                let Missing { since: missed, polls } = *missing;
                if polls >= STOP_POLLS && now.saturating_duration_since(missed) >= STOP_GRACE {
                    state.missing.remove(&id);
                    if let Some(at) = state.since.remove(&id) {
                        // The session ended when it was first missed, not when the grace ran out.
                        stopped.push((id, missed.saturating_duration_since(at)));
                    }
                }
            }
            // Of the games sharing the program in front, the account the player is on.
            let front = foreground.and_then(|program| {
                pick_account(
                    state.watch.iter().filter(|(_, names)| names.contains(program)).map(|(id, _)| id),
                    &state.launched,
                    now,
                )
            });
            state.foreground = front;
            let mut running = present;
            running.extend(state.missing.keys().cloned());
            state.fresh.clear();
            state.running = Some(running);
            // Two accounts on one program start and stop together: one notice, for the account in use.
            let started = one_per_program(started, &state.watch, &state.launched, now);
            let ran: HashMap<String, Duration> = stopped.into_iter().collect();
            let stopped: Vec<(String, Duration)> =
                one_per_program(ran.keys().cloned().collect(), &state.watch, &state.launched, now)
                    .into_iter()
                    .map(|id| {
                        let duration = ran[&id];
                        (id, duration)
                    })
                    .collect();
            if let Some(id) = stopped.last().map(|(id, _)| id).or(started.last()) {
                state.last_active = Some((id.clone(), now));
            }
            (started, stopped)
        };
        for game_id in started {
            (self.on_start)(game_id);
        }
        for (game_id, ran) in stopped {
            (self.on_stop)(game_id, ran);
        }
    }

    /// The watched game whose window was in front at the latest look.
    #[allow(dead_code)] // `active_game` reads it under its own lock; the tests read it here.
    pub fn foreground_game(&self) -> Option<String> {
        self.state.locked().foreground.clone()
    }

    /// Memoria started this game (Play), so it is the account in use on a shared program.
    pub fn note_launch(&self, game_id: &str, at: Instant) {
        let mut state = self.state.locked();
        state.launched.insert(game_id.to_string(), at);
        state.last_active = Some((game_id.to_string(), at));
    }

    /// The game the player is most likely on: the one in front, else one still
    /// running behind another window, else the one last started, stopped or
    /// launched within LAUNCH_RECENCY. None when nothing is known.
    pub fn active_game(&self, now: Instant) -> Option<String> {
        let state = self.state.locked();
        if let Some(front) = &state.foreground {
            return Some(front.clone());
        }
        let running: Vec<&String> = state.since.keys().filter(|id| !state.missing.contains_key(*id)).collect();
        if !running.is_empty() {
            // The one Memoria started, else the one that started running last.
            let launched = running.iter().any(|id| state.launched.contains_key(*id));
            return if launched {
                pick_account(running, &state.launched, now)
            } else {
                running
                    .into_iter()
                    .max_by(|a, b| state.since[*a].cmp(&state.since[*b]).then_with(|| b.cmp(a)))
                    .cloned()
            };
        }
        state
            .last_active
            .as_ref()
            .filter(|(id, at)| state.watch.contains_key(id) && now.saturating_duration_since(*at) <= LAUNCH_RECENCY)
            .map(|(id, _)| id.clone())
    }

    /// Looks come more often while a game runs or may have stopped, so its end is caught soon.
    pub fn poll_interval(&self) -> Duration {
        let state = self.state.locked();
        if state.since.is_empty() && state.missing.is_empty() {
            IDLE_POLL
        } else {
            ACTIVE_POLL
        }
    }

    pub fn start(&self) {
        let generation = {
            let mut state = self.state.locked();
            if state.active {
                return;
            }
            state.active = true;
            state.generation = state.generation.wrapping_add(1);
            state.generation
        };
        let watcher = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let watching = {
                    let state = watcher.state.locked();
                    if !state.active || state.generation != generation {
                        break;
                    }
                    !state.watch.is_empty()
                };
                if watching
                    && let Ok(Ok(snapshot)) = tokio::task::spawn_blocking(running_snapshot).await {
                    watcher.tick_at(&snapshot.programs, Instant::now(), snapshot.foreground.as_deref());
                }
                tokio::time::sleep(watcher.poll_interval()).await;
            }
        });
    }

    pub fn stop(&self) {
        let mut state = self.state.locked();
        state.active = false;
        state.running = None;
        state.since.clear();
        state.missing.clear();
        state.foreground = None;
    }
}

/// One look at what runs: every program's name, and the one whose window is in front.
struct Snapshot {
    programs: HashSet<String>,
    foreground: Option<String>,
}

/// From a ToolHelp snapshot, cheaper than tasklist.exe. The program in front is
/// found by its process id in the same pass, without opening any process.
#[cfg(windows)]
fn running_snapshot() -> Result<Snapshot, ()> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    let mut programs = HashSet::new();
    let mut foreground = None;
    unsafe {
        let window = GetForegroundWindow();
        let mut front = 0u32;
        if !window.is_null() {
            GetWindowThreadProcessId(window, &mut front);
        }
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
                let name = program_name(&String::from_utf16_lossy(&entry.szExeFile[..length]));
                // Process id 0 is the idle process, never a window's owner.
                if front != 0 && entry.th32ProcessID == front {
                    foreground = Some(name.clone());
                }
                programs.insert(name);
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
    }
    Ok(Snapshot { programs, foreground })
}

#[cfg(not(windows))]
fn running_snapshot() -> Result<Snapshot, ()> {
    Err(())
}

// ---------------------------------------------------------------------------
// Starting with Windows
// ---------------------------------------------------------------------------

/// A start at sign-in: Memoria goes straight to the tray without a window.
pub const BACKGROUND_ARG: &str = "--background";

/// Whether these command-line arguments (the program first) ask for a start in the tray.
pub fn background_launch(args: &[String]) -> bool {
    args.iter().skip(1).any(|arg| arg == BACKGROUND_ARG)
}

/// What Windows runs at sign-in.
pub fn login_command(exe: &Path) -> String {
    format!("\"{}\" {BACKGROUND_ARG}", exe.display())
}

/// Task Manager's Startup apps switch keeps a record per entry. Its first byte
/// is even (2 or 6) while the entry may run and odd (3) once it is switched off.
/// No record means on.
pub fn startup_disabled(record: &[u8]) -> bool {
    record.first().is_some_and(|byte| byte & 1 == 1)
}

/// The Run entry Windows starts Memoria from, and the switch Task Manager keeps for it.
#[cfg(windows)]
pub mod login {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    const NAME: &str = "Memoria";
    /// The Electron build registered under this name. One entry is enough.
    const LEGACY: &str = "electron.app.Memoria";

    fn user() -> RegKey {
        RegKey::predef(HKEY_CURRENT_USER)
    }

    fn wanted() -> Option<String> {
        std::env::current_exe().ok().map(|exe| super::login_command(&exe))
    }

    /// Whether Task Manager (or Settings > Apps > Startup) switched Memoria off.
    pub fn blocked() -> bool {
        user()
            .open_subkey(APPROVED)
            .and_then(|key| key.get_raw_value(NAME))
            .is_ok_and(|record| super::startup_disabled(&record.bytes))
    }

    /// The player's own choice, from Settings or the tray. Turning it on also
    /// clears Task Manager's switch, which Windows reads as on.
    pub fn set(enabled: bool) {
        let Ok((run, _)) = user().create_subkey(RUN) else { return };
        let _ = run.delete_value(LEGACY);
        if enabled {
            if let Some(command) = wanted() {
                let _ = run.set_value(NAME, &command);
            }
        } else {
            let _ = run.delete_value(NAME);
        }
        if let Ok(approved) = user().open_subkey_with_flags(APPROVED, KEY_SET_VALUE) {
            let _ = approved.delete_value(NAME);
        }
    }

    /// At startup: registers a new install and moves an older entry to the tray
    /// start. It writes only when the entry differs, and never over an entry
    /// Windows switched off.
    pub fn refresh(enabled: bool) {
        let Ok((run, _)) = user().create_subkey(RUN) else { return };
        if run.get_raw_value(LEGACY).is_ok() {
            let _ = run.delete_value(LEGACY);
        }
        if !enabled || blocked() {
            return;
        }
        let current: Option<String> = run.get_value(NAME).ok();
        if let Some(command) = wanted().filter(|command| current.as_ref() != Some(command)) {
            let _ = run.set_value(NAME, &command);
        }
    }
}

#[cfg(not(windows))]
pub mod login {
    pub fn blocked() -> bool {
        false
    }
    pub fn set(_enabled: bool) {}
    pub fn refresh(_enabled: bool) {}
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
        assert_eq!(program_name("游戏"), "游戏");
        assert_eq!(program_name("😀a"), "😀a");
        assert_eq!(program_name("原神.exe"), "原神");
        assert_eq!(program_name(".exe"), ".exe");
        let watch = clean_watch_list(&json!({ "g": ["Game.exe", "", 5], "": ["x"], "h": "nope" }));
        assert_eq!(watch.len(), 1);
        assert_eq!(watch["g"], set(&["game"]));
    }

    #[test]
    fn notices_only_games_that_start_while_watched() {
        let started = Arc::new(Mutex::new(Vec::new()));
        let heard = started.clone();
        let watcher = GameWatcher::new(move |id| heard.lock().unwrap().push(id), |_, _| {});
        watcher.set_watch(&json!({ "genshin": ["GenshinImpact"], "zzz": ["ZenlessZoneZero.exe"] }));
        // Already running at the first look: not a start.
        watcher.tick(&set(&["genshinimpact"]));
        watcher.tick(&set(&["genshinimpact", "zenlesszonezero"]));
        assert_eq!(*started.lock().unwrap(), vec!["zzz".to_string()]);
        // A game added while it already runs is not a start either.
        watcher.set_watch(&json!({ "genshin": ["GenshinImpact"], "zzz": ["ZenlessZoneZero"], "hsr": ["StarRail"] }));
        let t0 = Instant::now();
        watcher.tick_at(&set(&["genshinimpact", "zenlesszonezero", "starrail"]), t0, None);
        // Once it has stopped for good, running again is a start.
        watcher.tick_at(&set(&[]), t0 + Duration::from_secs(10), None);
        watcher.tick_at(&set(&[]), t0 + Duration::from_secs(30), None);
        watcher.tick_at(&set(&["starrail"]), t0 + Duration::from_secs(40), None);
        assert_eq!(*started.lock().unwrap(), vec!["zzz".to_string(), "hsr".to_string()]);
    }

    /// A watcher that records each stop with how long the game ran.
    fn stop_recorder() -> (GameWatcher, Arc<Mutex<Vec<(String, Duration)>>>) {
        let stopped = Arc::new(Mutex::new(Vec::new()));
        let heard = stopped.clone();
        let watcher = GameWatcher::new(|_| {}, move |id, ran| heard.lock().unwrap().push((id, ran)));
        (watcher, stopped)
    }

    #[test]
    fn notices_games_that_stop_with_how_long_they_ran() {
        let (watcher, stopped) = stop_recorder();
        let t0 = Instant::now();
        let at = |secs: u64| t0 + Duration::from_secs(secs);
        watcher.set_watch(&json!({ "genshin": ["GenshinImpact"], "zzz": ["ZenlessZoneZero"] }));
        watcher.tick_at(&set(&["genshinimpact"]), at(0), None);
        watcher.tick_at(&set(&["genshinimpact", "zenlesszonezero"]), at(600), None);
        // Gone at 900: two looks and twenty seconds later it counts, as of 900.
        watcher.tick_at(&set(&["zenlesszonezero"]), at(900), None);
        watcher.tick_at(&set(&["zenlesszonezero"]), at(904), None);
        assert!(stopped.lock().unwrap().is_empty());
        watcher.tick_at(&set(&["zenlesszonezero"]), at(920), None);
        assert_eq!(
            *stopped.lock().unwrap(),
            vec![("genshin".to_string(), Duration::from_secs(900))]
        );
        // Unwatching a running game is not a stop, even while it waits out the grace.
        watcher.tick_at(&set(&[]), at(930), None);
        watcher.set_watch(&json!({ "genshin": ["GenshinImpact"] }));
        watcher.tick_at(&set(&[]), at(960), None);
        watcher.tick_at(&set(&[]), at(990), None);
        assert_eq!(stopped.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_short_absence_is_not_a_stop_and_keeps_the_session() {
        let started = Arc::new(Mutex::new(0));
        let (stopped, heard_start) = (Arc::new(Mutex::new(Vec::new())), started.clone());
        let heard_stop = stopped.clone();
        let watcher = GameWatcher::new(
            move |_| *heard_start.lock().unwrap() += 1,
            move |id, ran| heard_stop.lock().unwrap().push((id, ran)),
        );
        let t0 = Instant::now();
        let at = |secs: u64| t0 + Duration::from_secs(secs);
        watcher.set_watch(&json!({ "hsr": ["StarRail"] }));
        watcher.tick_at(&set(&[]), at(0), None);
        watcher.tick_at(&set(&["starrail"]), at(10), None);
        assert_eq!(*started.lock().unwrap(), 1);
        // Missing from looks for less than the grace: not yet a stop.
        for secs in [100, 104, 108, 112, 116] {
            watcher.tick_at(&set(&[]), at(secs), None);
        }
        assert!(stopped.lock().unwrap().is_empty());
        // Back before the grace ran out: the same session, not a new start.
        watcher.tick_at(&set(&["starrail"]), at(119), None);
        assert_eq!(*started.lock().unwrap(), 1);
        // A single look without it is never a stop; a second, past the grace, is.
        watcher.tick_at(&set(&[]), at(200), None);
        watcher.tick_at(&set(&["starrail"]), at(204), None);
        watcher.tick_at(&set(&[]), at(300), None);
        assert!(stopped.lock().unwrap().is_empty());
        watcher.tick_at(&set(&[]), at(330), None);
        assert_eq!(*started.lock().unwrap(), 1);
        assert_eq!(
            *stopped.lock().unwrap(),
            vec![("hsr".to_string(), Duration::from_secs(290))]
        );
    }

    #[test]
    fn looks_come_sooner_while_a_game_runs_or_may_have_stopped() {
        let (watcher, stopped) = stop_recorder();
        let t0 = Instant::now();
        let at = |secs: u64| t0 + Duration::from_secs(secs);
        watcher.set_watch(&json!({ "genshin": ["GenshinImpact"] }));
        assert_eq!(watcher.poll_interval(), IDLE_POLL);
        watcher.tick_at(&set(&[]), at(0), None);
        assert_eq!(watcher.poll_interval(), IDLE_POLL);
        watcher.tick_at(&set(&["genshinimpact"]), at(10), None);
        assert_eq!(watcher.poll_interval(), ACTIVE_POLL);
        watcher.tick_at(&set(&[]), at(20), None);
        assert_eq!(watcher.poll_interval(), ACTIVE_POLL, "waiting out the grace");
        watcher.tick_at(&set(&[]), at(40), None);
        assert_eq!(stopped.lock().unwrap().len(), 1);
        assert_eq!(watcher.poll_interval(), IDLE_POLL);
        watcher.tick_at(&set(&["genshinimpact"]), at(50), None);
        watcher.stop();
        assert_eq!(watcher.poll_interval(), IDLE_POLL);
    }

    #[test]
    fn follows_the_watched_game_in_front() {
        let watcher = GameWatcher::new(|_| {}, |_, _| {});
        watcher.set_watch(&json!({ "genshin-2": ["GenshinImpact"], "genshin": ["GenshinImpact"], "zzz": ["ZenlessZoneZero"] }));
        let running = set(&["genshinimpact", "zenlesszonezero", "explorer"]);
        let now = Instant::now();
        watcher.tick_at(&running, now, Some("zenlesszonezero"));
        assert_eq!(watcher.foreground_game(), Some("zzz".to_string()));
        // Two games on one program: always the same one.
        watcher.tick_at(&running, now, Some("genshinimpact"));
        assert_eq!(watcher.foreground_game(), Some("genshin".to_string()));
        watcher.tick_at(&running, now, Some("explorer"));
        assert_eq!(watcher.foreground_game(), None);
        watcher.tick_at(&running, now, Some("genshinimpact"));
        watcher.tick(&running);
        assert_eq!(watcher.foreground_game(), None);
    }

    #[test]
    fn two_accounts_on_one_program_are_one_game_the_one_started_from_memoria() {
        let started = Arc::new(Mutex::new(Vec::new()));
        let stopped = Arc::new(Mutex::new(Vec::new()));
        let (heard_start, heard_stop) = (started.clone(), stopped.clone());
        let watcher = GameWatcher::new(
            move |id| heard_start.lock().unwrap().push(id),
            move |id, _| heard_stop.lock().unwrap().push(id),
        );
        watcher.set_watch(&json!({ "genshin-eu": ["GenshinImpact"], "genshin-na": ["GenshinImpact"], "zzz": ["ZenlessZoneZero"] }));
        let t0 = Instant::now();
        let at = |secs: u64| t0 + Duration::from_secs(secs);
        watcher.tick_at(&set(&[]), at(0), None);
        // Without a launch from Memoria, the first by id, the same every time.
        watcher.tick_at(&set(&["genshinimpact"]), at(10), Some("genshinimpact"));
        assert_eq!(*started.lock().unwrap(), vec!["genshin-eu".to_string()]);
        assert_eq!(watcher.foreground_game().as_deref(), Some("genshin-eu"));
        watcher.tick_at(&set(&[]), at(20), None);
        watcher.tick_at(&set(&[]), at(45), None);
        assert_eq!(*stopped.lock().unwrap(), vec!["genshin-eu".to_string()]);

        // Played from Memoria: that account starts, leads in front and stops.
        watcher.note_launch("genshin-na", at(50));
        watcher.tick_at(&set(&["genshinimpact", "zenlesszonezero"]), at(60), Some("genshinimpact"));
        let mut heard = started.lock().unwrap().clone();
        heard.sort();
        assert_eq!(heard, ["genshin-eu", "genshin-na", "zzz"], "a different program is its own game");
        assert_eq!(watcher.foreground_game().as_deref(), Some("genshin-na"));
        assert_eq!(watcher.active_game(at(60)).as_deref(), Some("genshin-na"));
        watcher.tick_at(&set(&["zenlesszonezero"]), at(70), Some("zenlesszonezero"));
        watcher.tick_at(&set(&["zenlesszonezero"]), at(95), Some("zenlesszonezero"));
        assert_eq!(stopped.lock().unwrap().last().map(String::as_str), Some("genshin-na"));
        assert_eq!(stopped.lock().unwrap().len(), 2);
        // A launch long ago no longer says which account runs.
        let later = at(60) + LAUNCH_RECENCY + Duration::from_secs(1);
        let candidates = ["genshin-eu".to_string(), "genshin-na".to_string()];
        let launched = HashMap::from([("genshin-na".to_string(), at(50))]);
        assert_eq!(pick_account(&candidates, &launched, at(60)).as_deref(), Some("genshin-na"));
        assert_eq!(pick_account(&candidates, &launched, later).as_deref(), Some("genshin-eu"));
        assert_eq!(pick_account(&[] as &[String], &launched, at(60)), None);
    }

    #[test]
    fn the_game_in_play_is_in_front_then_running_then_last_played() {
        let watcher = GameWatcher::new(|_| {}, |_, _| {});
        watcher.set_watch(&json!({ "hsr": ["StarRail"], "zzz": ["ZenlessZoneZero"] }));
        let t0 = Instant::now();
        let at = |secs: u64| t0 + Duration::from_secs(secs);
        assert_eq!(watcher.active_game(at(0)), None, "nothing known");
        watcher.tick_at(&set(&[]), at(0), None);
        watcher.tick_at(&set(&["starrail"]), at(10), None);
        watcher.tick_at(&set(&["starrail", "zenlesszonezero"]), at(20), Some("explorer"));
        // Behind another window: the one that started last.
        assert_eq!(watcher.active_game(at(20)).as_deref(), Some("zzz"));
        watcher.tick_at(&set(&["starrail", "zenlesszonezero"]), at(24), Some("starrail"));
        assert_eq!(watcher.active_game(at(24)).as_deref(), Some("hsr"));
        // Both closed: the one that stopped last, for a while.
        watcher.tick_at(&set(&[]), at(30), None);
        watcher.tick_at(&set(&[]), at(60), None);
        assert!(watcher.active_game(at(60)).is_some());
        assert_eq!(watcher.active_game(at(60) + LAUNCH_RECENCY + Duration::from_secs(1)), None);
        // A game started from Memoria counts before the watcher has seen it.
        watcher.note_launch("hsr", at(100));
        assert_eq!(watcher.active_game(at(100)).as_deref(), Some("hsr"));
    }

    #[test]
    fn the_quick_card_is_opt_in_and_its_shortcut_starts_blank() {
        let dir = std::env::temp_dir().join(format!("memoria-compact-prefs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let prefs = PreferenceFile::new(&dir);
        let fresh = prefs.get();
        assert!(!fresh.compact_pop_out_on_stop, "no card pops up unless asked for");
        assert!(fresh.compact_always_on_top);
        assert!(!fresh.compact_shortcut_enabled);
        assert_eq!(fresh.compact_shortcut, "", "never takes a key by default");
        // A shortcut must be chosen before it can be on.
        assert!(prefs.set_compact_shortcut(true, None).is_err());
        assert!(prefs.set_compact_shortcut(true, Some("Ctrl+M+N")).is_err());
        let set = prefs.set_compact_shortcut(true, Some("shift + alt + q")).unwrap();
        assert_eq!((set.compact_shortcut_enabled, set.compact_shortcut.as_str()), (true, "Alt+Shift+Q"));
        prefs.set(&json!({ "compactPopOutOnStop": true, "compactAlwaysOnTop": false, "compactShortcut": "F1" }));
        let reloaded = PreferenceFile::new(&dir).get();
        assert!(reloaded.compact_pop_out_on_stop && !reloaded.compact_always_on_top);
        assert_eq!(reloaded.compact_shortcut, "Alt+Shift+Q", "only set_compact_shortcut changes it");
        assert!(reloaded.compact_shortcut_enabled);
        // Off keeps the keys for later; blank clears them and turns it off.
        assert_eq!(prefs.set_compact_shortcut(false, None).unwrap().compact_shortcut, "Alt+Shift+Q");
        let cleared = prefs.set_compact_shortcut(false, Some(" ")).unwrap();
        assert_eq!((cleared.compact_shortcut_enabled, cleared.compact_shortcut.as_str()), (false, ""));
        // A hand-edited shortcut that no longer reads is dropped, and never held.
        crate::store::write_json(
            &dir.join("desktop-preferences.json"),
            &json!({ "compactShortcutEnabled": true, "compactShortcut": "Ctrl+Nope" }),
        )
        .unwrap();
        let broken = PreferenceFile::new(&dir).get();
        assert_eq!((broken.compact_shortcut_enabled, broken.compact_shortcut.as_str()), (false, ""));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn starts_in_the_tray_only_when_asked() {
        let args = |list: &[&str]| list.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
        assert!(background_launch(&args(&["Memoria.exe", "--background"])));
        assert!(background_launch(&args(&[r"C:\Memoria\Memoria.exe", "--flag", "--background"])));
        assert!(!background_launch(&args(&["Memoria.exe"])));
        assert!(!background_launch(&args(&["--background"])), "the program's own path is not an argument");
        assert!(!background_launch(&args(&["Memoria.exe", "--background=1", "background"])));
        assert_eq!(
            login_command(Path::new(r"C:\Programs\Memoria\Memoria.exe")),
            r#""C:\Programs\Memoria\Memoria.exe" --background"#
        );
    }

    #[test]
    fn reads_task_managers_startup_switch() {
        assert!(!startup_disabled(&[0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert!(!startup_disabled(&[0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert!(startup_disabled(&[0x03, 0, 0, 0, 0x5a, 0x1c, 0x8e, 0x21, 0x9b, 0x5d, 0xdb, 0x01]));
        assert!(startup_disabled(&[0x01]));
        assert!(!startup_disabled(&[]), "no record is on");
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

    #[test]
    fn reminders_default_on_for_new_installs_off_for_existing_ones_and_stay_local() {
        let dir = std::env::temp_dir().join(format!("memoria-reminder-prefs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(PreferenceFile::new(&dir).get().reminders_on_pc);
        crate::store::write_json(&dir.join("desktop-preferences.json"), &json!({ "closeToTray": true })).unwrap();
        let prefs = PreferenceFile::new(&dir);
        assert!(!prefs.get().reminders_on_pc);
        prefs.set(&json!({ "remindersOnPc": true }));
        assert!(PreferenceFile::new(&dir).get().reminders_on_pc);
        prefs.set(&json!({ "remindersOnPc": "false" }));
        assert!(prefs.get().reminders_on_pc);
        prefs.set(&json!({ "remindersOnPc": false }));
        assert!(!PreferenceFile::new(&dir).get().reminders_on_pc);
        assert!(!dir.join("state.json").exists());
    }
}
