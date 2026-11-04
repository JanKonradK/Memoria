// The window's page is served from the loopback server, which Tauri treats as
// a remote origin. Remote pages may only call commands listed here and
// granted in capabilities/main.json.
const COMMANDS: &[&str] = &[
    "set_zoom",
    "launch_list",
    "launch_choose",
    "launch_clear",
    "launch_start",
    "update_check",
    "update_download",
    "update_install",
    "presence_get",
    "presence_set",
    "games_watch",
    "game_notify",
    "renderer_ready",
    "close_result",
    "open_external",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("build the Tauri app");
}
