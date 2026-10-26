//! The Memoria window. Ported from desktop/electron-main.mjs.

use std::{
    fs,
    os::windows::process::CommandExt,
    process::Command,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use rfd::MessageLevel;
use serde_json::{Value, json};
use tauri::{
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
    menu::{Menu, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder},
    webview::{NewWindowResponse, PageLoadEvent},
};
use tauri_plugin_opener::OpenerExt;

use crate::{
    launch::{self, GameLaunch, LAUNCH_EXTENSIONS},
    paths::Paths,
    policy::{Rect, external_url, is_app_url, window_bounds},
    update::{self, Release},
};

const BRIDGE: &str = include_str!("bridge.js");
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const ZOOM_STEPS: [f64; 13] = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];

#[derive(serde::Serialize, serde::Deserialize, Default, Clone, Copy)]
struct SavedBounds {
    #[serde(flatten)]
    rect: Rect,
    #[serde(default)]
    maximized: bool,
}

pub struct Host {
    paths: Paths,
    origin: String,
    /// The page registered its close listener and can answer a close request.
    ready: AtomicBool,
    quitting: AtomicBool,
    pending_close: Mutex<Option<String>>,
    /// The last size and place of the window while it was neither maximized nor minimized.
    normal: Mutex<Option<Rect>>,
    zoom: Mutex<f64>,
    launch: Mutex<GameLaunch>,
    latest_release: Mutex<Option<Release>>,
    /// One download at a time. A second request waits, then finds it staged.
    downloading: tokio::sync::Mutex<()>,
    install_on_quit: AtomicBool,
    http: reqwest::Client,
}

impl Host {
    pub fn new(paths: Paths, origin: String) -> Result<Arc<Self>, String> {
        Ok(Arc::new(Self {
            launch: Mutex::new(GameLaunch::new(&paths.data)),
            latest_release: Mutex::new(None),
            downloading: tokio::sync::Mutex::new(()),
            install_on_quit: AtomicBool::new(false),
            http: update::client()?,
            paths,
            origin,
            ready: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
            pending_close: Mutex::new(None),
            normal: Mutex::new(None),
            zoom: Mutex::new(1.0),
        }))
    }
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn from_app(app: &AppHandle, webview: &tauri::Webview, host: &Host) -> bool {
    webview.label() == "main"
        && webview.url().is_ok_and(|url| is_app_url(url.as_str(), &host.origin))
        && window(app).is_some()
}

/// A message over the window. It does not block the caller.
fn message(app: &AppHandle, kind: MessageLevel, title: &str, text: &str) {
    let mut dialog = rfd::AsyncMessageDialog::new()
        .set_title(title)
        .set_description(text)
        .set_level(kind)
        .set_buttons(rfd::MessageButtons::Ok);
    if let Some(window) = window(app) {
        dialog = dialog.set_parent(&window);
    }
    tauri::async_runtime::spawn(dialog.show());
}

fn focus(app: &AppHandle) {
    if let Some(window) = window(app) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Asks the page to save and confirm before Memoria closes. The page checks
/// drafts and waits for both storage layers, then answers with close_result.
pub fn request_close(app: &AppHandle) {
    let host = app.state::<Arc<Host>>();
    if host.quitting.load(Ordering::SeqCst) {
        return;
    }
    let Some(window) = window(app) else { return };
    let id = {
        let mut pending = host.pending_close.lock().unwrap();
        if pending.is_some() {
            return;
        }
        focus(app);
        if !host.ready.load(Ordering::SeqCst) {
            // Nothing editable has opened yet.
            drop(pending);
            quit(app, false);
            return;
        }
        let id = uuid::Uuid::new_v4().to_string();
        *pending = Some(id.clone());
        id
    };
    let _ = window.eval(format!("window.__memoriaReceive?.('close-request', {})", serde_json::json!(id)));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        let host = app.state::<Arc<Host>>();
        let timed_out = {
            let mut pending = host.pending_close.lock().unwrap();
            let same = pending.as_deref() == Some(id.as_str());
            if same {
                *pending = None;
                host.install_on_quit.store(false, Ordering::SeqCst);
            }
            same
        };
        if timed_out && !host.quitting.load(Ordering::SeqCst) {
            message(
                &app,
                MessageLevel::Warning,
                "Memoria is still saving",
                "Memoria could not confirm that your changes were saved.\n\nKeep the app open. Check the connection, then try closing it again.",
            );
        }
    });
}

fn quit(app: &AppHandle, save: bool) {
    let host = app.state::<Arc<Host>>();
    if save {
        save_bounds(app, &host);
    }
    host.quitting.store(true, Ordering::SeqCst);
    if host.install_on_quit.swap(false, Ordering::SeqCst) && update::run_staged_installer(&host.paths).is_err() {
        message(
            app,
            MessageLevel::Error,
            "Memoria",
            "Windows could not start the update. Memoria stays on this version.",
        );
    }
    app.exit(0);
}

#[tauri::command]
pub fn renderer_ready(app: AppHandle, webview: tauri::Webview, host: tauri::State<Arc<Host>>) {
    if from_app(&app, &webview, &host) {
        host.ready.store(true, Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn close_result(
    app: AppHandle,
    webview: tauri::Webview,
    host: tauri::State<Arc<Host>>,
    request_id: String,
    allow: bool,
    error: Option<String>,
) {
    if !from_app(&app, &webview, &host) {
        return;
    }
    {
        let mut pending = host.pending_close.lock().unwrap();
        if pending.as_deref() != Some(request_id.as_str()) {
            return;
        }
        *pending = None;
    }
    if allow {
        quit(&app, true);
        return;
    }
    // A refused close also cancels the install it was asked for.
    host.install_on_quit.store(false, Ordering::SeqCst);
    if let Some(error) = error.filter(|e| !e.is_empty()) {
        let text: String = error.chars().take(500).collect();
        message(&app, MessageLevel::Warning, "Keep Memoria open", &text);
    }
}

#[tauri::command]
pub fn request_quit(app: AppHandle, webview: tauri::Webview, host: tauri::State<Arc<Host>>) {
    if from_app(&app, &webview, &host) {
        request_close(&app);
    }
}

#[tauri::command]
pub fn toggle_menu(app: AppHandle, webview: tauri::Webview, host: tauri::State<Arc<Host>>) {
    if !from_app(&app, &webview, &host) {
        return;
    }
    if let Some(window) = window(&app) {
        let _ = if window.is_menu_visible().unwrap_or(false) { window.hide_menu() } else { window.show_menu() };
    }
}

fn read_bounds(paths: &Paths) -> Option<SavedBounds> {
    serde_json::from_str(&fs::read_to_string(&paths.bounds).ok()?).ok()
}

fn save_bounds(app: &AppHandle, host: &Host) {
    let Some(window) = window(app) else { return };
    let maximized = window.is_maximized().unwrap_or(false);
    let rect = host.normal.lock().unwrap().or_else(|| current_rect(&window));
    if let Some(rect) = rect {
        let saved = SavedBounds { rect, maximized };
        // Window placement is optional; app data has its own save boundary.
        let _ = serde_json::to_string(&saved).map(|json| fs::write(&host.paths.bounds, json));
    }
}

/// Logical position of the frame and logical size of the page, which is what
/// the window builder takes back.
fn current_rect(window: &WebviewWindow) -> Option<Rect> {
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some(Rect { x: position.x, y: position.y, width: size.width, height: size.height })
}

/// Work areas in logical pixels, primary display first: a first launch centres there.
fn work_areas(app: &AppHandle) -> Vec<Rect> {
    let primary = app.primary_monitor().ok().flatten().map(|m| *m.position());
    let mut monitors = app.available_monitors().unwrap_or_default();
    monitors.sort_by_key(|m| Some(*m.position()) != primary);
    monitors
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            let area = monitor.work_area();
            let position = area.position.to_logical::<f64>(scale);
            let size = area.size.to_logical::<f64>(scale);
            Rect { x: position.x, y: position.y, width: size.width, height: size.height }
        })
        .collect()
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let item = |id: &str, label: &str, accelerator: Option<&str>| {
        let builder = MenuItemBuilder::with_id(id, label);
        match accelerator {
            Some(accelerator) => builder.accelerator(accelerator).build(app),
            None => builder.build(app),
        }
    };
    let file = SubmenuBuilder::new(app, "File")
        .item(&item("close", "Close window", Some("Alt+F4"))?)
        .item(&item("quit", "Quit Memoria", Some("CmdOrCtrl+Q"))?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit").undo().redo().separator().cut().copy().paste().select_all().build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item("zoom-reset", "Actual size", Some("CmdOrCtrl+0"))?)
        .item(&item("zoom-in", "Zoom in", Some("CmdOrCtrl+Plus"))?)
        .item(&item("zoom-out", "Zoom out", Some("CmdOrCtrl+-"))?)
        .item(&item("fullscreen", "Toggle full screen", Some("F11"))?)
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&item("phone-sync", "Allow phone sync through Windows", None)?)
        .item(&item("updates", "Check for updates", None)?)
        .item(&item("about", "About Memoria", None)?)
        .build()?;
    MenuBuilder::new(app).items(&[&file, &edit, &view, &help]).build()
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    let Some(window) = window(app) else { return };
    let host = app.state::<Arc<Host>>();
    match event.id().as_ref() {
        "close" | "quit" => request_close(app),
        "zoom-reset" | "zoom-in" | "zoom-out" => {
            let mut zoom = host.zoom.lock().unwrap();
            let index = ZOOM_STEPS.iter().position(|step| *step >= *zoom - 0.001).unwrap_or(7);
            *zoom = match event.id().as_ref() {
                "zoom-in" => ZOOM_STEPS[(index + 1).min(ZOOM_STEPS.len() - 1)],
                "zoom-out" => ZOOM_STEPS[index.saturating_sub(1)],
                _ => 1.0,
            };
            let _ = window.set_zoom(*zoom);
        }
        "fullscreen" => {
            let _ = window.set_fullscreen(!window.is_fullscreen().unwrap_or(false));
        }
        "phone-sync" => allow_phone_sync(app),
        "updates" => {
            focus(app);
            let _ = window.eval("window.__memoriaReceive?.('show-updates')");
        }
        "about" => message(
            app,
            MessageLevel::Info,
            "Memoria",
            "Memoria for Windows\n\nYour games, saved on this PC.\nPhone sync is available while Memoria is open.",
        ),
        _ => {}
    }
    // The menu bar stays hidden until Alt is pressed again.
    let _ = window.hide_menu();
}

fn allow_phone_sync(app: &AppHandle) {
    let script = app.state::<Arc<Host>>().paths.root.join("desktop").join("Enable-Phone-Sync.ps1");
    let app = app.clone();
    std::thread::spawn(move || {
        let status = Command::new("powershell.exe")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(script)
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        let (kind, text) = match status {
            Ok(status) if status.success() => {
                (MessageLevel::Info, "Windows now allows your phone to connect to Memoria on this local network.")
            }
            Ok(_) => (
                MessageLevel::Warning,
                "Windows did not allow the network change. Approve the administrator prompt to enable phone sync.",
            ),
            Err(_) => (MessageLevel::Error, "Windows could not open the network setup."),
        };
        message(&app, kind, "Memoria phone sync", text);
    });
}

fn open_external(app: &AppHandle, value: &str) {
    let Some(url) = external_url(value) else { return };
    if app.opener().open_url(url, None::<&str>).is_err() {
        message(app, MessageLevel::Error, "Memoria", "Windows could not open this link.");
    }
}

pub fn create_window(app: &AppHandle, url: Url) -> tauri::Result<()> {
    let host = app.state::<Arc<Host>>().inner().clone();
    let areas = work_areas(app);
    let saved = read_bounds(&host.paths);
    let bounds = window_bounds(saved.map(|s| s.rect), &areas);
    let primary = areas.first().copied().unwrap_or(Rect { x: 0.0, y: 0.0, width: 1280.0, height: 900.0 });

    let navigation = host.clone();
    let opener = app.clone();
    let menu = build_menu(app)?;
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Memoria")
        .inner_size(bounds.width, bounds.height)
        .position(bounds.x, bounds.y)
        .min_inner_size(primary.width.min(360.0), primary.height.min(480.0))
        .background_color(tauri::window::Color(16, 16, 21, 255))
        .visible(false)
        .menu(menu)
        .data_directory(host.paths.webview.clone())
        .zoom_hotkeys_enabled(true)
        .initialization_script(BRIDGE)
        .on_navigation(move |target| {
            let allowed = is_app_url(target.as_str(), &navigation.origin);
            if allowed {
                // A new document has no close listener until it registers one.
                navigation.ready.store(false, Ordering::SeqCst);
            }
            allowed
        })
        .on_new_window(move |target, _features| {
            open_external(&opener, target.as_str());
            NewWindowResponse::Deny
        })
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .build()?;
    let _ = window.hide_menu();
    if saved.is_some_and(|s| s.maximized) {
        let _ = window.maximize();
    }

    let tracked = window.clone();
    let events = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            if !events.state::<Arc<Host>>().quitting.load(Ordering::SeqCst) {
                api.prevent_close();
                request_close(&events);
            }
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let normal = !tracked.is_maximized().unwrap_or(false)
                && !tracked.is_minimized().unwrap_or(false)
                && !tracked.is_fullscreen().unwrap_or(false);
            if normal && let Some(rect) = current_rect(&tracked) {
                *events.state::<Arc<Host>>().normal.lock().unwrap() = Some(rect);
            }
        }
        _ => {}
    });
    // A page that never finishes loading still gets a window to show its error.
    let late = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        let _ = late.show();
    });
    Ok(())
}

pub fn menu_handler(app: &AppHandle, event: MenuEvent) {
    on_menu(app, event);
}

pub fn second_instance(app: &AppHandle) {
    focus(app);
}

pub fn is_quitting(app: &AppHandle) -> bool {
    app.try_state::<Arc<Host>>().is_none_or(|host| host.quitting.load(Ordering::SeqCst))
}

fn allowed(app: &AppHandle, webview: &tauri::Webview, host: &Host) -> Result<(), String> {
    if from_app(app, webview, host) && !host.quitting.load(Ordering::SeqCst) {
        Ok(())
    } else {
        Err("This action is only available in Memoria.".into())
    }
}

#[tauri::command]
pub fn launch_list(app: AppHandle, webview: tauri::Webview, host: tauri::State<Arc<Host>>) -> Result<Value, String> {
    allowed(&app, &webview, &host)?;
    Ok(host.launch.lock().unwrap().list())
}

/// The only way a launch path enters Memoria: a file the player picks here.
#[tauri::command]
pub async fn launch_choose(
    app: AppHandle,
    webview: tauri::Webview,
    host: tauri::State<'_, Arc<Host>>,
    game_id: String,
) -> Result<Value, String> {
    allowed(&app, &webview, &host)?;
    host.launch.lock().unwrap().check_choice(&game_id)?;
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("Choose the game or its launcher")
        .add_filter("Programs and shortcuts", &LAUNCH_EXTENSIONS);
    if let Some(window) = window(&app) {
        dialog = dialog.set_parent(&window);
    }
    let path = dialog.pick_file().await.map(|file| file.path().to_path_buf());
    host.launch.lock().unwrap().choose(&game_id, path)
}

#[tauri::command]
pub fn launch_clear(
    app: AppHandle,
    webview: tauri::Webview,
    host: tauri::State<Arc<Host>>,
    game_id: String,
) -> Result<Value, String> {
    allowed(&app, &webview, &host)?;
    host.launch.lock().unwrap().clear(&game_id)
}

/// Started the way a double-click would, so a launcher that needs elevation can ask for it.
#[tauri::command]
pub fn launch_start(
    app: AppHandle,
    webview: tauri::Webview,
    host: tauri::State<Arc<Host>>,
    game_id: String,
) -> Result<Value, String> {
    allowed(&app, &webview, &host)?;
    let path = host.launch.lock().unwrap().target(&game_id)?;
    app.opener().open_path(&path, None::<&str>).map_err(|_| launch::start_failed(&path))?;
    Ok(launch::started(&path))
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    webview: tauri::Webview,
    host: tauri::State<'_, Arc<Host>>,
) -> Result<Value, String> {
    allowed(&app, &webview, &host)?;
    let installed = update::installed_version(&host.paths);
    let release = update::fetch_latest_release(&host.http, installed.as_deref()).await?;
    *host.latest_release.lock().unwrap() = release.clone();
    Ok(json!({ "installed": installed, "release": release, "staged": update::staged_version(&host.paths) }))
}

#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    webview: tauri::Webview,
    host: tauri::State<'_, Arc<Host>>,
) -> Result<Value, String> {
    allowed(&app, &webview, &host)?;
    let release = host.latest_release.lock().unwrap().clone().ok_or("Check for updates first.")?;
    let _one_at_a_time = host.downloading.lock().await;
    let last_sent = Mutex::new(None::<std::time::Instant>);
    let progress = |received: u64, total: u64| {
        let mut last = last_sent.lock().unwrap();
        if last.is_some_and(|at| at.elapsed() < Duration::from_millis(200)) {
            return;
        }
        *last = Some(std::time::Instant::now());
        if let Some(window) = window(&app) {
            let payload = json!({ "received": received, "total": total });
            let _ = window.eval(format!("window.__memoriaReceive?.('update-progress', {payload})"));
        }
    };
    update::stage_release(&host.http, &host.paths, &release, &progress).await
}

/// Installs after the window has saved and closed, through the normal close path.
#[tauri::command]
pub fn update_install(app: AppHandle, webview: tauri::Webview, host: tauri::State<Arc<Host>>) -> Result<bool, String> {
    allowed(&app, &webview, &host)?;
    if update::staged_version(&host.paths).is_none() {
        return Err("Download the update first.".into());
    }
    host.install_on_quit.store(true, Ordering::SeqCst);
    request_close(&app);
    Ok(true)
}
