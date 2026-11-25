// The window's page is served from the loopback server, which Tauri treats as
// a remote origin. Remote pages may only call commands listed here and
// granted in capabilities/main.json (or, for the snip window, capabilities/snip.json).
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
    "notifications_status",
    "notifications_test",
    "notifications_settings",
    "connector_status",
    "connector_hoyolab_login",
    "connector_hoyolab_disconnect",
    "connector_hoyolab_link",
    "connector_hoyolab_refresh",
    "connector_hoyolab_redeem",
    "connector_hoyolab_checkin",
    "connector_hoyolab_prefs",
    "connector_gacha_scan",
    "connector_screenshot_pick",
    "connector_screenshot_watch_choose",
    "connector_screenshot_watch_clear",
    "connector_screenshot_captures_open",
    "connector_screenshot_captures_clear",
    "connector_skport_login",
    "connector_skport_disconnect",
    "connector_skport_link",
    "connector_skport_refresh",
    "connector_skport_prefs",
    "connector_hoyolab_import_browser",
    "connector_skport_import_browser",
    "connector_browser_start",
    "connector_browser_cancel",
    "connector_browser_open_helper",
    "connector_screenshot_capture",
    "connector_screenshot_set_shortcut",
    "screenshot_snip_data",
    "screenshot_snip_commit",
    "screenshot_snip_cancel",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("build the Tauri app");
}
