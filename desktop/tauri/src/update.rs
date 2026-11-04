//! Updates from GitHub releases.
//!
//! The window asks; this module talks to GitHub (the window's content policy
//! only allows its own origin), downloads the Windows zip, checks it against
//! the release's SHA256SUMS.txt and unpacks it into a pending folder. After
//! the window has saved and closed, the new build's own installer copies it
//! over this install and reopens Memoria.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const REPO: &str = "JanKonradK/Memoria";
const ASSET_NAME: &str = "Memoria-win-x64.zip";
const CHECKSUM_ASSET: &str = "SHA256SUMS.txt";
const MAX_DOWNLOAD_BYTES: u64 = 400 * 1024 * 1024;

fn releases_api() -> String {
    format!("https://api.github.com/repos/{REPO}/releases?per_page=30")
}

fn release_page() -> String {
    format!("https://github.com/{REPO}/releases/latest")
}

pub struct Paths {
    pub update_dir: PathBuf,
    pub pending_dir: PathBuf,
    pub pending_manifest: PathBuf,
    pub last_check: PathBuf,
}

impl Paths {
    pub fn new(data: &Path) -> Self {
        let update_dir = data.join("updates");
        Self {
            pending_dir: update_dir.join("pending"),
            pending_manifest: update_dir.join("pending.json"),
            last_check: update_dir.join("last-check.json"),
            update_dir,
        }
    }
}

/// The record the packaging script writes at the install root. Its presence
/// is what marks a packaged install rather than a source checkout.
pub fn release_record(root: &Path) -> Option<Value> {
    crate::store::read_json(&root.join("release.json"))
}

/// Compares `1.2.3` versions. A prerelease sorts below the same final release.
pub fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let parse = |value: &str| {
        let value = value.strip_prefix('v').unwrap_or(value);
        let (core, pre) = value.split_once('-').unwrap_or((value, ""));
        let parts: Vec<i64> = core.split('.').map(|p| p.parse().unwrap_or(0)).collect();
        (parts, pre.to_string())
    };
    let (a, a_pre) = parse(left);
    let (b, b_pre) = parse(right);
    for index in 0..3 {
        let order = a
            .get(index)
            .copied()
            .unwrap_or(0)
            .cmp(&b.get(index).copied().unwrap_or(0));
        if order != Ordering::Equal {
            return order;
        }
    }
    match (a_pre.is_empty(), b_pre.is_empty()) {
        (true, true) => Ordering::Equal,
        (true, false) => Ordering::Greater,
        (false, true) => Ordering::Less,
        (false, false) => a_pre.cmp(&b_pre),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("Memoria-updater (+https://github.com/{REPO})"))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

fn read_release(release: &Value) -> Value {
    let tag = release["tag_name"].as_str().unwrap_or("").to_string();
    let assets: Vec<Value> = release["assets"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|asset| {
                    json!({
                        "name": asset["name"].as_str().unwrap_or(""),
                        "url": asset["browser_download_url"].as_str().unwrap_or(""),
                        "size": asset["size"].as_u64().unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    json!({
        "version": tag.trim_start_matches('v'),
        "tag": tag,
        "name": release["name"].as_str().filter(|n| !n.is_empty()).unwrap_or(&tag),
        "notes": release["body"].as_str().unwrap_or(""),
        "url": release["html_url"].as_str().map(str::to_string).unwrap_or_else(release_page),
        "publishedAt": release["published_at"].clone(),
        "assets": assets,
    })
}

/// The newest final release, with the notes of every release newer than `since`.
pub async fn fetch_latest_release(since: Option<&str>) -> Result<Option<Value>, String> {
    let response = client()?
        .get(releases_api())
        .header("accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub could not be reached: {e}"))?;
    let status = response.status().as_u16();
    // Unauthenticated requests share 60 an hour per network address.
    if status == 403 || status == 429 {
        return Err("GitHub limits update checks. Try again in an hour.".into());
    }
    if !response.status().is_success() {
        return Err(format!("GitHub responded {status}"));
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    let list = match body {
        Value::Array(items) => items,
        other => vec![other],
    };
    let mut releases: Vec<Value> = list
        .iter()
        .filter(|r| {
            !r["draft"].as_bool().unwrap_or(false)
                && !r["prerelease"].as_bool().unwrap_or(false)
                && !r["tag_name"].as_str().unwrap_or("").trim_start_matches('v').is_empty()
        })
        .map(read_release)
        .collect();
    releases.sort_by(|a, b| compare_versions(b["version"].as_str().unwrap(), a["version"].as_str().unwrap()));
    let Some(latest) = releases.first().cloned() else {
        return Ok(None);
    };
    let newer: Vec<&Value> = releases
        .iter()
        .filter(|r| since.is_none_or(|since| compare_versions(r["version"].as_str().unwrap(), since).is_gt()))
        .collect();
    let changes: Vec<Value> = (if newer.is_empty() { vec![&latest] } else { newer })
        .into_iter()
        .map(|r| json!({ "version": r["version"], "notes": r["notes"], "publishedAt": r["publishedAt"] }))
        .collect();
    let mut latest = latest;
    latest["changes"] = Value::Array(changes);
    Ok(Some(latest))
}

/// The downloaded build waiting to be installed, if it is newer than this one.
pub fn staged_version(root: &Path, paths: &Paths) -> Option<String> {
    let record = release_record(root)?;
    let staged = crate::store::read_json(&paths.pending_manifest)?;
    if !paths.pending_dir.exists() {
        return None;
    }
    let staged = staged["version"].as_str()?.to_string();
    compare_versions(&staged, record["version"].as_str()?)
        .is_gt()
        .then_some(staged)
}

fn clear_pending(paths: &Paths) {
    let _ = fs::remove_file(&paths.pending_manifest);
    let _ = fs::remove_dir_all(&paths.pending_dir);
}

pub fn parse_checksums(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim();
            let (digest, name) = line.split_once(char::is_whitespace)?;
            let name = name.trim().trim_start_matches('*').trim_start_matches("./");
            (digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit()))
                .then(|| (name.to_string(), digest.to_ascii_lowercase()))
        })
        .collect()
}

async fn download(
    client: &reqwest::Client,
    url: &str,
    destination: &Path,
    max: u64,
    progress: &(dyn Fn(u64, u64) + Send + Sync),
) -> Result<(), String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("{url} responded {}", response.status().as_u16()));
    }
    let total = response.content_length().unwrap_or(0);
    if total > max {
        return Err("The download is larger than expected.".into());
    }
    let mut file = fs::File::create(destination).map_err(|e| e.to_string())?;
    let mut received = 0u64;
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("Download failed: {e}"))? {
        received += chunk.len() as u64;
        if received > max {
            drop(file);
            let _ = fs::remove_file(destination);
            return Err("The download is larger than expected.".into());
        }
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        progress(received, total);
    }
    Ok(())
}

fn sha256_file(file: &Path) -> Result<String, String> {
    Ok(hex::encode(Sha256::digest(fs::read(file).map_err(|e| e.to_string())?)))
}

/// Windows ships bsdtar as `tar`, which reads zip archives.
fn extract_zip(zip: &Path, destination: &Path) -> Result<(), String> {
    let _ = fs::remove_dir_all(destination);
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    // Windows' own bsdtar by full path: a Git or MSYS tar earlier on PATH cannot read zips.
    let system_tar = std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join("System32").join("tar.exe"))
        .filter(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from("tar"));
    let mut tar = Command::new(system_tar);
    tar.arg("-xf").arg(zip).arg("-C").arg(destination);
    hide_console(&mut tar);
    if tar.status().is_ok_and(|s| s.success()) {
        return Ok(());
    }
    let quote = |p: &Path| format!("'{}'", p.display().to_string().replace('\'', "''"));
    let mut shell = Command::new("powershell");
    shell.args(["-NoProfile", "-NonInteractive", "-Command"]).arg(format!(
        "Expand-Archive -LiteralPath {} -DestinationPath {} -Force",
        quote(zip),
        quote(destination)
    ));
    hide_console(&mut shell);
    if shell.status().is_ok_and(|s| s.success()) {
        Ok(())
    } else {
        Err("The downloaded update could not be unpacked.".into())
    }
}

#[cfg(windows)]
pub fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn hide_console(_command: &mut Command) {}

/// The zip holds one `Memoria/` folder. Staging needs what is inside it.
fn unwrap_single_root(directory: &Path) -> PathBuf {
    let entries: Vec<_> = fs::read_dir(directory)
        .map(|d| d.flatten().collect())
        .unwrap_or_default();
    if entries.len() == 1 && entries[0].path().is_dir() {
        entries[0].path()
    } else {
        directory.to_path_buf()
    }
}

/// Downloads, verifies and unpacks a release into the pending folder. Nothing in the install is touched.
pub async fn stage_release(
    root: &Path,
    paths: &Paths,
    release: &Value,
    progress: impl Fn(u64, u64) + Send + Sync,
) -> Result<Value, String> {
    let record = release_record(root).ok_or("This copy of Memoria runs from source. Pull the new version instead.")?;
    let version = release["version"].as_str().unwrap_or("").to_string();
    if compare_versions(&version, record["version"].as_str().unwrap_or("0")).is_le() {
        return Err("This version is already installed.".into());
    }
    if staged_version(root, paths).as_deref() == Some(version.as_str()) {
        return Ok(json!({ "version": version }));
    }
    let asset = |name: &str| {
        release["assets"]
            .as_array()
            .and_then(|a| a.iter().find(|asset| asset["name"] == name))
            .and_then(|asset| asset["url"].as_str())
            .map(str::to_string)
    };
    let (Some(zip_url), Some(sums_url)) = (asset(ASSET_NAME), asset(CHECKSUM_ASSET)) else {
        return Err(format!("Release {version} has no Windows download."));
    };

    let work = paths.update_dir.join("download");
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = async {
        let client = client()?;
        let zip = work.join(ASSET_NAME);
        download(&client, &zip_url, &zip, MAX_DOWNLOAD_BYTES, &progress).await?;
        let sums = work.join(CHECKSUM_ASSET);
        download(&client, &sums_url, &sums, 64_000, &|_, _| {}).await?;
        // An unsigned zip from the internet is checked before a byte of it is unpacked.
        let text = fs::read_to_string(&sums).map_err(|e| e.to_string())?;
        let expected = parse_checksums(&text)
            .into_iter()
            .find(|(name, _)| name == ASSET_NAME)
            .map(|(_, digest)| digest)
            .ok_or(format!("{CHECKSUM_ASSET} does not list {ASSET_NAME}."))?;
        if sha256_file(&zip)? != expected {
            return Err("The download is damaged. Try again.".to_string());
        }
        let unpacked = work.join("unpacked");
        extract_zip(&zip, &unpacked)?;
        let tree = unwrap_single_root(&unpacked);
        if !tree.join("release.json").exists() {
            return Err("The downloaded build has no release.json.".into());
        }
        clear_pending(paths);
        fs::create_dir_all(&paths.update_dir).map_err(|e| e.to_string())?;
        fs::rename(&tree, &paths.pending_dir).map_err(|e| e.to_string())?;
        let stamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        crate::store::write_json(
            &paths.pending_manifest,
            &json!({ "version": version, "tag": release["tag"], "stagedAt": stamp }),
        )
        .map_err(|e| e.to_string())?;
        Ok(json!({ "version": version }))
    }
    .await;
    let _ = fs::remove_dir_all(&work);
    result
}

/// What `/api/update` reports. The window drives updates, so the mode is always manual.
pub fn status(root: &Path, paths: &Paths) -> Value {
    let record = release_record(root);
    json!({
        "packaged": record.is_some(),
        "version": record.as_ref().and_then(|r| r["version"].as_str()),
        "channel": record.as_ref().and_then(|r| r["channel"].as_str()).unwrap_or("stable"),
        "mode": "manual",
        "pending": Value::Null,
        "lastChecked": crate::store::read_json(&paths.last_check).and_then(|v| v["checkedAt"].as_str().map(str::to_string)),
        "releasePage": release_page(),
    })
}

/// Waits for this process to exit, installs the staged build over this
/// install with its own installer, then reopens Memoria: the new build, or the
/// old one if the install failed and rolled back.
pub fn run_staged_installer(root: &Path, paths: &Paths) -> std::io::Result<()> {
    let installer = paths.pending_dir.join("desktop").join("Install-Shortcut.ps1");
    let quote = |p: &Path| format!("'{}'", p.display().to_string().replace('\'', "''"));
    let script = [
        "$ErrorActionPreference = 'Continue'".to_string(),
        format!("$log = {}", quote(&paths.update_dir.join("install.log"))),
        format!("Wait-Process -Id {} -Timeout 60 -ErrorAction SilentlyContinue", std::process::id()),
        "$installed = $false".into(),
        "foreach ($attempt in 1..20) {".into(),
        format!("  & {} -InstallRoot {} -NoShortcuts *> $log", quote(&installer), quote(root)),
        "  if ($?) { $installed = $true; break }".into(),
        "  Start-Sleep -Milliseconds 500".into(),
        "}".into(),
        format!(
            "if ($installed) {{ Remove-Item -LiteralPath {} -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath {} -Force -ErrorAction SilentlyContinue }}",
            quote(&paths.pending_dir),
            quote(&paths.pending_manifest)
        ),
        format!(
            "Start-Process -FilePath {} -WorkingDirectory {}",
            quote(&root.join("Memoria.exe")),
            quote(root)
        ),
    ]
    .join("\n");
    let file = paths.update_dir.join("install-update.ps1");
    fs::create_dir_all(&paths.update_dir)?;
    // A byte-order mark keeps Windows PowerShell from misreading non-ASCII paths.
    fs::write(&file, format!("\u{FEFF}{script}\n"))?;
    // PowerShell started straight from a detached child can exit without
    // running anything, so `start` launches it on its own.
    let mut command = Command::new(std::env::var_os("ComSpec").unwrap_or_else(|| "cmd.exe".into()));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command
            .creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW)
            .raw_arg(format!(
            "/d /s /c \"start \"\" /b powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{}\"\"",
            file.display()
        ));
    }
    command.spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn versions_compare_like_releases() {
        assert_eq!(compare_versions("3.2.0", "3.10.0"), Ordering::Less);
        assert_eq!(compare_versions("v3.2.1", "3.2.0"), Ordering::Greater);
        assert_eq!(compare_versions("3.2.0-beta.1", "3.2.0"), Ordering::Less);
        assert_eq!(compare_versions("3.2.0", "3.2"), Ordering::Equal);
    }

    #[test]
    fn checksum_lines() {
        let digest = "a".repeat(64);
        let table = parse_checksums(&format!(
            "{digest}  Memoria-win-x64.zip\n{digest} *./Memoria.html\nnoise"
        ));
        assert_eq!(table.len(), 2);
        assert_eq!(table[0].0, "Memoria-win-x64.zip");
        assert_eq!(table[1].0, "Memoria.html");
    }

    /// Serves a release zip and its checksums from a scratch folder, then stages it.
    #[cfg(windows)]
    #[tokio::test]
    async fn stages_a_verified_release() {
        let dir = std::env::temp_dir().join(format!("memoria-update-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let (install, data, build) = (dir.join("install"), dir.join("data"), dir.join("build"));
        for folder in [&install, &data, &build.join("Memoria")] {
            fs::create_dir_all(folder).unwrap();
        }
        fs::write(
            install.join("release.json"),
            r#"{"name":"Memoria","version":"3.2.0","runtime":"tauri"}"#,
        )
        .unwrap();
        fs::write(
            build.join("Memoria/release.json"),
            r#"{"name":"Memoria","version":"3.3.0","runtime":"tauri"}"#,
        )
        .unwrap();
        fs::write(build.join("Memoria/Memoria.exe"), "new program").unwrap();
        let zip = dir.join(ASSET_NAME);
        let tar = PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32/tar.exe");
        assert!(Command::new(tar)
            .arg("-a")
            .arg("-cf")
            .arg(&zip)
            .arg("-C")
            .arg(&build)
            .arg("Memoria")
            .status()
            .unwrap()
            .success());
        let digest = sha256_file(&zip).unwrap();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let zip_bytes = fs::read(&zip).unwrap();
        let sums = std::sync::Arc::new(std::sync::Mutex::new(format!(
            "{digest}  {ASSET_NAME}
"
        )));
        let served = sums.clone();
        let router = axum::Router::new()
            .route("/zip", axum::routing::get(move || async move { zip_bytes }))
            .route(
                "/sums",
                axum::routing::get(move || async move { served.lock().unwrap().clone() }),
            );
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });

        let release = json!({
            "version": "3.3.0", "tag": "v3.3.0",
            "assets": [
                { "name": ASSET_NAME, "url": format!("{base}/zip") },
                { "name": CHECKSUM_ASSET, "url": format!("{base}/sums") },
            ],
        });
        let paths = Paths::new(&data);

        // A checksum that does not match stops before anything is unpacked.
        *sums.lock().unwrap() = format!(
            "{}  {ASSET_NAME}
",
            "0".repeat(64)
        );
        let damaged = stage_release(&install, &paths, &release, |_, _| {}).await.unwrap_err();
        assert!(damaged.contains("damaged"), "{damaged}");
        assert_eq!(staged_version(&install, &paths), None);

        *sums.lock().unwrap() = format!(
            "{digest}  {ASSET_NAME}
"
        );
        let progress = std::sync::atomic::AtomicU64::new(0);
        stage_release(&install, &paths, &release, |received, _| {
            progress.store(received, std::sync::atomic::Ordering::Relaxed)
        })
        .await
        .unwrap();
        assert!(progress.into_inner() > 0);
        assert_eq!(staged_version(&install, &paths).as_deref(), Some("3.3.0"));
        assert_eq!(
            fs::read_to_string(paths.pending_dir.join("Memoria.exe")).unwrap(),
            "new program"
        );
        assert!(!paths.update_dir.join("download").exists());
    }

    #[test]
    fn release_shape_matches_the_app() {
        let release = read_release(&json!({
            "tag_name": "v3.3.0", "name": "", "body": "Notes", "html_url": "https://x",
            "published_at": "2026-11-01T00:00:00Z",
            "assets": [{ "name": "Memoria-win-x64.zip", "browser_download_url": "https://d", "size": 5 }]
        }));
        assert_eq!(release["version"], "3.3.0");
        assert_eq!(release["name"], "v3.3.0");
        assert_eq!(release["assets"][0]["url"], "https://d");
    }
}
