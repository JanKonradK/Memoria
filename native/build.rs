use std::{path::PathBuf, process::Command};

/// Commands the app window may invoke. Each becomes an `allow-*` permission
/// that native/capabilities/ grants to the loopback app origin only.
const COMMANDS: &[&str] = &["renderer_ready", "close_result", "request_quit", "toggle_menu"];

fn main() {
    bundle_shared_core();
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri build step failed");
}

/// Bundles native/core/entry.mjs and the shared/ rules it imports into one
/// script for QuickJS. Node is a build tool here; it never ships.
fn bundle_shared_core() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo = manifest.join("..");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("shared-core.js");
    for watched in ["core/entry.mjs", "../shared/src", "../shared/package.json", "../package-lock.json"] {
        println!("cargo:rerun-if-changed={watched}");
    }
    let esbuild = repo.join("node_modules").join("esbuild").join("bin").join("esbuild");
    let status = Command::new("node")
        .arg(&esbuild)
        .arg(manifest.join("core").join("entry.mjs"))
        .args([
            "--bundle",
            "--platform=neutral",
            "--main-fields=module,main",
            "--format=iife",
            "--global-name=MemoriaCore",
            "--target=es2023",
            "--log-level=warning",
        ])
        .arg(format!("--outfile={}", out.display()))
        .current_dir(&repo)
        .status()
        .unwrap_or_else(|e| panic!("could not run esbuild through node ({e}). Run npm ci first."));
    assert!(status.success(), "esbuild could not bundle native/core/entry.mjs. Run npm ci first.");
}
