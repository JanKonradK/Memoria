//! Updates from GitHub releases. Ported from desktop/update.mjs and the
//! Electron window's install-on-close step.
//!
//! The window checks and downloads on request. A download is verified against
//! the release's SHA256SUMS.txt and unpacked into %APPDATA%\memoria\updates.
//! Installing waits for Memoria to save and close, then runs the new build's
//! own installer over this install and reopens it.

use std::{
    cmp::Ordering,
    fs,
    io::{Read, Write},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, SystemTime},
};

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::paths::Paths;

pub const REPO: &str = "JanKonradK/Memoria";
const RELEASE_PAGE: &str = "https://github.com/JanKonradK/Memoria/releases/latest";
const ASSET_NAME: &str = "Memoria-win-x64.zip";
const CHECKSUM_ASSET: &str = "SHA256SUMS.txt";
const NETWORK_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_DOWNLOAD_BYTES: u64 = 400 * 1024 * 1024;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;

/// `1.2.3` ordering. A prerelease sorts below the same finished version.
pub fn compare_versions(left: &str, right: &str) -> Ordering {
    let parse = |value: &str| {
        let value = value.strip_prefix('v').unwrap_or(value);
        let (core, prerelease) = value.split_once('-').unwrap_or((value, ""));
        // split('-', 2) in JS keeps only the text up to a second hyphen.
        let prerelease = prerelease.split('-').next().unwrap_or("").to_owned();
        let parts: Vec<i64> = core.split('.').map(|p| leading_int(p).unwrap_or(0)).collect();
        (parts, prerelease)
    };
    let (a, a_pre) = parse(left);
    let (b, b_pre) = parse(right);
    for index in 0..3 {
        let diff = a.get(index).copied().unwrap_or(0).cmp(&b.get(index).copied().unwrap_or(0));
        if diff != Ordering::Equal {
            return diff;
        }
    }
    match (a_pre.is_empty(), b_pre.is_empty()) {
        _ if a_pre == b_pre => Ordering::Equal,
        (true, _) => Ordering::Greater,
        (_, true) => Ordering::Less,
        _ => a_pre.cmp(&b_pre),
    }
}

/// Number.parseInt: leading digits, optional sign, anything after ignored.
fn leading_int(value: &str) -> Option<i64> {
    let value = value.trim_start();
    let (sign, digits) = match value.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, value.strip_prefix('+').unwrap_or(value)),
    };
    let end = digits.find(|c: char| !c.is_ascii_digit()).unwrap_or(digits.len());
    digits[..end].parse::<i64>().ok().map(|n| n * sign)
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// release.json at the install root marks a packaged install, not a checkout.
pub fn release_record(paths: &Paths) -> Option<Value> {
    read_json(&paths.root.join("release.json"))
}

pub fn installed_version(paths: &Paths) -> Option<String> {
    release_record(paths)?.get("version")?.as_str().map(str::to_owned)
}

fn pending_dir(paths: &Paths) -> PathBuf {
    paths.updates.join("pending")
}

fn pending_manifest(paths: &Paths) -> PathBuf {
    paths.updates.join("pending.json")
}

/// The staged build, when one newer than this install is waiting.
pub fn staged_version(paths: &Paths) -> Option<String> {
    let installed = installed_version(paths)?;
    let staged = read_json(&pending_manifest(paths))?.get("version")?.as_str()?.to_owned();
    (pending_dir(paths).exists() && compare_versions(&staged, &installed) == Ordering::Greater).then_some(staged)
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Asset {
    pub name: String,
    pub url: String,
    pub size: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub version: String,
    pub notes: String,
    pub published_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub version: String,
    pub tag: String,
    pub name: String,
    pub notes: String,
    pub url: String,
    pub published_at: Option<String>,
    pub assets: Vec<Asset>,
    pub changes: Vec<Change>,
}

/// JavaScript's String(value) for the JSON shapes GitHub returns.
fn text(value: Option<&Value>, fallback: &str) -> String {
    match value {
        None | Some(Value::Null) => fallback.to_owned(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

fn read_release(raw: &Value) -> Release {
    let tag = text(raw.get("tag_name"), "undefined");
    let assets = raw.get("assets").and_then(Value::as_array).cloned().unwrap_or_default();
    Release {
        version: tag.strip_prefix('v').unwrap_or(&tag).to_owned(),
        name: text(raw.get("name"), &tag),
        notes: text(raw.get("body"), ""),
        url: text(raw.get("html_url"), RELEASE_PAGE),
        published_at: raw.get("published_at").and_then(Value::as_str).map(str::to_owned),
        assets: assets
            .iter()
            .map(|a| Asset {
                name: text(a.get("name"), "undefined"),
                url: text(a.get("browser_download_url"), "undefined"),
                size: a.get("size").and_then(Value::as_f64).filter(|s| *s > 0.0).map_or(0, |s| s as u64),
            })
            .collect(),
        tag,
        changes: Vec::new(),
    }
}

/// The newest final release, with the notes of every release newer than `since`.
pub fn pick_latest(body: &Value, since: Option<&str>) -> Option<Release> {
    let list = match body {
        Value::Array(items) => items.clone(),
        other => vec![other.clone()],
    };
    let mut releases: Vec<Release> = list
        .iter()
        .filter(|r| {
            let truthy = |key: &str| r.get(key).is_some_and(|v| !matches!(v, Value::Null | Value::Bool(false)));
            let tag = text(r.get("tag_name"), "");
            !truthy("draft") && !truthy("prerelease") && !tag.strip_prefix('v').unwrap_or(&tag).is_empty()
        })
        .map(read_release)
        .collect();
    releases.sort_by(|a, b| compare_versions(&b.version, &a.version));
    let latest = releases.first()?.clone();
    let newer: Vec<&Release> = releases
        .iter()
        .filter(|r| since.is_none_or(|since| compare_versions(&r.version, since) == Ordering::Greater))
        .collect();
    let notes = if newer.is_empty() { vec![&latest] } else { newer };
    let changes = notes
        .iter()
        .map(|r| Change { version: r.version.clone(), notes: r.notes.clone(), published_at: r.published_at.clone() })
        .collect();
    Some(Release { changes, ..latest })
}

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("Memoria-updater (+https://github.com/{REPO})"))
        .timeout(NETWORK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

pub async fn fetch_latest_release(http: &reqwest::Client, since: Option<&str>) -> Result<Option<Release>, String> {
    let response = http
        .get(format!("https://api.github.com/repos/{REPO}/releases?per_page=30"))
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
    Ok(pick_latest(&body, since))
}

/// Writes `url` to `destination`, refusing anything over `max` bytes.
async fn download_to(
    http: &reqwest::Client,
    url: &str,
    destination: &Path,
    max: u64,
    progress: &(dyn Fn(u64, u64) + Sync),
) -> Result<(), String> {
    let response = http.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("{url} responded {}", response.status().as_u16()));
    }
    let total = response.content_length().unwrap_or(0);
    if total > max {
        return Err("download exceeds the size ceiling or has no body".into());
    }
    let mut file = fs::File::create(destination).map_err(|e| e.to_string())?;
    let mut received = 0u64;
    let mut stream = response.bytes_stream();
    let result = async {
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            received += chunk.len() as u64;
            progress(received, total);
            if received > max {
                return Err("download exceeded the size ceiling".to_owned());
            }
            file.write_all(&chunk).map_err(|e| e.to_string())?;
        }
        file.flush().map_err(|e| e.to_string())
    }
    .await;
    if result.is_err() {
        drop(file);
        let _ = fs::remove_file(destination);
    }
    result
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// `<sha256>  <name>` lines, as sha256sum writes them.
pub fn parse_checksums(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim_end();
            let (digest, rest) = line.split_at_checked(64)?;
            if !digest.bytes().all(|b| b.is_ascii_hexdigit()) || !rest.starts_with(char::is_whitespace) {
                return None;
            }
            let name = rest.trim_start().trim_start_matches('*');
            let name = name.strip_prefix("./").unwrap_or(name);
            (!name.is_empty()).then(|| (name.to_owned(), digest.to_ascii_lowercase()))
        })
        .collect()
}

/// Windows 10 and later ship bsdtar as `tar`, which reads zip. PowerShell is the fallback.
fn extract_zip(zip: &Path, destination: &Path) -> Result<(), String> {
    let _ = fs::remove_dir_all(destination);
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    let quiet = |command: &mut Command| {
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status()
    };
    if quiet(Command::new("tar").arg("-xf").arg(zip).arg("-C").arg(destination)).is_ok_and(|s| s.success()) {
        return Ok(());
    }
    let literal = |p: &Path| format!("'{}'", p.display().to_string().replace('\'', "''"));
    let script =
        format!("Expand-Archive -LiteralPath {} -DestinationPath {} -Force", literal(zip), literal(destination));
    match quiet(Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", &script])) {
        Ok(status) if status.success() => Ok(()),
        _ => Err("could not unpack the downloaded update".into()),
    }
}

/// The zip has one top-level Memoria folder; staging needs its contents.
fn unwrap_single_root(directory: &Path) -> PathBuf {
    let entries: Vec<_> = fs::read_dir(directory).map(|r| r.flatten().collect()).unwrap_or_default();
    match entries.as_slice() {
        [only] if only.path().is_dir() => only.path(),
        _ => directory.to_path_buf(),
    }
}

fn clear_pending(paths: &Paths) {
    let _ = fs::remove_file(pending_manifest(paths));
    let _ = fs::remove_dir_all(pending_dir(paths));
}

/// Downloads, verifies and unpacks `release` into the pending folder.
/// Nothing in the install is touched.
pub async fn stage_release(
    http: &reqwest::Client,
    paths: &Paths,
    release: &Release,
    progress: &(dyn Fn(u64, u64) + Sync),
) -> Result<Value, String> {
    let installed =
        installed_version(paths).ok_or("This copy of Memoria runs from source. Pull the new version instead.")?;
    if compare_versions(&release.version, &installed) != Ordering::Greater {
        return Err("This version is already installed.".into());
    }
    if staged_version(paths).as_deref() == Some(release.version.as_str()) {
        return Ok(json!({ "version": release.version }));
    }
    let find = |name: &str| release.assets.iter().find(|a| a.name == name);
    let (Some(zip_asset), Some(sums_asset)) = (find(ASSET_NAME), find(CHECKSUM_ASSET)) else {
        return Err(format!("Release {} has no Windows download.", release.version));
    };
    let work = paths.updates.join("download");
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = async {
        let zip = work.join(ASSET_NAME);
        download_to(http, &zip_asset.url, &zip, MAX_DOWNLOAD_BYTES, progress).await?;
        let sums = work.join(CHECKSUM_ASSET);
        download_to(http, &sums_asset.url, &sums, 64_000, &|_, _| {}).await?;
        // An unsigned zip from the internet is checked before a byte of it is unpacked.
        let table = parse_checksums(&fs::read_to_string(&sums).map_err(|e| e.to_string())?);
        let expected = table
            .iter()
            .rev()
            .find(|(name, _)| name == ASSET_NAME)
            .map(|(_, digest)| digest.clone())
            .ok_or(format!("{CHECKSUM_ASSET} does not list {ASSET_NAME}."))?;
        if sha256_file(&zip)? != expected {
            return Err("The download is damaged. Try again.".into());
        }
        let unpacked = work.join("unpacked");
        extract_zip(&zip, &unpacked)?;
        let tree = unwrap_single_root(&unpacked);
        if !tree.join("release.json").is_file() {
            return Err("The downloaded build has no release.json.".into());
        }
        // Clear the manifest with the tree it describes, so a failed rename
        // never leaves a manifest pointing at missing files.
        clear_pending(paths);
        fs::rename(&tree, pending_dir(paths)).map_err(|e| e.to_string())?;
        let manifest = json!({
            "version": release.version,
            "tag": release.tag,
            "stagedAt": humantime::format_rfc3339_millis(SystemTime::now()).to_string(),
        });
        let text = format!("{}\n", serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?);
        fs::write(pending_manifest(paths), text).map_err(|e| e.to_string())?;
        Ok(json!({ "version": release.version }))
    }
    .await;
    let _ = fs::remove_dir_all(&work);
    result
}

fn quote(value: &Path) -> String {
    format!("'{}'", value.display().to_string().replace('\'', "''"))
}

/// Waits for this process to exit, installs the staged build over this install
/// with its own installer, then reopens Memoria: the new build, or the old one
/// if the install failed and rolled back.
pub fn run_staged_installer(paths: &Paths) -> std::io::Result<()> {
    let pending = pending_dir(paths);
    let installer = pending.join("desktop").join("Install-Shortcut.ps1");
    let script = [
        "$ErrorActionPreference = 'Continue'".to_owned(),
        format!("$log = {}", quote(&paths.updates.join("install.log"))),
        format!("Wait-Process -Id {} -Timeout 60 -ErrorAction SilentlyContinue", std::process::id()),
        "$installed = $false".into(),
        "foreach ($attempt in 1..20) {".into(),
        format!("  & {} -InstallRoot {} -NoShortcuts *> $log", quote(&installer), quote(&paths.root)),
        "  if ($?) { $installed = $true; break }".into(),
        "  Start-Sleep -Milliseconds 500".into(),
        "}".into(),
        format!(
            "if ($installed) {{ Remove-Item -LiteralPath {} -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath {} -Force -ErrorAction SilentlyContinue }}",
            quote(&pending),
            quote(&pending_manifest(paths))
        ),
        "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue".into(),
        format!(
            "Start-Process -FilePath {} -WorkingDirectory {}",
            quote(&paths.root.join("Memoria.exe")),
            quote(&paths.root)
        ),
    ]
    .join("\n");
    fs::create_dir_all(&paths.updates)?;
    let file = paths.updates.join("install-update.ps1");
    // A byte-order mark keeps Windows PowerShell from misreading non-ASCII paths.
    fs::write(&file, format!("\u{FEFF}{script}\n"))?;
    let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
    Command::new(comspec)
        .raw_arg(format!(
            "/d /s /c \"start \"\" /b powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{}\"\"",
            file.display()
        ))
        .env_remove("ELECTRON_RUN_AS_NODE")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
        .spawn()
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_versions_like_the_app() {
        assert_eq!(compare_versions("3.2.0", "3.10.0"), Ordering::Less);
        assert_eq!(compare_versions("v3.2.0", "3.2.0"), Ordering::Equal);
        assert_eq!(compare_versions("3.2.0", "3.2.0-beta.1"), Ordering::Greater);
        assert_eq!(compare_versions("3.2.0-beta.2", "3.2.0-beta.10"), Ordering::Greater);
        assert_eq!(compare_versions("3.2", "3.2.0"), Ordering::Equal);
        assert_eq!(compare_versions("4x.0.0", "3.0.0"), Ordering::Greater);
    }

    #[test]
    fn picks_the_newest_final_release_with_every_newer_note() {
        let body = json!([
            { "tag_name": "v3.3.0", "name": "3.3.0", "body": "three", "assets": [{ "name": ASSET_NAME, "browser_download_url": "https://x/z", "size": 5 }], "published_at": "2026-10-20T00:00:00Z" },
            { "tag_name": "v3.4.0-beta.1", "prerelease": true },
            { "tag_name": "v3.5.0", "draft": true },
            { "tag_name": "v3.2.1", "body": "two" },
            { "tag_name": "v3.1.0", "body": "old" },
        ]);
        let latest = pick_latest(&body, Some("3.2.0")).unwrap();
        assert_eq!(latest.version, "3.3.0");
        assert_eq!(latest.assets[0].size, 5);
        assert_eq!(latest.changes.iter().map(|c| c.version.as_str()).collect::<Vec<_>>(), ["3.3.0", "3.2.1"]);
        assert_eq!(pick_latest(&body, Some("9.0.0")).unwrap().changes.len(), 1);
        assert_eq!(pick_latest(&json!([]), None), None);
        let shape = serde_json::to_value(&latest).unwrap();
        assert_eq!(shape["publishedAt"], "2026-10-20T00:00:00Z");
        assert_eq!(shape["changes"][0]["publishedAt"], "2026-10-20T00:00:00Z");
    }

    #[test]
    fn reads_sha256sums() {
        let digest = "a".repeat(64);
        let text = format!("{digest}  Memoria-win-x64.zip\r\n{}  *./Memoria.html\nnot a line\n", "B".repeat(64));
        assert_eq!(
            parse_checksums(&text),
            vec![("Memoria-win-x64.zip".into(), digest), ("Memoria.html".into(), "b".repeat(64))]
        );
    }

    #[test]
    fn reports_only_a_newer_staged_build() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::new(temp.path().join("install"), temp.path().join("data"));
        fs::create_dir_all(&paths.root).unwrap();
        fs::create_dir_all(pending_dir(&paths)).unwrap();
        fs::write(pending_manifest(&paths), r#"{"version":"3.3.0"}"#).unwrap();
        assert_eq!(staged_version(&paths), None, "a checkout never has a staged build");
        fs::write(paths.root.join("release.json"), r#"{"version":"3.2.0"}"#).unwrap();
        assert_eq!(staged_version(&paths).as_deref(), Some("3.3.0"));
        fs::write(paths.root.join("release.json"), r#"{"version":"3.3.0"}"#).unwrap();
        assert_eq!(staged_version(&paths), None);
    }
}
