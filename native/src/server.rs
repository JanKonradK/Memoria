//! The loopback launcher: serves app/dist and the authenticated /api the app
//! window uses. Same contract as desktop/memoria.mjs, so the React app, its
//! IndexedDB origin and older launchers on the same ports keep working.

use std::{
    collections::HashMap,
    fs,
    io::{ErrorKind, Write},
    net::{Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use axum::{
    Router,
    body::{Body, Bytes},
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use futures_util::StreamExt;
use hmac::{Hmac, KeyInit, Mac};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::{net::TcpListener, sync::broadcast};

use crate::{
    core::{CoreError, MAX_SYNC_BYTES, StateCore},
    paths::Paths,
    policy::{PORTS, is_token},
};

const MARKER: &str = "x-memoria";
const LEGACY_MARKER: &str = "x-void";
const HMAC_DOMAIN: &str = "memoria-launcher-v1";
const LEGACY_HMAC_DOMAIN: &str = "void-launcher-v1";
const COOKIES: [&str; 2] = ["memoria_token", "void_token"];
const TICKET_TTL: Duration = Duration::from_secs(30);
const CALENDAR_URL: &str = "https://raw.githubusercontent.com/JanKonradK/Memoria/main/app/public/events.json";
const CALENDAR_LIMIT: usize = 524_288;
const CALENDAR_TTL: Duration = Duration::from_secs(15 * 60);
const CALENDAR_ERROR: &str = "Calendar updates are unavailable. Your saved calendar is unchanged.";
const RELEASE_PAGE: &str = "https://github.com/JanKonradK/Memoria/releases/latest";
const CONTENT_SECURITY_POLICY: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// The two protocol vintages an identity probe may speak, current first.
struct Dialect {
    hello: &'static str,
    ticket: &'static str,
    marker: &'static str,
    domain: &'static str,
}
const DIALECTS: [Dialect; 2] = [
    Dialect { hello: "/.memoria/hello", ticket: "/.memoria/ticket", marker: MARKER, domain: HMAC_DOMAIN },
    Dialect { hello: "/.void/hello", ticket: "/.void/ticket", marker: LEGACY_MARKER, domain: LEGACY_HMAC_DOMAIN },
];

pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::fill(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn hmac(secret: &str, message: &str) -> String {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(secret.as_bytes()).expect("any key length");
    mac.update(message.as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

fn hmac_proof(secret: &str, purpose: &str, port: u16, nonce: &str, domain: &str) -> String {
    hmac(secret, &format!("{domain}:{purpose}:{port}:{nonce}"))
}

fn secret_equals(actual: Option<&str>, expected: &str) -> bool {
    let Some(actual) = actual else { return false };
    actual.len() == expected.len() && actual.bytes().zip(expected.bytes()).fold(0u8, |d, (a, b)| d | (a ^ b)) == 0
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// The profile secret shared with every launcher build on this PC.
pub fn install_secret(paths: &Paths) -> std::io::Result<String> {
    fs::create_dir_all(&paths.data)?;
    match fs::OpenOptions::new().write(true).create_new(true).open(&paths.token) {
        Ok(mut file) => file.write_all(new_token().as_bytes())?,
        Err(e) if e.kind() == ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e),
    }
    let secret = fs::read_to_string(&paths.token)?.trim().to_owned();
    if !is_token(&secret) {
        return Err(std::io::Error::other(format!(
            "Memoria's launcher token is missing or invalid: {}",
            paths.token.display()
        )));
    }
    Ok(secret)
}

pub struct Launcher {
    paths: Paths,
    secret: String,
    /// Binds the window's bearer token to this process. Never written to disk.
    session: String,
    core: StateCore,
    tickets: Mutex<HashMap<String, Instant>>,
    used_nonces: Mutex<HashMap<String, Instant>>,
    changes: broadcast::Sender<()>,
    calendar: tokio::sync::Mutex<Option<(Instant, Value)>>,
    calendar_url: String,
    http: reqwest::Client,
    policy: String,
    port: u16,
}

pub enum Started {
    /// This process serves the port. `url` opens the window with a fresh ticket.
    Owned { url: String },
    /// An authenticated older launcher already serves it; reuse its origin.
    Reused { url: String },
}

/// Binds the first free port, or reuses a Memoria launcher that proves it knows
/// this PC's secret. The order never changes: IndexedDB is scoped to the port.
pub async fn start(paths: Paths, core: StateCore) -> Result<Started, String> {
    let secret = install_secret(&paths).map_err(|e| e.to_string())?;
    let ports = test_ports().unwrap_or(PORTS.to_vec());
    let http = reqwest::Client::builder()
        .user_agent(concat!("Memoria/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut conflicts = Vec::new();
    for port in ports {
        match TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port))).await {
            Ok(listener) => {
                let launcher = Arc::new(Launcher::new(paths, secret, core, http, port)?);
                let url = format!("http://127.0.0.1:{port}/api/launch/{}", launcher.issue_ticket());
                launcher.watch_state();
                let router = Router::new().fallback(handle).with_state(launcher.clone());
                tokio::spawn(async move {
                    let _ = axum::serve(listener, router).await;
                });
                return Ok(Started::Owned { url });
            }
            Err(error) => {
                let identity = probe(&http, port, &secret).await;
                if let Some(dialect) = identity.authenticated {
                    let ticket = request_ticket(&http, port, &secret, dialect).await?;
                    return Ok(Started::Reused { url: format!("http://127.0.0.1:{port}/api/launch/{ticket}") });
                }
                if identity.claims_memoria {
                    return Err(format!(
                        "port {port} is occupied by a listener claiming to be Memoria, but it failed the authenticated identity challenge."
                    ));
                }
                conflicts.push(format!("{port} ({})", error.kind()));
            }
        }
    }
    Err(format!("ports {} are all in use by other programs.", conflicts.join(", ")))
}

/// MEMORIA_TEST_PORT keeps contract tests off the real storage origins.
fn test_ports() -> Option<Vec<u16>> {
    std::env::var("MEMORIA_TEST_PORT").ok()?.parse().ok().map(|port| vec![port])
}

struct Identity {
    authenticated: Option<&'static Dialect>,
    claims_memoria: bool,
}

async fn probe(http: &reqwest::Client, port: u16, secret: &str) -> Identity {
    let mut claims_memoria = false;
    for dialect in &DIALECTS {
        let nonce = new_token();
        let response = http
            .get(format!("http://127.0.0.1:{port}{}?nonce={nonce}", dialect.hello))
            .timeout(Duration::from_millis(1500))
            .send()
            .await;
        let Ok(response) = response else { continue };
        claims_memoria |= response.headers().get(dialect.marker).is_some_and(|v| v == "1");
        if !response.status().is_success() {
            continue;
        }
        let proof = response.json::<Value>().await.ok().and_then(|v| v["proof"].as_str().map(str::to_owned));
        if secret_equals(proof.as_deref(), &hmac_proof(secret, "hello", port, &nonce, dialect.domain)) {
            return Identity { authenticated: Some(dialect), claims_memoria: true };
        }
    }
    Identity { authenticated: None, claims_memoria }
}

async fn request_ticket(http: &reqwest::Client, port: u16, secret: &str, dialect: &Dialect) -> Result<String, String> {
    let nonce = new_token();
    let time = now_ms().to_string();
    let proof = hmac_proof(secret, "ticket", port, &format!("{nonce}:{time}"), dialect.domain);
    let marker = dialect.marker;
    let response = http
        .post(format!("http://127.0.0.1:{port}{}", dialect.ticket))
        .header(format!("{marker}-nonce"), nonce)
        .header(format!("{marker}-time"), time)
        .header(format!("{marker}-proof"), proof)
        .timeout(Duration::from_millis(1500))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "the running Memoria instance refused a launch ticket (HTTP {}).",
            response.status().as_u16()
        ));
    }
    let ticket = response.json::<Value>().await.ok().and_then(|v| v["ticket"].as_str().map(str::to_owned));
    ticket.filter(|t| is_token(t)).ok_or_else(|| "the running Memoria instance returned an invalid ticket.".into())
}

/// Inline scripts in index.html are allowed by hash, as the Node launcher did.
fn inline_script_hashes(html: &str) -> Vec<String> {
    let html = html.replace("\r\n", "\n").replace('\r', "\n");
    let lower = html.to_ascii_lowercase();
    let mut hashes = Vec::new();
    let mut at = 0;
    while let Some(start) = lower[at..].find("<script").map(|i| i + at) {
        let next = lower.as_bytes().get(start + 7).copied().unwrap_or(b'>');
        let Some(tag_end) = lower[start..].find('>').map(|i| i + start) else { break };
        let tag = &lower[start..tag_end];
        let has_src = tag
            .match_indices("src=")
            .any(|(i, _)| i > 0 && !tag.as_bytes()[i - 1].is_ascii_alphanumeric() && tag.as_bytes()[i - 1] != b'_');
        // Like the regex it replaces: a miss moves on one tag, never to a close tag.
        if next.is_ascii_alphanumeric() || next == b'_' || has_src {
            at = start + 7;
            continue;
        }
        let Some(close) = lower[tag_end..].find("</script>").map(|i| i + tag_end) else { break };
        hashes.push(format!("'sha256-{}'", STANDARD.encode(Sha256::digest(&html.as_bytes()[tag_end + 1..close]))));
        at = close + 9;
    }
    hashes
}

impl Launcher {
    fn new(paths: Paths, secret: String, core: StateCore, http: reqwest::Client, port: u16) -> Result<Self, String> {
        let index = fs::read_to_string(paths.dist.join("index.html")).map_err(|_| {
            "this install is missing app/dist. Re-download Memoria from \
             https://github.com/JanKonradK/Memoria/releases/latest and unpack it again."
                .to_owned()
        })?;
        let hashes = inline_script_hashes(&index).join(" ");
        let policy = CONTENT_SECURITY_POLICY.replace("script-src 'self'", &format!("script-src 'self' {hashes}"));
        Ok(Self {
            paths,
            secret,
            session: new_token(),
            core,
            tickets: Mutex::default(),
            used_nonces: Mutex::default(),
            changes: broadcast::channel(16).0,
            calendar: tokio::sync::Mutex::default(),
            calendar_url: std::env::var("MEMORIA_CALENDAR_URL").unwrap_or_else(|_| CALENDAR_URL.into()),
            http,
            policy,
            port,
        })
    }

    fn prune(&self) {
        let now = Instant::now();
        self.tickets.lock().unwrap().retain(|_, expires| *expires > now);
        self.used_nonces.lock().unwrap().retain(|_, expires| *expires > now);
    }

    pub fn issue_ticket(&self) -> String {
        self.prune();
        let ticket = new_token();
        self.tickets.lock().unwrap().insert(ticket.clone(), Instant::now() + TICKET_TTL);
        ticket
    }

    fn consume_ticket(&self, ticket: &str) -> bool {
        self.prune();
        self.tickets.lock().unwrap().remove(ticket).is_some_and(|expires| expires > Instant::now())
    }

    fn browser_token(&self, host: &str) -> String {
        hmac(&self.secret, &format!("memoria-browser-v1:{host}:{}", self.session))
    }

    /// Pings open windows when state.json changes on disk, from any writer.
    /// The directory is watched because the atomic write replaces the file.
    fn watch_state(self: &Arc<Self>) {
        use notify::{RecursiveMode, Watcher};
        let _ = fs::create_dir_all(&self.paths.data);
        let (events, mut changed) = tokio::sync::mpsc::unbounded_channel();
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if let Ok(event) = event
                && event.paths.iter().any(|p| p.file_name().is_some_and(|n| n == "state.json"))
            {
                let _ = events.send(());
            }
        });
        let Ok(mut watcher) = watcher else { return };
        if watcher.watch(&self.paths.data, RecursiveMode::NonRecursive).is_err() {
            return;
        }
        let changes = self.changes.clone();
        tokio::spawn(async move {
            let _watcher = watcher;
            while changed.recv().await.is_some() {
                // One ping per burst of writes.
                tokio::time::sleep(Duration::from_millis(100)).await;
                while changed.try_recv().is_ok() {}
                let _ = changes.send(());
            }
        });
    }
}

fn json_response(status: StatusCode, payload: &Value) -> Response {
    json_text(status, payload.to_string())
}

fn json_text(status: StatusCode, body: String) -> Response {
    (status, [(header::CONTENT_TYPE, "application/json; charset=utf-8"), (header::CACHE_CONTROL, "no-store")], body)
        .into_response()
}

fn error(status: u16, message: &str) -> Response {
    json_response(
        StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        &json!({ "error": message }),
    )
}

fn core_error(error: CoreError) -> Response {
    self::error(error.status, &error.message)
}

/// A complete 413 that also closes the connection, so the client stops uploading.
fn too_large(message: &str) -> Response {
    let mut response = error(413, message);
    response.headers_mut().insert(header::CONNECTION, HeaderValue::from_static("close"));
    response
}

fn header_str(headers: &HeaderMap, name: impl header::AsHeaderName) -> Option<&str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

/// decodeURIComponent: percent escapes must be complete and form UTF-8.
fn decode_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = value.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn query_param(query: Option<&str>, name: &str) -> Option<String> {
    query?.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        (decode_component(&key.replace('+', " "))? == name).then(|| decode_component(&value.replace('+', " ")))?
    })
}

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("webmanifest") => "application/manifest+json; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn serve_file(path: &Path) -> Option<Response> {
    let body = fs::read(path).ok()?;
    Some(([(header::CONTENT_TYPE, mime(path)), (header::CACHE_CONTROL, "no-cache")], body).into_response())
}

async fn handle(State(launcher): State<Arc<Launcher>>, request: Request) -> Response {
    let mut response = route(&launcher, request).await;
    let headers = response.headers_mut();
    let set = |headers: &mut HeaderMap, name: &'static str, value: &str| {
        if !headers.contains_key(name) {
            headers.insert(name, HeaderValue::from_str(value).expect("static header"));
        }
    };
    set(headers, "content-security-policy", &launcher.policy);
    set(headers, "x-content-type-options", "nosniff");
    set(headers, "x-frame-options", "DENY");
    set(headers, "referrer-policy", "no-referrer");
    set(headers, "permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
    // Stamped everywhere, so an identity probe of either vintage sees its marker.
    set(headers, MARKER, "1");
    set(headers, LEGACY_MARKER, "1");
    response
}

async fn route(launcher: &Arc<Launcher>, request: Request) -> Response {
    let port = launcher.port;
    let headers = request.headers().clone();
    let host = header_str(&headers, header::HOST).map(str::to_owned);
    if host.as_deref() != Some(&format!("127.0.0.1:{port}")) && host.as_deref() != Some(&format!("localhost:{port}")) {
        return error(421, &format!("Host must be 127.0.0.1:{port} or localhost:{port}."));
    }
    let host = host.unwrap_or_default();
    let method = request.method().clone();
    let query = request.uri().query().map(str::to_owned);
    let Some(path) = decode_component(request.uri().path()) else {
        return error(400, "Malformed request URL.");
    };

    for dialect in &DIALECTS {
        if path == dialect.hello {
            return identity_challenge(launcher, &method, query.as_deref(), dialect);
        }
        if path == dialect.ticket {
            return ticket_request(launcher, &method, &headers, dialect);
        }
    }

    if method == Method::GET
        && let Some(ticket) = path.strip_prefix("/api/launch/").map(|t| t.strip_suffix('/').unwrap_or(t))
        && is_token(ticket)
    {
        if !launcher.consume_ticket(ticket) {
            return error(401, "This launch ticket is invalid or has expired.");
        }
        return launch_html(launcher, &host);
    }

    // One test, so an unauthenticated caller never reaches the static files by
    // naming a route the API does not implement.
    let api = path == "/api" || path.starts_with("/api/");
    if api {
        if let Some(denied) = authorize(launcher, &method, &headers, &host) {
            return denied;
        }
        return match (method.as_str(), path.as_str()) {
            ("GET", "/api/events") => events(launcher),
            ("GET", "/api/state") => match launcher.core.read().await {
                Ok(state) => json_response(StatusCode::OK, &json!({ "state": state })),
                Err(e) => error(500, &e.message),
            },
            ("POST", "/api/sync") => sync(launcher, &headers, request.into_body()).await,
            ("GET", "/api/calendar") => calendar(launcher).await,
            ("GET", "/api/update") => json_response(StatusCode::OK, &update_status(&launcher.paths)),
            _ => error(404, "API route not found."),
        };
    }
    static_file(launcher, &path)
}

fn identity_challenge(launcher: &Launcher, method: &Method, query: Option<&str>, dialect: &Dialect) -> Response {
    if method != Method::GET {
        return error(405, "Method not allowed.");
    }
    match query_param(query, "nonce").filter(|n| is_token(n)) {
        Some(nonce) => json_response(
            StatusCode::OK,
            &json!({ "proof": hmac_proof(&launcher.secret, "hello", launcher.port, &nonce, dialect.domain) }),
        ),
        None => error(400, "A high-entropy challenge nonce is required."),
    }
}

fn ticket_request(launcher: &Launcher, method: &Method, headers: &HeaderMap, dialect: &Dialect) -> Response {
    if method != Method::POST {
        return error(405, "Method not allowed.");
    }
    launcher.prune();
    let marker = dialect.marker;
    let nonce = header_str(headers, format!("{marker}-nonce").as_str());
    let proof = header_str(headers, format!("{marker}-proof").as_str());
    let time = header_str(headers, format!("{marker}-time").as_str());
    let fresh = time.filter(|t| t.len() == 13 && t.bytes().all(|b| b.is_ascii_digit())).is_some_and(|t| {
        let at: u128 = t.parse().unwrap_or(0);
        now_ms().abs_diff(at) <= TICKET_TTL.as_millis()
    });
    let expected = match (fresh, nonce, time) {
        (true, Some(nonce), Some(time)) if is_token(nonce) => {
            Some(hmac_proof(&launcher.secret, "ticket", launcher.port, &format!("{nonce}:{time}"), dialect.domain))
        }
        _ => None,
    };
    let nonce = nonce.unwrap_or_default();
    let used = launcher.used_nonces.lock().unwrap().contains_key(nonce);
    match expected {
        Some(expected) if secret_equals(proof, &expected) && !used => {
            launcher.used_nonces.lock().unwrap().insert(nonce.to_owned(), Instant::now() + 2 * TICKET_TTL);
            json_response(StatusCode::OK, &json!({ "ticket": launcher.issue_ticket() }))
        }
        _ => error(401, "The launch-ticket proof was rejected."),
    }
}

fn launch_html(launcher: &Launcher, host: &str) -> Response {
    let source = match fs::read_to_string(launcher.paths.dist.join("index.html")) {
        Ok(source) if source.contains("<head>") => source,
        Ok(_) => return error(500, "Memoria's built index.html has no token injection point."),
        Err(e) => return error(500, &e.to_string()),
    };
    let mut nonce = [0u8; 24];
    rand::fill(&mut nonce);
    let nonce = STANDARD.encode(nonce);
    let token = serde_json::to_string(&launcher.browser_token(host)).expect("string");
    let bootstrap = format!(
        r#"<script nonce="{nonce}">
      (() => {{
        const token = {token};
        try {{
          sessionStorage.setItem('memoria-launcher-token', token);
          localStorage.removeItem('void-sync-config');
        }} catch {{
          // The API will remain closed if the browser refuses token storage.
        }}
        history.replaceState(history.state, '', '/');
      }})();
    </script>"#
    );
    let body = source.replacen("<head>", &format!("<head>{bootstrap}"), 1);
    let policy = launcher.policy.replace("script-src 'self'", &format!("script-src 'self' 'nonce-{nonce}'"));
    let mut response =
        ([(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CACHE_CONTROL, "no-store")], body)
            .into_response();
    let headers = response.headers_mut();
    for name in COOKIES {
        let cookie = format!("{name}=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/");
        headers.append(header::SET_COOKIE, HeaderValue::from_str(&cookie).expect("cookie"));
    }
    headers.insert("content-security-policy", HeaderValue::from_str(&policy).expect("policy"));
    response
}

fn authorize(launcher: &Launcher, method: &Method, headers: &HeaderMap, host: &str) -> Option<Response> {
    let bearer = header_str(headers, header::AUTHORIZATION)
        .and_then(|v| v.strip_prefix("Bearer "))
        .filter(|t| !t.is_empty() && t.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
    if !secret_equals(bearer, &launcher.browser_token(host)) {
        let mut response = error(401, "A valid Memoria desktop bearer token is required.");
        response
            .headers_mut()
            .insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer realm=\"Memoria desktop\""));
        return Some(response);
    }
    let unsafe_method = matches!(method.as_str(), "POST" | "PUT" | "PATCH" | "DELETE");
    let same_origin = header_str(headers, header::ORIGIN) == Some(&format!("http://{host}"))
        && header_str(headers, "sec-fetch-site") == Some("same-origin");
    (unsafe_method && !same_origin)
        .then(|| error(403, "Unsafe API requests must come from this exact loopback origin."))
}

/// Reads a JSON body up to `limit` bytes. Oversized bodies are refused as soon
/// as the declared length or the received bytes pass the limit.
pub async fn read_body(headers: &HeaderMap, body: Body, limit: usize, too_big: &str) -> Result<Bytes, Box<Response>> {
    let content_type = header_str(headers, header::CONTENT_TYPE)
        .and_then(|v| v.split(';').next())
        .map(|v| v.trim().to_ascii_lowercase());
    if content_type.as_deref() != Some("application/json") {
        return Err(Box::new(error(415, "Content-Type must be application/json.")));
    }
    let declared = header_str(headers, header::CONTENT_LENGTH).and_then(|v| v.parse::<usize>().ok());
    let mut stream = body.into_data_stream();
    if declared.is_some_and(|length| length > limit) {
        discard(stream, limit);
        return Err(Box::new(too_large(too_big)));
    }
    let mut received = Vec::new();
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else { return Err(Box::new(error(400, "Request interrupted."))) };
        if received.len() + chunk.len() > limit {
            discard(stream, limit);
            return Err(Box::new(too_large(too_big)));
        }
        received.extend_from_slice(&chunk);
    }
    Ok(received.into())
}

/// Closing a socket with unread upload bytes makes Windows reset it, and the
/// client loses the 413 it was sent. Read and drop a bounded amount for up to
/// a second while the response goes out, as the Node launcher did.
fn discard(mut stream: axum::body::BodyDataStream, limit: usize) {
    tokio::spawn(async move {
        let _ = tokio::time::timeout(Duration::from_secs(1), async {
            let mut discarded = 0;
            while let Some(Ok(chunk)) = stream.next().await {
                discarded += chunk.len();
                if discarded > 2 * limit {
                    break;
                }
            }
        })
        .await;
    });
}

async fn sync(launcher: &Launcher, headers: &HeaderMap, body: Body) -> Response {
    let too_big = format!("Request body exceeds {MAX_SYNC_BYTES} bytes.");
    let bytes = match read_body(headers, body, MAX_SYNC_BYTES, &too_big).await {
        Ok(bytes) => bytes,
        Err(response) => return *response,
    };
    let Ok(text) = String::from_utf8(bytes.to_vec()) else {
        return error(400, "Request body is not valid JSON.");
    };
    if serde_json::from_str::<Value>(&text).is_err() {
        return error(400, "Request body is not valid JSON.");
    }
    match launcher.core.merge(text, Box::new(|| true)).await {
        Ok(json) => json_text(StatusCode::OK, format!("{{\"state\":{json}}}")),
        Err(e) => core_error(e),
    }
}

fn events(launcher: &Launcher) -> Response {
    let changes = tokio_stream::wrappers::BroadcastStream::new(launcher.changes.subscribe());
    let stream = futures_util::stream::once(async { Ok::<_, std::io::Error>(Bytes::from_static(b"retry: 2000\n\n")) })
        .chain(changes.map(|_| Ok(Bytes::from_static(b"data: changed\n\n"))));
    (
        [
            (header::CONTENT_TYPE, "text/event-stream"),
            (header::CACHE_CONTROL, "no-cache"),
            (header::CONNECTION, "keep-alive"),
        ],
        Body::from_stream(stream),
    )
        .into_response()
}

async fn calendar(launcher: &Launcher) -> Response {
    let mut cache = launcher.calendar.lock().await;
    if cache.as_ref().is_none_or(|(at, _)| at.elapsed() > CALENDAR_TTL) {
        match fetch_calendar(launcher).await {
            Some(payload) => *cache = Some((Instant::now(), payload)),
            None => return error(502, CALENDAR_ERROR),
        }
    }
    json_response(StatusCode::OK, &cache.as_ref().expect("filled").1)
}

async fn fetch_calendar(launcher: &Launcher) -> Option<Value> {
    let response = launcher.http.get(&launcher.calendar_url).timeout(Duration::from_secs(15)).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let mut stream = response.bytes_stream();
    let mut received = Vec::new();
    while let Some(chunk) = stream.next().await {
        received.extend_from_slice(&chunk.ok()?);
        if received.len() > CALENDAR_LIMIT {
            return None;
        }
    }
    serde_json::from_slice(&received).ok()
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// What /api/update reports. The Rust host installs updates from its window,
/// never at startup, so its mode is always manual.
pub fn update_status(paths: &Paths) -> Value {
    let record = read_json(&paths.root.join("release.json"));
    json!({
        "packaged": record.is_some(),
        "version": record.as_ref().and_then(|r| r.get("version")).cloned().unwrap_or(Value::Null),
        "channel": record.as_ref().and_then(|r| r.get("channel")).cloned().unwrap_or(json!("stable")),
        "mode": "manual",
        "pending": Value::Null,
        "lastChecked": read_json(&paths.updates.join("last-check.json"))
            .and_then(|v| v.get("checkedAt").cloned())
            .unwrap_or(Value::Null),
        "releasePage": RELEASE_PAGE,
    })
}

fn static_file(launcher: &Launcher, path: &str) -> Response {
    let outside = || error(403, "Path is outside the app.");
    if path.contains('\0') || path.contains(':') {
        return outside();
    }
    // Both separators count, as they do for Windows paths.
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return outside();
                }
            }
            part => parts.push(part),
        }
    }
    let dist = &launcher.paths.dist;
    let mut file: PathBuf = parts.iter().fold(dist.clone(), |p, part| p.join(part));
    if file.is_dir() {
        file = file.join("index.html");
    }
    if file.exists() {
        let (Ok(root), Ok(real)) = (dist.canonicalize(), file.canonicalize()) else {
            return error(404, "File is unavailable.");
        };
        if !real.starts_with(&root) {
            return outside();
        }
        if let Some(response) = serve_file(&file) {
            return response;
        }
    }
    serve_file(&dist.join("index.html")).unwrap_or_else(|| error(404, "File is unavailable."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_only_inline_scripts() {
        let html = "<head><script>a()</script><script src=\"/x.js\"></script><scripts>no</scripts><SCRIPT type=\"module\">b()\r\n</SCRIPT></head>";
        let hashes = inline_script_hashes(html);
        let digest = |s: &str| format!("'sha256-{}'", STANDARD.encode(Sha256::digest(s.as_bytes())));
        assert_eq!(hashes, vec![digest("a()"), digest("b()\n")]);
    }

    #[test]
    fn decodes_like_decode_uri_component() {
        assert_eq!(decode_component("/a%20b/%E2%9C%93").as_deref(), Some("/a b/✓"));
        assert_eq!(decode_component("/%ZZ"), None);
        assert_eq!(decode_component("/%E2%9C"), None);
        assert_eq!(query_param(Some("x=1&nonce=abc"), "nonce").as_deref(), Some("abc"));
    }

    #[test]
    fn signs_in_each_dialect_domain() {
        let proof = hmac_proof("secret", "hello", 17817, "n", HMAC_DOMAIN);
        assert_eq!(proof, hmac("secret", "memoria-launcher-v1:hello:17817:n"));
        assert_ne!(proof, hmac_proof("secret", "hello", 17817, "n", LEGACY_HMAC_DOMAIN));
        assert!(secret_equals(Some(&proof), &proof));
        assert!(!secret_equals(Some("short"), &proof));
        assert!(!secret_equals(None, &proof));
    }
}
