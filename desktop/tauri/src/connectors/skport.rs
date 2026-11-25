//! SKPORT, Gryphline's player hub, read for Arknights: Endfield with the
//! player's own sign-in.
//!
//! The sign-in window is a separate WebView2 profile with no bridge script and
//! no capabilities. Memoria reads its `ACCOUNT_TOKEN` (or `SK_OAUTH_CRED_KEY`)
//! cookie from WebView2's cookie manager, trades it for a `cred` and a signing
//! token, seals all three with DPAPI and closes the window. Requests carry
//! `cred` in a header marked sensitive and a `sign` built from the signing
//! token. Errors are fixed sentences: a reqwest error prints its URL, and a
//! response body is never echoed back.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow};

use super::{ConnectorManager, now_ms};
use crate::App;
use crate::locks::Locked;

pub const LABEL: &str = "skport-login";
const START: &str = "https://www.skport.com/";
/// How long the window waits for a sign-in before it stops checking.
const GIVE_UP: Duration = Duration::from_secs(30 * 60);

const ZONAI: &str = "https://zonai.skport.com";
const GRANT_URL: &str = "https://as.gryphline.com/user/oauth2/v2/grant";
const CRED_PATH: &str = "/web/v1/user/auth/generate_cred_by_code";
const REFRESH_PATH: &str = "/web/v1/auth/refresh";
const BINDING_PATH: &str = "/api/v1/game/player/binding";
const CARD_PATH: &str = "/api/v1/game/endfield/card/detail";
/// SKPORT's web client, as named to Gryphline's account service.
const APP_CODE: &str = "6eb76d4e13aa36e6";
const PLATFORM: &str = "3";
const VERSION_NAME: &str = "1.0.0";
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

pub const MANUAL_GAP: Duration = Duration::from_secs(10);
pub const AUTO_GAP: Duration = Duration::from_secs(15 * 60);

/// Cookie origins the sign-in leaves its tokens on.
const COOKIE_URLS: [&str; 3] = [
    "https://www.skport.com",
    "https://game.skport.com",
    "https://as.gryphline.com",
];

const ALLOWED_HOSTS: [&str; 11] = [
    "skport.com",
    "gryphline.com",
    "hypergryph.com",
    "geetest.com",
    "google.com",
    "gstatic.com",
    "recaptcha.net",
    "apple.com",
    "facebook.com",
    "twitter.com",
    "x.com",
];

const SIGNED_OUT: &str = "SKPORT did not accept the sign-in. Sign in again.";
const DAMAGED: &str = "The SKPORT sign-in is damaged. Sign in again.";

/// The SKPORT tokens. Held only in memory, briefly, and never printed: no Debug.
#[derive(Clone)]
pub struct Secrets {
    /// The Gryphline account token, kept to mint a new `cred` when the old one ends.
    pub account_token: Option<String>,
    pub cred: String,
    /// The key `sign` headers are made with.
    pub sign_token: String,
}

fn header_safe(value: &str) -> bool {
    !value.is_empty() && value.len() <= 4096 && value.bytes().all(|b| b.is_ascii_graphic() && b != b';' && b != b',')
}

impl Secrets {
    pub fn new(account_token: Option<&str>, cred: &str, sign_token: &str) -> Option<Self> {
        let account_token = account_token.filter(|t| !t.is_empty());
        (header_safe(cred) && header_safe(sign_token) && account_token.is_none_or(header_safe)).then(|| Self {
            account_token: account_token.map(str::to_string),
            cred: cred.to_string(),
            sign_token: sign_token.to_string(),
        })
    }

    pub(super) fn to_json(&self) -> Value {
        json!({ "accountToken": self.account_token, "cred": self.cred, "signToken": self.sign_token })
    }

    pub(super) fn from_json(value: &Value) -> Option<Self> {
        Self::new(
            value["accountToken"].as_str(),
            value["cred"].as_str()?,
            value["signToken"].as_str()?,
        )
    }
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/// HMAC-SHA256 (RFC 2104) as 64 lowercase hex characters.
pub fn hmac_sha256_hex(key: &[u8], msg: &[u8]) -> String {
    const BLOCK: usize = 64;
    let mut block_key = [0u8; BLOCK];
    if key.len() > BLOCK {
        block_key[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block_key[..key.len()].copy_from_slice(key);
    }
    let pad = |byte: u8| block_key.map(|k| k ^ byte);
    let mut inner = Sha256::new();
    inner.update(pad(0x36));
    inner.update(msg);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(pad(0x5c));
    outer.update(inner);
    hex::encode(outer.finalize())
}

fn header_json(timestamp: &str) -> String {
    format!(r#"{{"platform":"{PLATFORM}","timestamp":"{timestamp}","dId":"","vName":"{VERSION_NAME}"}}"#)
}

/// SKPORT's V2 `sign`: md5(hex(hmac_sha256(signToken, path + query-or-body + timestamp + headerJson))).
pub fn sign(path: &str, query_or_body: &str, timestamp: &str, sign_token: &str) -> String {
    let to_sign = format!("{path}{query_or_body}{timestamp}{}", header_json(timestamp));
    super::ds::md5_hex(hmac_sha256_hex(sign_token.as_bytes(), to_sign.as_bytes()).as_bytes())
}

fn unix_seconds() -> String {
    (now_ms() / 1000).to_string()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|_| "Memoria could not prepare a secure connection.".to_string())
}

fn put(map: &mut HeaderMap, name: &'static str, value: &str, sensitive: bool) -> Result<(), String> {
    let mut value = HeaderValue::from_str(value).map_err(|_| DAMAGED.to_string())?;
    value.set_sensitive(sensitive);
    map.insert(HeaderName::from_static(name), value);
    Ok(())
}

/// The headers every SKPORT request sends, without a signature.
fn base_headers(timestamp: &str) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    put(&mut map, "accept", "application/json", false)?;
    put(&mut map, "content-type", "application/json", false)?;
    put(&mut map, "origin", "https://www.skport.com", false)?;
    put(&mut map, "referer", "https://www.skport.com/", false)?;
    put(&mut map, "platform", PLATFORM, false)?;
    put(&mut map, "timestamp", timestamp, false)?;
    put(&mut map, "did", "", false)?;
    put(&mut map, "vname", VERSION_NAME, false)?;
    Ok(map)
}

/// Headers for a signed call. `cred` and `sign` are marked sensitive so they never print.
fn signed_headers(
    secrets: &Secrets,
    path: &str,
    query_or_body: &str,
    timestamp: &str,
    game_role: Option<&str>,
) -> Result<HeaderMap, String> {
    let mut map = base_headers(timestamp)?;
    put(&mut map, "cred", &secrets.cred, true)?;
    put(
        &mut map,
        "sign",
        &sign(path, query_or_body, timestamp, &secrets.sign_token),
        true,
    )?;
    if let Some(role) = game_role {
        put(&mut map, "sk-game-role", role, false)?;
    }
    Ok(map)
}

/// `(code, data)` from a SKPORT answer. HTTP 401 reads as code 401.
async fn read(response: reqwest::Response) -> Result<(i64, Value), String> {
    let status = response.status();
    if status.as_u16() == 401 {
        return Ok((401, Value::Null));
    }
    if !status.is_success() {
        return Err(format!(
            "SKPORT answered with an error ({}). Try again later.",
            status.as_u16()
        ));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|_| "SKPORT sent an answer Memoria could not read.".to_string())?;
    let code = body["code"].as_i64().or_else(|| body["status"].as_i64()).unwrap_or(-1);
    Ok((code, body["data"].clone()))
}

fn unreachable_error(_: reqwest::Error) -> String {
    "SKPORT could not be reached. Check your connection and try again.".into()
}

fn expired(code: i64) -> bool {
    matches!(code, 401 | 10000 | 10002)
}

/// Text from a JSON string or number, for ids SKPORT sends either way.
fn text_or_number(value: &Value) -> Option<String> {
    match value {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/// Gryphline account token -> one-time code -> `cred`, signing token and user id.
async fn exchange_account_token(account_token: &str) -> Result<(Secrets, Option<String>), String> {
    let http = client()?;
    let grant = http
        .post(GRANT_URL)
        .headers(base_headers(&unix_seconds())?)
        .json(&json!({ "token": account_token, "appCode": APP_CODE, "type": 0 }))
        .send()
        .await
        .map_err(unreachable_error)?;
    let (_, data) = read(grant).await?;
    let code = data["code"]
        .as_str()
        .filter(|c| header_safe(c))
        .ok_or(SIGNED_OUT)?
        .to_string();
    let issued = http
        .post(format!("{ZONAI}{CRED_PATH}"))
        .headers(base_headers(&unix_seconds())?)
        .json(&json!({ "code": code, "kind": 1 }))
        .send()
        .await
        .map_err(unreachable_error)?;
    let (status, data) = read(issued).await?;
    if status != 0 {
        return Err(SIGNED_OUT.into());
    }
    let secrets = Secrets::new(
        Some(account_token),
        data["cred"].as_str().unwrap_or(""),
        data["token"].as_str().unwrap_or(""),
    )
    .ok_or(SIGNED_OUT)?;
    Ok((secrets, text_or_number(&data["userId"])))
}

/// A fresh signing token for a `cred`.
async fn refresh_sign_token(cred: &str) -> Result<String, String> {
    let mut headers = base_headers(&unix_seconds())?;
    put(&mut headers, "cred", cred, true)?;
    let response = client()?
        .get(format!("{ZONAI}{REFRESH_PATH}"))
        .headers(headers)
        .send()
        .await
        .map_err(unreachable_error)?;
    let (code, data) = read(response).await?;
    match data["token"].as_str() {
        Some(token) if code == 0 && header_safe(token) => Ok(token.to_string()),
        _ => Err(SIGNED_OUT.into()),
    }
}

/// New tokens after SKPORT says the old ones ended: a refresh first, then a
/// full exchange with the account token when the `cred` itself is gone.
async fn renew(secrets: &Secrets) -> Result<Secrets, String> {
    if let Ok(token) = refresh_sign_token(&secrets.cred).await {
        return Secrets::new(secrets.account_token.as_deref(), &secrets.cred, &token).ok_or_else(|| SIGNED_OUT.into());
    }
    match &secrets.account_token {
        Some(account) => exchange_account_token(account).await.map(|(fresh, _)| fresh),
        None => Err(SIGNED_OUT.into()),
    }
}

/// A signed GET to zonai.skport.com. An ended signing token is renewed once,
/// and the renewed tokens are sealed again.
async fn signed_get(
    manager: &ConnectorManager,
    secrets: Secrets,
    path: &str,
    query: &str,
    game_role: Option<&str>,
) -> Result<(i64, Value), String> {
    let url = if query.is_empty() {
        format!("{ZONAI}{path}")
    } else {
        format!("{ZONAI}{path}?{query}")
    };
    // Taken before the first await, like the secrets: a renewal never revives a disconnected sign-in.
    let epoch = manager.skport_epoch();
    let mut secrets = secrets;
    for attempt in 0..2 {
        let headers = signed_headers(&secrets, path, query, &unix_seconds(), game_role)?;
        let response = client()?
            .get(&url)
            .headers(headers)
            .send()
            .await
            .map_err(unreachable_error)?;
        let (code, data) = read(response).await?;
        if !expired(code) || attempt == 1 {
            return Ok((code, data));
        }
        secrets = renew(&secrets).await?;
        manager.store_skport(&secrets, None, epoch)?;
    }
    Err(SIGNED_OUT.into())
}

// ---------------------------------------------------------------------------
// Roles and cards
// ---------------------------------------------------------------------------

/// The account's Arknights: Endfield roles, sanitised.
pub async fn fetch_roles(manager: &ConnectorManager, secrets: Secrets) -> Result<Vec<Value>, String> {
    let (code, data) = signed_get(manager, secrets, BINDING_PATH, "", None).await?;
    if code != 0 {
        return Err(if expired(code) {
            SIGNED_OUT.into()
        } else {
            format!("SKPORT could not list your game accounts (code {code}).")
        });
    }
    Ok(sanitize_roles(&data))
}

/// One role from a binding entry. `parent` is the binding a nested role came from.
fn role_from(item: &Value, parent: Option<&Value>) -> Option<Value> {
    let text = |v: &Value, max: usize| v.as_str().map(|s| s.chars().take(max).collect::<String>());
    let pick = |keys: &[&str]| keys.iter().find_map(|key| text_or_number(&item[*key]));
    let uid = pick(&["roleId", "uid", "gameUid"])?;
    let region = pick(&["serverId", "server_id", "channelMasterId"]).or_else(|| {
        // "3_{uid}_{server}", as the sk-game-role header writes it.
        let role = item["gameRole"].as_str()?;
        let mut parts = role.splitn(3, '_');
        let (_, role_uid, server) = (parts.next()?, parts.next()?, parts.next()?);
        (role_uid == uid).then(|| server.to_string())
    })?;
    if !super::valid_uid(&uid) || !super::valid_region(&region) {
        return None;
    }
    let nickname = ["nickname", "nickName", "roleName"]
        .iter()
        .find_map(|key| text(&item[*key], 40))
        .or_else(|| parent.and_then(|p| text(&p["nickName"], 40)));
    let region_name = ["serverName", "channelName"]
        .iter()
        .find_map(|key| text(&item[*key], 40));
    let level = item["level"]
        .as_u64()
        .or_else(|| item["level"].as_str().and_then(|l| l.parse().ok()));
    Some(json!({
        "presetKey": "endfield",
        "uid": uid,
        "region": region,
        "nickname": nickname,
        "level": level,
        "regionName": region_name,
    }))
}

/// Reads `data.list[]`: Endfield's `bindingList[]` entries, each a role or
/// holding `roles[]`/`defaultRole`, or a flat list of roles.
fn sanitize_roles(data: &Value) -> Vec<Value> {
    let mut roles: Vec<Value> = Vec::new();
    let mut add = |role: Option<Value>| {
        if let Some(role) = role
            && roles.len() < 50
            && !roles
                .iter()
                .any(|r| r["uid"] == role["uid"] && r["region"] == role["region"])
        {
            roles.push(role);
        }
    };
    for entry in data["list"].as_array().into_iter().flatten().take(50) {
        let app_code = entry["appCode"].as_str();
        if let Some(bindings) = entry["bindingList"].as_array() {
            if app_code != Some("endfield") {
                continue;
            }
            for binding in bindings.iter().take(50) {
                if let Some(nested) = binding["roles"].as_array().filter(|r| !r.is_empty()) {
                    for role in nested.iter().take(50) {
                        add(role_from(role, Some(binding)));
                    }
                } else if binding["defaultRole"].is_object() {
                    add(role_from(&binding["defaultRole"], Some(binding)));
                } else {
                    add(role_from(binding, None));
                }
            }
        } else if app_code.is_none_or(|code| code == "endfield") {
            add(role_from(entry, None));
        }
    }
    roles
}

fn card_query(uid: &str, region: &str) -> String {
    format!("roleId={uid}&serverId={region}")
}

fn result(ok: bool, retcode: Option<i64>, raw: Value, error: Option<String>) -> Value {
    json!({
        "ok": ok,
        "retcode": retcode,
        "backoffUntilMs": null,
        "presetKey": "endfield",
        "observedAt": now_ms(),
        "raw": raw,
        "error": error,
    })
}

/// Reads one linked game's Endfield card. `auto` refreshes wait 15 minutes per
/// game; a tap waits 10 seconds.
pub async fn refresh(manager: &ConnectorManager, game_id: &str, auto: bool) -> Value {
    let fail = |message: &str| result(false, None, Value::Null, Some(message.to_string()));
    let Some(link) = manager.skport_game_link(game_id) else {
        return fail("Link this game to an Arknights: Endfield account first.");
    };
    let Some(secrets) = manager.skport_secrets() else {
        return fail("Sign in to SKPORT first.");
    };
    if let Err(wait) = manager.claim_fetch(&format!("skport:{game_id}"), if auto { AUTO_GAP } else { MANUAL_GAP }) {
        return fail(&format!("Read just now. Try again in {wait} s."));
    }
    let query = card_query(&link.uid, &link.region);
    let role = format!("{PLATFORM}_{}_{}", link.uid, link.region);
    match signed_get(manager, secrets, CARD_PATH, &query, Some(&role)).await {
        Ok((0, data)) => result(true, Some(0), data, None),
        Ok((code, _)) if expired(code) => result(false, Some(code), Value::Null, Some(SIGNED_OUT.into())),
        Ok((code, _)) => result(
            false,
            Some(code),
            Value::Null,
            Some(format!("SKPORT could not read this account's card (code {code}).")),
        ),
        Err(error) => fail(&error),
    }
}

// ---------------------------------------------------------------------------
// The sign-in window
// ---------------------------------------------------------------------------

/// HTTPS to SKPORT, Gryphline's account pages, its captcha and the sign-in providers it offers. Nothing else.
pub fn allowed_skport_url(url: &tauri::Url) -> bool {
    if url.scheme() == "about" && url.path() == "blank" {
        return true;
    }
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    ALLOWED_HOSTS
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

/// Opens the sign-in window, or brings the open one forward. A connected
/// account keeps its session unless `fresh` asks for a clean sign-in.
pub fn open(app: &AppHandle, fresh: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let state = app.state::<App>();
    let connected = state.connectors.status()["skport"]["connected"] == true;
    let url: tauri::Url = START
        .parse()
        .map_err(|_| "The SKPORT address is invalid.".to_string())?;
    let checker = app.clone();
    let mut builder = tauri::WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url.clone()))
        .title("Sign in to SKPORT · Memoria")
        .inner_size(520.0, 760.0)
        .min_inner_size(360.0, 480.0)
        .center()
        .data_directory(state.connectors.skport_profile_dir())
        .on_navigation(allowed_skport_url)
        .on_new_window(|url, _| {
            if allowed_skport_url(&url) {
                NewWindowResponse::Allow
            } else {
                NewWindowResponse::Deny
            }
        })
        .on_page_load(move |window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                check_cookies(&checker, &window);
            }
        });
    if let Some(main) = crate::main_window(app) {
        builder = builder
            .parent(&main)
            .map_err(|_| "The sign-in window could not open.".to_string())?;
    }
    let window = builder
        .build()
        .map_err(|_| "The sign-in window could not open.".to_string())?;
    if !connected || fresh {
        // A disconnected account, or one asked to start over, signs in from a clean profile.
        clear_cookies(&window);
        let _ = window.navigate(url);
    }
    let poller = app.clone();
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        while started.elapsed() < GIVE_UP {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let Some(window) = poller.get_webview_window(LABEL) else {
                return;
            };
            check_cookies(&poller, &window);
        }
    });
    Ok(())
}

pub fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
}

/// What the sign-in left in the cookie jar. Never printed: no Debug.
#[derive(Default)]
struct Found {
    account_token: Option<String>,
    cred: Option<String>,
}

/// Trades the cookie for tokens, seals them, reads the roles, closes the window and tells the page.
fn complete(app: AppHandle, found: Found) {
    let state = app.state::<App>();
    if state
        .connectors
        .skport_completing
        .swap(true, std::sync::atomic::Ordering::SeqCst)
    {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let state = app.state::<App>();
        let error = connect_tokens(&state.connectors, found.account_token, found.cred)
            .await
            .err();
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || close(&handle));
        let mut status = state.connectors.status();
        if let Some(error) = error {
            status["error"] = json!(error);
        }
        crate::emit(&app, "memoria:connector-status", status);
        state.connectors.finish_skport_completing();
    });
}

/// Trades an account token (or a `cred`) for fresh tokens, seals them and
/// saves the roles. The number of roles found.
pub async fn connect_tokens(
    manager: &ConnectorManager,
    account_token: Option<String>,
    cred: Option<String>,
) -> Result<usize, String> {
    let epoch = manager.skport_epoch();
    let (secrets, user_id) = match (&account_token, &cred) {
        (Some(account), _) => exchange_account_token(account).await?,
        (None, Some(cred)) => {
            let token = refresh_sign_token(cred).await?;
            (Secrets::new(None, cred, &token).ok_or(SIGNED_OUT)?, None)
        }
        (None, None) => return Err(SIGNED_OUT.into()),
    };
    drop((account_token, cred));
    manager.store_skport(&secrets, user_id.as_deref().map(super::mask_uid), epoch)?;
    let roles = fetch_roles(manager, secrets).await?;
    let count = roles.len();
    manager.set_skport_roles(roles, epoch)?;
    Ok(count)
}

/// A cookie value as the API wants it: unquoted, percent-decoded, and the
/// `cred` field when SKPORT stored a JSON object.
pub(super) fn clean_cookie(raw: &str) -> Option<String> {
    let unquote = |s: &str| s.trim().trim_matches('"').to_string();
    let mut value = unquote(raw);
    if value.contains('%') {
        value = unquote(&percent_decode(&value)?);
    }
    if value.starts_with('{') {
        let parsed: Value = serde_json::from_str(&value).ok()?;
        value = ["cred", "token", "value"]
            .iter()
            .find_map(|key| parsed[*key].as_str().map(str::to_string))?;
    }
    header_safe(&value).then_some(value)
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(windows)]
fn core_cookie_manager(
    webview: &tauri::webview::PlatformWebview,
) -> Option<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2CookieManager> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2;
    use windows_core::Interface;
    // SAFETY: called on the UI thread with WebView2's own controller.
    unsafe {
        webview
            .controller()
            .CoreWebView2()
            .and_then(|core| core.cast::<ICoreWebView2_2>())
            .and_then(|core| core.CookieManager())
            .ok()
    }
}

#[cfg(windows)]
fn clear_cookies(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| {
        if let Some(manager) = core_cookie_manager(&webview) {
            // SAFETY: the manager belongs to this live webview.
            let _ = unsafe { manager.DeleteAllCookies() };
        }
    });
}

#[cfg(not(windows))]
fn clear_cookies(_window: &WebviewWindow) {}

/// The cookies from all three origins, gathered before deciding.
#[cfg(windows)]
struct Gather {
    found: Found,
    remaining: usize,
}

/// Asks WebView2 for each origin's cookies (HttpOnly included) and finishes the
/// sign-in once a token is there.
#[cfg(windows)]
fn check_cookies(app: &AppHandle, window: &WebviewWindow) {
    use webview2_com::GetCookiesCompletedHandler;

    if app
        .state::<App>()
        .connectors
        .skport_completing
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return;
    }
    let handle = app.clone();
    let _ = window.with_webview(move |webview| {
        let Some(manager) = core_cookie_manager(&webview) else {
            return;
        };
        let gather = Arc::new(Mutex::new(Gather {
            found: Found::default(),
            remaining: COOKIE_URLS.len(),
        }));
        let finish_one = {
            let gather = gather.clone();
            move |app: &AppHandle| {
                let mut gather = gather.locked();
                gather.remaining = gather.remaining.saturating_sub(1);
                if gather.remaining == 0 && (gather.found.account_token.is_some() || gather.found.cred.is_some()) {
                    complete(app.clone(), std::mem::take(&mut gather.found));
                }
            }
        };
        for url in COOKIE_URLS {
            let app = handle.clone();
            let gather = gather.clone();
            let finish = finish_one.clone();
            let handler = GetCookiesCompletedHandler::create(Box::new(move |result, list| {
                if result.is_ok()
                    && let Some(list) = list
                {
                    // SAFETY: WebView2 hands over a live cookie list for the length of this callback.
                    let (account, cred) = unsafe { read_tokens(&list) }.unwrap_or_default();
                    let mut gather = gather.locked();
                    if gather.found.account_token.is_none() {
                        gather.found.account_token = account;
                    }
                    if gather.found.cred.is_none() {
                        gather.found.cred = cred;
                    }
                }
                finish(&app);
                Ok(())
            }));
            let wide = windows_core::HSTRING::from(url);
            // SAFETY: called on the UI thread; the handler outlives the call.
            if unsafe { manager.GetCookies(&wide, &handler) }.is_err() {
                finish_one(&handle);
            }
        }
    });
}

/// `(ACCOUNT_TOKEN, SK_OAUTH_CRED_KEY)`, cleaned.
#[cfg(windows)]
unsafe fn read_tokens(
    list: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2CookieList,
) -> windows_core::Result<(Option<String>, Option<String>)> {
    let mut count = 0u32;
    unsafe { list.Count(&mut count)? };
    let (mut account, mut cred) = (None, None);
    for index in 0..count.min(500) {
        let cookie = unsafe { list.GetValueAtIndex(index)? };
        let mut name = windows_core::PWSTR::null();
        unsafe { cookie.Name(&mut name)? };
        let name = webview2_com::take_pwstr(name);
        let slot = match name.as_str() {
            "ACCOUNT_TOKEN" => &mut account,
            "SK_OAUTH_CRED_KEY" => &mut cred,
            _ => continue,
        };
        let mut value = windows_core::PWSTR::null();
        unsafe { cookie.Value(&mut value)? };
        *slot = clean_cookie(&webview2_com::take_pwstr(value));
    }
    Ok((account, cred))
}

#[cfg(not(windows))]
fn check_cookies(_app: &AppHandle, _window: &WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_matches_rfc_4231_vectors() {
        // Test case 1.
        assert_eq!(
            hmac_sha256_hex(&[0x0b; 20], b"Hi There"),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
        // Test case 2.
        assert_eq!(
            hmac_sha256_hex(b"Jefe", b"what do ya want for nothing?"),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        // Test case 6: a key longer than one block is hashed first.
        assert_eq!(
            hmac_sha256_hex(&[0xaa; 131], b"Test Using Larger Than Block-Size Key - Hash Key First"),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    #[test]
    fn sign_covers_path_query_time_and_headers() {
        let expected_json = r#"{"platform":"3","timestamp":"1700000000","dId":"","vName":"1.0.0"}"#;
        assert_eq!(header_json("1700000000"), expected_json);
        let to_sign = format!("{CARD_PATH}roleId=1&serverId=2{}{expected_json}", "1700000000");
        let expected = crate::connectors::ds::md5_hex(hmac_sha256_hex(b"tok", to_sign.as_bytes()).as_bytes());
        let signed = sign(CARD_PATH, &card_query("1", "2"), "1700000000", "tok");
        assert_eq!(signed, expected);
        assert_eq!(signed.len(), 32);
        assert_ne!(signed, sign(CARD_PATH, &card_query("1", "3"), "1700000000", "tok"));
        assert_ne!(signed, sign(CARD_PATH, &card_query("1", "2"), "1700000001", "tok"));
    }

    #[test]
    fn secret_headers_are_sensitive() {
        let secrets = Secrets::new(Some("acct"), "CREDVALUE", "signkey").unwrap();
        let map = signed_headers(&secrets, CARD_PATH, "roleId=1&serverId=2", "1700000000", Some("3_1_2")).unwrap();
        assert!(map["cred"].is_sensitive());
        assert!(map["sign"].is_sensitive());
        assert_eq!(map["platform"], "3");
        assert_eq!(map["vname"], "1.0.0");
        assert_eq!(map["did"], "");
        assert_eq!(map["sk-game-role"], "3_1_2");
        assert_eq!(map["origin"], "https://www.skport.com");
        assert!(!format!("{map:?}").contains("CREDVALUE"));
        assert!(Secrets::new(None, "a;b", "x").is_none());
        assert!(Secrets::new(None, "cred", "").is_none());
        let round = Secrets::from_json(&secrets.to_json()).unwrap();
        assert_eq!(
            (round.cred.as_str(), round.account_token.as_deref()),
            ("CREDVALUE", Some("acct"))
        );
    }

    #[test]
    fn roles_read_nested_and_flat_bindings() {
        let nested = json!({ "list": [
            { "appCode": "arknights", "bindingList": [{ "uid": "1", "channelMasterId": "1", "nickName": "Doctor" }] },
            { "appCode": "endfield", "bindingList": [
                { "uid": "9001", "nickName": "Account", "roles": [
                    { "roleId": "4000000001", "serverId": "2", "nickname": "Endmin", "level": 40, "serverName": "Asia" },
                    { "roleId": 4000000002u64, "serverId": 3, "level": "12" },
                ]},
                { "uid": "9002", "defaultRole": { "roleId": "4000000003", "serverId": "2", "nickName": "Alt" } },
                { "uid": "4000000004", "channelMasterId": "5", "nickName": "Flat", "channelName": "Europe" },
                { "roleId": "bad id", "serverId": "2" },
                { "gameRole": "3_4000000005_7", "roleId": "4000000005" },
            ]},
        ]});
        let roles = sanitize_roles(&nested);
        assert_eq!(roles.len(), 5);
        assert_eq!(roles[0]["presetKey"], "endfield");
        assert_eq!(roles[0]["uid"], "4000000001");
        assert_eq!(roles[0]["region"], "2");
        assert_eq!(roles[0]["nickname"], "Endmin");
        assert_eq!(roles[0]["regionName"], "Asia");
        assert_eq!(roles[1]["uid"], "4000000002");
        assert_eq!(roles[1]["region"], "3");
        assert_eq!(roles[1]["level"], 12);
        assert_eq!(roles[1]["nickname"], "Account");
        assert_eq!(roles[2]["nickname"], "Alt");
        assert_eq!(roles[3]["region"], "5");
        assert_eq!(roles[3]["regionName"], "Europe");
        assert_eq!(roles[4]["region"], "7");

        let flat = json!({ "list": [
            { "roleId": "4000000001", "serverId": "2", "nickname": "Endmin" },
            { "roleId": "4000000001", "serverId": "2" },
            { "appCode": "arknights", "uid": "1", "serverId": "1" },
        ]});
        let roles = sanitize_roles(&flat);
        assert_eq!(roles.len(), 1);
        assert_eq!(roles[0]["nickname"], "Endmin");
        assert!(sanitize_roles(&json!(null)).is_empty());
    }

    #[test]
    fn cookies_are_cleaned() {
        assert_eq!(clean_cookie("\"abc123\"").as_deref(), Some("abc123"));
        assert_eq!(clean_cookie("a%2Bb%3D").as_deref(), Some("a+b="));
        assert_eq!(clean_cookie("%7B%22cred%22%3A%22xyz%22%7D").as_deref(), Some("xyz"));
        assert_eq!(clean_cookie(r#"{"cred":"q"}"#).as_deref(), Some("q"));
        assert!(clean_cookie("").is_none());
        assert!(clean_cookie("a;b").is_none());
        assert!(clean_cookie("%zz").is_none());
    }

    #[test]
    fn sign_in_stays_on_known_hosts() {
        let ok = |u: &str| allowed_skport_url(&u.parse().unwrap());
        assert!(ok("https://www.skport.com/"));
        assert!(ok("https://as.gryphline.com/user/login"));
        assert!(ok("https://user.hypergryph.com/"));
        assert!(ok("https://static.geetest.com/x.js"));
        assert!(ok("https://accounts.google.com/o/oauth2"));
        assert!(ok("about:blank"));
        assert!(!ok("http://www.skport.com/"));
        assert!(!ok("https://skport.com.evil.example/"));
        assert!(!ok("https://evilskport.com/"));
        assert!(!ok("https://user:pw@www.skport.com/"));
        assert!(!ok("https://www.hoyolab.com/"));
        assert!(!ok("file:///C:/Windows"));
    }

    #[test]
    fn expiry_codes() {
        assert!(expired(10000) && expired(10002) && expired(401));
        assert!(!expired(0) && !expired(10001));
    }
}
