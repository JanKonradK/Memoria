//! Wi-Fi sync with the Android app.
//!
//! A separate listener from the window's loopback server. The phone pairs with
//! an eight-digit code shown in PC Settings, then syncs with a bearer token
//! whose hash is all the PC keeps. The protocol matches the phone app exactly.

use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Router;
use rand::{Rng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::oneshot;

use crate::core::{Core, CoreError, MAX_STATE_BYTES};
use crate::store;

pub const LAN_PORT: u16 = 17820;
const CODE_TTL_MS: u64 = 5 * 60_000;
const MAX_DEVICES: usize = 10;
const UNREADABLE: &str =
    "Saved phone connections could not be read. Your progress is safe. Reset phone connections to pair again.";

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

/// Private IPv4 ranges, loopback, and 100.64.0.0/10, the range private network
/// apps such as Tailscale use to reach the PC away from home Wi-Fi. Anything
/// else never reaches the sync routes.
pub fn private_address(ip: IpAddr) -> bool {
    let ip = match ip {
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => return false,
        },
        other => other,
    };
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            a == 10
                || a == 127
                || (a == 192 && b == 168)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 100 && (64..=127).contains(&b))
        }
        IpAddr::V6(_) => false,
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Device {
    id: String,
    hash: String,
    name: String,
    paired_at: f64,
}

#[derive(Clone, Default, Serialize)]
struct Config {
    enabled: bool,
    devices: Vec<Device>,
}

fn parse_config(value: &Value) -> Option<Config> {
    let object = value.as_object()?;
    let enabled = match object.get("enabled") {
        None => false,
        Some(Value::Bool(flag)) => *flag,
        Some(_) => return None,
    };
    let devices = match object.get("devices") {
        None => Vec::new(),
        Some(Value::Array(items)) => {
            let mut devices = Vec::new();
            for item in items {
                let id = item.get("id")?.as_str()?;
                let hash = item.get("hash")?.as_str()?;
                let name = item.get("name")?.as_str()?;
                let paired_at = item.get("pairedAt")?.as_f64()?;
                if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
                    return None;
                }
                if !paired_at.is_finite() || paired_at < 0.0 {
                    return None;
                }
                devices.push(Device {
                    id: id.into(),
                    hash: hash.into(),
                    name: name.into(),
                    paired_at,
                });
            }
            devices
        }
        Some(_) => return None,
    };
    Some(Config { enabled, devices })
}

struct Pairing {
    code: String,
    expires_at: u64,
}

struct Inner {
    config: Config,
    load_error: Option<&'static str>,
    pairing: Option<Pairing>,
    failures: Vec<u64>,
    /// The bound port and the switch that stops the listener.
    running: Option<(u16, oneshot::Sender<()>)>,
}

#[derive(Clone)]
pub struct Lan {
    inner: Arc<Mutex<Inner>>,
    /// Settings commands run one at a time, so double clicks cannot start a stray listener.
    control_lock: Arc<tokio::sync::Mutex<()>>,
    file: PathBuf,
    core: Core,
    port: u16,
}

#[derive(Debug)]
pub struct LanError {
    pub status: u16,
    pub message: String,
}

fn fail(status: u16, message: impl Into<String>) -> LanError {
    LanError {
        status,
        message: message.into(),
    }
}

impl From<CoreError> for LanError {
    fn from(error: CoreError) -> Self {
        fail(error.status, error.message)
    }
}

impl Lan {
    pub fn new(data: PathBuf, core: Core, port: u16) -> Self {
        let file = data.join("devices.json");
        let (config, load_error) = match std::fs::read(&file) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (Config::default(), None),
            Err(_) => (Config::default(), Some(UNREADABLE)),
            Ok(bytes) => match serde_json::from_slice::<Value>(&bytes)
                .ok()
                .as_ref()
                .and_then(parse_config)
            {
                Some(config) => (config, None),
                // Never write over an unreadable file until the user asks to reset it.
                None => (Config::default(), Some(UNREADABLE)),
            },
        };
        Self {
            inner: Arc::new(Mutex::new(Inner {
                config,
                load_error,
                pairing: None,
                failures: Vec::new(),
                running: None,
            })),
            control_lock: Arc::new(tokio::sync::Mutex::new(())),
            file,
            core,
            port,
        }
    }

    fn save(&self, next: &Config) -> Result<(), LanError> {
        store::write_atomic(&self.file, serde_json::to_string(next).unwrap_or_default().as_bytes())
            .map_err(|error| fail(500, format!("Phone connections could not be saved: {error}")))
    }

    /// Keep what Settings shows in step with disk: a failed write leaves the old config in place.
    fn commit(&self, inner: &mut Inner, next: Config) -> Result<(), LanError> {
        self.save(&next)?;
        inner.config = next;
        Ok(())
    }

    pub fn status(&self) -> Value {
        let inner = self.inner.lock().unwrap();
        status_of(&inner, self.port)
    }

    pub fn enabled(&self) -> bool {
        self.inner.lock().unwrap().running.is_some()
    }

    /// Starts the listener again if the user left Wi-Fi sync on.
    pub async fn restore(&self) {
        if self.inner.lock().unwrap().config.enabled {
            if let Err(error) = self.start().await {
                eprintln!("Wi-Fi sync unavailable: {}", error.message);
            }
        }
    }

    pub async fn control(&self, body: &Value) -> Result<Value, LanError> {
        let _serial = self.control_lock.lock().await;
        let action = body.get("action").and_then(Value::as_str).unwrap_or("");
        let load_error = self.inner.lock().unwrap().load_error;
        if let Some(message) = load_error {
            if action != "reset" {
                return Err(fail(409, message));
            }
        }
        match action {
            "reset" => {
                if load_error.is_none() {
                    return Err(fail(409, "Phone connections do not need to be reset."));
                }
                if self.file.exists() {
                    let mut suffix = [0u8; 4];
                    rand::thread_rng().fill_bytes(&mut suffix);
                    let backup = self.file.with_file_name(format!(
                        "devices-unreadable-{}-{}.json",
                        now_ms(),
                        hex::encode(suffix)
                    ));
                    std::fs::rename(&self.file, backup).map_err(|e| fail(500, e.to_string()))?;
                }
                let mut inner = self.inner.lock().unwrap();
                self.commit(&mut inner, Config::default())?;
                inner.load_error = None;
                Ok(status_of(&inner, self.port))
            }
            "start" => self.start().await,
            "stop" => self.stop(),
            "code" => self.new_code(),
            "revoke" => {
                let id = body.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                let mut inner = self.inner.lock().unwrap();
                let mut next = inner.config.clone();
                next.devices.retain(|device| device.id != id);
                self.commit(&mut inner, next)?;
                Ok(status_of(&inner, self.port))
            }
            _ => Err(fail(400, "Unknown device action.")),
        }
    }

    fn new_code(&self) -> Result<Value, LanError> {
        let mut inner = self.inner.lock().unwrap();
        if inner.running.is_none() {
            return Err(fail(409, "Turn on Wi-Fi sync first."));
        }
        let code = format!("{:08}", rand::thread_rng().gen_range(0..100_000_000u32));
        inner.pairing = Some(Pairing {
            code,
            expires_at: now_ms() + CODE_TTL_MS,
        });
        Ok(status_of(&inner, self.port))
    }

    async fn start(&self) -> Result<Value, LanError> {
        if self.enabled() {
            return Ok(self.status());
        }
        let listener = tokio::net::TcpListener::bind(("0.0.0.0", self.port))
            .await
            .map_err(|error| fail(500, format!("Wi-Fi sync could not start: {error}")))?;
        let port = listener.local_addr().map(|a| a.port()).unwrap_or(self.port);
        {
            let mut inner = self.inner.lock().unwrap();
            let mut next = inner.config.clone();
            next.enabled = true;
            self.commit(&mut inner, next)?;
        }
        let (stop, stopped) = oneshot::channel::<()>();
        let router = Router::new().fallback(handle).with_state(self.clone());
        tokio::spawn(async move {
            let _ = axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>())
                .with_graceful_shutdown(async {
                    let _ = stopped.await;
                })
                .await;
        });
        self.inner.lock().unwrap().running = Some((port, stop));
        self.new_code()
    }

    fn stop(&self) -> Result<Value, LanError> {
        let mut inner = self.inner.lock().unwrap();
        let mut next = inner.config.clone();
        next.enabled = false;
        self.commit(&mut inner, next)?;
        inner.pairing = None;
        if let Some((_, stop)) = inner.running.take() {
            let _ = stop.send(());
        }
        Ok(status_of(&inner, self.port))
    }

    /// A paired device counts only while the listener runs and the device is still on the list.
    fn active(&self, device_id: &str) -> bool {
        let inner = self.inner.lock().unwrap();
        inner.running.is_some() && inner.config.devices.iter().any(|d| d.id == device_id)
    }

    async fn route(&self, request: Request) -> Result<Value, LanError> {
        let path = request
            .uri()
            .path_and_query()
            .map(|p| p.as_str().to_string())
            .unwrap_or_default();
        if request.method() != axum::http::Method::POST || !["/pair", "/sync", "/disconnect"].contains(&path.as_str()) {
            return Err(fail(404, "Route not found."));
        }
        let headers = request.headers().clone();
        if path == "/pair" {
            {
                let mut inner = self.inner.lock().unwrap();
                let now = now_ms();
                inner.failures.retain(|at| *at + 60_000 > now);
                if inner.failures.len() >= 5 {
                    return Err(fail(429, "Too many pairing attempts. Wait one minute and try again."));
                }
                inner.failures.push(now);
            }
            let body = read_json(&headers, request.into_body(), 1024).await?;
            let candidate: String = body
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect();
            let mut inner = self.inner.lock().unwrap();
            let valid = candidate.len() == 8
                && candidate.bytes().all(|b| b.is_ascii_digit())
                && inner
                    .pairing
                    .as_ref()
                    .is_some_and(|p| p.expires_at > now_ms() && store::secret_equals(&candidate, &p.code));
            if !valid {
                return Err(fail(
                    401,
                    "The pairing code is wrong or has expired. Get a new code from PC Settings.",
                ));
            }
            if inner.config.devices.len() >= MAX_DEVICES {
                return Err(fail(
                    409,
                    "Remove an old device from PC Settings before pairing another.",
                ));
            }
            let token = store::new_token();
            let mut id = [0u8; 12];
            rand::thread_rng().fill_bytes(&mut id);
            let name = body
                .get("name")
                .and_then(Value::as_str)
                .map(|n| n.trim().chars().take(60).collect::<String>())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "Android phone".into());
            let device = Device {
                id: hex::encode(id),
                hash: sha256_hex(&token),
                name,
                paired_at: now_ms() as f64,
            };
            let mut next = inner.config.clone();
            next.devices.push(device.clone());
            self.commit(&mut inner, next)?;
            inner.pairing = None;
            return Ok(json!({ "token": token, "deviceId": device.id }));
        }

        let token = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .filter(|t| store::is_token(t));
        let device_id = token.and_then(|token| {
            let hash = sha256_hex(token);
            let inner = self.inner.lock().unwrap();
            inner
                .config
                .devices
                .iter()
                .find(|d| d.hash == hash)
                .map(|d| d.id.clone())
        });
        let Some(device_id) = device_id.filter(|id| self.active(id)) else {
            return Err(fail(401, "This phone is no longer paired. Pair it again in Settings."));
        };
        if path == "/disconnect" {
            let mut inner = self.inner.lock().unwrap();
            let mut next = inner.config.clone();
            next.devices.retain(|d| d.id != device_id);
            self.commit(&mut inner, next)?;
            return Ok(json!({ "ok": true }));
        }
        let body = read_body(&headers, request.into_body(), MAX_STATE_BYTES).await?;
        let lan = self.clone();
        let check = device_id.clone();
        let merged = self.core.merge(body, move || lan.active(&check)).await?;
        if !self.active(&device_id) {
            return Err(fail(401, "This device was disconnected."));
        }
        let state: Value = serde_json::from_str(&merged).map_err(|e| fail(500, e.to_string()))?;
        // The phone keeps this list, so it still finds the PC after its address
        // changes or when it switches between home Wi-Fi and a private network app.
        let addresses = self.status()["addresses"].clone();
        Ok(json!({ "state": state, "addresses": addresses }))
    }
}

fn status_of(inner: &Inner, default_port: u16) -> Value {
    let port = inner.running.as_ref().map(|(port, _)| *port).unwrap_or(default_port);
    let addresses: Vec<String> = if inner.running.is_some() {
        if_addrs::get_if_addrs()
            .unwrap_or_default()
            .into_iter()
            .filter(|i| !i.is_loopback() && i.ip().is_ipv4() && private_address(i.ip()))
            .map(|i| format!("http://{}:{port}", i.ip()))
            .collect()
    } else {
        Vec::new()
    };
    let pairing = inner.pairing.as_ref().filter(|p| p.expires_at > now_ms());
    json!({
        "enabled": inner.running.is_some(),
        "error": inner.load_error,
        "port": port,
        "addresses": addresses,
        "code": pairing.map(|p| p.code.clone()),
        "expiresAt": pairing.map(|p| p.expires_at),
        "devices": inner.config.devices.iter()
            .map(|d| json!({ "id": d.id, "name": d.name, "pairedAt": d.paired_at }))
            .collect::<Vec<_>>(),
    })
}

/// The request body as text, refusing anything that is not JSON or is too large.
pub async fn read_body(headers: &HeaderMap, body: Body, limit: usize) -> Result<String, LanError> {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().to_ascii_lowercase());
    if content_type.as_deref() != Some("application/json") {
        return Err(fail(415, "Content-Type must be application/json."));
    }
    let declared = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok()?.parse::<usize>().ok());
    if declared.is_some_and(|length| length > limit) {
        return Err(fail(413, "Request exceeds the sync size limit."));
    }
    let bytes = axum::body::to_bytes(body, limit)
        .await
        .map_err(|_| fail(413, "Request exceeds the sync size limit."))?;
    String::from_utf8(bytes.to_vec()).map_err(|_| fail(400, "Request body is not valid JSON."))
}

pub async fn read_json(headers: &HeaderMap, body: Body, limit: usize) -> Result<Value, LanError> {
    let text = read_body(headers, body, limit).await?;
    serde_json::from_str(&text).map_err(|_| fail(400, "Request body is not valid JSON."))
}

pub fn json_response(status: u16, body: &Value) -> Response {
    (
        StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        body.to_string(),
    )
        .into_response()
}

async fn handle(State(lan): State<Lan>, ConnectInfo(peer): ConnectInfo<SocketAddr>, request: Request) -> Response {
    // A native HTTP client sends no Origin. Browser pages are never admitted,
    // even when someone shares a pairing code with a page by accident.
    let headers = request.headers();
    if headers.contains_key(header::ORIGIN) || headers.contains_key("sec-fetch-site") || !private_address(peer.ip()) {
        return json_response(
            403,
            &json!({ "error": "Use the Memoria Android app on your home Wi-Fi or private network." }),
        );
    }
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), lan.route(request)).await;
    match result {
        Ok(Ok(body)) => json_response(200, &body),
        Ok(Err(error)) => {
            let message = if error.status >= 500 {
                "PC sync could not save data. Check the PC and try again.".to_string()
            } else {
                error.message
            };
            json_response(error.status, &json!({ "error": message }))
        }
        Err(_) => json_response(408, &json!({ "error": "The request took too long." })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::broadcast;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("memoria-lan-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn private_ranges() {
        for ip in [
            "10.1.2.3",
            "192.168.0.4",
            "172.16.0.1",
            "172.31.255.1",
            "127.0.0.1",
            "100.101.2.3",
        ] {
            assert!(private_address(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "172.32.0.1", "100.63.0.1", "100.128.0.1", "::1"] {
            assert!(!private_address(ip.parse().unwrap()), "{ip}");
        }
        assert!(private_address("::ffff:192.168.1.2".parse().unwrap()));
    }

    #[tokio::test]
    async fn pairs_syncs_and_revokes_a_phone() {
        let dir = scratch("pair");
        let core = Core::start(dir.join("state.json"), broadcast::channel(4).0);
        // Port 0: any free port, so the test never clashes with a running Memoria.
        let lan = Lan::new(dir.clone(), core.clone(), 0);
        let status = lan.control(&json!({ "action": "start" })).await.unwrap();
        let port = status["port"].as_u64().unwrap();
        let code = status["code"].as_str().unwrap().to_string();
        let client = reqwest::Client::new();
        let base = format!("http://127.0.0.1:{port}");

        let wrong = client
            .post(format!("{base}/pair"))
            .json(&json!({ "code": "00000000" }))
            .send()
            .await
            .unwrap();
        assert_eq!(wrong.status(), 401);
        let browser = client
            .post(format!("{base}/pair"))
            .header("origin", "https://example.com")
            .json(&json!({ "code": code }))
            .send()
            .await
            .unwrap();
        assert_eq!(browser.status(), 403);

        let paired: Value = client
            .post(format!("{base}/pair"))
            .json(&json!({ "code": code, "name": "  Galaxy S23  " }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let token = paired["token"].as_str().unwrap().to_string();
        assert!(store::is_token(&token));
        assert_eq!(lan.status()["devices"][0]["name"], "Galaxy S23");

        let state: Value = serde_json::from_str(&core.read().await.unwrap()).unwrap();
        let synced = client
            .post(format!("{base}/sync"))
            .bearer_auth(&token)
            .json(&json!({ "state": state }))
            .send()
            .await
            .unwrap();
        assert_eq!(synced.status(), 200);
        let synced: Value = synced.json().await.unwrap();
        assert!(synced["state"]["games"].is_array());
        assert!(synced["addresses"].is_array());

        let id = paired["deviceId"].as_str().unwrap();
        lan.control(&json!({ "action": "revoke", "id": id })).await.unwrap();
        let revoked = client
            .post(format!("{base}/sync"))
            .bearer_auth(&token)
            .json(&json!({ "state": state }))
            .send()
            .await
            .unwrap();
        assert_eq!(revoked.status(), 401);

        // Saved settings survive a restart.
        lan.control(&json!({ "action": "stop" })).await.unwrap();
        let saved = store::read_json(&dir.join("devices.json")).unwrap();
        assert_eq!(saved["enabled"], false);
        assert_eq!(saved["devices"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn an_unreadable_file_waits_for_a_reset() {
        let dir = scratch("unreadable");
        std::fs::write(dir.join("devices.json"), "{broken").unwrap();
        let lan = Lan::new(
            dir.clone(),
            Core::start(dir.join("state.json"), broadcast::channel(4).0),
            0,
        );
        assert_eq!(lan.status()["error"], UNREADABLE);
        assert_eq!(
            lan.control(&json!({ "action": "start" })).await.unwrap_err().status,
            409
        );
        lan.control(&json!({ "action": "reset" })).await.unwrap();
        assert!(lan.status()["error"].is_null());
        assert!(std::fs::read_dir(&dir).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("devices-unreadable-")));
    }
}
