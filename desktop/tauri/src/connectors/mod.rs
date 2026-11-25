//! Opt-in direct live numbers: a HoYoLAB sign-in, a SKPORT sign-in for
//! Arknights: Endfield, wish/warp history from the game's own web cache, and
//! screenshot text read by Windows OCR (from a file or a screen capture).
//!
//! Everything stays on this PC. HoYoLAB cookies and SKPORT tokens are sealed
//! with DPAPI in connectors.json and never cross into the page, a log or
//! state.json; the page sees only `status()`, which carries no secret and no
//! folder path.

pub mod browser;
pub mod capture;
pub mod ds;
pub mod gacha;
pub mod hoyolab;
pub mod login;
pub mod ocr;
pub mod skport;

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;

use serde_json::{Value, json};

use crate::locks::Locked;

/// The HoYoLAB session cookies. Held only in memory, briefly, and never printed.
/// The account tokens are optional: they let Memoria redeem codes, and old
/// sign-ins without them still read notes.
#[derive(Clone)]
pub struct Cookies {
    pub ltuid: String,
    pub ltoken: String,
    pub ltmid: String,
    pub cookie_token: Option<String>,
    pub account_id: Option<String>,
    pub account_mid: Option<String>,
}

fn valid_cookie(v: &str) -> bool {
    !v.is_empty() && v.len() <= 512 && v.bytes().all(|b| b.is_ascii_graphic() && b != b';' && b != b',')
}

impl Cookies {
    /// None unless all three are present and look like cookie values.
    pub fn new(ltuid: &str, ltoken: &str, ltmid: &str) -> Option<Self> {
        (valid_cookie(ltuid) && valid_cookie(ltoken) && valid_cookie(ltmid)).then(|| Self {
            ltuid: ltuid.to_string(),
            ltoken: ltoken.to_string(),
            ltmid: ltmid.to_string(),
            cookie_token: None,
            account_id: None,
            account_mid: None,
        })
    }

    /// Adds the account tokens, keeping only the ones that look like cookie values.
    pub fn with_account_tokens(
        mut self,
        cookie_token: Option<&str>,
        account_id: Option<&str>,
        account_mid: Option<&str>,
    ) -> Self {
        let keep = |v: Option<&str>| v.filter(|v| valid_cookie(v)).map(str::to_string);
        self.cookie_token = keep(cookie_token);
        self.account_id = keep(account_id);
        self.account_mid = keep(account_mid);
        self
    }

    pub fn header(&self) -> String {
        let mut header = format!(
            "ltuid_v2={}; ltoken_v2={}; ltmid_v2={}",
            self.ltuid, self.ltoken, self.ltmid
        );
        for (name, value) in [
            ("cookie_token_v2", &self.cookie_token),
            ("account_id_v2", &self.account_id),
            ("account_mid_v2", &self.account_mid),
        ] {
            if let Some(value) = value {
                header.push_str(&format!("; {name}={value}"));
            }
        }
        header
    }

    fn to_json(&self) -> Value {
        let mut value = json!({ "ltuid_v2": self.ltuid, "ltoken_v2": self.ltoken, "ltmid_v2": self.ltmid });
        for (name, field) in [
            ("cookie_token_v2", &self.cookie_token),
            ("account_id_v2", &self.account_id),
            ("account_mid_v2", &self.account_mid),
        ] {
            if let Some(field) = field {
                value[name] = json!(field);
            }
        }
        value
    }

    fn from_json(value: &Value) -> Option<Self> {
        Some(
            Self::new(
                value["ltuid_v2"].as_str()?,
                value["ltoken_v2"].as_str()?,
                value["ltmid_v2"].as_str()?,
            )?
            .with_account_tokens(
                value["cookie_token_v2"].as_str(),
                value["account_id_v2"].as_str(),
                value["account_mid_v2"].as_str(),
            ),
        )
    }
}

/// `12****89`: enough to recognise an account, not enough to name it.
pub fn mask_uid(uid: &str) -> String {
    let chars: Vec<char> = uid.chars().collect();
    if chars.len() <= 4 {
        return "*".repeat(chars.len().max(4));
    }
    let head: String = chars[..2].iter().collect();
    let tail: String = chars[chars.len() - 2..].iter().collect();
    format!("{head}****{tail}")
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub const PRESET_KEYS: [&str; 3] = ["genshin", "hsr", "zzz"];
/// The games a SKPORT sign-in reads, by Memoria preset key.
pub const SKPORT_PRESET_KEYS: [&str; 1] = ["endfield"];

#[derive(Clone, Debug, PartialEq)]
pub struct GameLink {
    pub preset_key: String,
    pub uid: String,
    pub region: String,
}

fn valid_game_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 160
}

fn valid_uid(uid: &str) -> bool {
    !uid.is_empty() && uid.len() <= 20 && uid.bytes().all(|b| b.is_ascii_digit())
}

fn valid_region(region: &str) -> bool {
    !region.is_empty()
        && region.len() <= 40
        && region
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Reads `{ gameId: { presetKey, uid, region } }`, keeping only well-formed links to `presets`.
fn parse_links(value: &Value, presets: &[&str]) -> BTreeMap<String, GameLink> {
    let mut game_links = BTreeMap::new();
    if let Some(links) = value.as_object() {
        for (game_id, link) in links.iter().take(200) {
            let (Some(preset), Some(uid), Some(region)) = (
                link["presetKey"].as_str(),
                link["uid"].as_str(),
                link["region"].as_str(),
            ) else {
                continue;
            };
            if valid_game_id(game_id) && presets.contains(&preset) && valid_uid(uid) && valid_region(region) {
                game_links.insert(
                    game_id.clone(),
                    GameLink {
                        preset_key: preset.into(),
                        uid: uid.into(),
                        region: region.into(),
                    },
                );
            }
        }
    }
    game_links
}

fn links_json(links: &BTreeMap<String, GameLink>) -> Value {
    Value::Object(
        links
            .iter()
            .map(|(id, link)| {
                (
                    id.clone(),
                    json!({ "presetKey": link.preset_key, "uid": link.uid, "region": link.region }),
                )
            })
            .collect(),
    )
}

/// Seals a secret with DPAPI, as base64. None when Windows refuses: nothing is stored unsealed.
fn seal(plain: &[u8]) -> Option<String> {
    use base64::Engine;
    crate::dpapi::protect(plain).map(|sealed| base64::engine::general_purpose::STANDARD.encode(sealed))
}

fn unseal(sealed: &str) -> Option<Value> {
    use base64::Engine;
    let blob = base64::engine::general_purpose::STANDARD.decode(sealed).ok()?;
    let plain = crate::dpapi::unprotect(&blob)?;
    serde_json::from_slice(&plain).ok()
}

/// The SKPORT (Arknights: Endfield) sign-in, kept apart from HoYoLAB's.
#[derive(Default)]
struct SkportSaved {
    /// DPAPI-sealed `{ accountToken, cred, signToken }` JSON, base64. Never the tokens themselves.
    sealed: Option<String>,
    masked_uid: Option<String>,
    /// Sanitised `{ presetKey, uid, region, nickname, level, regionName }`.
    roles: Vec<Value>,
    game_links: BTreeMap<String, GameLink>,
    auto_refresh_on_exit: bool,
}

impl SkportSaved {
    fn load(value: &Value) -> Self {
        Self {
            sealed: value["sealed"].as_str().map(str::to_string),
            masked_uid: value["maskedUid"].as_str().map(str::to_string),
            roles: value["roles"].as_array().cloned().unwrap_or_default(),
            game_links: parse_links(&value["gameLinks"], &SKPORT_PRESET_KEYS),
            auto_refresh_on_exit: value["autoRefreshOnExit"].as_bool().unwrap_or(false),
        }
    }

    fn to_json(&self) -> Value {
        json!({
            "sealed": self.sealed,
            "maskedUid": self.masked_uid,
            "roles": self.roles,
            "gameLinks": links_json(&self.game_links),
            "autoRefreshOnExit": self.auto_refresh_on_exit,
        })
    }
}

#[derive(Default)]
struct Saved {
    /// DPAPI-sealed cookie JSON, base64. Never the cookies themselves.
    sealed: Option<String>,
    masked_uid: Option<String>,
    /// Sanitised `{ presetKey, uid, region, nickname, level, regionName }`.
    roles: Vec<Value>,
    game_links: BTreeMap<String, GameLink>,
    backoff_until_ms: Option<u64>,
    auto_refresh_on_exit: bool,
    screenshot_watch_dir: Option<String>,
    skport: SkportSaved,
    /// The global capture shortcut. Off until the player turns it on.
    screenshot_shortcut_enabled: bool,
    /// Always a normalised accelerator that `capture::parse_accelerator` accepts.
    screenshot_shortcut: String,
}

impl Saved {
    fn load(file: &Path) -> Self {
        let Some(value) = crate::store::read_json(file) else {
            return Self {
                screenshot_shortcut: capture::DEFAULT_SHORTCUT.into(),
                ..Self::default()
            };
        };
        let text = |key: &str| value[key].as_str().map(str::to_string);
        let shortcut = value["screenshotShortcut"]
            .as_str()
            .and_then(|spec| capture::parse_accelerator(spec).ok())
            .map_or_else(|| capture::DEFAULT_SHORTCUT.to_string(), |parsed| parsed.display);
        Self {
            sealed: text("sealedCookies"),
            masked_uid: text("maskedUid"),
            roles: value["roles"].as_array().cloned().unwrap_or_default(),
            game_links: parse_links(&value["gameLinks"], &PRESET_KEYS),
            backoff_until_ms: value["backoffUntilMs"].as_u64(),
            auto_refresh_on_exit: value["autoRefreshOnExit"].as_bool().unwrap_or(false),
            screenshot_watch_dir: text("screenshotWatchDir"),
            skport: SkportSaved::load(&value["skport"]),
            screenshot_shortcut_enabled: value["screenshotShortcutEnabled"].as_bool().unwrap_or(false),
            screenshot_shortcut: shortcut,
        }
    }

    fn to_json(&self) -> Value {
        json!({
            "sealedCookies": self.sealed,
            "maskedUid": self.masked_uid,
            "roles": self.roles,
            "gameLinks": self.links_json(),
            "backoffUntilMs": self.backoff_until_ms,
            "autoRefreshOnExit": self.auto_refresh_on_exit,
            "screenshotWatchDir": self.screenshot_watch_dir,
            "skport": self.skport.to_json(),
            "screenshotShortcutEnabled": self.screenshot_shortcut_enabled,
            "screenshotShortcut": self.screenshot_shortcut,
        })
    }

    fn links_json(&self) -> Value {
        links_json(&self.game_links)
    }
}

/// Whether the global shortcut is held by Memoria right now, and why not.
#[derive(Default)]
struct ShortcutRuntime {
    registered: bool,
    error: Option<String>,
}

/// The images directly in `dir` (no subfolders, no links), for the captures folder.
fn capture_files(dir: &Path) -> Vec<(PathBuf, u64)> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .filter_map(|entry| {
            // `file_type` does not follow links, so a link is never a file here.
            let kind = entry.file_type().ok()?;
            let path = entry.path();
            (kind.is_file() && ocr::is_image(&path)).then(|| {
                let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
                (path, size)
            })
        })
        .collect()
}

pub struct ConnectorManager {
    data: PathBuf,
    file: PathBuf,
    /// Where screen captures' JPEGs are kept. Never shown to the page.
    captures_dir: PathBuf,
    saved: Mutex<Saved>,
    /// Game id to the last time its notes were fetched, for the cooldowns.
    last_fetch: Mutex<HashMap<String, Instant>>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    /// A sign-in is being finished, so a second cookie check does not repeat it.
    pub(crate) completing: AtomicBool,
    /// The same for the SKPORT sign-in window.
    pub(crate) skport_completing: AtomicBool,
    /// The frozen screen a snip is being drawn on. Pixels in memory only, never on disk.
    pub(crate) pending_capture: Mutex<Option<capture::PendingCapture>>,
    /// The thread that owns the global capture shortcut, once started.
    pub(crate) hotkey: Mutex<Option<capture::Hotkey>>,
    shortcut: Mutex<ShortcutRuntime>,
    /// The one-time code for connecting from the player's own browser. Memory only.
    browser: browser::HandoffSlot,
    /// Bumped by each HoYoLAB or SKPORT disconnect, under the `saved` lock. A
    /// sign-in, import or token renewal that began before one saves nothing,
    /// so a disconnect is never undone by a request still in flight.
    hoyolab_epoch: AtomicU64,
    skport_epoch: AtomicU64,
}

const HOYOLAB_GONE: &str = "HoYoLAB was disconnected while signing in. Sign in again.";
const SKPORT_GONE: &str = "SKPORT was disconnected while signing in. Sign in again.";

impl ConnectorManager {
    /// Keeps captures in `data/captures`, so a test's folder holds everything.
    #[cfg(test)]
    pub fn new(data: &Path) -> Self {
        Self::new_with_captures(data, data.join("captures"))
    }

    pub fn new_with_captures(data: &Path, captures_dir: PathBuf) -> Self {
        let file = data.join("connectors.json");
        Self {
            data: data.to_path_buf(),
            captures_dir,
            saved: Mutex::new(Saved::load(&file)),
            file,
            last_fetch: Mutex::new(HashMap::new()),
            watcher: Mutex::new(None),
            completing: AtomicBool::new(false),
            skport_completing: AtomicBool::new(false),
            pending_capture: Mutex::new(None),
            hotkey: Mutex::new(None),
            shortcut: Mutex::new(ShortcutRuntime::default()),
            browser: browser::HandoffSlot::default(),
            hoyolab_epoch: AtomicU64::new(0),
            skport_epoch: AtomicU64::new(0),
        }
    }

    /// Taken before a HoYoLAB sign-in's first await, and handed to its stores.
    pub fn hoyolab_epoch(&self) -> u64 {
        self.hoyolab_epoch.load(Ordering::SeqCst)
    }

    /// Taken before a SKPORT sign-in's or renewal's first await, and handed to its stores.
    pub fn skport_epoch(&self) -> u64 {
        self.skport_epoch.load(Ordering::SeqCst)
    }

    pub fn login_profile_dir(&self) -> PathBuf {
        self.data.join("hoyolab-webview")
    }

    pub fn skport_profile_dir(&self) -> PathBuf {
        self.data.join("skport-webview")
    }

    pub fn captures_dir(&self) -> &Path {
        &self.captures_dir
    }

    /// `(count, bytes)` of the kept captures.
    pub fn captures_summary(&self) -> (u64, u64) {
        capture_files(&self.captures_dir)
            .iter()
            .fold((0, 0), |(count, bytes), (_, size)| (count + 1, bytes + size))
    }

    /// Deletes the kept captures: only images directly in the folder, never a
    /// subfolder, a link or another kind of file. `(count, bytes)` freed.
    pub fn clear_captures(&self) -> Result<(u64, u64), String> {
        let (mut count, mut freed, mut failed) = (0, 0, false);
        for (path, size) in capture_files(&self.captures_dir) {
            match std::fs::remove_file(&path) {
                Ok(()) => {
                    count += 1;
                    freed += size;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => failed = true,
            }
        }
        if failed {
            return Err("Some captures could not be deleted. Close any app showing them and try again.".into());
        }
        Ok((count, freed))
    }

    fn save(&self, saved: &Saved) -> Result<(), String> {
        crate::store::write_json(&self.file, &saved.to_json())
            .map_err(|_| "Memoria could not save the connector settings.".to_string())
    }

    /// What the page may know: no cookies, no tokens, no folder paths.
    pub fn status(&self) -> Value {
        let saved = self.saved.locked();
        let backoff = saved.backoff_until_ms.filter(|until| *until > now_ms());
        let folder_name = saved.screenshot_watch_dir.as_deref().and_then(|dir| {
            Path::new(dir)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
        });
        let (registered, shortcut_error) = {
            let runtime = self.shortcut.locked();
            (runtime.registered, runtime.error.clone())
        };
        let (capture_count, capture_bytes) = self.captures_summary();
        json!({
            "hoyolab": {
                "connected": saved.sealed.is_some(),
                "maskedUid": saved.masked_uid,
                "roles": saved.roles,
                "gameLinks": saved.links_json(),
                "backoffUntilMs": backoff,
                "autoRefreshOnExit": saved.auto_refresh_on_exit,
            },
            "skport": {
                "connected": saved.skport.sealed.is_some(),
                "maskedUid": saved.skport.masked_uid,
                "roles": saved.skport.roles,
                "gameLinks": links_json(&saved.skport.game_links),
                "autoRefreshOnExit": saved.skport.auto_refresh_on_exit,
            },
            "screenshotWatch": {
                "enabled": saved.screenshot_watch_dir.is_some() && self.watcher.locked().is_some(),
                "folderName": folder_name,
            },
            "screenshotShortcut": {
                "enabled": saved.screenshot_shortcut_enabled,
                "accelerator": saved.screenshot_shortcut,
                "registered": registered,
                "error": shortcut_error,
            },
            "screenshotCaptures": { "count": capture_count, "bytes": capture_bytes },
            "browserHandoff": self.active_handoff_status(),
        })
    }

    /// Seals the cookies with DPAPI. Fails closed: nothing is stored unsealed,
    /// and nothing at all when HoYoLAB was disconnected since `epoch`.
    pub fn store_cookies(&self, cookies: &Cookies, epoch: u64) -> Result<(), String> {
        let plain = cookies.to_json().to_string();
        let sealed =
            seal(plain.as_bytes()).ok_or("Windows could not protect the HoYoLAB sign-in, so it was not saved.")?;
        let mut saved = self.saved.locked();
        if self.hoyolab_epoch() != epoch {
            return Err(HOYOLAB_GONE.into());
        }
        saved.sealed = Some(sealed);
        saved.masked_uid = Some(mask_uid(&cookies.ltuid));
        // A fresh sign-in is the player answering HoYoLAB's check.
        saved.backoff_until_ms = None;
        self.save(&saved)
    }

    pub fn cookies(&self) -> Option<Cookies> {
        let sealed = self.saved.locked().sealed.clone()?;
        Cookies::from_json(&unseal(&sealed)?)
    }

    /// Saves the sign-in's roles, unless HoYoLAB was disconnected since `epoch`.
    pub fn set_roles(&self, roles: Vec<Value>, epoch: u64) -> Result<(), String> {
        let mut saved = self.saved.locked();
        if self.hoyolab_epoch() != epoch {
            return Err(HOYOLAB_GONE.into());
        }
        // Links to an account that is no longer on this sign-in are dropped.
        saved.game_links.retain(|_, link| {
            roles
                .iter()
                .any(|r| r["presetKey"] == link.preset_key.as_str() && r["uid"] == link.uid.as_str())
        });
        saved.roles = roles;
        self.save(&saved)
    }

    pub fn disconnect(&self) -> Result<(), String> {
        {
            let mut saved = self.saved.locked();
            self.hoyolab_epoch.fetch_add(1, Ordering::SeqCst);
            saved.sealed = None;
            saved.masked_uid = None;
            saved.roles.clear();
            saved.game_links.clear();
            saved.backoff_until_ms = None;
            self.save(&saved)?;
        }
        self.last_fetch.locked().retain(|key, _| key.starts_with("skport:"));
        // The sign-in window's own profile holds the session too.
        let _ = std::fs::remove_dir_all(self.login_profile_dir());
        Ok(())
    }

    /// Links a game card to one of the signed-in account's roles, or unlinks it when `uid` is None.
    pub fn link(&self, game_id: &str, preset_key: &str, uid: Option<&str>, region: Option<&str>) -> Result<(), String> {
        if !valid_game_id(game_id) {
            return Err("Choose a game first.".into());
        }
        let mut saved = self.saved.locked();
        let Some(uid) = uid.filter(|u| !u.is_empty()) else {
            if saved.game_links.remove(game_id).is_some() {
                self.save(&saved)?;
            }
            return Ok(());
        };
        if !PRESET_KEYS.contains(&preset_key) || !valid_uid(uid) {
            return Err("Choose one of the accounts on your HoYoLAB sign-in.".into());
        }
        let role = saved
            .roles
            .iter()
            .find(|r| r["presetKey"] == preset_key && r["uid"] == uid)
            .ok_or("Choose one of the accounts on your HoYoLAB sign-in.")?;
        let role_region = role["region"].as_str().unwrap_or("").to_string();
        let region = region.filter(|r| !r.is_empty()).unwrap_or(&role_region);
        if !valid_region(region) || region != role_region {
            return Err("That account's server does not match HoYoLAB.".into());
        }
        if !saved.game_links.contains_key(game_id) && saved.game_links.len() >= 200 {
            return Err("Unlink a game before linking another.".into());
        }
        saved.game_links.insert(
            game_id.to_string(),
            GameLink {
                preset_key: preset_key.into(),
                uid: uid.into(),
                region: region.into(),
            },
        );
        self.save(&saved)
    }

    pub fn game_link(&self, game_id: &str) -> Option<GameLink> {
        self.saved.locked().game_links.get(game_id).cloned()
    }

    pub fn backoff_until_ms(&self) -> Option<u64> {
        self.saved.locked().backoff_until_ms.filter(|until| *until > now_ms())
    }

    pub fn set_backoff(&self, until_ms: u64) {
        let mut saved = self.saved.locked();
        saved.backoff_until_ms = Some(until_ms);
        let _ = self.save(&saved);
    }

    pub fn set_prefs(&self, changes: &Value) -> Result<(), String> {
        let mut saved = self.saved.locked();
        if let Some(flag) = changes["autoRefreshOnExit"].as_bool() {
            saved.auto_refresh_on_exit = flag;
        }
        self.save(&saved)
    }

    /// Claims a fetch slot for a game. Err with seconds to wait when it is too soon.
    pub fn claim_fetch(&self, game_id: &str, min_gap: std::time::Duration) -> Result<(), u64> {
        let mut last = self.last_fetch.locked();
        if let Some(at) = last.get(game_id)
            && at.elapsed() < min_gap
        {
            return Err((min_gap - at.elapsed()).as_secs().max(1));
        }
        last.insert(game_id.to_string(), Instant::now());
        Ok(())
    }

    pub fn watch_dir(&self) -> Option<PathBuf> {
        self.saved.locked().screenshot_watch_dir.as_ref().map(PathBuf::from)
    }

    /// Replaces any running watcher. The old one stops when it is dropped here.
    pub fn set_watcher(&self, dir: Option<&Path>, watcher: Option<notify::RecommendedWatcher>) -> Result<(), String> {
        let old = std::mem::replace(&mut *self.watcher.locked(), watcher);
        drop(old);
        let mut saved = self.saved.locked();
        saved.screenshot_watch_dir = dir.map(|d| d.to_string_lossy().into_owned());
        self.save(&saved)
    }

    /// Stops the watcher without forgetting the folder, for app exit.
    pub fn stop_watcher(&self) {
        let old = self.watcher.locked().take();
        drop(old);
    }

    pub fn finish_completing(&self) {
        self.completing.store(false, Ordering::SeqCst);
    }

    // -- SKPORT (Arknights: Endfield) ------------------------------------------

    /// Seals the SKPORT tokens with DPAPI. Fails closed: nothing is stored
    /// unsealed, and nothing at all when SKPORT was disconnected since `epoch`.
    /// `masked_uid` replaces the shown account only when it is known.
    pub fn store_skport(&self, secrets: &skport::Secrets, masked_uid: Option<String>, epoch: u64) -> Result<(), String> {
        let plain = secrets.to_json().to_string();
        let sealed =
            seal(plain.as_bytes()).ok_or("Windows could not protect the SKPORT sign-in, so it was not saved.")?;
        let mut saved = self.saved.locked();
        if self.skport_epoch() != epoch {
            return Err(SKPORT_GONE.into());
        }
        saved.skport.sealed = Some(sealed);
        if masked_uid.is_some() {
            saved.skport.masked_uid = masked_uid;
        }
        self.save(&saved)
    }

    pub fn skport_secrets(&self) -> Option<skport::Secrets> {
        let sealed = self.saved.locked().skport.sealed.clone()?;
        skport::Secrets::from_json(&unseal(&sealed)?)
    }

    /// Saves the SKPORT sign-in's roles, unless SKPORT was disconnected since `epoch`.
    pub fn set_skport_roles(&self, roles: Vec<Value>, epoch: u64) -> Result<(), String> {
        let mut saved = self.saved.locked();
        if self.skport_epoch() != epoch {
            return Err(SKPORT_GONE.into());
        }
        saved.skport.game_links.retain(|_, link| {
            roles.iter().any(|r| {
                r["presetKey"] == link.preset_key.as_str()
                    && r["uid"] == link.uid.as_str()
                    && r["region"] == link.region.as_str()
            })
        });
        if saved.skport.masked_uid.is_none() {
            saved.skport.masked_uid = roles.first().and_then(|r| r["uid"].as_str()).map(mask_uid);
        }
        saved.skport.roles = roles;
        self.save(&saved)
    }

    pub fn skport_disconnect(&self) -> Result<(), String> {
        {
            let mut saved = self.saved.locked();
            self.skport_epoch.fetch_add(1, Ordering::SeqCst);
            let auto_refresh_on_exit = saved.skport.auto_refresh_on_exit;
            saved.skport = SkportSaved {
                auto_refresh_on_exit,
                ..SkportSaved::default()
            };
            self.save(&saved)?;
        }
        self.last_fetch.locked().retain(|key, _| !key.starts_with("skport:"));
        // The sign-in window's own profile holds the session too.
        let _ = std::fs::remove_dir_all(self.skport_profile_dir());
        Ok(())
    }

    /// Links a game card to one of the SKPORT sign-in's roles, or unlinks it when `uid` is None.
    /// `region` picks between two roles with the same id on different servers.
    pub fn skport_link(&self, game_id: &str, uid: Option<&str>, region: Option<&str>) -> Result<(), String> {
        if !valid_game_id(game_id) {
            return Err("Choose a game first.".into());
        }
        let mut saved = self.saved.locked();
        let Some(uid) = uid.filter(|u| !u.is_empty()) else {
            if saved.skport.game_links.remove(game_id).is_some() {
                self.save(&saved)?;
            }
            return Ok(());
        };
        let unknown = "Choose one of the accounts on your SKPORT sign-in.";
        if !valid_uid(uid) {
            return Err(unknown.into());
        }
        let wanted = region.filter(|r| !r.is_empty());
        let role = saved
            .skport
            .roles
            .iter()
            .find(|r| r["uid"] == uid && wanted.is_none_or(|wanted| r["region"] == wanted))
            .ok_or(unknown)?;
        let role_region = role["region"].as_str().unwrap_or("").to_string();
        let preset = role["presetKey"].as_str().unwrap_or("").to_string();
        if !valid_region(&role_region) || !SKPORT_PRESET_KEYS.contains(&preset.as_str()) {
            return Err(unknown.into());
        }
        if !saved.skport.game_links.contains_key(game_id) && saved.skport.game_links.len() >= 200 {
            return Err("Unlink a game before linking another.".into());
        }
        saved.skport.game_links.insert(
            game_id.to_string(),
            GameLink {
                preset_key: preset,
                uid: uid.into(),
                region: role_region,
            },
        );
        self.save(&saved)
    }

    pub fn skport_game_link(&self, game_id: &str) -> Option<GameLink> {
        self.saved.locked().skport.game_links.get(game_id).cloned()
    }

    pub fn set_skport_prefs(&self, changes: &Value) -> Result<(), String> {
        let mut saved = self.saved.locked();
        if let Some(flag) = changes["autoRefreshOnExit"].as_bool() {
            saved.skport.auto_refresh_on_exit = flag;
        }
        self.save(&saved)
    }

    pub fn finish_skport_completing(&self) {
        self.skport_completing.store(false, Ordering::SeqCst);
    }

    // -- Screen capture shortcut ------------------------------------------------

    /// `(enabled, accelerator)` as saved.
    pub fn shortcut_setting(&self) -> (bool, String) {
        let saved = self.saved.locked();
        (saved.screenshot_shortcut_enabled, saved.screenshot_shortcut.clone())
    }

    pub fn save_shortcut(&self, enabled: bool, accelerator: &str) -> Result<(), String> {
        let mut saved = self.saved.locked();
        saved.screenshot_shortcut_enabled = enabled;
        saved.screenshot_shortcut = accelerator.to_string();
        self.save(&saved)
    }

    pub fn set_shortcut_runtime(&self, registered: bool, error: Option<String>) {
        *self.shortcut.locked() = ShortcutRuntime { registered, error };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_and_validates() {
        assert_eq!(mask_uid("123456789"), "12****89");
        assert_eq!(mask_uid("12"), "****");
        assert!(Cookies::new("1", "v2_abc", "mid").is_some());
        assert!(Cookies::new("1", "", "mid").is_none());
        assert!(Cookies::new("1", "a;b", "mid").is_none());
    }

    #[test]
    fn status_never_carries_secrets_or_paths() {
        let dir = std::env::temp_dir().join(format!("memoria-connectors-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let manager = ConnectorManager::new(&dir);
        manager
            .set_roles(
                vec![json!({ "presetKey": "genshin", "uid": "700000001", "region": "os_euro" })],
                manager.hoyolab_epoch(),
            )
            .unwrap();
        manager.link("g1", "genshin", Some("700000001"), None).unwrap();
        assert!(manager.link("g2", "genshin", Some("1"), None).is_err());
        manager
            .set_watcher(Some(Path::new(r"C:\Users\someone\Pictures\Shots")), None)
            .unwrap();
        #[cfg(windows)]
        {
            let cookies = Cookies::new("123456789", "v2_SECRETTOKEN", "MIDSECRET").unwrap();
            manager.store_cookies(&cookies, manager.hoyolab_epoch()).unwrap();
            assert_eq!(manager.cookies().unwrap().ltoken, "v2_SECRETTOKEN");
            let disk = std::fs::read_to_string(dir.join("connectors.json")).unwrap();
            assert!(!disk.contains("SECRETTOKEN") && !disk.contains("MIDSECRET"));
        }
        let status = manager.status().to_string();
        assert!(!status.contains("SECRETTOKEN") && !status.contains("someone"));
        assert!(status.contains("\"folderName\":\"Shots\""));
        assert_eq!(manager.status()["hoyolab"]["gameLinks"]["g1"]["region"], "os_euro");
        let reloaded = ConnectorManager::new(&dir);
        assert_eq!(reloaded.game_link("g1").unwrap().uid, "700000001");
        manager.disconnect().unwrap();
        assert!(manager.cookies().is_none());
        assert_eq!(manager.status()["hoyolab"]["connected"], false);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn skport_tokens_stay_sealed_and_links_follow_roles() {
        let dir = std::env::temp_dir().join(format!("memoria-connectors-skport-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let manager = ConnectorManager::new(&dir);
        let status = manager.status();
        assert_eq!(status["skport"]["connected"], false);
        assert_eq!(status["skport"]["autoRefreshOnExit"], false);
        manager
            .set_skport_roles(
                vec![
                    json!({ "presetKey": "endfield", "uid": "4000000001", "region": "2", "nickname": "Endmin" }),
                    json!({ "presetKey": "endfield", "uid": "4000000001", "region": "3" }),
                ],
                manager.skport_epoch(),
            )
            .unwrap();
        assert_eq!(manager.status()["skport"]["maskedUid"], "40****01");
        manager.skport_link("e1", Some("4000000001"), Some("3")).unwrap();
        assert_eq!(manager.skport_game_link("e1").unwrap().region, "3");
        manager.skport_link("e2", Some("4000000001"), None).unwrap();
        assert_eq!(manager.skport_game_link("e2").unwrap().region, "2");
        assert!(manager.skport_link("e3", Some("4000000001"), Some("9")).is_err());
        assert!(manager.skport_link("e3", Some("12"), None).is_err());
        // The HoYoLAB links are a separate list.
        assert!(manager.game_link("e1").is_none());
        manager.set_skport_prefs(&json!({ "autoRefreshOnExit": true })).unwrap();
        #[cfg(windows)]
        {
            let secrets = skport::Secrets::new(Some("ACCTSECRET"), "CREDSECRET", "SIGNSECRET").unwrap();
            manager.store_skport(&secrets, None, manager.skport_epoch()).unwrap();
            let back = manager.skport_secrets().unwrap();
            assert_eq!(back.cred, "CREDSECRET");
            assert_eq!(back.sign_token, "SIGNSECRET");
            assert_eq!(back.account_token.as_deref(), Some("ACCTSECRET"));
            let disk = std::fs::read_to_string(dir.join("connectors.json")).unwrap();
            assert!(!disk.contains("CREDSECRET") && !disk.contains("SIGNSECRET") && !disk.contains("ACCTSECRET"));
            assert_eq!(manager.status()["skport"]["connected"], true);
        }
        let status = manager.status().to_string();
        assert!(!status.contains("CREDSECRET") && !status.contains("SIGNSECRET") && !status.contains("ACCTSECRET"));
        let reloaded = ConnectorManager::new(&dir);
        assert_eq!(reloaded.skport_game_link("e1").unwrap().uid, "4000000001");
        assert_eq!(reloaded.status()["skport"]["autoRefreshOnExit"], true);
        // Roles that drop a server drop its links.
        manager
            .set_skport_roles(
                vec![json!({ "presetKey": "endfield", "uid": "4000000001", "region": "2" })],
                manager.skport_epoch(),
            )
            .unwrap();
        assert!(manager.skport_game_link("e1").is_none());
        assert!(manager.skport_game_link("e2").is_some());
        manager.skport_disconnect().unwrap();
        assert!(manager.skport_secrets().is_none());
        let status = manager.status();
        assert_eq!(status["skport"]["connected"], false);
        assert_eq!(status["skport"]["roles"], json!([]));
        assert_eq!(status["skport"]["autoRefreshOnExit"], true);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn shortcut_setting_persists_and_defaults() {
        let dir = std::env::temp_dir().join(format!("memoria-connectors-shortcut-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let manager = ConnectorManager::new(&dir);
        assert_eq!(
            manager.shortcut_setting(),
            (false, capture::DEFAULT_SHORTCUT.to_string())
        );
        let status = manager.status();
        assert_eq!(status["screenshotShortcut"]["enabled"], false);
        assert_eq!(status["screenshotShortcut"]["accelerator"], "Ctrl+Shift+M");
        assert_eq!(status["screenshotShortcut"]["registered"], false);
        manager.save_shortcut(true, "Alt+F9").unwrap();
        manager.set_shortcut_runtime(false, Some("In use".into()));
        assert_eq!(manager.status()["screenshotShortcut"]["error"], "In use");
        let reloaded = ConnectorManager::new(&dir);
        assert_eq!(reloaded.shortcut_setting(), (true, "Alt+F9".to_string()));
        // A hand-edited, invalid shortcut falls back to the default.
        let mut disk: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("connectors.json")).unwrap()).unwrap();
        disk["screenshotShortcut"] = json!("A");
        std::fs::write(dir.join("connectors.json"), disk.to_string()).unwrap();
        assert_eq!(ConnectorManager::new(&dir).shortcut_setting().1, "Ctrl+Shift+M");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn captures_count_and_clear_only_images_directly_inside() {
        let dir = std::env::temp_dir().join(format!("memoria-connectors-captures-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let captures = dir.join("Shots of someone");
        let manager = ConnectorManager::new_with_captures(&dir, captures.clone());
        assert_eq!(manager.captures_dir(), captures.as_path());
        // No folder yet: nothing kept, nothing to clear.
        assert_eq!(manager.captures_summary(), (0, 0));
        assert_eq!(manager.clear_captures().unwrap(), (0, 0));
        assert_eq!(manager.status()["screenshotCaptures"], json!({ "count": 0, "bytes": 0 }));

        std::fs::create_dir_all(captures.join("nested")).unwrap();
        std::fs::write(captures.join("a.jpg"), [1u8; 10]).unwrap();
        std::fs::write(captures.join("b.PNG"), [2u8; 5]).unwrap();
        std::fs::write(captures.join("notes.txt"), b"keep me").unwrap();
        std::fs::write(captures.join("nested").join("deep.jpg"), [3u8; 7]).unwrap();
        // A folder named like an image is still a folder.
        std::fs::create_dir_all(captures.join("album.jpg")).unwrap();
        assert_eq!(manager.captures_summary(), (2, 15));

        let status = manager.status();
        assert_eq!(status["screenshotCaptures"], json!({ "count": 2, "bytes": 15 }));
        let text = status.to_string();
        assert!(!text.contains("someone") && !text.contains("memoria-connectors-captures"));

        assert_eq!(manager.clear_captures().unwrap(), (2, 15));
        assert_eq!(manager.captures_summary(), (0, 0));
        assert!(!captures.join("a.jpg").exists() && !captures.join("b.PNG").exists());
        assert_eq!(std::fs::read(captures.join("notes.txt")).unwrap(), b"keep me");
        assert!(captures.join("nested").join("deep.jpg").is_file());
        assert!(captures.join("album.jpg").is_dir());
        assert_eq!(manager.status()["screenshotCaptures"]["count"], 0);

        // The default keeps captures beside the data, so tests stay isolated.
        assert_eq!(ConnectorManager::new(&dir).captures_dir(), dir.join("captures").as_path());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_disconnect_is_never_undone_by_a_sign_in_in_flight() {
        let dir = std::env::temp_dir().join(format!("memoria-connectors-epoch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let manager = ConnectorManager::new(&dir);
        let role = || vec![json!({ "presetKey": "hsr", "uid": "800000001", "region": "prod_official_eur" })];
        // A sign-in starts, the player disconnects, then the sign-in finishes.
        let hoyolab = manager.hoyolab_epoch();
        let skport = manager.skport_epoch();
        manager.disconnect().unwrap();
        assert_eq!(manager.set_roles(role(), hoyolab), Err(HOYOLAB_GONE.to_string()));
        assert_eq!(manager.status()["hoyolab"]["roles"], json!([]));
        // Each service keeps its own epoch.
        assert!(manager.set_skport_roles(Vec::new(), skport).is_ok());
        manager.skport_disconnect().unwrap();
        assert_eq!(manager.set_skport_roles(Vec::new(), skport), Err(SKPORT_GONE.to_string()));
        assert!(manager.set_roles(role(), manager.hoyolab_epoch()).is_ok());
        #[cfg(windows)]
        {
            let cookies = Cookies::new("1", "tok", "mid").unwrap();
            assert!(manager.store_cookies(&cookies, hoyolab).is_err());
            assert!(manager.cookies().is_none());
            let secrets = skport::Secrets::new(None, "CRED", "SIGN").unwrap();
            assert!(manager.store_skport(&secrets, None, skport).is_err());
            assert!(manager.skport_secrets().is_none());
            assert!(manager.store_skport(&secrets, None, manager.skport_epoch()).is_ok());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fetch_slots_cool_down() {
        let manager = ConnectorManager::new(&std::env::temp_dir().join("memoria-connectors-slots"));
        let gap = std::time::Duration::from_secs(10);
        assert!(manager.claim_fetch("g", gap).is_ok());
        assert!(manager.claim_fetch("g", gap).is_err());
        assert!(manager.claim_fetch("h", gap).is_ok());
    }

    #[test]
    fn cookies_keep_optional_account_tokens() {
        let base = Cookies::new("1", "tok", "mid").unwrap();
        assert_eq!(base.header(), "ltuid_v2=1; ltoken_v2=tok; ltmid_v2=mid");
        let back = Cookies::from_json(&base.to_json()).unwrap();
        assert_eq!(back.header(), base.header());

        let full = Cookies::new("1", "tok", "mid")
            .unwrap()
            .with_account_tokens(Some("ctok"), Some("1"), Some("amid"));
        assert_eq!(
            full.header(),
            "ltuid_v2=1; ltoken_v2=tok; ltmid_v2=mid; cookie_token_v2=ctok; account_id_v2=1; account_mid_v2=amid"
        );
        let back_full = Cookies::from_json(&full.to_json()).unwrap();
        assert_eq!(back_full.header(), full.header());

        let filtered = Cookies::new("1", "tok", "mid")
            .unwrap()
            .with_account_tokens(Some("bad;val"), Some(""), Some("ok_mid"));
        assert_eq!(
            filtered.header(),
            "ltuid_v2=1; ltoken_v2=tok; ltmid_v2=mid; account_mid_v2=ok_mid"
        );
    }
}
