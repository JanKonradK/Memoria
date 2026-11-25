//! Wish, warp, signal and convene history, read the way the game's own history
//! page reads it.
//!
//! The game writes the address of its history page, with a short-lived
//! `authkey`, into its web cache when the player opens that page. Memoria
//! finds the newest such address in files the game already left on disk (it
//! never touches the running game), asks the official history API for each
//! banner, and hands the page only the pulls. The authkey and record address
//! stay inside this file.

use std::collections::HashSet;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{Value, json};
use tauri::Url;

pub const GAMES: [&str; 4] = ["genshin", "hsr", "zzz", "wuwa"];

const PAGE_SIZE: usize = 20;
const MAX_PAGES: u32 = 50;
const PAGE_DELAY: Duration = Duration::from_millis(350);
const MAX_LOG_BYTES: u64 = 32 * 1024 * 1024;
const MAX_CACHE_BYTES: u64 = 256 * 1024 * 1024;
const WUWA_HOST: &str = "aki-gm-resources-oversea.aki-game.net";
const WUWA_API: &str = "https://gmserver-api.aki-game2.net/gacha/record/query";

fn history_name(game: &str) -> &'static str {
    match game {
        "genshin" => "wish history",
        "hsr" => "warp history",
        "zzz" => "signal search history",
        _ => "convene history",
    }
}

fn open_first(game: &str) -> String {
    format!("Open your {} in the game first, then scan again.", history_name(game))
}

fn expired(game: &str) -> String {
    format!(
        "The game's history link has expired. Open your {} in the game again, then scan again.",
        history_name(game)
    )
}

/// The game folder's `<Name>_Data` markers, per game.
fn data_markers(game: &str) -> &'static [&'static str] {
    match game {
        "genshin" => &["GenshinImpact_Data", "YuanShen_Data"],
        "hsr" => &["StarRail_Data"],
        "zzz" => &["ZenlessZoneZero_Data"],
        _ => &[],
    }
}

/// The game's `*_Data` folder, from the last line of its Unity log that names one.
pub fn extract_game_data_dir(log: &str, game: &str) -> Option<PathBuf> {
    let markers = data_markers(game);
    for line in log.lines().rev() {
        for marker in markers {
            let Some(at) = line.find(marker) else { continue };
            let bytes = line.as_bytes();
            // The last drive letter ("C:/" or "C:\") before the marker starts the path.
            let start = (0..at.saturating_sub(2)).rev().find(|&i| {
                bytes[i].is_ascii_alphabetic()
                    && bytes[i + 1] == b':'
                    && (bytes[i + 2] == b'/' || bytes[i + 2] == b'\\')
                    && (i == 0 || !bytes[i - 1].is_ascii_alphanumeric())
            });
            if let Some(start) = start {
                return Some(PathBuf::from(&line[start..at + marker.len()]));
            }
        }
    }
    None
}

/// `2.31.0.0` gives `[2, 31, 0, 0]`. Anything that is not dotted numbers gives None.
pub fn parse_semver_version(name: &str) -> Option<Vec<u32>> {
    let parts: Option<Vec<u32>> = name.split('.').map(|part| part.parse().ok()).collect();
    parts.filter(|parts| parts.len() >= 2)
}

fn is_url_byte(b: u8) -> bool {
    b.is_ascii_graphic() && !matches!(b, b'"' | b'\'' | b'<' | b'>' | b'\\' | b'^' | b'`' | b'{' | b'}' | b'|')
}

fn query_value(query: &str, key: &str) -> Option<String> {
    url_pairs(query).find(|(k, _)| k == key).map(|(_, v)| v)
}

fn url_pairs(query: &str) -> impl Iterator<Item = (String, String)> + '_ {
    tauri::Url::parse(&format!("https://q.invalid/?{query}"))
        .ok()
        .map(|url| url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
}

fn hoyo_host(host: &str) -> bool {
    ["hoyoverse.com", "mihoyo.com"]
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

/// The cleaned address of a history page, or None when it is not one for this game.
fn accept_url(candidate: &str, game: &str) -> Option<String> {
    let url = Url::parse(candidate).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return None;
    }
    let host = url.host_str()?.to_ascii_lowercase();
    if game == "wuwa" {
        if host != WUWA_HOST {
            return None;
        }
        let params = url.fragment()?.split_once('?')?.1;
        let has = |key: &str| query_value(params, key).is_some_and(|v| !v.is_empty());
        return (has("player_id") && has("record_id") && has("svr_id") && has("resources_id"))
            .then(|| format!("https://{host}{}#{}", url.path(), url.fragment().unwrap_or("")));
    }
    if !hoyo_host(&host) {
        return None;
    }
    let query = url.query()?;
    query_value(query, "authkey").filter(|v| !v.is_empty())?;
    let marker = match game {
        "genshin" => "hk4e",
        "hsr" => "hkrpg",
        "zzz" => "nap",
        _ => return None,
    };
    let biz_matches = query_value(query, "game_biz").is_some_and(|biz| biz.starts_with(marker));
    if !biz_matches && !host.contains(marker) && !url.path().contains(marker) {
        return None;
    }
    let is_gacha = query_value(query, "auth_appid").as_deref() == Some("webview_gacha")
        || url.path().to_ascii_lowercase().contains("gacha");
    if !is_gacha {
        return None;
    }
    // Only the query matters; the request goes to the fixed history API.
    Some(format!("https://{host}{}?{query}", url.path()))
}

/// The LAST history address for `game` in a web cache or log. Plain HTTP and
/// hosts other than the game's own are ignored.
pub fn extract_last_gacha_url(bytes: &[u8], game: &str) -> Option<String> {
    const NEEDLE: &[u8] = b"https://";
    let mut found = None;
    let mut index = 0;
    while index + NEEDLE.len() <= bytes.len() {
        let Some(offset) = bytes[index..].windows(NEEDLE.len()).position(|w| w == NEEDLE) else { break };
        let start = index + offset;
        let end = bytes[start..]
            .iter()
            .position(|b| !is_url_byte(*b))
            .map_or(bytes.len(), |len| start + len);
        if end - start <= 8192
            && let Ok(candidate) = std::str::from_utf8(&bytes[start..end])
            && let Some(url) = accept_url(candidate, game)
        {
            found = Some(url);
        }
        index = start + NEEDLE.len();
    }
    found
}

/// Up to `limit` bytes from the end of a file. A file the game holds open is
/// copied to a temporary file first.
fn read_tail(path: &Path, limit: u64) -> Option<Vec<u8>> {
    fn read(path: &Path, limit: u64) -> std::io::Result<Vec<u8>> {
        let mut file = fs::File::open(path)?;
        let len = file.metadata()?.len();
        if len > limit {
            file.seek(SeekFrom::Start(len - limit))?;
        }
        let mut bytes = Vec::with_capacity(len.min(limit) as usize);
        file.take(limit).read_to_end(&mut bytes)?;
        Ok(bytes)
    }
    if let Ok(bytes) = read(path, limit) {
        return Some(bytes);
    }
    // One name per copy, so two scans at once never read or delete each other's.
    static COPIES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let copy = COPIES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temporary = std::env::temp_dir().join(format!("memoria-gacha-{}-{copy}.tmp", std::process::id()));
    let copied = fs::copy(path, &temporary).ok().and_then(|_| read(&temporary, limit).ok());
    let _ = fs::remove_file(&temporary);
    copied
}

fn local_low() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join("AppData").join("LocalLow"))
}

fn log_files(game: &str) -> Vec<PathBuf> {
    let Some(low) = local_low() else { return Vec::new() };
    let pairs: &[(&str, &str)] = match game {
        "genshin" => &[("miHoYo/Genshin Impact", "output_log.txt"), ("miHoYo/原神", "output_log.txt")],
        "hsr" => &[("Cognosphere/Star Rail", "Player.log"), ("miHoYo/崩坏：星穹铁道", "Player.log")],
        "zzz" => &[("miHoYo/ZenlessZoneZero", "Player.log"), ("miHoYo/绝区零", "Player.log")],
        _ => &[],
    };
    pairs
        .iter()
        .flat_map(|(dir, file)| {
            let dir = low.join(dir);
            let prev = if file.ends_with(".log") {
                file.replace(".log", "-prev.log")
            } else {
                format!("{file}.last")
            };
            [dir.join(file), dir.join(prev)]
        })
        .filter(|path| path.is_file())
        .collect()
}

/// `data_2` files under a `*_Data` folder, newest web cache version first.
fn cache_files(data_dir: &Path) -> Vec<PathBuf> {
    let caches = data_dir.join("webCaches");
    let mut versions: Vec<(Vec<u32>, PathBuf)> = fs::read_dir(&caches)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    Some((parse_semver_version(&name)?, entry.path()))
                })
                .collect()
        })
        .unwrap_or_default();
    versions.sort_by(|a, b| b.0.cmp(&a.0));
    versions
        .into_iter()
        .map(|(_, dir)| dir)
        .chain(std::iter::once(caches))
        .map(|dir| dir.join("Cache").join("Cache_Data").join("data_2"))
        .filter(|file| file.is_file())
        .collect()
}

/// A `*_Data` folder from a folder the player picked: the folder itself, or one or two levels in.
fn data_dir_in(picked: &Path, game: &str) -> Option<PathBuf> {
    let markers = data_markers(game);
    let matches = |p: &Path| p.file_name().is_some_and(|n| markers.iter().any(|m| n == *m)) && p.is_dir();
    if matches(picked) {
        return Some(picked.to_path_buf());
    }
    let children = |dir: &Path| -> Vec<PathBuf> {
        fs::read_dir(dir)
            .map(|entries| entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).take(200).collect())
            .unwrap_or_default()
    };
    for child in children(picked) {
        if matches(&child) {
            return Some(child);
        }
        if let Some(grandchild) = children(&child).into_iter().find(|p| matches(p)) {
            return Some(grandchild);
        }
    }
    None
}

fn wuwa_logs(roots: &[PathBuf]) -> Vec<PathBuf> {
    roots
        .iter()
        .flat_map(|root| {
            [
                root.join("Client/Saved/Logs/Client.log"),
                root.join("Wuthering Waves Game/Client/Saved/Logs/Client.log"),
                root.join("Client/Binaries/Win64/ThirdParty/KrPcSdk_Global/KRSDKRes/KRSDKWebView/debug.log"),
            ]
        })
        .filter(|path| path.is_file())
        .collect()
}

fn wuwa_default_roots() -> Vec<PathBuf> {
    let relative = [
        r"Wuthering Waves\Wuthering Waves Game",
        r"Program Files\Wuthering Waves\Wuthering Waves Game",
        r"Program Files\Epic Games\WutheringWavesj3oFh\Wuthering Waves Game",
        r"Program Files\Epic Games\WutheringWavesj3oFh",
        r"Epic Games\WutheringWavesj3oFh\Wuthering Waves Game",
        r"Games\Wuthering Waves\Wuthering Waves Game",
    ];
    ('C'..='H')
        .flat_map(|drive| relative.iter().map(move |rel| PathBuf::from(format!(r"{drive}:\{rel}"))))
        .filter(|root| root.is_dir())
        .collect()
}

/// The newest history address on this PC. Blocking file work: run it off the async runtime.
pub fn locate(game: &str, picked: Option<&Path>) -> Result<String, String> {
    if !GAMES.contains(&game) {
        return Err("This game has no history scan.".into());
    }
    if game == "wuwa" {
        let roots = picked.map_or_else(wuwa_default_roots, |p| vec![p.to_path_buf()]);
        return wuwa_logs(&roots)
            .iter()
            .filter_map(|log| read_tail(log, MAX_LOG_BYTES))
            .find_map(|bytes| extract_last_gacha_url(&bytes, game))
            .ok_or_else(|| open_first(game));
    }
    let mut data_dirs: Vec<PathBuf> = picked.and_then(|p| data_dir_in(p, game)).into_iter().collect();
    if picked.is_none() {
        for log in log_files(game) {
            if let Some(dir) = read_tail(&log, MAX_LOG_BYTES)
                .and_then(|bytes| extract_game_data_dir(&String::from_utf8_lossy(&bytes), game))
                && !data_dirs.contains(&dir)
            {
                data_dirs.push(dir);
            }
        }
    }
    if data_dirs.is_empty() {
        return Err(if picked.is_some() {
            "That folder does not hold the game. Choose the folder the game is installed in.".into()
        } else {
            format!("Memoria could not find the game on this PC. {}", open_first(game))
        });
    }
    data_dirs
        .iter()
        .flat_map(|dir| cache_files(dir))
        .filter_map(|file| read_tail(&file, MAX_CACHE_BYTES))
        .find_map(|bytes| extract_last_gacha_url(&bytes, game))
        .ok_or_else(|| open_first(game))
}

fn banners(game: &str) -> &'static [&'static str] {
    match game {
        "genshin" => &["301", "302", "200", "500"],
        "hsr" => &["11", "12", "1", "2"],
        "zzz" => &["2001", "3001", "5001", "1001"],
        _ => &[],
    }
}

fn hoyo_endpoint(game: &str, china: bool) -> &'static str {
    match (game, china) {
        ("genshin", false) => "https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog",
        ("genshin", true) => "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog",
        ("hsr", false) => "https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getGachaLog",
        ("hsr", true) => "https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getGachaLog",
        ("zzz", false) => "https://public-operation-nap-sg.hoyoverse.com/common/gacha_record/api/getGachaLog",
        _ => "https://public-operation-nap.mihoyo.com/common/gacha_record/api/getGachaLog",
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Memoria could not prepare a secure connection.".to_string())
}

fn unreachable_error() -> String {
    "The game's history service could not be reached. Check your connection and try again.".into()
}

/// One banner page's request address.
fn page_url(game: &str, source: &Url, banner: &str, page: u32, end_id: &str) -> Option<Url> {
    let china = source.host_str().is_some_and(|h| h.ends_with("mihoyo.com"));
    let mut url = Url::parse(hoyo_endpoint(game, china)).ok()?;
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in source.query_pairs() {
            if !matches!(
                &*key,
                "gacha_type"
                    | "real_gacha_type"
                    | "page"
                    | "size"
                    | "end_id"
                    | "begin_id"
                    | "gacha_id"
                    | "default_gacha_type"
                    | "init_type"
                    | "decide_item_id_list"
                    | "version_switch"
                    | "lang"
            ) {
                query.append_pair(&key, &value);
            }
        }
        query
            .append_pair("lang", "en")
            .append_pair("size", &PAGE_SIZE.to_string())
            .append_pair("page", &page.to_string())
            .append_pair("end_id", end_id)
            .append_pair("gacha_type", banner);
        if game == "zzz" {
            query.append_pair("real_gacha_type", banner);
        }
    }
    Some(url)
}

fn pull(game: &str, item: &Value, fallback_type: &str) -> Option<Value> {
    let text = |key: &str| item[key].as_str().map(|s| s.chars().take(80).collect::<String>());
    let raw_rank = text("rank_type")
        .and_then(|r| r.parse::<u8>().ok())
        .or_else(|| item["rank_type"].as_u64().map(|r| r as u8));
    let rank = if game == "zzz" {
        raw_rank.map(|r| r.saturating_add(1))
    } else {
        raw_rank
    };
    Some(json!({
        "id": text("id")?,
        "time": text("time")?,
        "name": text("name")?,
        "rank": rank,
        "gachaType": text("gacha_type")
            .or_else(|| text("real_gacha_type"))
            .unwrap_or_else(|| fallback_type.to_string()),
        "itemType": text("item_type"),
    }))
}

async fn fetch_hoyo(game: &str, address: &str) -> Result<Value, String> {
    let source = Url::parse(address).map_err(|_| open_first(game))?;
    let client = client()?;
    let mut pulls = Vec::new();
    let mut seen = HashSet::new();
    let mut uid: Option<String> = None;
    let mut first = true;
    for banner in banners(game) {
        let mut end_id = "0".to_string();
        for page in 1..=MAX_PAGES {
            if !first {
                tokio::time::sleep(PAGE_DELAY).await;
            }
            first = false;
            let url = page_url(game, &source, banner, page, &end_id).ok_or_else(|| open_first(game))?;
            let body: Value = client
                .get(url)
                .send()
                .await
                .map_err(|_| unreachable_error())?
                .json()
                .await
                .map_err(|_| unreachable_error())?;
            match body["retcode"].as_i64() {
                Some(0) => {}
                Some(-101) => return Err(expired(game)),
                Some(-100) | Some(-110) => return Err(open_first(game)),
                Some(code) => return Err(format!("The game's history service refused the scan (code {code}).")),
                None => return Err(unreachable_error()),
            }
            let list = body["data"]["list"].as_array().cloned().unwrap_or_default();
            for item in &list {
                if uid.is_none() {
                    uid = item["uid"].as_str().map(str::to_string);
                }
                if let Some(pull) = pull(game, item, banner)
                    && seen.insert(pull["id"].as_str().unwrap_or("").to_string())
                {
                    pulls.push(pull);
                }
            }
            match list.last().and_then(|item| item["id"].as_str()) {
                Some(last) if list.len() >= PAGE_SIZE => end_id = last.to_string(),
                _ => break,
            }
        }
    }
    Ok(json!({ "presetKey": game, "uid": uid, "pulls": pulls }))
}

async fn fetch_wuwa(address: &str) -> Result<Value, String> {
    let game = "wuwa";
    let fragment = address.split_once('#').map(|(_, f)| f).unwrap_or("");
    let params = fragment.split_once('?').map(|(_, q)| q).unwrap_or("");
    let get = |key: &str| query_value(params, key).ok_or_else(|| open_first(game));
    let (player, record, server, resources) = (get("player_id")?, get("record_id")?, get("svr_id")?, get("resources_id")?);
    let client = client()?;
    let mut pulls = Vec::new();
    for pool in 1..=4u32 {
        if pool > 1 {
            tokio::time::sleep(PAGE_DELAY).await;
        }
        let body: Value = client
            .post(WUWA_API)
            .json(&json!({
                "playerId": player,
                "cardPoolId": resources,
                "cardPoolType": pool,
                "serverId": server,
                "languageCode": "en",
                "recordId": record,
            }))
            .send()
            .await
            .map_err(|_| unreachable_error())?
            .json()
            .await
            .map_err(|_| unreachable_error())?;
        if body["code"].as_i64() != Some(0) {
            return Err(expired(game));
        }
        let list = body["data"].as_array().cloned().unwrap_or_default();
        // Convene records carry no id. Pulls in one ten-pull share a time, so
        // the id counts them within that time, which stays stable as more arrive.
        let mut previous_time = String::new();
        let mut same_time = 0u32;
        for item in list.iter().take(MAX_PAGES as usize * PAGE_SIZE) {
            let time = item["time"].as_str().unwrap_or("").chars().take(40).collect::<String>();
            same_time = if time == previous_time { same_time + 1 } else { 0 };
            previous_time.clone_from(&time);
            let Some(name) = item["name"].as_str() else { continue };
            pulls.push(json!({
                "id": format!("wuwa-{pool}-{}-{same_time}", time.replace([' ', ':', '-'], "")),
                "time": time,
                "name": name.chars().take(80).collect::<String>(),
                "rank": item["qualityLevel"].as_u64().map(|r| r as u8),
                "gachaType": pool.to_string(),
                "itemType": item["resourceType"].as_str(),
            }));
        }
    }
    Ok(json!({ "presetKey": game, "uid": player, "pulls": pulls }))
}

/// Pulls for every banner, from the address `locate` found. Never returns the address.
pub async fn fetch(game: &str, address: &str) -> Result<Value, String> {
    if game == "wuwa" {
        fetch_wuwa(address).await
    } else {
        fetch_hoyo(game, address).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_game_folder_in_its_log() {
        let log = "Some line\n[Subsystems] Discovering subsystems at path D:/Games/Genshin Impact game/GenshinImpact_Data/UnitySubsystems\nother";
        assert_eq!(
            extract_game_data_dir(log, "genshin").unwrap(),
            PathBuf::from("D:/Games/Genshin Impact game/GenshinImpact_Data")
        );
        let star = "Loading C:\\Old\\StarRail_Data\\x\nLoading E:\\HoYoPlay\\games\\Star Rail Games\\StarRail_Data\\Plugins";
        assert_eq!(
            extract_game_data_dir(star, "hsr").unwrap(),
            PathBuf::from("E:\\HoYoPlay\\games\\Star Rail Games\\StarRail_Data")
        );
        assert!(extract_game_data_dir(star, "zzz").is_none());
        assert!(extract_game_data_dir("no paths here", "genshin").is_none());
    }

    #[test]
    fn picks_the_last_trusted_history_url() {
        let first = "https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog?authkey=OLD&game_biz=hk4e_global";
        let last = "https://gs.hoyoverse.com/genshin/event/e20190909gacha-v3/index.html?win_mode=fullscreen&authkey=NEW%2B&game_biz=hk4e_global#/log";
        let http = "http://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog?authkey=PLAIN&game_biz=hk4e_global";
        let evil = "https://hoyoverse.com.evil.example/getGachaLog?authkey=EVIL&game_biz=hk4e_global";
        let lookalike = "https://evilhoyoverse.com/getGachaLog?authkey=EVIL2&game_biz=hk4e_global";
        let star = "https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getGachaLog?authkey=STAR&game_biz=hkrpg_global";
        let cache = format!("1/0/{first}\0\0garbage{last}\u{1}{star}\0{http}\0{evil}\n{lookalike}");
        let found = extract_last_gacha_url(cache.as_bytes(), "genshin").unwrap();
        assert!(found.contains("authkey=NEW%2B"), "{found}");
        assert!(!found.contains('#'));
        assert!(extract_last_gacha_url(cache.as_bytes(), "hsr").unwrap().contains("authkey=STAR"));
        assert!(extract_last_gacha_url(http.as_bytes(), "genshin").is_none());
        assert!(extract_last_gacha_url(evil.as_bytes(), "genshin").is_none());
        assert!(extract_last_gacha_url(lookalike.as_bytes(), "genshin").is_none());
        assert!(extract_last_gacha_url(b"https://gs.hoyoverse.com/x?game_biz=hk4e_global", "genshin").is_none());

        let wuwa = "[2024] url https://aki-gm-resources-oversea.aki-game.net/aki/gacha/index.html#/record?svr_id=abc&player_id=500000001&lang=en&gacha_id=1&gacha_type=1&svr_area=global&record_id=rec&resources_id=res\"";
        let found = extract_last_gacha_url(wuwa.as_bytes(), "wuwa").unwrap();
        assert!(found.ends_with("resources_id=res"));
        assert!(extract_last_gacha_url(wuwa.replace("oversea.aki-game.net", "oversea.aki-game.net.evil.example").as_bytes(), "wuwa").is_none());

        let with_event_after = format!(
            "{last}\0https://act.hoyoverse.com/ys/event/blue-post/index.html?auth_appid=bluepost&game_biz=hk4e_global&authkey=NOTICE"
        );
        let picked = extract_last_gacha_url(with_event_after.as_bytes(), "genshin").unwrap();
        assert!(picked.contains("authkey=NEW%2B"), "{picked}");
    }

    #[test]
    fn sorts_cache_versions_as_numbers() {
        assert_eq!(parse_semver_version("2.31.0.0"), Some(vec![2, 31, 0, 0]));
        assert_eq!(parse_semver_version("Cache"), None);
        assert_eq!(parse_semver_version("2"), None);
        assert_eq!(parse_semver_version("2.x.0"), None);
        assert!(parse_semver_version("2.31.0.0") > parse_semver_version("2.4.0.0"));
    }

    #[test]
    fn page_requests_go_to_the_fixed_api_with_the_found_query() {
        let source = Url::parse("https://gs.hoyoverse.com/x?authkey=K%2B&game_biz=hk4e_global&gacha_type=999&page=9").unwrap();
        let url = page_url("genshin", &source, "301", 2, "123").unwrap();
        assert_eq!(url.host_str(), Some("public-operation-hk4e-sg.hoyoverse.com"));
        let pairs: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.into(), v.into())).collect();
        assert!(pairs.contains(&("authkey".into(), "K+".into())));
        assert!(pairs.contains(&("gacha_type".into(), "301".into())));
        assert!(pairs.contains(&("page".into(), "2".into())));
        assert!(!pairs.contains(&("gacha_type".into(), "999".into())));

        let ld_source = Url::parse(
            "https://public-operation-hkrpg-sg.hoyoverse.com/common/hkrpg_gacha_record/api/getLdGachaLog?authkey=K%2B&game_biz=hkrpg_global&auth_appid=webview_gacha&begin_id=0&gacha_id=99&default_gacha_type=11",
        )
        .unwrap();
        let hsr_url = page_url("hsr", &ld_source, "11", 1, "0").unwrap();
        let hsr_pairs: Vec<(String, String)> = hsr_url.query_pairs().map(|(k, v)| (k.into(), v.into())).collect();
        assert!(hsr_pairs.contains(&("authkey".into(), "K+".into())));
        assert!(!hsr_pairs.iter().any(|(k, _)| k == "begin_id" || k == "gacha_id" || k == "default_gacha_type"));
    }

    #[test]
    fn normalises_zzz_ranks_and_falls_back_to_real_gacha_type() {
        let item = json!({
            "id": "z1",
            "time": "2026-11-21 12:00:00",
            "name": "Miyabi",
            "rank_type": "4",
            "real_gacha_type": "2001",
            "item_type": "Agents"
        });
        let parsed = pull("zzz", &item, "2").unwrap();
        assert_eq!(parsed["rank"], 5);
        assert_eq!(parsed["gachaType"], "2001");

        let genshin = pull("genshin", &item, "301").unwrap();
        assert_eq!(genshin["rank"], 4);
    }
}
