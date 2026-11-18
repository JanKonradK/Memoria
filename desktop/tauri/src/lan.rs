//! Wi-Fi sync with the Android app.
//!
//! A separate listener from the window's loopback server. The phone pairs with
//! a code and pinned PC key fingerprint shown in Settings. All data and
//! pairing codes use X25519 + XChaCha20-Poly1305 authenticated encryption.

use base64::Engine as _;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Router;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::oneshot;

use crate::core::{Core, CoreError, MAX_STATE_BYTES};
use crate::lan_crypto as crypto;
use crate::store;

pub const LAN_PORT: u16 = 17820;
const CODE_TTL_MS: u64 = 5 * 60_000;
/// Pairing guesses one address may make each minute.
const PAIR_ATTEMPTS_PER_SOURCE: usize = 5;
/// Guesses all addresses together may make each minute. Well above what one
/// noisy neighbour can use up, and still about 150 guesses per 8-digit code.
const PAIR_ATTEMPTS_TOTAL: usize = 30;
const MAX_DEVICES: usize = 10;
/// Where requests carried by the internet relay seem to come from: a
/// documentation address no real device has, so relayed challenges and limits
/// never mix with a phone on the Wi-Fi.
const RELAY_PEER: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1));
const UNREADABLE: &str =
    "Saved phone connections could not be read. Your progress is safe. Reset phone connections to pair again.";

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
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

/// 100.64.0.0/10 is carrier-grade NAT space in general, not Tailscale's alone.
fn shared_address_space(ip: IpAddr) -> bool {
    let ip = match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6)),
        other => other,
    };
    matches!(ip, IpAddr::V4(v4) if v4.octets()[0] == 100 && (64..=127).contains(&v4.octets()[1]))
}

/// Whether this PC itself has an address in 100.64.0.0/10, as it does on a
/// Tailscale network. Checked at most once a minute.
fn on_tailnet() -> bool {
    static CACHE: Mutex<Option<(std::time::Instant, bool)>> = Mutex::new(None);
    let mut cache = CACHE.lock().unwrap();
    if let Some((at, value)) = *cache
        && at.elapsed() < std::time::Duration::from_secs(60) {
        return value;
    }
    let value = if_addrs::get_if_addrs()
        .map(|items| items.iter().any(|item| shared_address_space(item.ip())))
        .unwrap_or(false);
    *cache = Some((std::time::Instant::now(), value));
    value
}

/// A peer allowed to reach the sync routes: a private address, and an address
/// in 100.64.0.0/10 only while this PC is on such a network itself.
fn admitted(ip: IpAddr, tailnet: bool) -> bool {
    private_address(ip) && (tailnet || !shared_address_space(ip))
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Device {
    id: String,
    public_key: String,
    name: String,
    paired_at: f64,
}

#[derive(Clone, Serialize)]
struct Config {
    enabled: bool,
    devices: Vec<Device>,
    secret: String,
    /// The internet relay this PC also answers through; None keeps sync to
    /// Wi-Fi and private networks.
    #[serde(skip_serializing_if = "Option::is_none")]
    relay: Option<String>,
    /// Proves to the relay that this PC owns its mailbox. The relay keeps the
    /// first one it sees, so another PC cannot collect this one's requests.
    #[serde(rename = "relayToken")]
    relay_token: String,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: false,
            devices: Vec::new(),
            secret: crypto::random_hex::<32>(),
            relay: None,
            relay_token: crypto::random_hex::<32>(),
        }
    }
}

/// A relay address as saved: https, or http to this machine for testing, with no trailing slash.
pub fn relay_url(input: &str) -> Option<String> {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() || trimmed.len() > 200 {
        return None;
    }
    let url = reqwest::Url::parse(trimmed).ok()?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    let allowed = url.scheme() == "https" || (url.scheme() == "http" && local);
    let plain =
        url.query().is_none() && url.fragment().is_none() && url.username().is_empty() && url.password().is_none();
    (allowed && plain).then(|| trimmed.to_string())
}

/// What Settings shows about the relay connection.
#[derive(Clone)]
pub struct RelayStatus {
    /// off, connecting, connected, offline or error.
    pub state: &'static str,
    pub error: Option<String>,
}

fn parse_config(value: &Value) -> Option<Config> {
    let object = value.as_object()?;
    let enabled = match object.get("enabled") {
        None => false,
        Some(Value::Bool(flag)) => *flag,
        Some(_) => return None,
    };
    // Legacy bearer credentials are deliberately retired. Keep the enabled preference.
    if object.get("secret").is_none() && object.get("protectedSecret").is_none() {
        return Some(Config {
            enabled,
            ..Config::default()
        });
    }
    let secret = match (object.get("protectedSecret"), object.get("secret")) {
        (Some(protected), _) => {
            let blob = base64::engine::general_purpose::STANDARD
                .decode(protected.as_str()?)
                .ok()?;
            String::from_utf8(crate::dpapi::unprotect(&blob)?).ok()?
        }
        (None, Some(plain)) => plain.as_str()?.to_string(),
        (None, None) => unreachable!(),
    };
    crypto::public(&secret).ok()?;
    // A bad relay address or token is dropped alone, never the paired devices.
    let relay = object.get("relay").and_then(Value::as_str).and_then(relay_url);
    let relay_token = object
        .get("relayToken")
        .and_then(Value::as_str)
        .filter(|token| token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit()))
        .map(str::to_string)
        .unwrap_or_else(crypto::random_hex::<32>);
    let devices = match object.get("devices") {
        None => Vec::new(),
        Some(Value::Array(items)) => {
            let mut devices = Vec::new();
            for item in items {
                let id = item.get("id")?.as_str()?;
                let public_key = item.get("publicKey")?.as_str()?;
                let name = item.get("name")?.as_str()?;
                let paired_at = item.get("pairedAt")?.as_f64()?;
                if crypto::fingerprint(public_key).is_err() {
                    return None;
                }
                if !paired_at.is_finite() || paired_at < 0.0 {
                    return None;
                }
                devices.push(Device {
                    id: id.into(),
                    public_key: public_key.into(),
                    name: name.into(),
                    paired_at,
                });
            }
            devices
        }
        Some(_) => return None,
    };
    Some(Config {
        enabled,
        devices,
        secret,
        relay,
        relay_token,
    })
}

/// The config as written to disk. On Windows the private key is DPAPI-protected,
/// so a copied `devices.json` is useless on another account or PC.
fn stored_config(config: &Config) -> Value {
    let mut value = serde_json::to_value(config).unwrap_or_default();
    if let Some(blob) = crate::dpapi::protect(config.secret.as_bytes())
        && let Some(object) = value.as_object_mut() {
        object.remove("secret");
        object.insert(
            "protectedSecret".into(),
            Value::String(base64::engine::general_purpose::STANDARD.encode(blob)),
        );
    }
    value
}

struct Pairing {
    code: String,
    expires_at: u64,
}

struct Inner {
    config: Config,
    load_error: Option<&'static str>,
    pairing: Option<Pairing>,
    /// Recent pairing attempts and where they came from.
    failures: Vec<(u64, IpAddr)>,
    challenges: Vec<(String, IpAddr, u64)>,
    /// The bound port and the switch that stops the listener.
    running: Option<(u16, oneshot::Sender<()>)>,
    /// When each device last synced, since Memoria started.
    seen: HashMap<String, u64>,
    relay: RelayStatus,
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
                Some(config) => {
                    // A key saved in the clear by an older version is protected now,
                    // and a relay token made on this load is kept for the next one.
                    let stored = stored_config(&config);
                    let old = serde_json::from_slice::<Value>(&bytes).ok();
                    let plain_secret = stored.get("protectedSecret").is_some()
                        && old.as_ref().is_some_and(|o| o.get("secret").is_some());
                    let new_token = old.as_ref().is_some_and(|o| o.get("relayToken").is_none());
                    if plain_secret || new_token {
                        let _ = store::write_atomic(&file, stored.to_string().as_bytes());
                    }
                    (config, None)
                }
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
                challenges: Vec::new(),
                running: None,
                seen: HashMap::new(),
                relay: RelayStatus {
                    state: "off",
                    error: None,
                },
            })),
            control_lock: Arc::new(tokio::sync::Mutex::new(())),
            file,
            core,
            port,
        }
    }

    fn save(&self, next: &Config) -> Result<(), LanError> {
        store::write_atomic(&self.file, stored_config(next).to_string().as_bytes())
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
        let enabled = self.inner.lock().unwrap().config.enabled;
        if enabled && let Err(error) = self.start().await {
            eprintln!("Wi-Fi sync unavailable: {}", error.message);
        }
    }

    pub async fn control(&self, body: &Value) -> Result<Value, LanError> {
        let _serial = self.control_lock.lock().await;
        let action = body.get("action").and_then(Value::as_str).unwrap_or("");
        let load_error = self.inner.lock().unwrap().load_error;
        if let Some(message) = load_error
            && action != "reset" {
            return Err(fail(409, message));
        }
        match action {
            "reset" => {
                if load_error.is_none() {
                    return Err(fail(409, "Phone connections do not need to be reset."));
                }
                if self.file.exists() {
                    let mut suffix = [0u8; 4];
                    rand::fill(&mut suffix);
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
            "relay" => {
                let url = match body.get("url").and_then(Value::as_str).map(str::trim) {
                    None | Some("") => None,
                    Some(input) => Some(relay_url(input).ok_or_else(|| {
                        fail(
                            400,
                            "Enter the relay address from your Cloudflare deploy, starting with https://.",
                        )
                    })?),
                };
                let mut inner = self.inner.lock().unwrap();
                let mut next = inner.config.clone();
                next.relay = url;
                self.commit(&mut inner, next)?;
                let state = if inner.config.relay.is_some() {
                    "connecting"
                } else {
                    "off"
                };
                inner.relay = RelayStatus { state, error: None };
                Ok(status_of(&inner, self.port))
            }
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
        let code = format!("{:08}", rand::random_range(0..100_000_000u32));
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

    async fn route(&self, peer: IpAddr, request: Request) -> Result<Value, LanError> {
        let path = request
            .uri()
            .path_and_query()
            .map(|p| p.as_str().to_string())
            .unwrap_or_default();
        if request.method() != axum::http::Method::POST
            || !["/hello", "/pair", "/sync", "/disconnect"].contains(&path.as_str())
        {
            return Err(fail(404, "Route not found."));
        }
        if path == "/hello" {
            return self.hello(peer);
        }
        let headers = request.headers().clone();
        let envelope = read_json(&headers, request.into_body(), MAX_STATE_BYTES * 2 + 2048).await?;
        self.route_packet(peer, &path, envelope).await
    }

    /// A one-use challenge and this PC's key, the first step of every request.
    fn hello(&self, peer: IpAddr) -> Result<Value, LanError> {
        let mut inner = self.inner.lock().unwrap();
        inner.challenges.retain(|(_, _, expires)| *expires > now_ms());
        if inner.challenges.len() >= 256 || inner.challenges.iter().filter(|(_, ip, _)| *ip == peer).count() >= 8 {
            return Err(fail(429, "Too many connection requests. Try again in a minute."));
        }
        let challenge = crypto::random_hex::<32>();
        inner.challenges.push((challenge.clone(), peer, now_ms() + 60_000));
        let public_key = crypto::public(&inner.config.secret).map_err(|e| fail(500, e))?;
        Ok(json!({ "publicKey": public_key, "challenge": challenge }))
    }

    /// A sealed request: checks its challenge, opens it, runs it, and seals the reply.
    async fn route_packet(&self, peer: IpAddr, path: &str, envelope: Value) -> Result<Value, LanError> {
        let packet: crypto::Packet = serde_json::from_value(envelope)
            .map_err(|_| fail(400, "Encrypted sync is required. Update both devices and pair again."))?;
        let (pc, keys) = {
            let mut inner = self.inner.lock().unwrap();
            let index = inner
                .challenges
                .iter()
                .position(|(c, ip, expires)| c == &packet.challenge && *ip == peer && *expires > now_ms())
                .ok_or_else(|| fail(403, "Sync challenge expired or was already used."))?;
            inner.challenges.swap_remove(index);
            let pc = crypto::public(&inner.config.secret).map_err(|e| fail(500, e))?;
            let keys = crypto::keys(&inner.config.secret, &packet.public_key, &pc, &packet.public_key)
                .map_err(|e| fail(403, e))?;
            (pc, keys)
        };
        let body = crypto::open(&keys.0, path, &packet, "").map_err(|e| fail(403, e))?;
        let result = self.route_decrypted(peer, path, &packet.public_key, body).await;
        let body = match result {
            Ok(body) => body,
            Err(error) => json!({ "error": error.message, "status": error.status }),
        };
        let reply =
            crypto::seal(&keys.1, path, &pc, &packet.challenge, &body, &packet.nonce).map_err(|e| fail(500, e))?;
        serde_json::to_value(reply).map_err(|e| fail(500, e.to_string()))
    }

    /// A request the internet relay carried, answered exactly as on Wi-Fi.
    /// Pairing stays on Wi-Fi: a code is never guessable from the internet.
    pub async fn relayed(&self, path: &str, envelope: Value) -> Result<Value, LanError> {
        if !self.enabled() {
            return Err(fail(503, "Device sync is paused on the PC."));
        }
        match path {
            "/hello" => self.hello(RELAY_PEER),
            "/sync" | "/disconnect" => self.route_packet(RELAY_PEER, path, envelope).await,
            "/pair" => Err(fail(
                403,
                "Pair on the same Wi-Fi as the PC first. After that, sync works anywhere.",
            )),
            _ => Err(fail(404, "Route not found.")),
        }
    }

    /// Where to collect relayed requests: the relay, this PC's mailbox and its
    /// token. None while sync is paused or no relay is set.
    pub fn relay_target(&self) -> Option<(String, String, String)> {
        let inner = self.inner.lock().unwrap();
        inner.running.as_ref()?;
        let url = inner.config.relay.clone()?;
        let fingerprint = crypto::public(&inner.config.secret)
            .and_then(|p| crypto::fingerprint(&p))
            .ok()?;
        Some((url, crypto::relay_room(&fingerprint), inner.config.relay_token.clone()))
    }

    pub fn set_relay_status(&self, state: &'static str, error: Option<String>) {
        self.inner.lock().unwrap().relay = RelayStatus { state, error };
    }

    async fn route_decrypted(&self, peer: IpAddr, path: &str, phone_key: &str, body: Value) -> Result<Value, LanError> {
        if path == "/pair" {
            {
                let mut inner = self.inner.lock().unwrap();
                let now = now_ms();
                if !pairing_allowed(&mut inner.failures, peer, now) {
                    return Err(fail(429, "Too many pairing attempts. Wait one minute and try again."));
                }
            }
            if serde_json::to_vec(&body).unwrap_or_default().len() > 1024 {
                return Err(fail(413, "Pairing request is too large."));
            }
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
            let mut id = [0u8; 12];
            rand::fill(&mut id);
            let name = body
                .get("name")
                .and_then(Value::as_str)
                .map(|n| n.trim().chars().take(60).collect::<String>())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "Android phone".into());
            let device = Device {
                id: hex::encode(id),
                public_key: phone_key.into(),
                name,
                paired_at: now_ms() as f64,
            };
            let mut next = inner.config.clone();
            next.devices.retain(|d| d.public_key != phone_key);
            next.devices.push(device.clone());
            self.commit(&mut inner, next)?;
            inner.pairing = None;
            return Ok(json!({ "deviceId": device.id }));
        }

        let device_id = self
            .inner
            .lock()
            .unwrap()
            .config
            .devices
            .iter()
            .find(|d| d.public_key == phone_key)
            .map(|d| d.id.clone());
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
        let body = serde_json::to_string(&body).map_err(|e| fail(400, e.to_string()))?;
        if body.len() > MAX_STATE_BYTES {
            return Err(fail(413, "Request exceeds the sync size limit."));
        }
        let lan = self.clone();
        let check = device_id.clone();
        let merged = self.core.merge(body, move || lan.active(&check)).await?;
        if !self.active(&device_id) {
            return Err(fail(401, "This device was disconnected."));
        }
        self.inner.lock().unwrap().seen.insert(device_id, now_ms());
        let state: Value = serde_json::from_str(&merged).map_err(|e| fail(500, e.to_string()))?;
        // The phone keeps the address list, so it still finds the PC after its
        // address changes or when it switches between home Wi-Fi and a private
        // network app. The device list lets every device show what is connected.
        let status = self.status();
        Ok(json!({
            "state": state,
            "addresses": status["addresses"],
            "pc": status["name"],
            "devices": status["devices"],
            // Phones keep this, so away from home they reach the PC through the relay.
            "relay": status["relay"]["url"],
        }))
    }
}

fn status_of(inner: &Inner, default_port: u16) -> Value {
    let port = inner.running.as_ref().map(|(port, _)| *port).unwrap_or(default_port);
    let addresses: Vec<String> = if inner.running.is_some() {
        let mut found: Vec<(u8, String)> = if_addrs::get_if_addrs()
            .unwrap_or_default()
            .into_iter()
            .filter(|i| !i.is_loopback() && i.ip().is_ipv4() && private_address(i.ip()) && !virtual_adapter(&i.name))
            .map(|i| (address_rank(i.ip()), format!("http://{}:{port}", i.ip())))
            .collect();
        found.sort();
        found.dedup();
        found.into_iter().map(|(_, address)| address).collect()
    } else {
        Vec::new()
    };
    let pairing = inner.pairing.as_ref().filter(|p| p.expires_at > now_ms());
    json!({
        "enabled": inner.running.is_some(),
        "fingerprint": crypto::public(&inner.config.secret).and_then(|p| crypto::fingerprint(&p)).ok(),
        "error": inner.load_error,
        "port": port,
        "addresses": addresses,
        "code": pairing.map(|p| p.code.clone()),
        "expiresAt": pairing.map(|p| p.expires_at),
        "name": pc_name(),
        "relay": {
            "url": inner.config.relay,
            "state": match (&inner.config.relay, &inner.running) {
                (None, _) => "off",
                (Some(_), None) => "paused",
                _ => inner.relay.state,
            },
            "error": inner.relay.error,
        },
        "devices": inner.config.devices.iter()
            .map(|d| json!({
                "id": d.id,
                "name": d.name,
                "pairedAt": d.paired_at,
                "lastSeenAt": inner.seen.get(&d.id),
            }))
            .collect::<Vec<_>>(),
    })
}

/// What phones call this PC.
fn pc_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .map(|name| name.trim().chars().take(60).collect::<String>())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "This PC".into())
}

/// Network adapters a phone can never reach: WSL, Hyper-V, Docker and other VMs.
fn virtual_adapter(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    ["vethernet", "wsl", "hyper-v", "virtualbox", "vmware", "docker", "vbox"]
        .iter()
        .any(|word| name.contains(word))
}

/// Home Wi-Fi addresses first, then Tailscale, then the rest. The phone tries them in this order.
fn address_rank(ip: IpAddr) -> u8 {
    match ip {
        IpAddr::V4(v4) => match v4.octets() {
            [192, 168, ..] => 0,
            [10, ..] => 1,
            [100, ..] => 2,
            _ => 3,
        },
        IpAddr::V6(_) => 4,
    }
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

/// Records one pairing attempt unless its address, or everyone together, is over the limit.
/// Per-address limits keep one device on the network from locking everyone else out.
fn pairing_allowed(attempts: &mut Vec<(u64, IpAddr)>, peer: IpAddr, now: u64) -> bool {
    attempts.retain(|(at, _)| *at + 60_000 > now);
    let from_peer = attempts.iter().filter(|(_, ip)| *ip == peer).count();
    if from_peer >= PAIR_ATTEMPTS_PER_SOURCE || attempts.len() >= PAIR_ATTEMPTS_TOTAL {
        return false;
    }
    attempts.push((now, peer));
    true
}

async fn handle(State(lan): State<Lan>, ConnectInfo(peer): ConnectInfo<SocketAddr>, request: Request) -> Response {
    // A native HTTP client sends no Origin. Browser pages are never admitted,
    // even when someone shares a pairing code with a page by accident.
    let headers = request.headers();
    if headers.contains_key(header::ORIGIN)
        || headers.contains_key("sec-fetch-site")
        || !admitted(peer.ip(), shared_address_space(peer.ip()) && on_tailnet())
    {
        return json_response(
            403,
            &json!({ "error": "Use the Memoria Android app on your home Wi-Fi or private network." }),
        );
    }
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), lan.route(peer.ip(), request)).await;
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

    #[test]
    fn admits_shared_address_space_only_on_a_tailnet() {
        let tailscale: IpAddr = "100.101.2.3".parse().unwrap();
        let home: IpAddr = "192.168.1.20".parse().unwrap();
        let public: IpAddr = "8.8.8.8".parse().unwrap();
        assert!(admitted(home, false));
        assert!(!admitted(tailscale, false));
        assert!(admitted(tailscale, true));
        assert!(!admitted(public, true));
    }

    #[cfg(windows)]
    #[test]
    fn stores_the_private_key_protected_and_reads_both_forms() {
        let config = Config::default();
        let stored = stored_config(&config);
        assert!(stored.get("secret").is_none());
        assert!(!stored.to_string().contains(&config.secret));
        assert_eq!(parse_config(&stored).unwrap().secret, config.secret);
        let legacy = serde_json::json!({ "enabled": true, "devices": [], "secret": config.secret });
        assert_eq!(parse_config(&legacy).unwrap().secret, config.secret);
    }

    use super::*;

    #[test]
    fn one_noisy_address_cannot_lock_out_pairing() {
        let (noisy, phone): (IpAddr, IpAddr) = ("192.168.1.66".parse().unwrap(), "192.168.1.20".parse().unwrap());
        let mut attempts = Vec::new();
        for _ in 0..PAIR_ATTEMPTS_PER_SOURCE {
            assert!(pairing_allowed(&mut attempts, noisy, 1_000));
        }
        assert!(!pairing_allowed(&mut attempts, noisy, 1_000));
        assert!(pairing_allowed(&mut attempts, phone, 1_000));
        // A minute later the noisy address may try again.
        assert!(pairing_allowed(&mut attempts, noisy, 61_001));
    }

    #[test]
    fn many_addresses_together_still_hit_a_ceiling() {
        let mut attempts = Vec::new();
        for n in 0..PAIR_ATTEMPTS_TOTAL {
            let ip: IpAddr = format!("10.0.0.{}", n + 1).parse().unwrap();
            assert!(pairing_allowed(&mut attempts, ip, 5));
        }
        assert!(!pairing_allowed(&mut attempts, "10.0.1.1".parse().unwrap(), 5));
    }
    use tokio::sync::broadcast;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("memoria-lan-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn addresses_skip_virtual_adapters_and_put_home_wifi_first() {
        assert!(virtual_adapter("vEthernet (WSL (Hyper-V firewall))"));
        assert!(virtual_adapter("vEthernet (Default Switch)"));
        assert!(!virtual_adapter("WiFi"));
        assert!(!virtual_adapter("Ethernet"));
        let mut ranks = ["172.22.144.1", "100.101.2.3", "192.168.1.17", "10.0.0.4"]
            .map(|ip| (address_rank(ip.parse().unwrap()), ip));
        ranks.sort();
        assert_eq!(
            ranks.map(|(_, ip)| ip),
            ["192.168.1.17", "10.0.0.4", "100.101.2.3", "172.22.144.1"]
        );
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
        assert_eq!(wrong.status(), 400);
        let browser = client
            .post(format!("{base}/pair"))
            .header("origin", "https://example.com")
            .json(&json!({ "code": code }))
            .send()
            .await
            .unwrap();
        assert_eq!(browser.status(), 403);

        let secret = crypto::random_hex::<32>();
        let public = crypto::public(&secret).unwrap();
        let pc = {
            let inner = lan.inner.lock().unwrap();
            crypto::public(&inner.config.secret).unwrap()
        };
        let keys = crypto::keys(&secret, &pc, &pc, &public).unwrap();
        async fn send(
            client: &reqwest::Client,
            base: &str,
            path: &str,
            public: &str,
            keys: &([u8; 32], [u8; 32]),
            body: Value,
        ) -> Value {
            let hello: Value = client
                .post(format!("{base}/hello"))
                .json(&json!({}))
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            let packet = crypto::seal(&keys.0, path, public, hello["challenge"].as_str().unwrap(), &body, "").unwrap();
            let reply: crypto::Packet = client
                .post(format!("{base}{path}"))
                .json(&packet)
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            // Replaying the exact packet is rejected before it reaches the merge.
            let replay = client.post(format!("{base}{path}")).json(&packet).send().await.unwrap();
            assert_eq!(replay.status(), 403);
            crypto::open(&keys.1, path, &reply, &packet.nonce).unwrap()
        }
        let paired = send(
            &client,
            &base,
            "/pair",
            &public,
            &keys,
            json!({ "code": code, "name": "  Galaxy S23  " }),
        )
        .await;
        assert_eq!(lan.status()["devices"][0]["name"], "Galaxy S23");
        let state: Value = serde_json::from_str(&core.read().await.unwrap()).unwrap();
        let synced = send(&client, &base, "/sync", &public, &keys, json!({"state":state})).await;
        assert!(synced["state"]["games"].is_array());
        assert!(synced["addresses"].is_array());
        assert!(synced["pc"].is_string());
        assert_eq!(synced["devices"][0]["name"], "Galaxy S23");
        assert!(synced["devices"][0]["lastSeenAt"].is_u64());
        assert!(synced["relay"].is_null());

        // The same phone through the internet relay: same sealing, same answers.
        assert!(lan.relay_target().is_none());
        let bad = lan
            .control(&json!({ "action": "relay", "url": "http://relay.example" }))
            .await;
        assert_eq!(bad.err().unwrap().status, 400);
        let set = lan
            .control(&json!({ "action": "relay", "url": " https://relay.example.workers.dev/ " }))
            .await
            .unwrap();
        assert_eq!(set["relay"]["url"], "https://relay.example.workers.dev");
        let (url, room, token) = lan.relay_target().unwrap();
        assert_eq!(url, "https://relay.example.workers.dev");
        assert_eq!(room, crypto::relay_room(&crypto::fingerprint(&pc).unwrap()));
        assert_eq!(token.len(), 64);
        let hello = lan.relayed("/hello", Value::Null).await.unwrap();
        let packet = crypto::seal(
            &keys.0,
            "/sync",
            &public,
            hello["challenge"].as_str().unwrap(),
            &json!({ "state": state }),
            "",
        )
        .unwrap();
        let sealed = lan
            .relayed("/sync", serde_json::to_value(&packet).unwrap())
            .await
            .unwrap();
        let reply: crypto::Packet = serde_json::from_value(sealed).unwrap();
        let relayed = crypto::open(&keys.1, "/sync", &reply, &packet.nonce).unwrap();
        assert!(relayed["state"]["games"].is_array());
        assert_eq!(relayed["relay"], "https://relay.example.workers.dev");
        // A Wi-Fi challenge is never accepted through the relay, nor pairing at all.
        assert_eq!(lan.relayed("/pair", json!({})).await.err().unwrap().status, 403);
        let saved = store::read_json(&dir.join("devices.json")).unwrap();
        assert_eq!(saved["relayToken"], token.as_str());
        let id = paired["deviceId"].as_str().unwrap();
        lan.control(&json!({"action":"revoke","id":id})).await.unwrap();
        let revoked = send(&client, &base, "/sync", &public, &keys, json!({"state":state})).await;
        assert_eq!(revoked["status"], 401);

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
