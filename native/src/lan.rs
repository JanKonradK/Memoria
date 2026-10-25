//! Phone sync over the local network. Ported from desktop/lan-sync.mjs.
//!
//! A separate listener from the loopback launcher. Only the Android app, on a
//! private network, with a paired token, can merge into the PC document.

use std::{
    fs,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    Router,
    extract::{ConnectInfo, Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::{Semaphore, oneshot};

use crate::{
    core::{CoreError, MAX_SYNC_BYTES, StateCore},
    policy::is_token,
    server::read_body,
};

pub const LAN_PORT: u16 = 17820;
const CODE_TTL_MS: u64 = 5 * 60_000;
const MAX_DEVICES: usize = 10;
const LOAD_ERROR: &str =
    "Saved phone connections could not be read. Your progress is safe. Reset phone connections to pair again.";
const SIZE_LIMIT: &str = "Request exceeds the sync size limit.";
const GENERIC: &str = "PC sync could not save data. Check the PC and try again.";

fn fail(status: u16, message: impl Into<String>) -> CoreError {
    CoreError::new(status, message)
}

fn hash(value: &str) -> String {
    Sha256::digest(value.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    rand::fill(&mut bytes);
    bytes
}

/// 10/8, 172.16/12, 192.168/16 and loopback, as the Node listener allowed.
pub fn private_address(ip: IpAddr) -> bool {
    let v4 = match ip {
        IpAddr::V4(v4) => v4,
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => v4,
            None => return false,
        },
    };
    let [a, b, ..] = v4.octets();
    a == 10 || (a == 192 && b == 168) || (a == 172 && (16..=31).contains(&b)) || a == 127
}

#[derive(Clone, Debug, PartialEq)]
pub struct Device {
    id: String,
    hash: String,
    name: String,
    paired_at: serde_json::Number,
}

impl Device {
    fn parse(d: &Value) -> Option<Self> {
        let hash = d.get("hash")?.as_str()?;
        let paired_at = d.get("pairedAt")?.as_number()?;
        let valid_hash = hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        let valid_time = paired_at.as_f64().is_some_and(|t| t.is_finite() && t >= 0.0);
        if !valid_hash || !valid_time {
            return None;
        }
        Some(Self {
            id: d.get("id")?.as_str()?.to_owned(),
            hash: hash.to_owned(),
            name: d.get("name")?.as_str()?.to_owned(),
            paired_at: paired_at.clone(),
        })
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Config {
    enabled: bool,
    devices: Vec<Device>,
}

impl Config {
    fn to_json(&self) -> Value {
        json!({
            "enabled": self.enabled,
            "devices": self.devices.iter().map(|d| json!({
                "id": d.id, "hash": d.hash, "name": d.name, "pairedAt": d.paired_at,
            })).collect::<Vec<_>>(),
        })
    }

    /// The same checks as the Node loader. Anything else is unreadable.
    fn parse(saved: &Value) -> Option<Self> {
        let saved = saved.as_object()?;
        let enabled = match saved.get("enabled") {
            None => false,
            Some(Value::Bool(enabled)) => *enabled,
            Some(_) => return None,
        };
        let devices = match saved.get("devices") {
            None => Vec::new(),
            Some(Value::Array(items)) => items.iter().map(Device::parse).collect::<Option<Vec<_>>>()?,
            Some(_) => return None,
        };
        Some(Self { enabled, devices })
    }
}

/// Where pairings live. The file store is devices.json beside state.json.
pub trait ConfigStore: Send + Sync {
    /// `Ok(None)` when there is no file yet.
    fn load(&self) -> Result<Option<Value>, String>;
    fn save(&self, config: &Value) -> Result<(), String>;
    /// Moves an unreadable file aside, never deleting it.
    fn reset(&self) -> Result<(), String>;
}

pub struct FileStore {
    pub file: PathBuf,
}

impl ConfigStore for FileStore {
    fn load(&self) -> Result<Option<Value>, String> {
        match fs::read_to_string(&self.file) {
            Ok(text) => serde_json::from_str(&text).map(Some).map_err(|e| e.to_string()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn save(&self, config: &Value) -> Result<(), String> {
        let dir = self.file.parent().ok_or("No data folder.")?;
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let temporary = self.file.with_extension("json.tmp");
        fs::write(&temporary, config.to_string()).map_err(|e| e.to_string())?;
        fs::rename(&temporary, &self.file).map_err(|e| e.to_string())
    }

    fn reset(&self) -> Result<(), String> {
        if !self.file.exists() {
            return Ok(());
        }
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let suffix: String = random_bytes::<4>().iter().map(|b| format!("{b:02x}")).collect();
        let backup = self.file.with_file_name(format!("devices-unreadable-{stamp}-{suffix}.json"));
        fs::rename(&self.file, backup).map_err(|e| e.to_string())
    }
}

struct Pairing {
    code: String,
    expires_at: u64,
}

struct Running {
    port: u16,
    shutdown: Option<oneshot::Sender<()>>,
}

#[derive(Default)]
struct Inner {
    config: Config,
    load_error: Option<String>,
    server: Option<Running>,
    pairing: Option<Pairing>,
    failures: Vec<u64>,
}

pub type Clock = Box<dyn Fn() -> u64 + Send + Sync>;

pub struct LanSync {
    inner: Mutex<Inner>,
    /// Settings commands run one at a time, so double clicks cannot leave a stray listener.
    control: tokio::sync::Mutex<()>,
    core: StateCore,
    store: Box<dyn ConfigStore>,
    now: Clock,
    port: u16,
    connections: Arc<Semaphore>,
}

pub fn wall_clock() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl LanSync {
    pub fn new(core: StateCore, store: Box<dyn ConfigStore>, now: Clock, port: u16) -> Arc<Self> {
        let mut inner = Inner::default();
        // Pairing metadata must never block opening local progress, and an
        // unreadable file is left alone until the user asks for recovery.
        match store.load().map(|saved| saved.map_or(Some(Config::default()), |v| Config::parse(&v))) {
            Ok(Some(config)) => inner.config = config,
            _ => inner.load_error = Some(LOAD_ERROR.into()),
        }
        Arc::new(Self {
            inner: Mutex::new(inner),
            control: tokio::sync::Mutex::new(()),
            core,
            store,
            now,
            port,
            connections: Arc::new(Semaphore::new(20)),
        })
    }

    /// Saves first, then changes what the app shows and authorizes. A failed
    /// write leaves the previous controls in place for a retry.
    fn commit(&self, inner: &mut Inner, next: Config) -> Result<(), CoreError> {
        self.store.save(&next.to_json()).map_err(|e| fail(500, e))?;
        inner.config = next;
        Ok(())
    }

    fn active(inner: &Inner, device: &Device) -> bool {
        inner.server.is_some() && inner.config.devices.contains(device)
    }

    fn status_of(&self, inner: &Inner) -> Value {
        let now = (self.now)();
        let pairing = inner.pairing.as_ref().filter(|p| p.expires_at > now);
        let port = inner.server.as_ref().map_or(self.port, |s| s.port);
        let addresses: Vec<String> = match inner.server {
            Some(_) => if_addrs::get_if_addrs()
                .unwrap_or_default()
                .into_iter()
                .filter(|i| !i.is_loopback())
                .filter_map(|i| match i.ip() {
                    IpAddr::V4(v4) if private_address(IpAddr::V4(v4)) => Some(format!("http://{v4}:{port}")),
                    _ => None,
                })
                .collect(),
            None => Vec::new(),
        };
        json!({
            "enabled": inner.server.is_some(),
            "error": inner.load_error,
            "port": port,
            "addresses": addresses,
            "code": pairing.map(|p| p.code.clone()),
            "expiresAt": pairing.map(|p| p.expires_at),
            "devices": inner.config.devices.iter().map(|d| json!({ "id": d.id, "name": d.name, "pairedAt": d.paired_at })).collect::<Vec<_>>(),
        })
    }

    pub fn status(&self) -> Value {
        self.status_of(&self.inner.lock().unwrap())
    }

    fn new_code(&self, inner: &mut Inner) -> Result<Value, CoreError> {
        if inner.server.is_none() {
            return Err(fail(409, "Turn on Wi-Fi sync first."));
        }
        let number = u64::from_le_bytes(random_bytes::<8>()) % 100_000_000;
        inner.pairing = Some(Pairing { code: format!("{number:08}"), expires_at: (self.now)() + CODE_TTL_MS });
        Ok(self.status_of(inner))
    }

    async fn start(self: &Arc<Self>) -> Result<Value, CoreError> {
        if self.inner.lock().unwrap().server.is_some() {
            return Ok(self.status());
        }
        let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, self.port)))
            .await
            .map_err(|e| fail(500, format!("Wi-Fi sync could not use port {}: {e}", self.port)))?;
        let port = listener.local_addr().map(|a| a.port()).unwrap_or(self.port);
        let mut inner = self.inner.lock().unwrap();
        let next = Config { enabled: true, ..inner.config.clone() };
        // Dropping the listener on failure closes it again.
        self.commit(&mut inner, next)?;
        let (shutdown, stopped) = oneshot::channel::<()>();
        let router =
            Router::new().fallback(handle).with_state(self.clone()).into_make_service_with_connect_info::<SocketAddr>();
        tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = stopped.await;
                })
                .await;
        });
        inner.server = Some(Running { port, shutdown: Some(shutdown) });
        self.new_code(&mut inner)
    }

    fn stop(&self) -> Result<Value, CoreError> {
        let mut inner = self.inner.lock().unwrap();
        let next = Config { enabled: false, ..inner.config.clone() };
        self.commit(&mut inner, next)?;
        inner.pairing = None;
        if let Some(mut running) = inner.server.take() {
            running.shutdown.take().map(|s| s.send(()));
        }
        Ok(self.status_of(&inner))
    }

    /// Turns the listener back on after a restart if the user had it on.
    pub async fn restore(self: &Arc<Self>) -> Result<Value, CoreError> {
        let enabled = self.inner.lock().unwrap().config.enabled;
        if enabled { self.start().await } else { Ok(self.status()) }
    }

    /// The Settings controls behind /api/devices.
    pub async fn control(self: &Arc<Self>, body: &Value) -> Result<Value, CoreError> {
        let _serial = self.control.lock().await;
        let action = body.get("action").and_then(Value::as_str).unwrap_or_default();
        if let Some(error) = self.inner.lock().unwrap().load_error.clone()
            && action != "reset"
        {
            return Err(fail(409, error));
        }
        match action {
            "reset" => {
                let mut inner = self.inner.lock().unwrap();
                if inner.load_error.is_none() {
                    return Err(fail(409, "Phone connections do not need to be reset."));
                }
                self.store.reset().map_err(|e| fail(500, e))?;
                self.commit(&mut inner, Config::default())?;
                inner.load_error = None;
                Ok(self.status_of(&inner))
            }
            "start" => self.start().await,
            "stop" => self.stop(),
            "code" => self.new_code(&mut self.inner.lock().unwrap()),
            "revoke" => {
                let mut inner = self.inner.lock().unwrap();
                let id = body.get("id");
                let devices = inner.config.devices.iter().filter(|d| Some(&json!(d.id)) != id).cloned().collect();
                let next = Config { devices, ..inner.config.clone() };
                self.commit(&mut inner, next)?;
                Ok(self.status_of(&inner))
            }
            _ => Err(fail(400, "Unknown device action.")),
        }
    }

    fn pair(&self, body: &Value) -> Result<Value, CoreError> {
        let mut inner = self.inner.lock().unwrap();
        let now = (self.now)();
        let candidate: String = body
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        let valid = inner.pairing.as_ref().is_some_and(|p| {
            p.expires_at > now
                && candidate.len() == 8
                && candidate.bytes().all(|b| b.is_ascii_digit())
                && candidate.bytes().zip(p.code.bytes()).fold(0u8, |d, (a, b)| d | (a ^ b)) == 0
        });
        if !valid {
            return Err(fail(401, "The pairing code is wrong or has expired. Get a new code from PC Settings."));
        }
        if inner.config.devices.len() >= MAX_DEVICES {
            return Err(fail(409, "Remove an old device from PC Settings before pairing another."));
        }
        let token = URL_SAFE_NO_PAD.encode(random_bytes::<32>());
        let name = body.get("name").and_then(Value::as_str).map(|n| n.trim().chars().take(60).collect::<String>());
        let device = Device {
            id: random_bytes::<12>().iter().map(|b| format!("{b:02x}")).collect(),
            hash: hash(&token),
            name: name.filter(|n| !n.is_empty()).unwrap_or_else(|| "Android phone".into()),
            paired_at: now.into(),
        };
        let mut next = inner.config.clone();
        next.devices.push(device.clone());
        self.commit(&mut inner, next)?;
        inner.pairing = None;
        Ok(json!({ "token": token, "deviceId": device.id }))
    }

    async fn serve(self: &Arc<Self>, remote: SocketAddr, request: Request) -> Result<Value, CoreError> {
        let headers = request.headers().clone();
        // A native HTTP client sends no Origin. Browser pages are never let in,
        // even with a pairing code someone shared by mistake.
        if headers.contains_key(header::ORIGIN)
            || headers.contains_key("sec-fetch-site")
            || !private_address(remote.ip())
        {
            return Err(fail(403, "Use the Memoria Android app on the same private Wi-Fi network."));
        }
        let path = request.uri().path_and_query().map(|p| p.as_str().to_owned()).unwrap_or_default();
        if request.method() != "POST" || !["/pair", "/sync", "/disconnect"].contains(&path.as_str()) {
            return Err(fail(404, "Route not found."));
        }
        if path == "/pair" {
            {
                let mut inner = self.inner.lock().unwrap();
                let now = (self.now)();
                inner.failures.retain(|at| *at > now.saturating_sub(60_000));
                if inner.failures.len() >= 5 {
                    return Err(fail(429, "Too many pairing attempts. Wait one minute and try again."));
                }
                inner.failures.push(now);
            }
            let body = read_json(&headers, request.into_body(), 1024).await?;
            return self.pair(&body);
        }
        let bearer = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .filter(|t| is_token(t));
        let device = {
            let inner = self.inner.lock().unwrap();
            let device = bearer.and_then(|t| inner.config.devices.iter().find(|d| d.hash == hash(t)).cloned());
            device.filter(|d| Self::active(&inner, d))
        };
        let Some(device) = device else {
            return Err(fail(401, "This phone is no longer paired. Pair it again in Settings."));
        };
        if path == "/disconnect" {
            let mut inner = self.inner.lock().unwrap();
            let devices = inner.config.devices.iter().filter(|d| **d != device).cloned().collect();
            let next = Config { devices, ..inner.config.clone() };
            self.commit(&mut inner, next)?;
            return Ok(json!({ "ok": true }));
        }
        let body = read_text(&headers, request.into_body(), MAX_SYNC_BYTES).await?;
        let lan = self.clone();
        let checked = device.clone();
        let authorized = Box::new(move || Self::active(&lan.inner.lock().unwrap(), &checked));
        let merged = self.core.merge(body, authorized).await?;
        if !Self::active(&self.inner.lock().unwrap(), &device) {
            return Err(fail(401, "This device was disconnected."));
        }
        serde_json::from_str::<Value>(&merged)
            .map(|state| json!({ "state": state }))
            .map_err(|e| fail(500, e.to_string()))
    }
}

/// A request body as text that parses as JSON. The 413 keeps the size message.
async fn read_text(headers: &axum::http::HeaderMap, body: axum::body::Body, limit: usize) -> Result<String, CoreError> {
    let bytes = read_body(headers, body, limit, SIZE_LIMIT).await.map_err(|response| {
        let status = response.status().as_u16();
        let message = match status {
            413 => SIZE_LIMIT,
            415 => "Content-Type must be application/json.",
            _ => "Request interrupted.",
        };
        fail(status, message)
    })?;
    let text = String::from_utf8(bytes.to_vec()).map_err(|_| fail(400, "Request body is not valid JSON."))?;
    serde_json::from_str::<Value>(&text).map_err(|_| fail(400, "Request body is not valid JSON."))?;
    Ok(text)
}

pub async fn read_json(
    headers: &axum::http::HeaderMap,
    body: axum::body::Body,
    limit: usize,
) -> Result<Value, CoreError> {
    let text = read_text(headers, body, limit).await?;
    serde_json::from_str(&text).map_err(|_| fail(400, "Request body is not valid JSON."))
}

fn respond(status: u16, body: Value) -> Response {
    let mut response = (
        StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        body.to_string(),
    )
        .into_response();
    if status == 413 {
        // The client is told to stop sending; the reader drains what is in flight.
        response.headers_mut().insert(header::CONNECTION, header::HeaderValue::from_static("close"));
    }
    response
}

async fn handle(
    State(lan): State<Arc<LanSync>>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    request: Request,
) -> Response {
    let Ok(_permit) = lan.connections.clone().try_acquire_owned() else {
        return respond(503, json!({ "error": "PC sync is busy. Try again." }));
    };
    match tokio::time::timeout(Duration::from_secs(15), lan.serve(remote, request)).await {
        Ok(Ok(body)) => respond(200, body),
        // Only errors with a reason meant for the phone are shown as such.
        Ok(Err(error)) if error.status == 500 => respond(500, json!({ "error": GENERIC })),
        Ok(Err(error)) => respond(error.status, json!({ "error": error.message })),
        Err(_) => respond(408, json!({ "error": "The request took too long. Try again." })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

    struct Memory {
        saved: Mutex<Option<Value>>,
        failing: Arc<AtomicBool>,
        backed_up: Mutex<Option<Value>>,
    }

    impl ConfigStore for Arc<Memory> {
        fn load(&self) -> Result<Option<Value>, String> {
            Ok(self.saved.lock().unwrap().clone())
        }
        fn save(&self, config: &Value) -> Result<(), String> {
            if self.failing.load(Ordering::SeqCst) {
                return Err("Disk write failed".into());
            }
            *self.saved.lock().unwrap() = Some(config.clone());
            Ok(())
        }
        fn reset(&self) -> Result<(), String> {
            *self.backed_up.lock().unwrap() = self.saved.lock().unwrap().clone();
            Ok(())
        }
    }

    struct Fixture {
        lan: Arc<LanSync>,
        store: Arc<Memory>,
        clock: Arc<AtomicU64>,
        origin: String,
        _temp: tempfile::TempDir,
        state: PathBuf,
    }

    async fn fixture(saved: Option<Value>) -> Fixture {
        let temp = tempfile::tempdir().unwrap();
        let state = temp.path().join("state.json");
        let store = Arc::new(Memory { saved: Mutex::new(saved), failing: Arc::default(), backed_up: Mutex::default() });
        let clock = Arc::new(AtomicU64::new(100_000));
        let ticking = clock.clone();
        let lan = LanSync::new(
            StateCore::start(state.clone()).unwrap(),
            Box::new(store.clone()),
            Box::new(move || ticking.load(Ordering::SeqCst)),
            0,
        );
        Fixture { lan, store, clock, origin: String::new(), _temp: temp, state }
    }

    async fn started(saved: Option<Value>) -> Fixture {
        let mut f = fixture(saved).await;
        let status = f.lan.control(&json!({ "action": "start" })).await.unwrap();
        f.origin = format!("http://127.0.0.1:{}", status["port"]);
        f
    }

    async fn post(f: &Fixture, path: &str, body: Value, token: Option<&str>) -> (u16, Value) {
        let mut request = reqwest::Client::new().post(format!("{}{path}", f.origin)).json(&body);
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        let response = request.send().await.unwrap();
        (response.status().as_u16(), response.json().await.unwrap_or(Value::Null))
    }

    async fn pair(f: &Fixture) -> (String, String) {
        let code = f.lan.status()["code"].clone();
        let (status, body) = post(f, "/pair", json!({ "code": code }), None).await;
        assert_eq!(status, 200, "{body}");
        (body["token"].as_str().unwrap().into(), body["deviceId"].as_str().unwrap().into())
    }

    fn empty() -> Value {
        json!({ "state": { "schemaVersion": 0 } })
    }

    #[tokio::test]
    async fn pairs_once_rejects_browsers_and_revokes() {
        let f = started(None).await;
        let code = f.lan.status()["code"].clone();
        let browser = reqwest::Client::new()
            .post(format!("{}/pair", f.origin))
            .header("origin", "https://untrusted.example")
            .json(&json!({ "code": code }))
            .send()
            .await
            .unwrap();
        assert_eq!(browser.status(), 403);
        assert_eq!(post(&f, "/sync", empty(), None).await.0, 401);
        let (token, id) = pair(&f).await;
        assert_eq!(post(&f, "/pair", json!({ "code": code }), None).await.0, 401);
        assert!(!f.lan.status().to_string().contains(&token));
        f.lan.control(&json!({ "action": "revoke", "id": id })).await.unwrap();
        assert_eq!(post(&f, "/sync", empty(), Some(&token)).await.0, 401);
        f.lan.control(&json!({ "action": "stop" })).await.unwrap();
    }

    #[tokio::test]
    async fn syncs_through_the_state_rules_and_limits_size() {
        let f = started(None).await;
        let (token, _) = pair(&f).await;
        assert_eq!(post(&f, "/sync", json!({ "state": {} }), Some(&token)).await.0, 400);
        let (status, body) = post(&f, "/sync", json!({ "state": "x".repeat(1_000_001) }), Some(&token)).await;
        assert_eq!((status, body), (413, json!({ "error": SIZE_LIMIT })));
        assert!(!f.state.exists());
        let state = f.lan.core.read().await.unwrap();
        let (status, body) = post(&f, "/sync", json!({ "state": state }), Some(&token)).await;
        assert_eq!(status, 200, "{body}");
        assert!(body["state"]["games"].is_array());
        f.lan.control(&json!({ "action": "stop" })).await.unwrap();
    }

    #[tokio::test]
    async fn expires_codes_and_limits_guesses() {
        let f = started(None).await;
        let code = f.lan.status()["code"].clone();
        f.clock.fetch_add(300_001, Ordering::SeqCst);
        assert_eq!(post(&f, "/pair", json!({ "code": code }), None).await.0, 401);
        for _ in 0..4 {
            assert_eq!(post(&f, "/pair", json!({ "code": "éééééééé" }), None).await.0, 401);
        }
        assert_eq!(post(&f, "/pair", json!({ "code": code }), None).await.0, 429);
        f.clock.fetch_add(60_001, Ordering::SeqCst);
        f.lan.control(&json!({ "action": "code" })).await.unwrap();
        pair(&f).await;
        f.lan.control(&json!({ "action": "stop" })).await.unwrap();
    }

    #[tokio::test]
    async fn keeps_controls_unchanged_when_writes_fail() {
        let f = fixture(Some(json!({ "enabled": false, "devices": [] }))).await;
        f.store.failing.store(true, Ordering::SeqCst);
        let error = f.lan.control(&json!({ "action": "start" })).await.unwrap_err();
        assert_eq!(error.message, "Disk write failed");
        assert_eq!(f.lan.status()["enabled"], false);
        f.store.failing.store(false, Ordering::SeqCst);
        let status = f.lan.control(&json!({ "action": "start" })).await.unwrap();
        let f = Fixture { origin: format!("http://127.0.0.1:{}", status["port"]), ..f };
        let code = f.lan.status()["code"].clone();
        f.store.failing.store(true, Ordering::SeqCst);
        assert_eq!(post(&f, "/pair", json!({ "code": code }), None).await.0, 500);
        assert_eq!(f.lan.status()["code"], code);
        assert_eq!(f.lan.status()["devices"].as_array().unwrap().len(), 0);
        f.store.failing.store(false, Ordering::SeqCst);
        let (token, id) = pair(&f).await;
        f.store.failing.store(true, Ordering::SeqCst);
        assert!(f.lan.control(&json!({ "action": "revoke", "id": id })).await.is_err());
        assert_eq!(post(&f, "/disconnect", json!({}), Some(&token)).await.0, 500);
        assert_eq!(f.lan.status()["devices"].as_array().unwrap().len(), 1);
        assert!(f.lan.control(&json!({ "action": "stop" })).await.is_err());
        assert_eq!(f.lan.status()["enabled"], true);
        f.store.failing.store(false, Ordering::SeqCst);
        f.lan.control(&json!({ "action": "revoke", "id": id })).await.unwrap();
        assert_eq!(post(&f, "/sync", empty(), Some(&token)).await.0, 401);
        f.lan.control(&json!({ "action": "stop" })).await.unwrap();
        assert_eq!(f.store.saved.lock().unwrap().as_ref().unwrap()["enabled"], false);
    }

    #[tokio::test]
    async fn isolates_unreadable_pairings_until_reset() {
        for saved in
            [json!({ "devices": [null] }), json!({ "enabled": "yes" }), json!([]), json!("corrupt"), Value::Null]
        {
            let f = fixture(Some(saved.clone())).await;
            assert_eq!(f.lan.restore().await.unwrap()["enabled"], false);
            assert!(f.lan.status()["error"].as_str().unwrap().contains("Saved phone connections could not be read"));
            assert_eq!(f.lan.control(&json!({ "action": "start" })).await.unwrap_err().status, 409);
            assert_eq!(f.store.saved.lock().unwrap().clone(), Some(saved.clone()));
            f.lan.control(&json!({ "action": "reset" })).await.unwrap();
            assert_eq!(f.store.backed_up.lock().unwrap().clone(), Some(saved));
            assert_eq!(f.store.saved.lock().unwrap().clone(), Some(json!({ "enabled": false, "devices": [] })));
            assert!(f.lan.status()["error"].is_null());
        }
    }

    #[tokio::test]
    async fn stops_listening_and_keeps_devices() {
        let f = started(None).await;
        pair(&f).await;
        let stopped = f.lan.control(&json!({ "action": "stop" })).await.unwrap();
        assert_eq!(stopped["enabled"], false);
        assert!(stopped["code"].is_null());
        assert_eq!(stopped["devices"].as_array().unwrap().len(), 1);
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(reqwest::Client::new().post(format!("{}/sync", f.origin)).json(&json!({})).send().await.is_err());
    }

    #[tokio::test]
    async fn answers_and_closes_an_upload_that_never_arrives() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let f = started(None).await;
        let (token, _) = pair(&f).await;
        let address = f.origin.trim_start_matches("http://").to_owned();
        let mut socket = tokio::net::TcpStream::connect(&address).await.unwrap();
        let head = format!(
            "POST /sync HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: 1000001\r\n\r\n"
        );
        socket.write_all(head.as_bytes()).await.unwrap();
        let mut response = String::new();
        tokio::time::timeout(Duration::from_secs(3), socket.read_to_string(&mut response))
            .await
            .expect("the connection was not closed")
            .unwrap();
        assert!(response.starts_with("HTTP/1.1 413 "), "{response}");
        assert!(response.ends_with(&json!({ "error": SIZE_LIMIT }).to_string()), "{response}");
        assert!(!f.state.exists());
        f.lan.control(&json!({ "action": "stop" })).await.unwrap();
    }

    #[test]
    fn admits_only_private_networks() {
        for ip in ["10.0.0.2", "192.168.1.5", "172.16.0.1", "172.31.255.255", "127.0.0.1", "::ffff:192.168.0.9"] {
            assert!(private_address(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "172.32.0.1", "100.64.0.1", "::1", "fe80::1"] {
            assert!(!private_address(ip.parse().unwrap()), "{ip}");
        }
    }
}
