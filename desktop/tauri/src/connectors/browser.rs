//! Connecting with the player's own browser instead of Memoria's sign-in window.
//!
//! Two ways in: the player pastes what their browser shows (a `Cookie` header,
//! a DevTools "Copy as cURL/fetch", or a cookie-export JSON), or the Memoria
//! Browser Connect helper posts the cookies to the loopback server with a
//! one-time code shown in Memoria. Only the allowlisted cookie names are ever
//! kept; everything else in the input is dropped unread. Errors are fixed
//! sentences and never echo the input.

use std::sync::Mutex;

use serde_json::{Value, json};

use super::{ConnectorManager, Cookies, now_ms, valid_cookie};
use crate::locks::Locked;

/// How long a pairing code stays good.
pub const HANDOFF_TTL_MS: u64 = 5 * 60 * 1000;
/// Wrong guesses before the code is thrown away.
pub const MAX_ATTEMPTS: u8 = 5;
/// No 0/O or 1/I, so a code read off the screen is typed right.
const CODE_ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN: usize = 6;
/// Inputs larger than this are not cookie copies.
const MAX_INPUT: usize = 64 * 1024;

const HOYOLAB_NAMES: [&str; 6] = [
    "ltuid_v2",
    "ltoken_v2",
    "ltmid_v2",
    "cookie_token_v2",
    "account_id_v2",
    "account_mid_v2",
];
const SKPORT_NAMES: [&str; 2] = ["ACCOUNT_TOKEN", "SK_OAUTH_CRED_KEY"];

const MISSING_LTOKEN: &str = "The HoYoLAB cookie ltoken_v2 is missing. It is HttpOnly, so document.cookie and most page copies leave it out. Use the Memoria Browser Connect helper, or press F12 on hoyolab.com, open Network, pick any request to hoyolab.com and copy its whole Cookie request header.";
const MISSING_IDS: &str = "The HoYoLAB cookies ltuid_v2 and ltmid_v2 are missing. Copy the whole Cookie request header from a hoyolab.com request in DevTools (F12, Network), or use the Memoria Browser Connect helper.";
const NO_SKPORT: &str = "No SKPORT sign-in was found. Sign in on skport.com, then copy the Cookie request header of a skport.com request from DevTools (F12, Network), or use the Memoria Browser Connect helper.";
const TOO_LARGE: &str = "That is too much text to be a cookie copy. Copy only the Cookie header.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BrowserProvider {
    Hoyolab,
    Skport,
}

impl BrowserProvider {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "hoyolab" => Some(Self::Hoyolab),
            "skport" => Some(Self::Skport),
            _ => None,
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Hoyolab => "hoyolab",
            Self::Skport => "skport",
        }
    }

    /// Where the player signs in, opened in their default browser.
    pub fn home(self) -> &'static str {
        match self {
            Self::Hoyolab => "https://www.hoyolab.com/",
            Self::Skport => "https://www.skport.com/",
        }
    }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

fn name_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Characters that end a cookie value in a header, a shell quote or a JSON string.
fn value_end(c: char) -> bool {
    c.is_whitespace() || matches!(c, ';' | ',' | '\'' | '"' | '\\' | '`')
}

/// First value per allowed name, from any of the accepted shapes.
fn collect(raw: &str, names: &[&str]) -> Vec<Option<String>> {
    let mut found: Vec<Option<String>> = vec![None; names.len()];
    let mut put = |name: &str, value: String| {
        if let Some(slot) = names.iter().position(|n| *n == name)
            && found[slot].is_none()
            && !value.is_empty()
        {
            found[slot] = Some(value);
        }
    };
    let text = raw.trim();

    // JSON: an object of name to value, a Cookie-Editor array, or either nested under "cookies".
    if (text.starts_with('{') || text.starts_with('['))
        && let Ok(parsed) = serde_json::from_str::<Value>(text)
    {
        let mut stack = vec![&parsed];
        let mut seen = 0;
        while let Some(node) = stack.pop() {
            seen += 1;
            if seen > 2000 {
                break;
            }
            match node {
                Value::Array(items) => stack.extend(items.iter().rev()),
                Value::Object(map) => {
                    if let (Some(name), Some(value)) = (map.get("name").and_then(Value::as_str), map.get("value")) {
                        if let Some(value) = scalar(value) {
                            put(name, value);
                        }
                        continue;
                    }
                    for (key, value) in map {
                        if let Some(value) = scalar(value) {
                            put(key, value);
                        } else {
                            stack.push(value);
                        }
                    }
                }
                // A "cookie": "a=b; c=d" string is read by the scan below.
                _ => {}
            }
        }
    }

    // A Windows "Copy as cURL (cmd)" escapes quotes and percents with ^.
    let text = if text.contains("^\"") || text.contains("^%") {
        text.replace('^', "")
    } else {
        text.to_string()
    };
    // DevTools' Application table copied as "name<TAB>value<TAB>domain…".
    for line in text.lines() {
        let mut fields = line.split('\t');
        if let (Some(name), Some(value)) = (fields.next(), fields.next()) {
            put(name.trim(), value.trim().to_string());
        }
    }
    scan_pairs(&text, &mut put);
    found
}

fn scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Finds `name=value` wherever it sits: a header, a cURL `-H`/`-b`, a fetch call.
fn scan_pairs(text: &str, put: &mut impl FnMut(&str, String)) {
    let bytes = text.as_bytes();
    let mut index = 0;
    while let Some(offset) = text[index..].find('=') {
        let eq = index + offset;
        let mut start = eq;
        while start > 0 && name_char(bytes[start - 1]) {
            start -= 1;
        }
        let name = &text[start..eq];
        let after = &text[eq + 1..];
        let end = after.find(value_end).unwrap_or(after.len());
        if !name.is_empty() {
            put(name, after[..end].to_string());
        }
        index = eq + 1;
    }
}

/// HoYoLAB cookies from a paste or the helper. Unrelated cookies are dropped.
pub fn parse_hoyolab_input(raw: &str) -> Result<Cookies, String> {
    if raw.len() > MAX_INPUT {
        return Err(TOO_LARGE.into());
    }
    let found = collect(raw, &HOYOLAB_NAMES);
    let get = |slot: usize| found[slot].as_deref().filter(|v| valid_cookie(v));
    let Some(ltoken) = get(1) else {
        return Err(MISSING_LTOKEN.into());
    };
    let (Some(ltuid), Some(ltmid)) = (get(0), get(2)) else {
        return Err(MISSING_IDS.into());
    };
    let cookies = Cookies::new(ltuid, ltoken, ltmid).ok_or(MISSING_IDS)?;
    Ok(cookies.with_account_tokens(get(3), get(4), get(5)))
}

/// `(ACCOUNT_TOKEN, SK_OAUTH_CRED_KEY)`, cleaned like the sign-in window's. At least one is there.
pub fn parse_skport_input(raw: &str) -> Result<(Option<String>, Option<String>), String> {
    if raw.len() > MAX_INPUT {
        return Err(TOO_LARGE.into());
    }
    let found = collect(raw, &SKPORT_NAMES);
    let account = found[0].as_deref().and_then(super::skport::clean_cookie);
    let cred = found[1].as_deref().and_then(super::skport::clean_cookie);
    if account.is_none() && cred.is_none() {
        return Err(NO_SKPORT.into());
    }
    Ok((account, cred))
}

/// The helper may send cookies as a header string or as `{ name: value }`.
pub fn cookies_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Object(_) | Value::Array(_) => Some(value.to_string()),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Live checks
// ---------------------------------------------------------------------------

/// Checks the cookies with HoYoLAB, then seals them and saves the roles. Nothing is saved on a refusal.
pub async fn connect_hoyolab(manager: &ConnectorManager, cookies: Cookies) -> Result<usize, String> {
    let epoch = manager.hoyolab_epoch();
    let roles = super::hoyolab::fetch_roles(&cookies).await?;
    let count = roles.len();
    manager.store_cookies(&cookies, epoch)?;
    drop(cookies);
    manager.set_roles(roles, epoch)?;
    Ok(count)
}

/// Trades the SKPORT token for fresh ones, seals them and saves the roles.
pub async fn connect_skport(
    manager: &ConnectorManager,
    account: Option<String>,
    cred: Option<String>,
) -> Result<usize, String> {
    super::skport::connect_tokens(manager, account, cred).await
}

// ---------------------------------------------------------------------------
// The one-time pairing code
// ---------------------------------------------------------------------------

/// A pairing in progress. In memory only; never written anywhere.
pub struct BrowserHandoff {
    pub provider: BrowserProvider,
    pub code: String,
    pub expires_at_ms: u64,
    pub attempts: u8,
}

#[derive(Default)]
pub struct HandoffSlot(Mutex<Option<BrowserHandoff>>);

const NO_HANDOFF: &str = "No browser connection is waiting. Start again in Memoria.";
const EXPIRED: &str = "That code has expired. Start again in Memoria.";
const WRONG: &str = "That code does not match the one Memoria shows.";
const LOCKED: &str = "Too many wrong codes. Start again in Memoria.";

fn new_code() -> String {
    let mut bytes = [0u8; CODE_LEN];
    rand::fill(&mut bytes);
    // 32 symbols: the low five bits pick one without bias.
    bytes
        .iter()
        .map(|b| CODE_ALPHABET[(b & 31) as usize] as char)
        .collect()
}

impl HandoffSlot {
    pub fn start(&self, provider: BrowserProvider) -> Value {
        self.start_at(provider, now_ms())
    }

    fn start_at(&self, provider: BrowserProvider, now: u64) -> Value {
        let handoff = BrowserHandoff {
            provider,
            code: new_code(),
            expires_at_ms: now + HANDOFF_TTL_MS,
            attempts: 0,
        };
        let answer = json!({ "provider": provider.key(), "code": handoff.code, "expiresAtMs": handoff.expires_at_ms });
        *self.0.locked() = Some(handoff);
        answer
    }

    pub fn cancel(&self) {
        *self.0.locked() = None;
    }

    pub fn verify_and_consume(&self, provider: BrowserProvider, code: &str) -> Result<(), &'static str> {
        self.verify_at(provider, code, now_ms())
    }

    fn verify_at(&self, provider: BrowserProvider, code: &str, now: u64) -> Result<(), &'static str> {
        let mut slot = self.0.locked();
        let Some(handoff) = slot.as_mut() else {
            return Err(NO_HANDOFF);
        };
        if now >= handoff.expires_at_ms {
            *slot = None;
            return Err(EXPIRED);
        }
        let typed: String = code
            .trim()
            .chars()
            .take(32)
            .filter(|c| !c.is_whitespace() && *c != '-')
            .map(|c| c.to_ascii_uppercase())
            .collect();
        let matches = crate::store::secret_equals(&typed, &handoff.code);
        if matches && provider == handoff.provider {
            *slot = None;
            return Ok(());
        }
        handoff.attempts = handoff.attempts.saturating_add(1);
        if handoff.attempts >= MAX_ATTEMPTS {
            *slot = None;
            return Err(LOCKED);
        }
        Err(WRONG)
    }

    /// For `status()`: never the code.
    pub fn status(&self) -> Value {
        self.status_at(now_ms())
    }

    fn status_at(&self, now: u64) -> Value {
        match self.0.locked().as_ref().filter(|h| h.expires_at_ms > now) {
            Some(h) => json!({ "active": true, "provider": h.provider.key(), "expiresAtMs": h.expires_at_ms }),
            None => json!({ "active": false, "provider": null, "expiresAtMs": null }),
        }
    }
}

impl ConnectorManager {
    pub fn start_handoff(&self, provider: BrowserProvider) -> Value {
        self.browser.start(provider)
    }

    pub fn cancel_handoff(&self) {
        self.browser.cancel();
    }

    pub fn verify_and_consume_handoff(&self, provider: BrowserProvider, code: &str) -> Result<(), &'static str> {
        self.browser.verify_and_consume(provider, code)
    }

    pub fn active_handoff_status(&self) -> Value {
        self.browser.status()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "v2_CAISDGNiM2h5aWJzZmN5bxABGgdIT1lPTEFC";

    /// The error, without printing cookies (they have no Debug on purpose).
    fn hoyolab_error(raw: &str) -> String {
        parse_hoyolab_input(raw).err().expect("expected an error")
    }

    #[test]
    fn reads_a_raw_header_and_drops_the_rest() {
        let raw = format!(
            "mi18nLang=en-us; _HYVUUID=abc; ltuid_v2=123456789; ltoken_v2={TOKEN}; ltmid_v2=1abcd_hy; account_id_v2=123456789"
        );
        let cookies = parse_hoyolab_input(&raw).unwrap();
        assert_eq!(cookies.ltuid, "123456789");
        assert_eq!(cookies.ltoken, TOKEN);
        assert_eq!(cookies.ltmid, "1abcd_hy");
        assert_eq!(cookies.account_id.as_deref(), Some("123456789"));
        assert!(cookies.cookie_token.is_none());
        assert!(!cookies.header().contains("_HYVUUID") && !cookies.header().contains("mi18n"));
        let line = format!("Cookie: ltuid_v2=1; ltoken_v2={TOKEN}; ltmid_v2=m");
        assert_eq!(parse_hoyolab_input(&line).unwrap().ltuid, "1");
    }

    #[test]
    fn reads_curl_and_fetch_copies() {
        let bash = format!(
            "curl 'https://bbs-api-os.hoyolab.com/x' \\\n  -H 'accept: */*' \\\n  -H 'cookie: ltuid_v2=11; ltoken_v2={TOKEN}; ltmid_v2=mm' \\\n  -H 'x-rpc-language: en-us'"
        );
        assert_eq!(parse_hoyolab_input(&bash).unwrap().ltmid, "mm");
        let b_flag = format!("curl 'https://x.hoyolab.com/' -b 'ltuid_v2=12; ltoken_v2={TOKEN}; ltmid_v2=mm'");
        assert_eq!(parse_hoyolab_input(&b_flag).unwrap().ltuid, "12");
        let cmd = format!(
            "curl ^\"https://x.hoyolab.com/^\" ^\n  -H ^\"cookie: ltuid_v2=13; ltoken_v2={TOKEN}; ltmid_v2=mm^\""
        );
        assert_eq!(parse_hoyolab_input(&cmd).unwrap().ltuid, "13");
        let fetch = format!(
            "fetch(\"https://x.hoyolab.com/\", {{\n  \"headers\": {{\n    \"cookie\": \"ltuid_v2=14; ltoken_v2={TOKEN}; ltmid_v2=mm\"\n  }}\n}});"
        );
        assert_eq!(parse_hoyolab_input(&fetch).unwrap().ltuid, "14");
    }

    #[test]
    fn reads_json_objects_and_cookie_editor_arrays() {
        let object = format!(r#"{{"ltuid_v2": 15, "ltoken_v2": "{TOKEN}", "ltmid_v2": "mm", "other": "x"}}"#);
        assert_eq!(parse_hoyolab_input(&object).unwrap().ltuid, "15");
        let array = format!(
            r#"[{{"domain":".hoyolab.com","name":"ltuid_v2","value":"16"}},{{"name":"ltoken_v2","value":"{TOKEN}","httpOnly":true}},{{"name":"ltmid_v2","value":"mm"}},{{"name":"cookie_token_v2","value":"ctok"}}]"#
        );
        let cookies = parse_hoyolab_input(&array).unwrap();
        assert_eq!(cookies.ltuid, "16");
        assert_eq!(cookies.cookie_token.as_deref(), Some("ctok"));
        let helper = json!({ "ltuid_v2": "17", "ltoken_v2": TOKEN, "ltmid_v2": "mm" });
        assert_eq!(parse_hoyolab_input(&cookies_text(&helper).unwrap()).unwrap().ltuid, "17");
    }

    #[test]
    fn a_document_cookie_copy_explains_the_missing_ltoken() {
        let error = hoyolab_error("ltuid_v2=1; ltmid_v2=m; mi18nLang=en-us");
        assert!(error.contains("ltoken_v2") && error.contains("HttpOnly"));
        assert_eq!(hoyolab_error(""), MISSING_LTOKEN);
        let ids = hoyolab_error(&format!("ltoken_v2={TOKEN}"));
        assert_eq!(ids, MISSING_IDS);
        // A value is never echoed back.
        assert!(!ids.contains(TOKEN));
        // Look-alike names are not the real ones.
        assert!(parse_hoyolab_input(&format!("xltuid_v2=1; ltoken_v2={TOKEN}; ltmid_v2=m")).is_err());
        assert!(parse_hoyolab_input(&"a".repeat(MAX_INPUT + 1)).is_err());
    }

    #[test]
    fn reads_skport_tokens() {
        let (account, cred) = parse_skport_input("foo=1; ACCOUNT_TOKEN=abc%2Bdef%3D; bar=2").unwrap();
        assert_eq!(account.as_deref(), Some("abc+def="));
        assert!(cred.is_none());
        let encoded = "SK_OAUTH_CRED_KEY=%7B%22cred%22%3A%22xyz%22%7D";
        let (account, cred) = parse_skport_input(encoded).unwrap();
        assert!(account.is_none());
        assert_eq!(cred.as_deref(), Some("xyz"));
        let array = r#"[{"name":"ACCOUNT_TOKEN","value":"tok1"},{"name":"SK_OAUTH_CRED_KEY","value":"{\"cred\":\"c1\"}"}]"#;
        let (account, cred) = parse_skport_input(array).unwrap();
        assert_eq!((account.as_deref(), cred.as_deref()), (Some("tok1"), Some("c1")));
        assert_eq!(parse_skport_input("ltuid_v2=1").unwrap_err(), NO_SKPORT);
    }

    #[test]
    fn handoff_is_single_use_and_short_lived() {
        let slot = HandoffSlot::default();
        assert_eq!(slot.verify_at(BrowserProvider::Hoyolab, "ABCDEF", 0), Err(NO_HANDOFF));
        let started = slot.start_at(BrowserProvider::Hoyolab, 1_000);
        let code = started["code"].as_str().unwrap().to_string();
        assert_eq!(code.len(), CODE_LEN);
        assert!(code.bytes().all(|b| CODE_ALPHABET.contains(&b)));
        assert_eq!(started["expiresAtMs"], 1_000 + HANDOFF_TTL_MS);
        let status = slot.status_at(1_000);
        assert_eq!(status["active"], true);
        assert!(!status.to_string().contains(&code));
        // Case and spacing do not matter; the right code for the wrong service does.
        assert_eq!(slot.verify_at(BrowserProvider::Skport, &code, 2_000), Err(WRONG));
        let typed = format!(" {} ", code.to_ascii_lowercase());
        assert_eq!(slot.verify_at(BrowserProvider::Hoyolab, &typed, 2_000), Ok(()));
        assert_eq!(slot.verify_at(BrowserProvider::Hoyolab, &code, 2_000), Err(NO_HANDOFF));
        assert_eq!(slot.status_at(2_000)["active"], false);

        let code = slot.start_at(BrowserProvider::Skport, 0)["code"].as_str().unwrap().to_string();
        assert_eq!(slot.verify_at(BrowserProvider::Skport, &code, HANDOFF_TTL_MS), Err(EXPIRED));
        assert_eq!(slot.verify_at(BrowserProvider::Skport, &code, 0), Err(NO_HANDOFF));
    }

    #[test]
    fn handoff_locks_after_five_wrong_codes() {
        let slot = HandoffSlot::default();
        let code = slot.start_at(BrowserProvider::Hoyolab, 0)["code"].as_str().unwrap().to_string();
        let wrong = if code == "AAAAAA" { "BBBBBB" } else { "AAAAAA" };
        for _ in 0..MAX_ATTEMPTS - 1 {
            assert_eq!(slot.verify_at(BrowserProvider::Hoyolab, wrong, 1), Err(WRONG));
        }
        assert_eq!(slot.verify_at(BrowserProvider::Hoyolab, wrong, 1), Err(LOCKED));
        assert_eq!(slot.verify_at(BrowserProvider::Hoyolab, &code, 1), Err(NO_HANDOFF));
        // Starting again replaces any earlier code.
        let first = slot.start_at(BrowserProvider::Hoyolab, 0)["code"].as_str().unwrap().to_string();
        let second = slot.start_at(BrowserProvider::Hoyolab, 0)["code"].as_str().unwrap().to_string();
        if first != second {
            assert_eq!(slot.verify_at(BrowserProvider::Hoyolab, &first, 1), Err(WRONG));
        }
        assert_eq!(slot.verify_at(BrowserProvider::Hoyolab, &second, 1), Ok(()));
        slot.start_at(BrowserProvider::Hoyolab, 0);
        slot.cancel();
        assert_eq!(slot.status_at(0)["active"], false);
    }
}
