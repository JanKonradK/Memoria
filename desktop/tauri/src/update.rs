//! Updates from GitHub releases.
//!
//! The window asks; this module talks to GitHub (the window's content policy
//! only allows its own origin), downloads the Windows zip, checks it against
//! the publisher-signed release manifest and unpacks it into a pending folder. After
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
const MANIFEST_ASSET: &str = "release-manifest.json";
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
pub async fn fetch_latest_release(since: Option<&str>, paths: &Paths) -> Result<Option<Value>, String> {
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
    if since.is_some_and(|current| compare_versions(latest["version"].as_str().unwrap_or(""), current).is_gt()) {
        let manifest_url = latest["assets"]
            .as_array()
            .and_then(|assets| assets.iter().find(|a| a["name"] == MANIFEST_ASSET))
            .and_then(|a| a["url"].as_str())
            .ok_or("This release has no publisher signature.")?;
        let mut response = client()?.get(manifest_url).send().await.map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err("The signed release manifest could not be downloaded.".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > 2_000_000 {
                return Err("The release manifest is too large.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let envelope = serde_json::from_slice(&bytes).map_err(|_| "The release manifest is invalid.")?;
        let previous = crate::store::read_json(&paths.update_dir.join("trust.json"));
        let (manifest, stamp) = crate::publisher::verify(&envelope, crate::publisher::RELEASE, previous.as_ref())?;
        if manifest["version"] != latest["version"] || manifest["tag"] != latest["tag"] {
            return Err("The signed release does not match this version.".into());
        }
        crate::publisher::accept(&paths.update_dir.join("trust.json"), &stamp)?;
    }
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

#[cfg(test)]
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
    refuse_elevated()?;
    let record = release_record(root).ok_or("This copy of Memoria runs from source. Pull the new version instead.")?;
    let version = release["version"].as_str().unwrap_or("").to_string();
    if compare_versions(&version, record["version"].as_str().unwrap_or("0")).is_le() {
        return Err("This version is already installed.".into());
    }
    if staged_version(root, paths).as_deref() == Some(version.as_str()) && validate_pending(root, paths).is_ok() {
        return Ok(json!({ "version": version }));
    }
    let asset = |name: &str| {
        release["assets"]
            .as_array()
            .and_then(|a| a.iter().find(|asset| asset["name"] == name))
            .and_then(|asset| asset["url"].as_str())
            .map(str::to_string)
    };
    let (Some(zip_url), Some(manifest_url)) = (asset(ASSET_NAME), asset(MANIFEST_ASSET)) else {
        return Err(format!("Release {version} has no signed Windows download."));
    };

    let work = paths.update_dir.join("download");
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = async {
        let client = client()?;
        let zip = work.join(ASSET_NAME);
        download(&client, &zip_url, &zip, MAX_DOWNLOAD_BYTES, &progress).await?;
        let signed_file = work.join(MANIFEST_ASSET);
        download(&client, &manifest_url, &signed_file, 2_000_000, &|_, _| {}).await?;
        let envelope = crate::store::read_json(&signed_file).ok_or("The signed release manifest is invalid.")?;
        let previous = crate::store::read_json(&paths.update_dir.join("trust.json"));
        let (manifest, stamp) = crate::publisher::verify(&envelope, crate::publisher::RELEASE, previous.as_ref())?;
        if manifest["version"] != version || manifest["tag"] != release["tag"] {
            return Err("The signed release does not match this version.".into());
        }
        if manifest["files"][ASSET_NAME].as_str() != Some(sha256_file(&zip)?.as_str()) {
            return Err("The signed update is damaged or modified. Try again.".into());
        }
        let unpacked = work.join("unpacked");
        extract_zip(&zip, &unpacked)?;
        let tree = unwrap_single_root(&unpacked);
        if !tree.join("release.json").exists() {
            return Err("The downloaded build has no release.json.".into());
        }
        let _locks = verify_tree(&tree, &manifest)?;
        drop(_locks);
        clear_pending(paths);
        fs::create_dir_all(&paths.update_dir).map_err(|e| e.to_string())?;
        fs::rename(&tree, &paths.pending_dir).map_err(|e| e.to_string())?;
        let staged_at = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        crate::store::write_json(
            &paths.pending_manifest,
            &json!({ "version": version, "tag": release["tag"], "stagedAt": staged_at, "signed": envelope }),
        )
        .map_err(|e| e.to_string())?;
        crate::publisher::accept(&paths.update_dir.join("trust.json"), &stamp)?;
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
    refuse_elevated().map_err(std::io::Error::other)?;
    let _locks = validate_pending(root, paths).map_err(std::io::Error::other)?;
    // Native helper: no editable command file runs after the app exits.
    let mut command = Command::new(paths.pending_dir.join("Memoria.exe"));
    command
        .arg("--apply-signed-update")
        .arg(root)
        .arg(&paths.update_dir)
        .arg(std::process::id().to_string());
    hide_console(&mut command);
    command.spawn().map(|_| ())
}

pub fn refuse_elevated() -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
            System::Threading::{GetCurrentProcess, OpenProcessToken},
        };
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err("Could not check update permissions.".into());
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut size = 0;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut _ as *mut _,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        );
        CloseHandle(token);
        if ok == 0 || elevation.TokenIsElevated != 0 {
            return Err("Close Memoria and open it without administrator rights before updating.".into());
        }
    }
    Ok(())
}

/// Hold read-only handles on every signed source until the installer finishes.
/// Refuse extra files, links and junctions; these could inject installer code.
fn verify_tree(root: &Path, manifest: &Value) -> Result<Vec<fs::File>, String> {
    use std::io::Read;
    let expected = manifest["windows"]
        .as_object()
        .filter(|m| !m.is_empty())
        .ok_or("The signed Windows file list is missing.")?;
    fn walk(
        root: &Path,
        dir: &Path,
        expected: &serde_json::Map<String, Value>,
        locks: &mut Vec<fs::File>,
        directories: &mut Vec<fs::File>,
    ) -> Result<(), String> {
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // Deny directory deletion/rename while any verified path is in use.
            directories.push(
                fs::OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .custom_flags(0x02000000)
                    .open(dir)
                    .map_err(|e| e.to_string())?,
            );
        }
        let metadata = fs::symlink_metadata(dir).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("Update folders cannot contain links or junctions.".into());
            }
        }
        if metadata.file_type().is_symlink() {
            return Err("Update folders cannot contain links.".into());
        }
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let file = entry.map_err(|e| e.to_string())?.path();
            let meta = fs::symlink_metadata(&file).map_err(|e| e.to_string())?;
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err("Update files cannot contain links or junctions.".into());
                }
            }
            if meta.file_type().is_symlink() {
                return Err("Update files cannot contain links.".into());
            }
            if meta.is_dir() {
                walk(root, &file, expected, locks, directories)?;
                continue;
            }
            let name = file
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            let digest = expected
                .get(&name)
                .and_then(Value::as_str)
                .ok_or("The staged update contains an unsigned file.")?;
            let mut options = fs::OpenOptions::new();
            options.read(true);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                options.share_mode(1);
            }
            let mut handle = options.open(&file).map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            handle.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            if hex::encode(Sha256::digest(bytes)) != digest {
                return Err(format!("The staged update was modified: {name}. Download it again."));
            }
            locks.push(handle);
        }
        Ok(())
    }
    let mut locks = Vec::new();
    let mut directories = Vec::new();
    walk(root, root, expected, &mut locks, &mut directories)?;
    if locks.len() != expected.len() {
        return Err("The staged update is incomplete. Download it again.".into());
    }
    locks.extend(directories);
    Ok(locks)
}

pub fn validate_pending(root: &Path, paths: &Paths) -> Result<(Vec<fs::File>, Value), String> {
    refuse_elevated()?;
    let pending = crate::store::read_json(&paths.pending_manifest).ok_or("Download a signed update first.")?;
    let previous = crate::store::read_json(&paths.update_dir.join("trust.json"));
    let (manifest, _) = crate::publisher::verify(&pending["signed"], crate::publisher::RELEASE, previous.as_ref())?;
    let current = release_record(root).ok_or("This install has no version record.")?;
    if !compare_versions(
        manifest["version"].as_str().unwrap_or(""),
        current["version"].as_str().unwrap_or("0"),
    )
    .is_gt()
    {
        return Err("This update is older than the installed version.".into());
    }
    Ok((verify_tree(&paths.pending_dir, &manifest)?, manifest))
}

pub fn apply_helper(args: &[String]) -> Result<(), String> {
    if args.len() != 5 {
        return Err("Invalid update command.".into());
    }
    refuse_elevated()?;
    let root = PathBuf::from(&args[2]);
    let paths = Paths::new(Path::new(&args[3]).parent().ok_or("Invalid update directory.")?);
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
        };
        let pid = args[4].parse::<u32>().map_err(|_| "Invalid process.")?;
        let process = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if !process.is_null() {
            let result = WaitForSingleObject(process, 60_000);
            CloseHandle(process);
            if result != 0 {
                return Err("Memoria did not close in time.".into());
            }
        }
    }
    // Recheck AFTER waiting and keep locks until all source files have been copied.
    let (locks, manifest) = validate_pending(&root, &paths)?;
    let mut installer = Command::new("powershell.exe");
    installer
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(paths.pending_dir.join("desktop/Install-Shortcut.ps1"))
        .arg("-InstallRoot")
        .arg(&root)
        .arg("-NoShortcuts");
    hide_console(&mut installer);
    // Copy only signed names, so a file inserted after verification is ignored.
    let names: Vec<&String> = manifest["windows"]
        .as_object()
        .ok_or("Missing file list.")?
        .keys()
        .collect();
    let names_file = paths.update_dir.join("install-files.json");
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1);
    }
    let mut names_lock = options.open(&names_file).map_err(|e| e.to_string())?;
    names_lock
        .write_all(&serde_json::to_vec(&names).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    names_lock.flush().map_err(|e| e.to_string())?;
    installer.arg("-VerifiedFilesFile").arg(&names_file);
    let result = installer.status().map_err(|e| e.to_string())?;
    drop(locks);
    drop(names_lock);
    if !result.success() {
        return Err("The signed update installer failed. Your data was kept.".into());
    }
    clear_pending(&paths);
    Command::new(root.join("Memoria.exe"))
        .current_dir(&root)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
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
        let signed = |digest: &str| {
            let windows = json!({
                "release.json": sha256_file(&build.join("Memoria/release.json")).unwrap(),
                "Memoria.exe": sha256_file(&build.join("Memoria/Memoria.exe")).unwrap(),
            });
            crate::publisher::tests::signed(
                json!({"version":"3.3.0", "tag":"v3.3.0", "files":{ASSET_NAME:digest},"windows":windows}),
                1_793_836_800_010,
            )
            .0
            .to_string()
        };
        let sums = std::sync::Arc::new(std::sync::Mutex::new(signed(&digest)));
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
                { "name": MANIFEST_ASSET, "url": format!("{base}/sums") },
            ],
        });
        let paths = Paths::new(&data);

        // A checksum that does not match stops before anything is unpacked.
        *sums.lock().unwrap() = signed(&"0".repeat(64));
        let damaged = stage_release(&install, &paths, &release, |_, _| {}).await.unwrap_err();
        assert!(damaged.contains("damaged"), "{damaged}");
        assert_eq!(staged_version(&install, &paths), None);

        *sums.lock().unwrap() = signed(&digest);
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
        // The later installer check rejects modified, extra and missing files.
        let (manifest, _) = crate::publisher::verify(
            &serde_json::from_str::<Value>(&signed(&digest)).unwrap(),
            crate::publisher::RELEASE,
            None,
        )
        .unwrap();
        fs::write(paths.pending_dir.join("Memoria.exe"), "tampered").unwrap();
        assert!(verify_tree(&paths.pending_dir, &manifest)
            .unwrap_err()
            .contains("modified"));
        fs::write(paths.pending_dir.join("Memoria.exe"), "new program").unwrap();
        fs::write(paths.pending_dir.join("injected.ps1"), "evil").unwrap();
        assert!(verify_tree(&paths.pending_dir, &manifest)
            .unwrap_err()
            .contains("unsigned"));
        fs::remove_file(paths.pending_dir.join("injected.ps1")).unwrap();
        fs::remove_file(paths.pending_dir.join("Memoria.exe")).unwrap();
        assert!(verify_tree(&paths.pending_dir, &manifest)
            .unwrap_err()
            .contains("incomplete"));
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
