//! Where Memoria keeps its files. The data directory is the one every earlier
//! build used, so progress, phone pairings and launch targets carry over.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug)]
pub struct Paths {
    /// The install (Memoria.exe, release.json, app/dist) or, in development, the checkout.
    pub root: PathBuf,
    pub dist: PathBuf,
    pub data: PathBuf,
    pub state: PathBuf,
    pub token: PathBuf,
    pub updates: PathBuf,
    pub webview: PathBuf,
    pub bounds: PathBuf,
}

impl Paths {
    pub fn resolve() -> io::Result<Self> {
        let app_data =
            std::env::var_os("APPDATA").map(PathBuf::from).ok_or_else(|| io::Error::other("APPDATA is not set."))?;
        let root = install_root()?;
        Ok(Self::new(root, app_data.join("memoria")))
    }

    pub fn new(root: PathBuf, data: PathBuf) -> Self {
        Self {
            dist: root.join("app").join("dist"),
            state: data.join("state.json"),
            token: data.join("launcher-token"),
            updates: data.join("updates"),
            // Kept apart from the Electron profile in desktop-profile.
            webview: data.join("webview-profile"),
            bounds: data.join("desktop-window.json"),
            root,
            data,
        }
    }
}

/// The folder holding app/dist: beside the executable in a release, or the
/// checkout during development. MEMORIA_ROOT overrides both for tests.
fn install_root() -> io::Result<PathBuf> {
    if let Some(root) = std::env::var_os("MEMORIA_ROOT") {
        return Ok(PathBuf::from(root));
    }
    let exe = std::env::current_exe()?;
    let beside = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    if beside.join("app").join("dist").join("index.html").is_file() {
        return Ok(beside);
    }
    if cfg!(debug_assertions) {
        return Ok(Path::new(env!("CARGO_MANIFEST_DIR")).join(".."));
    }
    Err(io::Error::other(
        "this install is missing app/dist. Re-download Memoria from \
         https://github.com/JanKonradK/Memoria/releases/latest and unpack it again.",
    ))
}

/// The app was renamed twice, and these folders can hold the only desktop
/// copy of someone's progress. Newest name first.
pub fn migrate_legacy_data(app_data: &Path, data: &Path) -> io::Result<()> {
    for legacy in ["void", "technogg"].map(|name| app_data.join(name)) {
        if !legacy.exists() {
            continue;
        }
        if !data.exists() {
            return fs::rename(&legacy, data);
        }
        let legacy_state = legacy.join("state.json");
        let state = data.join("state.json");
        if !legacy_state.exists() || state.exists() {
            continue;
        }
        let bytes = fs::read(&legacy_state)?;
        fs::write(&state, &bytes)?;
        if fs::read(&state)? != bytes {
            return Err(io::Error::other("Memoria could not verify the migrated desktop state file."));
        }
        return Ok(());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_a_renamed_data_folder_and_keeps_existing_progress() {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path().join("memoria");
        fs::create_dir_all(temp.path().join("void")).unwrap();
        fs::write(temp.path().join("void").join("state.json"), "{\"v\":1}").unwrap();
        migrate_legacy_data(temp.path(), &data).unwrap();
        assert_eq!(fs::read_to_string(data.join("state.json")).unwrap(), "{\"v\":1}");

        fs::create_dir_all(temp.path().join("technogg")).unwrap();
        fs::write(temp.path().join("technogg").join("state.json"), "{\"v\":0}").unwrap();
        migrate_legacy_data(temp.path(), &data).unwrap();
        assert_eq!(fs::read_to_string(data.join("state.json")).unwrap(), "{\"v\":1}");
    }
}
