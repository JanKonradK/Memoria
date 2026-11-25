//! HoYoLAB's Battle Chronicle notes, daily check-in and code redemption, with
//! the player's own sign-in.
//!
//! Requests carry the cookies in a header marked sensitive. Errors are turned
//! into fixed sentences here, because a reqwest error prints its URL and a
//! response body is never echoed back.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::{Map, Value, json};

use super::{ConnectorManager, Cookies, now_ms};

/// The account's game roles, read with the cookie token first and the ltoken second.
const ROLES_URLS: [&str; 2] = [
    "https://api-account-os.hoyolab.com/account/binding/api/getUserGameRolesByCookie",
    "https://api-account-os.hoyolab.com/account/binding/api/getUserGameRolesByLtoken",
];
/// The Battle Chronicle cards on the account's HoYoLAB profile, which also name
/// its roles. Read only when the bindings list none.
const RECORD_CARD_URL: &str = "https://bbs-api-os.hoyolab.com/game_record/card/wapi/getGameRecordCard";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// HoYoLAB asked for a captcha: leave it alone for two hours.
pub const BACKOFF: Duration = Duration::from_secs(2 * 60 * 60);
pub const MANUAL_GAP: Duration = Duration::from_secs(10);
pub const AUTO_GAP: Duration = Duration::from_secs(15 * 60);

/// The game a HoYoLAB `game_biz` belongs to, by Memoria preset key.
pub fn preset_for_biz(biz: &str) -> Option<&'static str> {
    match biz {
        "hk4e_global" => Some("genshin"),
        "hkrpg_global" => Some("hsr"),
        "nap_global" => Some("zzz"),
        _ => None,
    }
}

/// The game a Battle Chronicle card's `game_id` belongs to, by Memoria preset key.
fn preset_for_card_game(game_id: i64) -> Option<&'static str> {
    match game_id {
        2 => Some("genshin"),
        6 => Some("hsr"),
        8 => Some("zzz"),
        _ => None,
    }
}

const SG_GENSHIN: &str = "https://sg-public-api.hoyolab.com/event/game_record/genshin/api";
const BBS_GENSHIN: &str = "https://bbs-api-os.hoyolab.com/game_record/genshin/api";
const SG_HSR: &str = "https://sg-public-api.hoyolab.com/event/game_record/hkrpg/api";
const BBS_HSR: &str = "https://bbs-api-os.hoyolab.com/game_record/hkrpg/api";
const NAP_ZZZ: &str = "https://sg-act-nap-api.hoyolab.com/event/game_record_zzz/api/zzz";

/// A game's Real-Time Notes, as the URLs to try in order: HoYoLAB's newer
/// `sg-public-api` gateway first, the older `bbs-api-os` one second. Empty for
/// a game without notes.
fn note_urls(preset_key: &str, region: &str, uid: &str) -> Vec<String> {
    let role = format!("server={region}&role_id={uid}");
    match preset_key {
        "genshin" => vec![
            format!("{SG_GENSHIN}/dailyNote?{role}"),
            format!("{BBS_GENSHIN}/dailyNote?{role}"),
        ],
        "hsr" => vec![format!("{SG_HSR}/note?{role}"), format!("{BBS_HSR}/note?{role}")],
        "zzz" => vec![format!("{NAP_ZZZ}/note?{role}")],
        _ => Vec::new(),
    }
}

/// What one notes answer means for the URLs still to try.
#[derive(Debug, PartialEq)]
enum NoteAnswer {
    /// The notes themselves.
    Notes,
    /// HoYoLAB asked for a captcha: stop and leave it alone for two hours.
    Captcha,
    /// The sign-in was refused or the account keeps its notes private: every
    /// gateway gives the same answer, so stop here.
    Final,
    /// A gateway mismatch (-10001), any other code or an empty answer: the
    /// other gateway may still answer.
    Retry,
}

fn note_answer(retcode: i64, data: &Value) -> NoteAnswer {
    match retcode {
        0 if data.is_object() => NoteAnswer::Notes,
        1034 => NoteAnswer::Captcha,
        -100 | 10001 | 10102 => NoteAnswer::Final,
        _ => NoteAnswer::Retry,
    }
}

fn note_error(retcode: i64) -> String {
    match retcode {
        -100 | 10001 => "HoYoLAB did not accept the sign-in. Sign in again.".into(),
        10102 => "This account keeps its Real-Time Notes private on HoYoLAB.".into(),
        0 => "HoYoLAB sent no notes for this account.".into(),
        _ => format!("HoYoLAB could not read this account's notes (code {retcode})."),
    }
}

/// The failure worth reporting once every URL has failed: a HoYoLAB code beats
/// a connection or HTTP error, and any other code beats the gateway's -10001,
/// which only says the request reached the wrong host. Ties keep the first.
#[derive(Debug, PartialEq)]
struct Failure {
    retcode: Option<i64>,
    error: String,
}

impl Failure {
    fn rank(retcode: Option<i64>) -> u8 {
        match retcode {
            None => 0,
            Some(-10001) => 1,
            Some(_) => 2,
        }
    }

    fn keep(slot: &mut Option<Failure>, retcode: Option<i64>, error: String) {
        // A 0 without data is no refusal: it is kept without a code.
        let retcode = retcode.filter(|code| *code != 0);
        if slot.as_ref().is_none_or(|kept| Self::rank(retcode) > Self::rank(kept.retcode)) {
            *slot = Some(Failure { retcode, error });
        }
    }
}

/// The endgame records read alongside a game's notes, as `(key under
/// "_endgame", URLs to try in order)`. Empty for a game without any.
fn endgame_urls(preset_key: &str, region: &str, uid: &str) -> Vec<(&'static str, Vec<String>)> {
    let role = format!("server={region}&role_id={uid}");
    let genshin = |path: &str, query: &str| {
        vec![
            format!("{SG_GENSHIN}/{path}?{role}&{query}"),
            format!("{BBS_GENSHIN}/{path}?{role}&{query}"),
        ]
    };
    let hsr = |path: &str| {
        vec![
            format!("{SG_HSR}/{path}?{role}&schedule_type=1&need_all=true"),
            format!("{BBS_HSR}/{path}?{role}&schedule_type=1&need_all=true"),
        ]
    };
    match preset_key {
        "genshin" => vec![
            ("spiralAbyss", genshin("spiralAbyss", "schedule_type=1")),
            ("roleCombat", genshin("role_combat", "need_detail=false")),
            ("hardChallenge", genshin("hard_challenge", "need_detail=false")),
        ],
        "hsr" => vec![
            ("moc", hsr("challenge")),
            ("pf", hsr("challenge_story")),
            ("as", hsr("challenge_boss")),
        ],
        "zzz" => vec![
            ("shiyu", vec![format!("{NAP_ZZZ}/hadal_info_v2?{role}&schedule_type=1")]),
            (
                "deadlyAssault",
                vec![format!("{NAP_ZZZ}/hadal_mem_detail_v2?{role}&schedule_type=1&uid={uid}")],
            ),
        ],
        _ => Vec::new(),
    }
}

/// One host of a game's daily check-in.
#[derive(Debug, PartialEq)]
struct CheckinHost {
    info: String,
    sign: String,
    /// The `x-rpc-signgame` header the host wants, if any.
    sign_game: Option<&'static str>,
}

/// HoYoLAB's daily check-in for a game: its act id and the hosts to try in
/// order. Star Rail's own `luna/hkrpg/os` (which wants `x-rpc-signgame:
/// hkrpg`) comes first, and the shared `luna/os` stays as its fallback.
fn checkin_urls(preset_key: &str) -> Option<(&'static str, Vec<CheckinHost>)> {
    let (act_id, bases): (_, &[(&str, Option<&'static str>)]) = match preset_key {
        "genshin" => ("e202102251931481", &[("https://sg-hk4e-api.hoyolab.com/event/sol", None)]),
        "hsr" => (
            "e202303301540311",
            &[
                ("https://sg-public-api.hoyolab.com/event/luna/hkrpg/os", Some("hkrpg")),
                ("https://sg-public-api.hoyolab.com/event/luna/os", None),
            ],
        ),
        "zzz" => (
            "e202406031448091",
            &[("https://sg-act-nap-api.hoyolab.com/event/luna/zzz/os", Some("zzz"))],
        ),
        _ => return None,
    };
    let hosts = bases
        .iter()
        .map(|(base, sign_game)| CheckinHost {
            info: format!("{base}/info?lang=en-us&act_id={act_id}"),
            sign: format!("{base}/sign?lang=en-us"),
            sign_game: *sign_game,
        })
        .collect();
    Some((act_id, hosts))
}

/// HoYoverse's web code redemption for a game: `(URL without the query, game_biz, site)`.
fn redeem_target(preset_key: &str) -> Option<(&'static str, &'static str, &'static str)> {
    match preset_key {
        "genshin" => Some((
            "https://sg-hk4e-api.hoyoverse.com/common/apicdkey/api/webExchangeCdkey",
            "hk4e_global",
            "https://genshin.hoyoverse.com",
        )),
        "hsr" => Some((
            "https://public-operation-hkrpg.hoyoverse.com/common/apicdkey/api/webExchangeCdkey",
            "hkrpg_global",
            "https://hsr.hoyoverse.com",
        )),
        "zzz" => Some((
            "https://public-operation-nap.hoyoverse.com/common/apicdkey/api/webExchangeCdkey",
            "nap_global",
            "https://zenless.hoyoverse.com",
        )),
        _ => None,
    }
}

/// A redemption code as typed: trimmed, 1–80 letters, digits, `_` or `-`.
fn clean_code(code: &str) -> Option<&str> {
    let code = code.trim();
    (!code.is_empty()
        && code.len() <= 80
        && code.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
    .then_some(code)
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|_| "Memoria could not prepare a secure connection.".to_string())
}

fn headers(cookies: &Cookies) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    let mut put = |name: &'static str, value: &str| -> Result<(), String> {
        let value = HeaderValue::from_str(value).map_err(|_| "The HoYoLAB sign-in is damaged. Sign in again.".to_string())?;
        map.insert(HeaderName::from_static(name), value);
        Ok(())
    };
    put("ds", &super::ds::hoyolab_ds_os())?;
    put("x-rpc-app_version", "1.5.0")?;
    put("x-rpc-client_type", "5")?;
    put("x-rpc-language", "en-us")?;
    put("x-rpc-lang", "en-us")?;
    put("origin", "https://act.hoyolab.com")?;
    put("referer", "https://act.hoyolab.com/")?;
    put("accept", "application/json, text/plain, */*")?;
    let mut cookie =
        HeaderValue::from_str(&cookies.header()).map_err(|_| "The HoYoLAB sign-in is damaged. Sign in again.".to_string())?;
    cookie.set_sensitive(true);
    map.insert(reqwest::header::COOKIE, cookie);
    Ok(map)
}

/// `(retcode, data)` from a HoYoLAB GET.
async fn get_with(client: &reqwest::Client, url: &str, cookies: &Cookies) -> Result<(i64, Value), String> {
    let response = client
        .get(url)
        .headers(headers(cookies)?)
        .send()
        .await
        .map_err(|_| "HoYoLAB could not be reached. Check your connection and try again.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("HoYoLAB answered with an error ({}). Try again later.", response.status().as_u16()));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|_| "HoYoLAB sent an answer Memoria could not read.".to_string())?;
    let retcode = body["retcode"].as_i64().unwrap_or(-1);
    Ok((retcode, body["data"].clone()))
}

fn roles_error(retcode: i64) -> String {
    match retcode {
        -100 | 10001 => "HoYoLAB did not accept the sign-in. Sign in again.".into(),
        _ => format!("HoYoLAB could not list your game accounts (code {retcode})."),
    }
}

/// The signed-in account's Genshin, Star Rail and Zenless roles, sanitised.
///
/// The cookie-token binding is asked first and the ltoken one second, since a
/// sign-in may carry only one of the two tokens. When neither lists a tracked
/// role, the profile's Battle Chronicle cards are read for them. Fails only
/// when no source answered; an account without roles is an empty list.
pub async fn fetch_roles(cookies: &Cookies) -> Result<Vec<Value>, String> {
    let client = client(Duration::from_secs(15))?;
    let mut failure: Option<Failure> = None;
    let mut answered = false;
    let mut urls: Vec<String> = ROLES_URLS.iter().map(|url| url.to_string()).collect();
    // HoYoLAB account ids are digits; anything else never reaches a URL.
    if super::valid_uid(&cookies.ltuid) {
        urls.push(format!("{RECORD_CARD_URL}?uid={}", cookies.ltuid));
    }
    for url in &urls {
        match get_with(&client, url, cookies).await {
            Ok((0, data)) => {
                answered = true;
                let roles = if url.starts_with(RECORD_CARD_URL) {
                    sanitize_card_roles(&data)
                } else {
                    sanitize_roles(&data)
                };
                if !roles.is_empty() {
                    return Ok(roles);
                }
            }
            Ok((retcode, _)) => Failure::keep(&mut failure, Some(retcode), roles_error(retcode)),
            Err(error) => Failure::keep(&mut failure, None, error),
        }
    }
    match failure {
        Some(failure) if !answered => Err(failure.error),
        _ => Ok(Vec::new()),
    }
}

/// One sanitised role, or None when its id or server is malformed.
fn role_json(preset: &str, uid: &str, region: &str, role: &Value) -> Option<Value> {
    let text = |v: &Value| v.as_str().map(|s| s.chars().take(40).collect::<String>());
    (super::valid_uid(uid) && super::valid_region(region)).then(|| {
        json!({
            "presetKey": preset,
            "uid": uid,
            "region": region,
            "nickname": text(&role["nickname"]),
            "level": role["level"].as_u64(),
            "regionName": text(&role["region_name"]),
        })
    })
}

/// At most 50 roles, each game's id once.
fn dedupe_roles(roles: impl Iterator<Item = Value>) -> Vec<Value> {
    let mut kept: Vec<Value> = Vec::new();
    for role in roles {
        if kept.len() >= 50 {
            break;
        }
        let seen = kept
            .iter()
            .any(|other| other["presetKey"] == role["presetKey"] && other["uid"] == role["uid"]);
        if !seen {
            kept.push(role);
        }
    }
    kept
}

/// The tracked roles in a binding answer (`list[].game_biz`, `game_uid`).
fn sanitize_roles(data: &Value) -> Vec<Value> {
    let Some(list) = data["list"].as_array() else { return Vec::new() };
    dedupe_roles(list.iter().take(100).filter_map(|role| {
        let preset = preset_for_biz(role["game_biz"].as_str()?)?;
        role_json(preset, role["game_uid"].as_str()?, role["region"].as_str()?, role)
    }))
}

/// The tracked roles in a Battle Chronicle cards answer (`list[].game_id`,
/// `game_role_id`), whose id may come as a string or a number.
fn sanitize_card_roles(data: &Value) -> Vec<Value> {
    let Some(list) = data["list"].as_array() else { return Vec::new() };
    dedupe_roles(list.iter().take(100).filter_map(|card| {
        let preset = preset_for_card_game(card["game_id"].as_i64()?)?;
        let uid = match &card["game_role_id"] {
            Value::String(uid) => uid.clone(),
            Value::Number(uid) => uid.as_u64()?.to_string(),
            _ => return None,
        };
        role_json(preset, &uid, card["region"].as_str()?, card)
    }))
}

/// One optional record: None on any failure, which never fails the notes.
/// A captcha request (1034) sets `captcha`, and every later call stands down.
async fn fetch_optional(client: &reqwest::Client, url: &str, cookies: &Cookies, captcha: &AtomicBool) -> Option<Value> {
    if captcha.load(Ordering::Relaxed) {
        return None;
    }
    match get_with(client, url, cookies).await {
        Ok((0, data)) if !data.is_null() => Some(data),
        Ok((1034, _)) => {
            captcha.store(true, Ordering::Relaxed);
            None
        }
        _ => None,
    }
}

/// The first of a source's URLs that answers, unless HoYoLAB asked for a captcha.
async fn fetch_first(
    client: &reqwest::Client,
    source: Option<&(&'static str, Vec<String>)>,
    cookies: &Cookies,
    captcha: &AtomicBool,
) -> Option<(&'static str, Value)> {
    let (key, urls) = source?;
    for url in urls {
        if let Some(data) = fetch_optional(client, url, cookies, captcha).await {
            return Some((key, data));
        }
    }
    None
}

/// The game's endgame records, read side by side on one connection pool.
/// Best effort: whatever fails is simply missing.
async fn fetch_endgame(link: &super::GameLink, cookies: &Cookies) -> Map<String, Value> {
    let mut found = Map::new();
    let Ok(client) = client(Duration::from_secs(10)) else { return found };
    let sources = endgame_urls(&link.preset_key, &link.region, &link.uid);
    let captcha = AtomicBool::new(false);
    // No game has more than three records.
    let (a, b, c) = tokio::join!(
        fetch_first(&client, sources.first(), cookies, &captcha),
        fetch_first(&client, sources.get(1), cookies, &captcha),
        fetch_first(&client, sources.get(2), cookies, &captcha),
    );
    for (key, data) in [a, b, c].into_iter().flatten() {
        found.insert(key.to_string(), data);
    }
    found
}

/// HoYoLAB's signed headers, plus the check-in host's `x-rpc-signgame`.
fn checkin_headers(cookies: &Cookies, host: &CheckinHost) -> Result<HeaderMap, String> {
    let mut headers = headers(cookies)?;
    if let Some(game) = host.sign_game {
        headers.insert(HeaderName::from_static("x-rpc-signgame"), HeaderValue::from_static(game));
    }
    Ok(headers)
}

/// Today's check-in state from the first host that answers, best effort:
/// None on any failure.
async fn fetch_checkin(link: &super::GameLink, cookies: &Cookies) -> Option<Value> {
    let (_, hosts) = checkin_urls(&link.preset_key)?;
    let client = client(Duration::from_secs(10)).ok()?;
    for host in &hosts {
        let Ok(headers) = checkin_headers(cookies, host) else { continue };
        let Ok(response) = client.get(&host.info).headers(headers).send().await else { continue };
        if !response.status().is_success() {
            continue;
        }
        let Ok(body) = response.json::<Value>().await else { continue };
        if body["retcode"].as_i64() == Some(0) && body["data"].is_object() {
            return Some(body["data"].clone());
        }
    }
    None
}

fn action(ok: bool, status: &str, retcode: Option<i64>, message: &str) -> Value {
    json!({ "ok": ok, "status": status, "retcode": retcode, "message": message })
}

/// The linked game and its sign-in, or the answer to give instead.
fn linked(manager: &ConnectorManager, game_id: &str) -> Result<(super::GameLink, Cookies), Value> {
    let Some(link) = manager.game_link(game_id) else {
        return Err(action(false, "failed", None, "Link this game to a HoYoLAB account first."));
    };
    let Some(cookies) = manager.cookies() else {
        return Err(action(false, "auth", None, "Sign in to HoYoLAB first."));
    };
    Ok((link, cookies))
}

/// Whether a check-in answer settles the claim, so no other host is asked:
/// claimed (or a captcha), already claimed, or a refused sign-in.
fn checkin_settled(retcode: i64) -> bool {
    matches!(retcode, 0 | -5003 | -100 | 10001)
}

fn checkin_answer(retcode: i64, data: &Value) -> Value {
    match retcode {
        0 => {
            let gt = &data["gt_result"];
            let risky = data["is_risk"] == true
                || gt["is_risk"] == true
                || gt["risk_code"].as_i64().is_some_and(|code| code != 0);
            if risky {
                action(false, "captcha", Some(5001), "HoYoLAB asked for verification. Open the check-in page to claim.")
            } else {
                action(true, "claimed", Some(0), "Claimed HoYoLAB daily check-in.")
            }
        }
        -5003 => action(true, "already", Some(-5003), "Already checked in on HoYoLAB today."),
        -100 | 10001 => action(
            false,
            "auth",
            Some(retcode),
            "HoYoLAB sign-in expired. Sign in again in Settings \u{2192} Connections.",
        ),
        _ => action(false, "failed", Some(retcode), &format!("HoYoLAB check-in failed (code {retcode}).")),
    }
}

/// Claims today's HoYoLAB check-in for a linked game.
pub async fn claim_checkin(manager: &ConnectorManager, game_id: &str) -> Value {
    let (link, cookies) = match linked(manager, game_id) {
        Ok(found) => found,
        Err(answer) => return answer,
    };
    let Some((act_id, hosts)) = checkin_urls(&link.preset_key) else {
        return action(false, "failed", None, "This game has no HoYoLAB check-in.");
    };
    let client = match client(Duration::from_secs(15)) {
        Ok(client) => client,
        Err(error) => return action(false, "failed", None, &error),
    };
    let payload = json!({ "act_id": act_id }).to_string();
    // The next host is asked only when this one could not settle the claim.
    // HoYoLAB keeps one claim a day, so asking twice never claims twice.
    let mut failure: Option<Failure> = None;
    for host in &hosts {
        let sent = async {
            let mut headers = checkin_headers(&cookies, host)?;
            headers.insert(reqwest::header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
            let response = client
                .post(&host.sign)
                .headers(headers)
                .body(payload.clone())
                .send()
                .await
                .map_err(|_| "HoYoLAB could not be reached. Check your connection and try again.".to_string())?;
            if !response.status().is_success() {
                return Err(format!("HoYoLAB answered with an error ({}). Try again later.", response.status().as_u16()));
            }
            let body: Value = response
                .json()
                .await
                .map_err(|_| "HoYoLAB sent an answer Memoria could not read.".to_string())?;
            Ok::<_, String>((body["retcode"].as_i64().unwrap_or(-1), body["data"].clone()))
        };
        match sent.await {
            Ok((retcode, data)) if checkin_settled(retcode) => return checkin_answer(retcode, &data),
            Ok((retcode, _)) => Failure::keep(&mut failure, Some(retcode), String::new()),
            Err(error) => Failure::keep(&mut failure, None, error),
        }
    }
    match failure {
        Some(Failure { retcode: Some(retcode), .. }) => checkin_answer(retcode, &Value::Null),
        Some(Failure { error, .. }) => action(false, "failed", None, &error),
        None => action(false, "failed", None, "HoYoLAB check-in failed."),
    }
}

fn redeem_answer(retcode: i64) -> Value {
    let (ok, status, message) = match retcode {
        0 => (true, "redeemed", "Code redeemed! Check in-game mail."),
        -2017 | -2018 => (true, "already", "Already redeemed on this account."),
        -2001 => (false, "expired", "This code has expired."),
        -2003 => (false, "invalid", "Invalid redemption code."),
        -2016 => (false, "cooldown", "Cooldown active \u{2014} wait 5 seconds and try again."),
        -1071 | -100 | 10001 => (
            false,
            "auth",
            "Sign in to HoYoLAB again in Settings \u{2192} Connections for 1-click claiming, or open the redeem page.",
        ),
        -2006 => (false, "expired", "Max redemptions reached for this code."),
        -2004 => (false, "failed", "Account level is too low to claim this code."),
        -1073 => (false, "failed", "No character found on that server."),
        _ => return action(false, "failed", Some(retcode), &format!("Redemption failed (code {retcode}).")),
    };
    action(ok, status, Some(retcode), message)
}

/// Redeems a code on the linked game's account through HoYoverse's web redemption.
pub async fn redeem_code(manager: &ConnectorManager, game_id: &str, code: &str) -> Value {
    let Some(code) = clean_code(code) else {
        return action(false, "invalid", None, "Invalid redemption code.");
    };
    let (link, cookies) = match linked(manager, game_id) {
        Ok(found) => found,
        Err(answer) => return answer,
    };
    let Some((base, biz, site)) = redeem_target(&link.preset_key) else {
        return action(false, "failed", None, "This game has no HoYoverse code redemption.");
    };
    let url = format!(
        "{base}?uid={}&region={}&lang=en&cdkey={code}&game_biz={biz}&sLangKey=en-us",
        link.uid, link.region
    );
    let sent = async {
        let damaged = |_| "The HoYoLAB sign-in is damaged. Sign in again.".to_string();
        let mut cookie = HeaderValue::from_str(&cookies.header()).map_err(damaged)?;
        cookie.set_sensitive(true);
        let mut headers = HeaderMap::new();
        headers.insert(reqwest::header::COOKIE, cookie);
        headers.insert(reqwest::header::ORIGIN, HeaderValue::from_static(site));
        headers.insert(reqwest::header::REFERER, HeaderValue::from_str(&format!("{site}/")).map_err(damaged)?);
        headers.insert(reqwest::header::ACCEPT, HeaderValue::from_static("application/json, text/plain, */*"));
        let response = client(Duration::from_secs(15))?
            .get(&url)
            .headers(headers)
            .send()
            .await
            .map_err(|_| "HoYoverse could not be reached. Check your connection and try again.".to_string())?;
        if !response.status().is_success() {
            return Err(format!("HoYoverse answered with an error ({}). Try again later.", response.status().as_u16()));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|_| "HoYoverse sent an answer Memoria could not read.".to_string())?;
        Ok::<_, String>(body["retcode"].as_i64().unwrap_or(-1))
    };
    match sent.await {
        Ok(retcode) => redeem_answer(retcode),
        Err(error) => action(false, "failed", None, &error),
    }
}

fn result(
    ok: bool,
    retcode: Option<i64>,
    backoff: Option<u64>,
    preset_key: Option<&str>,
    raw: Value,
    error: Option<String>,
) -> Value {
    json!({
        "ok": ok,
        "retcode": retcode,
        "backoffUntilMs": backoff,
        "presetKey": preset_key,
        "observedAt": now_ms(),
        "raw": raw,
        "error": error,
    })
}

/// Reads one linked game's live notes. `auto` refreshes wait 15 minutes per
/// game; a tap waits 10 seconds. A captcha request pauses everything for 2 hours.
pub async fn refresh(manager: &ConnectorManager, game_id: &str, auto: bool) -> Value {
    let fail = |preset: Option<&str>, message: &str| {
        result(false, None, manager.backoff_until_ms(), preset, Value::Null, Some(message.to_string()))
    };
    let Some(link) = manager.game_link(game_id) else {
        return fail(None, "Link this game to a HoYoLAB account first.");
    };
    let preset = Some(link.preset_key.as_str());
    if let Some(until) = manager.backoff_until_ms() {
        return result(
            false,
            Some(1034),
            Some(until),
            preset,
            Value::Null,
            Some("HoYoLAB asked for a verification. Memoria is waiting before it asks again.".into()),
        );
    }
    let Some(cookies) = manager.cookies() else {
        return fail(preset, "Sign in to HoYoLAB first.");
    };
    if let Err(wait) = manager.claim_fetch(game_id, if auto { AUTO_GAP } else { MANUAL_GAP }) {
        return fail(preset, &format!("Read just now. Try again in {wait} s."));
    }
    let urls = note_urls(&link.preset_key, &link.region, &link.uid);
    if urls.is_empty() {
        return fail(preset, "This game has no live notes on HoYoLAB.");
    }
    let client = match client(Duration::from_secs(15)) {
        Ok(client) => client,
        Err(error) => return fail(preset, &error),
    };
    let mut failure: Option<Failure> = None;
    for url in &urls {
        let (retcode, mut data) = match get_with(&client, url, &cookies).await {
            Ok(answer) => answer,
            Err(error) => {
                Failure::keep(&mut failure, None, error);
                continue;
            }
        };
        match note_answer(retcode, &data) {
            NoteAnswer::Notes => {
                let (endgame, checkin) = tokio::join!(fetch_endgame(&link, &cookies), fetch_checkin(&link, &cookies));
                if let Some(note) = data.as_object_mut() {
                    if !endgame.is_empty() {
                        note.insert("_endgame".into(), Value::Object(endgame));
                    }
                    if let Some(checkin) = checkin {
                        note.insert("_checkin".into(), checkin);
                    }
                }
                return result(true, Some(0), None, preset, data, None);
            }
            NoteAnswer::Captcha => {
                let until = now_ms() + BACKOFF.as_millis() as u64;
                manager.set_backoff(until);
                return result(
                    false,
                    Some(1034),
                    Some(until),
                    preset,
                    Value::Null,
                    Some("HoYoLAB asked for a verification. Open Battle Chronicle on HoYoLAB once, then try again.".into()),
                );
            }
            NoteAnswer::Final => {
                return result(false, Some(retcode), None, preset, Value::Null, Some(note_error(retcode)));
            }
            NoteAnswer::Retry => Failure::keep(&mut failure, Some(retcode), note_error(retcode)),
        }
    }
    match failure {
        Some(Failure {
            retcode: Some(retcode),
            error,
        }) => result(false, Some(retcode), None, preset, Value::Null, Some(error)),
        Some(Failure { error, .. }) => fail(preset, &error),
        None => fail(preset, "HoYoLAB could not be reached. Check your connection and try again."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_tracked_games_roles() {
        let data = json!({ "list": [
            { "game_biz": "hk4e_global", "game_uid": "700000001", "region": "os_euro", "nickname": "Traveler", "level": 60, "region_name": "Europe" },
            { "game_biz": "bh3_global", "game_uid": "1", "region": "x" },
            { "game_biz": "nap_global", "game_uid": "1500000001", "region": "prod_gf_eu" },
            { "game_biz": "hkrpg_global", "game_uid": "bad uid", "region": "prod_official_eur" },
        ]});
        let roles = sanitize_roles(&data);
        assert_eq!(roles.len(), 2);
        assert_eq!(roles[0]["presetKey"], "genshin");
        assert_eq!(roles[1]["region"], "prod_gf_eu");
    }

    #[test]
    fn duplicate_roles_are_kept_once() {
        let data = json!({ "list": [
            { "game_biz": "hkrpg_global", "game_uid": "700000001", "region": "prod_official_eur" },
            { "game_biz": "hkrpg_global", "game_uid": "700000001", "region": "prod_official_eur" },
            { "game_biz": "hk4e_global", "game_uid": "700000001", "region": "os_euro" },
        ]});
        let roles = sanitize_roles(&data);
        assert_eq!(roles.len(), 2);
        assert_eq!(roles[0]["presetKey"], "hsr");
        assert_eq!(roles[1]["presetKey"], "genshin");
        assert!(sanitize_roles(&Value::Null).is_empty());
        let many: Vec<Value> = (0..80)
            .map(|n| json!({ "game_biz": "hk4e_global", "game_uid": format!("7000000{n:02}"), "region": "os_euro" }))
            .collect();
        assert_eq!(sanitize_roles(&json!({ "list": many })).len(), 50);
    }

    #[test]
    fn record_cards_name_missing_roles() {
        let data = json!({ "list": [
            { "game_id": 6, "game_role_id": "800000001", "region": "prod_official_asia", "nickname": "Trailblazer", "level": 70, "region_name": "Asia" },
            { "game_id": 2, "game_role_id": 700000001u64, "region": "os_euro" },
            { "game_id": 1, "game_role_id": "10000001", "region": "overseas01" },
            { "game_id": 8, "game_role_id": "bad id", "region": "prod_gf_eu" },
            { "game_id": 6, "game_role_id": "800000001", "region": "prod_official_asia" },
        ]});
        let roles = sanitize_card_roles(&data);
        assert_eq!(roles.len(), 2);
        assert_eq!(
            roles[0],
            json!({
                "presetKey": "hsr",
                "uid": "800000001",
                "region": "prod_official_asia",
                "nickname": "Trailblazer",
                "level": 70,
                "regionName": "Asia",
            })
        );
        assert_eq!(roles[1]["uid"], "700000001");
        assert_eq!(roles[1]["presetKey"], "genshin");
        assert_eq!(preset_for_card_game(8), Some("zzz"));
        assert_eq!(preset_for_card_game(1), None);
    }

    #[test]
    fn note_urls_try_the_sg_gateway_first() {
        let role = "server=prod_official_eur&role_id=700000001";
        assert_eq!(
            note_urls("hsr", "prod_official_eur", "700000001"),
            [
                format!("https://sg-public-api.hoyolab.com/event/game_record/hkrpg/api/note?{role}"),
                format!("https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note?{role}"),
            ]
        );
        let role = "server=os_euro&role_id=700000001";
        assert_eq!(
            note_urls("genshin", "os_euro", "700000001"),
            [
                format!("https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote?{role}"),
                format!("https://bbs-api-os.hoyolab.com/game_record/genshin/api/dailyNote?{role}"),
            ]
        );
        assert_eq!(
            note_urls("zzz", "prod_gf_eu", "1500000001"),
            ["https://sg-act-nap-api.hoyolab.com/event/game_record_zzz/api/zzz/note?server=prod_gf_eu&role_id=1500000001"]
        );
        assert!(note_urls("wuwa", "x", "1").is_empty());
    }

    #[test]
    fn note_answers_decide_whether_to_fall_back() {
        assert_eq!(note_answer(0, &json!({ "current_stamina": 120 })), NoteAnswer::Notes);
        // An empty answer is worth asking the other gateway about.
        assert_eq!(note_answer(0, &Value::Null), NoteAnswer::Retry);
        assert_eq!(note_answer(1034, &Value::Null), NoteAnswer::Captcha);
        for code in [-100, 10001, 10102] {
            assert_eq!(note_answer(code, &Value::Null), NoteAnswer::Final, "{code}");
        }
        for code in [-10001, -1, 10101, -10002] {
            assert_eq!(note_answer(code, &Value::Null), NoteAnswer::Retry, "{code}");
        }
        assert!(note_error(10102).contains("private"));
        assert!(note_error(-100).contains("Sign in again"));
        assert!(note_error(-10001).contains("-10001"));
    }

    #[test]
    fn the_most_telling_failure_is_kept() {
        let mut slot = None;
        Failure::keep(&mut slot, None, "offline".into());
        Failure::keep(&mut slot, Some(-10001), "gateway".into());
        assert_eq!(slot.as_ref().unwrap().retcode, Some(-10001));
        Failure::keep(&mut slot, None, "offline again".into());
        assert_eq!(slot.as_ref().unwrap().error, "gateway");
        Failure::keep(&mut slot, Some(-1), "other".into());
        assert_eq!(slot.as_ref().unwrap().retcode, Some(-1));
        // Ties keep the first: the primary gateway's answer.
        Failure::keep(&mut slot, Some(10101), "later".into());
        assert_eq!(slot.as_ref().unwrap().error, "other");

        let mut empty = None;
        Failure::keep(&mut empty, Some(0), "no notes".into());
        assert_eq!(
            empty,
            Some(Failure {
                retcode: None,
                error: "no notes".into()
            })
        );
        Failure::keep(&mut empty, Some(-10001), "gateway".into());
        assert_eq!(empty.unwrap().retcode, Some(-10001));
    }

    #[test]
    fn endgame_urls_follow_the_game() {
        let genshin = endgame_urls("genshin", "os_euro", "700000001");
        let keys: Vec<&str> = genshin.iter().map(|(key, _)| *key).collect();
        assert_eq!(keys, ["spiralAbyss", "roleCombat", "hardChallenge"]);
        let role = "server=os_euro&role_id=700000001";
        let sg = "https://sg-public-api.hoyolab.com/event/game_record/genshin/api";
        let bbs = "https://bbs-api-os.hoyolab.com/game_record/genshin/api";
        assert_eq!(
            genshin[0].1,
            [
                format!("{sg}/spiralAbyss?{role}&schedule_type=1"),
                format!("{bbs}/spiralAbyss?{role}&schedule_type=1"),
            ]
        );
        assert_eq!(
            genshin[1].1,
            [
                format!("{sg}/role_combat?{role}&need_detail=false"),
                format!("{bbs}/role_combat?{role}&need_detail=false"),
            ]
        );
        assert_eq!(
            genshin[2].1,
            [
                format!("{sg}/hard_challenge?{role}&need_detail=false"),
                format!("{bbs}/hard_challenge?{role}&need_detail=false"),
            ]
        );

        let sg = "https://sg-public-api.hoyolab.com/event/game_record/hkrpg/api";
        let bbs = "https://bbs-api-os.hoyolab.com/game_record/hkrpg/api";
        let tail = "?server=prod_official_eur&role_id=700000001&schedule_type=1&need_all=true";
        assert_eq!(
            endgame_urls("hsr", "prod_official_eur", "700000001"),
            [
                (
                    "moc",
                    vec![format!("{sg}/challenge{tail}"), format!("{bbs}/challenge{tail}")]
                ),
                (
                    "pf",
                    vec![format!("{sg}/challenge_story{tail}"), format!("{bbs}/challenge_story{tail}")]
                ),
                (
                    "as",
                    vec![format!("{sg}/challenge_boss{tail}"), format!("{bbs}/challenge_boss{tail}")]
                ),
            ]
        );

        let nap = "https://sg-act-nap-api.hoyolab.com/event/game_record_zzz/api/zzz";
        let role = "server=prod_gf_eu&role_id=1500000001";
        assert_eq!(
            endgame_urls("zzz", "prod_gf_eu", "1500000001"),
            [
                ("shiyu", vec![format!("{nap}/hadal_info_v2?{role}&schedule_type=1")]),
                (
                    "deadlyAssault",
                    vec![format!("{nap}/hadal_mem_detail_v2?{role}&schedule_type=1&uid=1500000001")]
                ),
            ]
        );
        assert!(endgame_urls("wuwa", "x", "1").is_empty());
    }

    #[test]
    fn headers_match_the_web_client() {
        let cookies = Cookies::new("1", "tok", "mid").unwrap();
        let map = headers(&cookies).unwrap();
        for name in [
            "ds",
            "x-rpc-app_version",
            "x-rpc-client_type",
            "x-rpc-language",
            "x-rpc-lang",
            "origin",
            "referer",
            "accept",
            "cookie",
        ] {
            assert!(map.contains_key(name), "{name}");
        }
        assert_eq!(map["x-rpc-language"], "en-us");
        assert_eq!(map["x-rpc-lang"], "en-us");
        assert_eq!(map["x-rpc-app_version"], "1.5.0");
        assert_eq!(map["x-rpc-client_type"], "5");
    }

    #[test]
    fn checkin_and_redeem_follow_the_game() {
        let (act, hosts) = checkin_urls("zzz").unwrap();
        assert_eq!(act, "e202406031448091");
        assert_eq!(
            hosts,
            [CheckinHost {
                info: "https://sg-act-nap-api.hoyolab.com/event/luna/zzz/os/info?lang=en-us&act_id=e202406031448091".into(),
                sign: "https://sg-act-nap-api.hoyolab.com/event/luna/zzz/os/sign?lang=en-us".into(),
                sign_game: Some("zzz"),
            }]
        );
        let (act, hosts) = checkin_urls("genshin").unwrap();
        assert_eq!(act, "e202102251931481");
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].sign_game, None);

        // Star Rail: its own luna/hkrpg/os host first, the shared luna/os second.
        let (act, hosts) = checkin_urls("hsr").unwrap();
        assert_eq!(act, "e202303301540311");
        assert_eq!(
            hosts,
            [
                CheckinHost {
                    info: "https://sg-public-api.hoyolab.com/event/luna/hkrpg/os/info?lang=en-us&act_id=e202303301540311"
                        .into(),
                    sign: "https://sg-public-api.hoyolab.com/event/luna/hkrpg/os/sign?lang=en-us".into(),
                    sign_game: Some("hkrpg"),
                },
                CheckinHost {
                    info: "https://sg-public-api.hoyolab.com/event/luna/os/info?lang=en-us&act_id=e202303301540311".into(),
                    sign: "https://sg-public-api.hoyolab.com/event/luna/os/sign?lang=en-us".into(),
                    sign_game: None,
                },
            ]
        );
        let cookies = Cookies::new("1", "tok", "mid").unwrap();
        assert_eq!(checkin_headers(&cookies, &hosts[0]).unwrap()["x-rpc-signgame"], "hkrpg");
        assert!(!checkin_headers(&cookies, &hosts[1]).unwrap().contains_key("x-rpc-signgame"));
        assert!(checkin_urls("wuwa").is_none());
        // Only a claim, an earlier claim or a refused sign-in stops the fallback.
        for code in [0, -5003, -100, 10001] {
            assert!(checkin_settled(code), "{code}");
        }
        for code in [-10001, -1, -500012] {
            assert!(!checkin_settled(code), "{code}");
        }
        assert_eq!(redeem_target("hsr").unwrap().1, "hkrpg_global");
        assert!(redeem_target("wuwa").is_none());
    }

    #[test]
    fn codes_are_checked_before_sending() {
        assert_eq!(clean_code("  GENSHINGIFT "), Some("GENSHINGIFT"));
        assert_eq!(clean_code("ab_c-1"), Some("ab_c-1"));
        assert!(clean_code("").is_none());
        assert!(clean_code("a&b=c").is_none());
        assert!(clean_code("a b").is_none());
        assert!(clean_code(&"A".repeat(81)).is_none());
    }

    #[test]
    fn answers_map_retcodes() {
        assert_eq!(redeem_answer(0)["status"], "redeemed");
        assert_eq!(redeem_answer(-2017)["ok"], true);
        assert_eq!(redeem_answer(-2001)["status"], "expired");
        assert_eq!(redeem_answer(-1071)["status"], "auth");
        assert_eq!(redeem_answer(-9)["status"], "failed");
        assert_eq!(checkin_answer(0, &json!({ "is_risk": false }))["status"], "claimed");
        assert_eq!(checkin_answer(0, &json!({ "gt_result": { "risk_code": 375 } }))["status"], "captcha");
        assert_eq!(checkin_answer(-5003, &Value::Null)["status"], "already");
        assert_eq!(checkin_answer(-100, &Value::Null)["status"], "auth");
    }

    #[test]
    fn cookie_header_is_sensitive() {
        let cookies = Cookies::new("1", "tok", "mid").unwrap();
        let map = headers(&cookies).unwrap();
        assert!(map[reqwest::header::COOKIE].is_sensitive());
        assert!(format!("{map:?}").contains("Sensitive"));
    }
}
