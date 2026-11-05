//! The loopback server the window loads the app from.
//!
//! It serves `app/dist` on a FIXED port and backs /api/state, /api/sync and
//! /api/events with `%APPDATA%\memoria\state.json`. The port must stay the same
//! between launches: the window's storage is scoped to its origin.
//!
//! The API answers only the window's bearer token, which is minted fresh each
//! run and handed to the window by its startup script. It is never on disk.

use std::convert::Infallible;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::Router;
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::core::{Core, MAX_STATE_BYTES};
use crate::lan::{self, Lan};
use crate::update;

pub const PORTS: [u16; 3] = [17817, 17818, 17819];
const CALENDAR_URL: &str = "https://raw.githubusercontent.com/JanKonradK/Memoria/main/app/public/events.json";
const CONTENT_SECURITY_POLICY: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://ipc.localhost ipc:; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

pub struct Server {
    pub port: u16,
    pub dist: PathBuf,
    pub root: PathBuf,
    pub token: String,
    pub core: Core,
    pub lan: Lan,
    pub changes: broadcast::Sender<()>,
    pub update_paths: update::Paths,
    policy: String,
    calendar: Mutex<Option<(Instant, Value)>>,
}

/// Binds the first free port in the fixed list, always in the same order.
pub async fn bind(ports: &[u16]) -> Result<TcpListener, String> {
    let mut busy = Vec::new();
    for port in ports {
        match TcpListener::bind(("127.0.0.1", *port)).await {
            Ok(listener) => return Ok(listener),
            Err(_) => busy.push(port.to_string()),
        }
    }
    Err(format!(
        "Ports {} are all in use by other programs. Close them, then open Memoria again.",
        busy.join(", ")
    ))
}

/// Hashes of the inline scripts in index.html, so the policy allows exactly those.
pub fn inline_script_hashes(html: &str) -> Vec<String> {
    let html = html.replace("\r\n", "\n").replace('\r', "\n");
    let lower = html.to_ascii_lowercase();
    let mut hashes = Vec::new();
    let mut from = 0;
    while let Some(start) = lower[from..].find("<script").map(|i| i + from) {
        let Some(tag_end) = lower[start..].find('>').map(|i| i + start) else {
            break;
        };
        let Some(close) = lower[tag_end..].find("</script>").map(|i| i + tag_end) else {
            break;
        };
        let tag = &lower[start..tag_end];
        if !tag.contains(" src=") {
            let body = &html[tag_end + 1..close];
            let digest = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(body.as_bytes()));
            hashes.push(format!("'sha256-{digest}'"));
        }
        from = close + 9;
    }
    hashes
}

impl Server {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        port: u16,
        root: PathBuf,
        dist: PathBuf,
        token: String,
        core: Core,
        lan: Lan,
        changes: broadcast::Sender<()>,
        update_paths: update::Paths,
    ) -> Result<Self, String> {
        let html = std::fs::read_to_string(dist.join("index.html")).map_err(|_| {
            format!(
                "This install is missing app/dist. Download Memoria again from https://github.com/{}/releases/latest.",
                update::REPO
            )
        })?;
        let hashes = inline_script_hashes(&html);
        let policy =
            CONTENT_SECURITY_POLICY.replace("script-src 'self'", &format!("script-src 'self' {}", hashes.join(" ")));
        Ok(Self {
            port,
            root,
            dist,
            token,
            core,
            lan,
            changes,
            update_paths,
            policy,
            calendar: Mutex::new(None),
        })
    }

    pub fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn serve(self: Arc<Self>, listener: TcpListener) {
        let router = Router::new().fallback(handle).with_state(self);
        tauri::async_runtime::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
    }

    fn json(&self, status: u16, body: &Value) -> Response {
        self.raw_json(status, body.to_string())
    }

    fn raw_json(&self, status: u16, body: String) -> Response {
        (
            StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            [
                (header::CONTENT_TYPE, "application/json; charset=utf-8"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            body,
        )
            .into_response()
    }

    fn error(&self, status: u16, message: &str) -> Response {
        self.json(status, &json!({ "error": message }))
    }

    async fn route(&self, request: Request) -> Response {
        let headers = request.headers();
        let host = headers.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
        if host != format!("127.0.0.1:{}", self.port) && host != format!("localhost:{}", self.port) {
            return self.error(421, &format!("Host must be 127.0.0.1:{0} or localhost:{0}.", self.port));
        }
        let Some(path) = percent_decode(request.uri().path()) else {
            return self.error(400, "Malformed request URL.");
        };
        let is_api = path == "/api" || path.starts_with("/api/");
        if !is_api {
            return self.serve_file(&path);
        }

        // One test, so an unauthenticated caller never reaches a route by naming one the API lacks.
        let bearer = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .unwrap_or("");
        if !crate::store::secret_equals(bearer, &self.token) {
            let mut response = self.error(401, "A valid Memoria desktop bearer token is required.");
            response.headers_mut().insert(
                header::WWW_AUTHENTICATE,
                HeaderValue::from_static("Bearer realm=\"Memoria desktop\""),
            );
            return response;
        }
        let method = request.method().clone();
        if [Method::POST, Method::PUT, Method::PATCH, Method::DELETE].contains(&method) {
            let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
            let site = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok());
            if origin != Some(format!("http://{host}").as_str()) || site != Some("same-origin") {
                return self.error(403, "Unsafe API requests must come from this exact loopback origin.");
            }
        }

        match (method, path.as_str()) {
            (Method::GET, "/api/events") => self.events(),
            (Method::GET, "/api/state") => match self.core.read().await {
                Ok(state) => self.raw_json(200, format!("{{\"state\":{state}}}")),
                Err(error) => self.error(500, &error.message),
            },
            (Method::POST, "/api/sync") => {
                let headers = request.headers().clone();
                let body = match lan::read_body(&headers, request.into_body(), MAX_STATE_BYTES).await {
                    Ok(body) => body,
                    Err(error) => return self.error(error.status, &error.message),
                };
                match self.core.merge(body, || true).await {
                    Ok(state) => self.raw_json(200, format!("{{\"state\":{state}}}")),
                    Err(error) => self.error(error.status, &error.message),
                }
            }
            (Method::GET, "/api/devices") => self.json(200, &self.lan.status()),
            (Method::POST, "/api/devices") => {
                let headers = request.headers().clone();
                let result = match lan::read_json(&headers, request.into_body(), 1024).await {
                    Ok(body) => self.lan.control(&body).await,
                    Err(error) => Err(error),
                };
                match result {
                    Ok(status) => self.json(200, &status),
                    Err(error) => self.error(error.status, &error.message),
                }
            }
            (Method::GET, "/api/calendar") => self.calendar().await,
            (Method::GET, "/api/update") => self.json(200, &update::status(&self.root, &self.update_paths)),
            _ => self.error(404, "API route not found."),
        }
    }

    /// A ping whenever the state file changes, so open windows pull right away.
    fn events(&self) -> Response {
        let first = tokio_stream::once(Ok::<_, Infallible>(Event::default().retry(Duration::from_secs(2))));
        let pings = BroadcastStream::new(self.changes.subscribe()).filter_map(|change| {
            change
                .ok()
                .map(|_| Ok::<_, Infallible>(Event::default().data("changed")))
        });
        let mut response = Sse::new(first.chain(pings))
            .keep_alive(KeepAlive::default())
            .into_response();
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
        response
    }

    async fn calendar(&self) -> Response {
        let cached = self.calendar.lock().unwrap().clone();
        if let Some((at, payload)) = cached.filter(|(at, _)| at.elapsed() < Duration::from_secs(15 * 60)) {
            let _ = at;
            return self.json(200, &payload);
        }
        let unavailable = "Calendar updates are unavailable. Your saved calendar is unchanged.";
        let fetched = async {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .ok()?;
            let mut response = client.get(CALENDAR_URL).send().await.ok()?;
            if !response.status().is_success() {
                return None;
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.ok()? {
                bytes.extend_from_slice(&chunk);
                if bytes.len() > 524_288 {
                    return None;
                }
            }
            serde_json::from_slice::<Value>(&bytes).ok()
        }
        .await;
        match fetched {
            Some(payload) => {
                *self.calendar.lock().unwrap() = Some((Instant::now(), payload.clone()));
                self.json(200, &payload)
            }
            None => self.error(502, unavailable),
        }
    }

    fn serve_file(&self, path: &str) -> Response {
        if path.contains('\0') || path.contains(':') {
            return self.error(403, "Path is outside the app.");
        }
        let relative = Path::new(path.trim_start_matches('/'));
        if relative.components().any(|c| !matches!(c, Component::Normal(_))) {
            return self.error(403, "Path is outside the app.");
        }
        let mut file = self.dist.join(relative);
        if file.is_dir() {
            file = file.join("index.html");
        }
        if file.is_file() {
            let inside = match (self.dist.canonicalize(), file.canonicalize()) {
                (Ok(root), Ok(target)) => target.starts_with(root),
                _ => false,
            };
            if !inside {
                return self.error(403, "Path is outside the app.");
            }
        } else {
            // The app routes on the client, so unknown paths get the app itself.
            file = self.dist.join("index.html");
        }
        match std::fs::read(&file) {
            Ok(body) => (
                StatusCode::OK,
                [(header::CONTENT_TYPE, mime(&file)), (header::CACHE_CONTROL, "no-cache")],
                body,
            )
                .into_response(),
            Err(_) => self.error(404, "File is unavailable."),
        }
    }
}

async fn handle(State(server): State<Arc<Server>>, request: Request) -> Response {
    let mut response = server.route(request).await;
    let headers = response.headers_mut();
    for (name, value) in [
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("referrer-policy", "no-referrer"),
        (
            "permissions-policy",
            "camera=(), microphone=(), geolocation=(), payment=()",
        ),
        ("x-memoria", "1"),
    ] {
        headers.insert(name, HeaderValue::from_static(value));
    }
    if let Ok(policy) = HeaderValue::from_str(&server.policy) {
        headers.insert("content-security-policy", policy);
    }
    response
}

fn mime(file: &Path) -> &'static str {
    match file
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
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

fn percent_decode(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_only_inline_scripts() {
        let html = "<head><script>a()</script><script type=\"module\" src=\"/x.js\"></script>\r\n<script>b()\r\n</script></head>";
        let hashes = inline_script_hashes(html);
        assert_eq!(hashes.len(), 2);
        let expected = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(b"b()\n"));
        assert_eq!(hashes[1], format!("'sha256-{expected}'"));
    }

    #[test]
    fn decodes_paths() {
        assert_eq!(percent_decode("/a%20b").as_deref(), Some("/a b"));
        assert_eq!(percent_decode("/%zz"), None);
    }

    async fn test_server(dir: &Path) -> (Arc<Server>, String) {
        let dist = dir.join("dist");
        std::fs::create_dir_all(dist.join("assets")).unwrap();
        std::fs::write(
            dist.join("index.html"),
            "<html><head><script>x()</script></head></html>",
        )
        .unwrap();
        std::fs::write(dist.join("assets/app.js"), "console.log(1)").unwrap();
        std::fs::write(dir.join("secret.txt"), "no").unwrap();
        let (changes, _) = broadcast::channel(8);
        let core = Core::start(dir.join("state.json"), changes.clone());
        let lan = Lan::new(dir.to_path_buf(), core.clone(), 0);
        let listener = bind(&[0]).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = Arc::new(
            Server::new(
                port,
                dir.to_path_buf(),
                dist,
                crate::store::new_token(),
                core,
                lan,
                changes,
                update::Paths::new(dir),
            )
            .unwrap(),
        );
        server.clone().serve(listener);
        (server, format!("http://127.0.0.1:{port}"))
    }

    #[tokio::test]
    async fn serves_the_app_and_guards_the_api() {
        let dir = std::env::temp_dir().join(format!("memoria-server-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (server, base) = test_server(&dir).await;
        let client = reqwest::Client::new();

        let page = client.get(format!("{base}/some/route")).send().await.unwrap();
        assert_eq!(page.status(), 200);
        assert!(page.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("'sha256-"));
        assert!(page.text().await.unwrap().contains("x()"));
        let script = client.get(format!("{base}/assets/app.js")).send().await.unwrap();
        assert_eq!(script.headers()["content-type"], "text/javascript; charset=utf-8");
        let escape = client.get(format!("{base}/..%5csecret.txt")).send().await.unwrap();
        assert_eq!(escape.status(), 403);

        assert_eq!(
            client.get(format!("{base}/api/state")).send().await.unwrap().status(),
            401
        );
        let state = client
            .get(format!("{base}/api/state"))
            .bearer_auth(&server.token)
            .send()
            .await
            .unwrap();
        assert_eq!(state.status(), 200);
        let state: Value = state.json().await.unwrap();

        // A write from another site is refused even with the token.
        let foreign = client
            .post(format!("{base}/api/sync"))
            .bearer_auth(&server.token)
            .header("origin", "https://example.com")
            .json(&state)
            .send()
            .await
            .unwrap();
        assert_eq!(foreign.status(), 403);
        let synced = client
            .post(format!("{base}/api/sync"))
            .bearer_auth(&server.token)
            .header("origin", base.as_str())
            .header("sec-fetch-site", "same-origin")
            .json(&state)
            .send()
            .await
            .unwrap();
        assert_eq!(synced.status(), 200);

        let wrong_host = client
            .get(format!("{base}/"))
            .header("host", "evil.test")
            .send()
            .await
            .unwrap();
        assert_eq!(wrong_host.status(), 421);

        // An unknown API route never falls through to the app page.
        let unknown = client
            .get(format!("{base}/api/nothing"))
            .bearer_auth(&server.token)
            .send()
            .await
            .unwrap();
        assert_eq!(unknown.status(), 404);
        assert_eq!(unknown.json::<Value>().await.unwrap()["error"], "API route not found.");

        let write = |body: Vec<u8>, content_type: &'static str| {
            client
                .post(format!("{base}/api/sync"))
                .bearer_auth(&server.token)
                .header("origin", base.as_str())
                .header("sec-fetch-site", "same-origin")
                .header("content-type", content_type)
                .body(body)
                .send()
        };
        assert_eq!(write(b"{}".to_vec(), "text/plain").await.unwrap().status(), 415);
        // Prove rejection before upload. Sending the body races the early 413
        // against a Windows socket write error when the server closes it.
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut socket = tokio::net::TcpStream::connect(("127.0.0.1", server.port)).await.unwrap();
        let headers = format!(
            "POST /api/sync HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nOrigin: {base}\r\nSec-Fetch-Site: same-origin\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            server.port, server.token, MAX_STATE_BYTES + 10
        );
        socket.write_all(headers.as_bytes()).await.unwrap();
        let mut response = Vec::new();
        tokio::time::timeout(std::time::Duration::from_secs(5), socket.read_to_end(&mut response))
            .await
            .unwrap()
            .unwrap();
        assert!(String::from_utf8(response).unwrap().starts_with("HTTP/1.1 413 "));
        // A document from a newer version of the app is refused, and nothing is saved.
        let mut newer = state["state"].clone();
        newer["schemaVersion"] = json!(999);
        let before = std::fs::read(dir.join("state.json")).ok();
        let refused = write(json!({ "state": newer }).to_string().into_bytes(), "application/json")
            .await
            .unwrap();
        assert_eq!(refused.status(), 400);
        assert_eq!(std::fs::read(dir.join("state.json")).ok(), before);
    }
}
