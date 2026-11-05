//! Memoria for Windows.
//!
//! One small process: a WebView2 window showing the app, a loopback server
//! that feeds it the PC's data file, Wi-Fi sync for the phone, the tray, game
//! start notices and updates. Replaces the Electron build, which shipped its
//! own copy of Chromium and Node.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod core;
mod lan;
mod launch;
mod presence;
mod server;
mod store;
mod update;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rfd::MessageLevel as MessageDialogKind;
use serde_json::{json, Value};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, RunEvent, WebviewUrl, WebviewWindow, WindowEvent};
use tokio::sync::broadcast;

const APP_ID: &str = "app.memoria.tracker";
const MAIN: &str = "main";

#[derive(Default)]
struct CloseState {
    /// The page has registered its close handler, so a close can wait for its save.
    ready: bool,
    pending: Option<String>,
    install_on_quit: bool,
    quitting: bool,
    tray_hint_shown: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

struct TrayItems {
    open_at_login: Option<CheckMenuItem<tauri::Wry>>,
    notices: CheckMenuItem<tauri::Wry>,
    close_to_tray: CheckMenuItem<tauri::Wry>,
}

struct App {
    root: PathBuf,
    data: PathBuf,
    /// An installed copy, not a source checkout or a check run on a scratch
    /// profile. Only this one registers itself with Windows.
    packaged: bool,
    origin: String,
    launch: launch::GameLaunch,
    prefs: presence::PreferenceFile,
    watcher: Mutex<Option<presence::GameWatcher>>,
    update_paths: update::Paths,
    latest_release: Mutex<Option<Value>>,
    downloading: tokio::sync::Mutex<()>,
    close: Mutex<CloseState>,
    /// Game id to when it was reported starting. Only these may show a notice.
    started_games: Mutex<HashMap<String, Instant>>,
    /// The last size and place of the window while it was neither maximized nor minimized.
    bounds: Mutex<Option<Bounds>>,
    tray: Mutex<Option<TrayItems>>,
    /// The page zoom picked with Ctrl and + or -, kept across launches.
    zoom: Mutex<f64>,
}

impl App {
    fn bounds_file(&self) -> PathBuf {
        self.data.join("desktop-window.json")
    }

    fn zoom_file(&self) -> PathBuf {
        self.data.join("desktop-zoom.json")
    }

    fn presence_state(&self) -> Value {
        let prefs = self.prefs.get();
        json!({
            "openAtLogin": prefs.open_at_login,
            "closeToTray": prefs.close_to_tray,
            "gameStartNotices": prefs.game_start_notices,
            "canStartWithWindows": self.packaged,
            "gameWatch": cfg!(windows),
        })
    }
}

// ---------------------------------------------------------------------------
// Windows helpers
// ---------------------------------------------------------------------------

/// Opens a file, program or link the way a double-click would.
#[cfg(windows)]
pub fn shell_open(target: &str) -> bool {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (verb, file) = (wide("open"), wide(target));
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    result as isize > 32
}

#[cfg(not(windows))]
pub fn shell_open(_target: &str) -> bool {
    false
}

/// A message box for failures before the window exists. A check run
/// (MEMORIA_INSTANCE) has nobody to press OK, so it only logs.
fn fatal(message: &str) -> ! {
    eprintln!("Memoria could not start: {message}");
    #[cfg(windows)]
    if std::env::var_os("MEMORIA_INSTANCE").is_none() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        let (text, title) = (wide(message), wide("Memoria could not start"));
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR,
            )
        };
    }
    std::process::exit(1);
}

/// Game source links may open outside the app, but never a local handler.
pub fn external_url(value: &str) -> Option<String> {
    if value.len() > 4096 {
        return None;
    }
    let url = tauri::Url::parse(value).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?.to_ascii_lowercase();
    let numeric = host.split('.').count() == 4 && host.split('.').all(|part| part.parse::<u8>().is_ok());
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.starts_with('[')
        || numeric
        || !host.contains('.')
    {
        return None;
    }
    Some(url.to_string())
}

/// Places a saved window on the display it overlaps most, or centres a new one.
fn window_bounds(saved: Option<Bounds>, areas: &[Bounds]) -> Bounds {
    let fallback = Bounds {
        x: 0,
        y: 0,
        width: 1280,
        height: 900,
    };
    let valid = saved.filter(|b| (360..=10000).contains(&b.width) && (320..=10000).contains(&b.height));
    let overlap = |area: &Bounds| -> i64 {
        let Some(b) = valid else { return 0 };
        let w = (b.x + b.width as i32).min(area.x + area.width as i32) - b.x.max(area.x);
        let h = (b.y + b.height as i32).min(area.y + area.height as i32) - b.y.max(area.y);
        (w.max(0) as i64) * (h.max(0) as i64)
    };
    let area = areas
        .iter()
        .copied()
        .max_by_key(overlap)
        .filter(|_| !areas.is_empty())
        .unwrap_or(fallback);
    let area = if valid.is_some() && overlap(&area) > 0 {
        area
    } else {
        areas.first().copied().unwrap_or(fallback)
    };
    let restore = valid.filter(|_| overlap(&area) > 0);
    let width = area.width.min(restore.map_or(1280, |b| b.width).max(360));
    let height = area.height.min(restore.map_or(900, |b| b.height).max(480));
    let (x, y) = match restore {
        Some(b) => (
            b.x.clamp(area.x, area.x + area.width as i32 - width as i32),
            b.y.clamp(area.y, area.y + area.height as i32 - height as i32),
        ),
        None => (
            area.x + (area.width - width) as i32 / 2,
            area.y + (area.height - height) as i32 / 2,
        ),
    };
    Bounds { x, y, width, height }
}

fn monitor_areas(app: &AppHandle) -> Vec<Bounds> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let area = m.work_area();
            Bounds {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        })
        .filter(|b| b.width > 0 && b.height > 0)
        .collect()
}

#[cfg(windows)]
fn set_open_at_login(enabled: bool) {
    use winreg::enums::HKEY_CURRENT_USER;
    let Ok((run, _)) =
        winreg::RegKey::predef(HKEY_CURRENT_USER).create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
    else {
        return;
    };
    // The Electron build registered as electron.app.Memoria. One entry is enough.
    let _ = run.delete_value("electron.app.Memoria");
    if enabled {
        if let Ok(exe) = std::env::current_exe() {
            let _ = run.set_value("Memoria", &format!("\"{}\"", exe.display()));
        }
    } else {
        let _ = run.delete_value("Memoria");
    }
}

#[cfg(not(windows))]
fn set_open_at_login(_enabled: bool) {}

/// Windows shows an installed copy's notices under Memoria's own name and icon.
#[cfg(windows)]
fn register_notice_identity(root: &Path) {
    use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    use winreg::enums::HKEY_CURRENT_USER;
    let id: Vec<u16> = APP_ID.encode_utf16().chain(Some(0)).collect();
    unsafe { SetCurrentProcessExplicitAppUserModelID(id.as_ptr()) };
    if let Ok((key, _)) =
        winreg::RegKey::predef(HKEY_CURRENT_USER).create_subkey(format!(r"Software\Classes\AppUserModelId\{APP_ID}"))
    {
        let _ = key.set_value("DisplayName", &"Memoria");
        let _ = key.set_value(
            "IconUri",
            &root.join("desktop").join("memoria.ico").display().to_string(),
        );
    }
}

#[cfg(not(windows))]
fn register_notice_identity(_root: &Path) {}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

/// Delivers an event to the page's `memoriaDesktop` listeners.
fn emit(app: &AppHandle, channel: &str, payload: Value) {
    if let Some(window) = main_window(app) {
        let script = format!(
            "window.__memoriaDesktopEmit && window.__memoriaDesktopEmit({}, {})",
            json!(channel),
            payload
        );
        let _ = window.eval(script);
    }
}

/// A window hidden in the tray stops painting and lets WebView2 give memory
/// back; the page keeps running so sync and game notices still work.
fn set_background(window: &WebviewWindow, background: bool) {
    #[cfg(windows)]
    let _ = window.with_webview(move |webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;
        let controller = webview.controller();
        let _ = controller.SetIsVisible(!background);
        if let Ok(core) = controller
            .CoreWebView2()
            .and_then(|core| core.cast::<ICoreWebView2_19>())
        {
            let _ = core.SetMemoryUsageTargetLevel(if background {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            });
        }
    });
    #[cfg(not(windows))]
    let _ = (window, background);
}

fn focus_window(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        set_background(&window, false);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_notice(app: &AppHandle, title: &str, body: &str, on_click: Option<Box<dyn Fn() + Send>>) {
    #[cfg(windows)]
    {
        use tauri_winrt_notification::Toast;
        let state = app.state::<App>();
        let id = if state.packaged {
            APP_ID
        } else {
            Toast::POWERSHELL_APP_ID
        };
        let mut toast = Toast::new(id).title(title).text1(body);
        if let Some(click) = on_click {
            toast = toast.on_activated(move |_| {
                click();
                Ok(())
            });
        }
        let _ = toast.show();
    }
    #[cfg(not(windows))]
    {
        let _ = (app, title, body, on_click);
    }
}

/// A native message box over the window. Shown off the event loop so it never stalls it.
fn message(app: &AppHandle, kind: MessageDialogKind, title: &str, text: &str) {
    let (window, title, text) = (main_window(app), title.to_string(), text.to_string());
    std::thread::spawn(move || {
        let mut dialog = rfd::MessageDialog::new()
            .set_level(kind)
            .set_title(title)
            .set_description(text)
            .set_buttons(rfd::MessageButtons::Ok);
        if let Some(window) = &window {
            dialog = dialog.set_parent(window);
        }
        dialog.show();
    });
}

fn save_bounds(app: &AppHandle) {
    let state = app.state::<App>();
    let maximized = main_window(app).and_then(|w| w.is_maximized().ok()).unwrap_or(false);
    let saved = *state.bounds.lock().unwrap();
    if let Some(b) = saved {
        let _ = store::write_json(
            &state.bounds_file(),
            &json!({ "x": b.x, "y": b.y, "width": b.width, "height": b.height, "maximized": maximized, "physical": true }),
        );
    }
}

fn record_bounds(window: &WebviewWindow) {
    if window.is_maximized().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return;
    }
    if let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) {
        if size.width > 0 && size.height > 0 {
            *window.state::<App>().bounds.lock().unwrap() = Some(Bounds {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            });
        }
    }
}

/// Asks the page to save, then quits once it confirms.
fn request_close(app: &AppHandle) {
    let state = app.state::<App>();
    let id = {
        let mut close = state.close.lock().unwrap();
        if close.pending.is_some() || close.quitting {
            return;
        }
        if !close.ready {
            close.quitting = true;
            drop(close);
            save_bounds(app);
            app.exit(0);
            return;
        }
        let id = store::new_token();
        close.pending = Some(id.clone());
        id
    };
    focus_window(app);
    emit(app, "memoria:close-request", json!(id));
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        let state = handle.state::<App>();
        let timed_out = {
            let mut close = state.close.lock().unwrap();
            if close.pending.as_deref() == Some(id.as_str()) {
                close.pending = None;
                close.install_on_quit = false;
                true
            } else {
                false
            }
        };
        if timed_out {
            message(
                &handle,
                MessageDialogKind::Warning,
                "Memoria is still saving",
                "Memoria could not confirm that your changes were saved. Keep the app open, then try closing it again.",
            );
        }
    });
}

/// Closing the window hides it while Memoria keeps watching for games and syncing.
fn hide_to_tray(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        let _ = window.hide();
        set_background(&window, true);
    }
    let state = app.state::<App>();
    let first = {
        let mut close = state.close.lock().unwrap();
        !std::mem::replace(&mut close.tray_hint_shown, true)
    };
    if first {
        show_notice(
            app,
            "Memoria is still running",
            "It stays in the tray. Right-click its icon to quit.",
            None,
        );
    }
}

fn apply_preferences(app: &AppHandle) {
    let state = app.state::<App>();
    let prefs = state.prefs.get();
    if state.packaged {
        set_open_at_login(prefs.open_at_login);
    }
    if let Some(watcher) = state.watcher.lock().unwrap().as_ref() {
        if cfg!(windows) && prefs.game_start_notices {
            watcher.start();
        } else {
            watcher.stop();
        }
    }
    if let Some(items) = state.tray.lock().unwrap().as_ref() {
        if let Some(item) = &items.open_at_login {
            let _ = item.set_checked(prefs.open_at_login);
        }
        let _ = items.notices.set_checked(prefs.game_start_notices);
        let _ = items.close_to_tray.set_checked(prefs.close_to_tray);
    }
    emit(app, "memoria:presence-changed", state.presence_state());
}

fn allow_phone_sync(app: &AppHandle) {
    let script = app.state::<App>().root.join("desktop").join("Enable-Phone-Sync.ps1");
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut command = std::process::Command::new("powershell.exe");
        command
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&script);
        update::hide_console(&mut command);
        let (kind, text) = match command.status() {
            Ok(status) if status.success() => (
                MessageDialogKind::Info,
                "Windows now allows your phone to connect to Memoria on this local network.",
            ),
            Ok(_) => (
                MessageDialogKind::Warning,
                "Windows did not allow the network change. Approve the administrator prompt to enable phone sync.",
            ),
            Err(_) => (MessageDialogKind::Error, "Windows could not open the network setup."),
        };
        message(&handle, kind, "Memoria phone sync", text);
    });
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<App>();
    let prefs = state.prefs.get();
    let open = MenuItem::with_id(app, "open", "Open Memoria", true, None::<&str>)?;
    let login = if state.packaged {
        Some(CheckMenuItem::with_id(
            app,
            "login",
            "Start with Windows",
            true,
            prefs.open_at_login,
            None::<&str>,
        )?)
    } else {
        None
    };
    let notices = CheckMenuItem::with_id(
        app,
        "notices",
        "Notify when a game starts",
        true,
        prefs.game_start_notices,
        None::<&str>,
    )?;
    let keep = CheckMenuItem::with_id(
        app,
        "tray",
        "Keep running when closed",
        true,
        prefs.close_to_tray,
        None::<&str>,
    )?;
    let phone = MenuItem::with_id(app, "phone", "Allow phone sync through Windows", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "updates", "Check for updates", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "About Memoria", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Memoria", true, None::<&str>)?;
    let menu = Menu::new(app)?;
    menu.append(&open)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if let Some(login) = &login {
        menu.append(login)?;
    }
    menu.append(&notices)?;
    menu.append(&keep)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&phone)?;
    menu.append(&updates)?;
    menu.append(&about)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&quit)?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Memoria")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let state = app.state::<App>();
            match event.id().as_ref() {
                "open" => focus_window(app),
                "login" => {
                    let flag = !state.prefs.get().open_at_login;
                    state.prefs.set(&json!({ "openAtLogin": flag }));
                    apply_preferences(app);
                }
                "notices" => {
                    let flag = !state.prefs.get().game_start_notices;
                    state.prefs.set(&json!({ "gameStartNotices": flag }));
                    apply_preferences(app);
                }
                "tray" => {
                    let flag = !state.prefs.get().close_to_tray;
                    state.prefs.set(&json!({ "closeToTray": flag }));
                    apply_preferences(app);
                }
                "phone" => allow_phone_sync(app),
                "updates" => {
                    focus_window(app);
                    emit(app, "memoria:show-updates", Value::Null);
                }
                "about" => message(
                    app,
                    MessageDialogKind::Info,
                    "Memoria",
                    "Memoria for Windows\nYour games, saved on this PC.\nPhone sync is available while Memoria is running.",
                ),
                "quit" => request_close(app),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                focus_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    *state.tray.lock().unwrap() = Some(TrayItems {
        open_at_login: login,
        notices,
        close_to_tray: keep,
    });
    Ok(())
}

fn create_window(app: &AppHandle, token: &str) -> tauri::Result<()> {
    let state = app.state::<App>();
    let origin = state.origin.clone();
    let script = include_str!("bridge.js")
        .replace("__ORIGIN__", &json!(origin).to_string())
        .replace("__TOKEN__", &json!(token).to_string());
    let url: tauri::Url = format!("{origin}/").parse().expect("loopback URL");
    let nav_origin = origin.clone();
    let shown = Arc::new(Mutex::new(false));
    let window = tauri::WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(url))
        .title("Memoria")
        .min_inner_size(360.0, 480.0)
        .visible(false)
        .background_color(tauri::window::Color(16, 16, 21, 255))
        .data_directory(state.data.join("webview"))
        .initialization_script(&script)
        .on_navigation(move |url| {
            if url.origin().ascii_serialization() == nav_origin {
                return true;
            }
            if let Some(external) = external_url(url.as_str()) {
                shell_open(&external);
            }
            false
        })
        .on_new_window(|url, _| {
            if let Some(external) = external_url(url.as_str()) {
                shell_open(&external);
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |window, payload| match payload.event() {
            // A reload or navigation starts a page that has not registered its close handler yet.
            PageLoadEvent::Started => window.state::<App>().close.lock().unwrap().ready = false,
            PageLoadEvent::Finished => {
                let mut shown = shown.lock().unwrap();
                if !*shown {
                    *shown = true;
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build()?;

    let saved = store::read_json(&state.bounds_file());
    let saved_bounds = saved.as_ref().filter(|v| v["physical"] == true).and_then(|v| {
        Some(Bounds {
            x: v["x"].as_i64()? as i32,
            y: v["y"].as_i64()? as i32,
            width: v["width"].as_u64()? as u32,
            height: v["height"].as_u64()? as u32,
        })
    });
    let bounds = window_bounds(saved_bounds, &monitor_areas(app));
    let _ = window.set_size(PhysicalSize::new(bounds.width, bounds.height));
    let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
    *state.bounds.lock().unwrap() = Some(bounds);
    if saved.as_ref().is_some_and(|v| v["maximized"] == true) {
        let _ = window.maximize();
    }
    let zoom = store::read_json(&state.zoom_file())
        .and_then(|v| v["zoom"].as_f64())
        .map_or(1.0, |zoom| zoom_step(zoom, 0));
    *state.zoom.lock().unwrap() = zoom;
    if zoom != 1.0 {
        let _ = window.set_zoom(zoom);
    }

    let handle = app.clone();
    let tracked = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            let state = handle.state::<App>();
            if state.close.lock().unwrap().quitting {
                return;
            }
            api.prevent_close();
            let pending = state.close.lock().unwrap().pending.is_some();
            if state.prefs.get().close_to_tray && !pending {
                save_bounds(&handle);
                hide_to_tray(&handle);
            } else {
                request_close(&handle);
            }
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => record_bounds(&tracked),
        _ => {}
    });
    Ok(())
}

/// The zoom levels Ctrl and + or - step through, as in a browser.
const ZOOM_LEVELS: [f64; 11] = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];

/// The level `step` places away from `current`. Zero snaps to the nearest level;
/// a step past either end stays at that end.
fn zoom_step(current: f64, step: i32) -> f64 {
    let nearest = ZOOM_LEVELS
        .iter()
        .enumerate()
        .min_by(|a, b| (a.1 - current).abs().total_cmp(&(b.1 - current).abs()))
        .map_or(5, |(index, _)| index);
    let index = (nearest as i32 + step).clamp(0, ZOOM_LEVELS.len() as i32 - 1);
    ZOOM_LEVELS[index as usize]
}

// ---------------------------------------------------------------------------
// Commands the page calls through `memoriaDesktop`
// ---------------------------------------------------------------------------

/// Ctrl and +, - or 0 in the window. `step` is 1 or -1, or 0 to reset to 100%.
#[tauri::command]
fn set_zoom(webview: tauri::Webview, state: tauri::State<'_, App>, step: i32) -> CommandResult<f64> {
    trusted(&webview, &state)?;
    let mut zoom = state.zoom.lock().unwrap();
    let next = if step == 0 {
        1.0
    } else {
        zoom_step(*zoom, step.signum())
    };
    webview.set_zoom(next).map_err(|error| error.to_string())?;
    *zoom = next;
    let _ = store::write_json(&state.zoom_file(), &json!({ "zoom": next }));
    Ok(next)
}

type CommandResult<T> = Result<T, String>;

/// Only the app's own page in the main window may call these.
fn trusted(webview: &tauri::Webview, state: &App) -> CommandResult<()> {
    let same = webview.label() == MAIN
        && webview
            .url()
            .map(|u| u.origin().ascii_serialization() == state.origin)
            .unwrap_or(false);
    let quitting = state.close.lock().unwrap().quitting;
    if same && !quitting {
        Ok(())
    } else {
        Err("This action is only available in Memoria.".into())
    }
}

#[tauri::command]
fn launch_list(webview: tauri::Webview, state: tauri::State<'_, App>) -> CommandResult<Value> {
    trusted(&webview, &state)?;
    Ok(state.launch.list())
}

#[tauri::command]
async fn launch_choose(app: AppHandle, webview: tauri::Webview, game_id: String) -> CommandResult<Value> {
    let state = app.state::<App>();
    trusted(&webview, &state)?;
    let window = main_window(&app);
    // The only source of a launch path: a file the player picks in a native dialog.
    let picked = tokio::task::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new()
            .set_title("Choose the game or its launcher")
            .add_filter("Programs and shortcuts", &launch::LAUNCH_EXTENSIONS);
        if let Some(window) = &window {
            dialog = dialog.set_parent(window);
        }
        dialog.pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    state.launch.choose(&game_id, picked)
}

#[tauri::command]
fn launch_clear(webview: tauri::Webview, state: tauri::State<'_, App>, game_id: String) -> CommandResult<Value> {
    trusted(&webview, &state)?;
    state.launch.clear(&game_id)
}

#[tauri::command]
fn launch_start(webview: tauri::Webview, state: tauri::State<'_, App>, game_id: String) -> CommandResult<Value> {
    trusted(&webview, &state)?;
    state.launch.start(&game_id)
}

#[tauri::command]
async fn update_check(app: AppHandle, webview: tauri::Webview) -> CommandResult<Value> {
    let state = app.state::<App>();
    trusted(&webview, &state)?;
    let installed = update::release_record(&state.root).and_then(|r| r["version"].as_str().map(str::to_string));
    let release = update::fetch_latest_release(installed.as_deref()).await?;
    *state.latest_release.lock().unwrap() = release.clone();
    let _ = store::write_json(
        &state.update_paths.last_check,
        &json!({ "checkedAt": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }),
    );
    Ok(json!({
        "installed": installed,
        "release": release,
        "staged": update::staged_version(&state.root, &state.update_paths),
    }))
}

#[tauri::command]
async fn update_download(app: AppHandle, webview: tauri::Webview) -> CommandResult<Value> {
    let state = app.state::<App>();
    trusted(&webview, &state)?;
    let release = state
        .latest_release
        .lock()
        .unwrap()
        .clone()
        .ok_or("Check for updates first.")?;
    // One download at a time. A second request waits and then finds it staged.
    let _one = state.downloading.lock().await;
    let last = Mutex::new(Instant::now() - Duration::from_secs(1));
    let handle = app.clone();
    update::stage_release(&state.root, &state.update_paths, &release, move |received, total| {
        let mut last = last.lock().unwrap();
        if last.elapsed() >= Duration::from_millis(200) {
            *last = Instant::now();
            emit(
                &handle,
                "memoria:update-progress",
                json!({ "received": received, "total": total }),
            );
        }
    })
    .await
}

#[tauri::command]
fn update_install(app: AppHandle, webview: tauri::Webview) -> CommandResult<bool> {
    let state = app.state::<App>();
    trusted(&webview, &state)?;
    if update::staged_version(&state.root, &state.update_paths).is_none() {
        return Err("Download the update first.".into());
    }
    state.close.lock().unwrap().install_on_quit = true;
    request_close(&app);
    Ok(true)
}

#[tauri::command]
fn presence_get(webview: tauri::Webview, state: tauri::State<'_, App>) -> CommandResult<Value> {
    trusted(&webview, &state)?;
    Ok(state.presence_state())
}

#[tauri::command]
fn presence_set(app: AppHandle, webview: tauri::Webview, changes: Value) -> CommandResult<Value> {
    let state = app.state::<App>();
    trusted(&webview, &state)?;
    state.prefs.set(&changes);
    apply_preferences(&app);
    Ok(state.presence_state())
}

#[tauri::command]
fn games_watch(webview: tauri::Webview, state: tauri::State<'_, App>, games: Value) -> CommandResult<bool> {
    trusted(&webview, &state)?;
    if let Some(watcher) = state.watcher.lock().unwrap().as_ref() {
        watcher.set_watch(&games);
    }
    Ok(true)
}

#[tauri::command]
fn game_notify(app: AppHandle, webview: tauri::Webview, notice: Value) -> CommandResult<bool> {
    let state = app.state::<App>();
    trusted(&webview, &state)?;
    let game_id = notice["gameId"].as_str().unwrap_or("").to_string();
    // Only a game the watcher just reported can show a notice, once.
    let reported = state.started_games.lock().unwrap().remove(&game_id);
    if !reported.is_some_and(|at| at.elapsed() < Duration::from_secs(60)) {
        return Ok(false);
    }
    let text = |key: &str, max: usize| notice[key].as_str().unwrap_or("").chars().take(max).collect::<String>();
    let title = Some(text("title", 100))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Memoria".into());
    let handle = app.clone();
    show_notice(
        &app,
        &title,
        &text("body", 250),
        Some(Box::new(move || {
            focus_window(&handle);
            emit(&handle, "memoria:open-game", json!(game_id));
        })),
    );
    Ok(true)
}

#[tauri::command]
fn renderer_ready(webview: tauri::Webview, state: tauri::State<'_, App>) -> CommandResult<()> {
    trusted(&webview, &state)?;
    state.close.lock().unwrap().ready = true;
    Ok(())
}

#[tauri::command]
fn close_result(
    app: AppHandle,
    webview: tauri::Webview,
    request_id: String,
    allow: bool,
    error: Option<String>,
) -> CommandResult<()> {
    let state = app.state::<App>();
    trusted(&webview, &state)?;
    {
        let mut close = state.close.lock().unwrap();
        if close.pending.as_deref() != Some(request_id.as_str()) {
            return Ok(());
        }
        close.pending = None;
        if allow {
            // The page has checked its drafts and awaited both storage layers.
            close.quitting = true;
        } else {
            // A refused close also cancels the install it was asked for.
            close.install_on_quit = false;
        }
    }
    if allow {
        save_bounds(&app);
        app.exit(0);
    } else if let Some(error) = error.filter(|e| !e.is_empty()) {
        message(&app, MessageDialogKind::Warning, "Keep Memoria open", &error);
    }
    Ok(())
}

#[tauri::command]
fn open_external(webview: tauri::Webview, state: tauri::State<'_, App>, url: String) -> CommandResult<()> {
    trusted(&webview, &state)?;
    let url = external_url(&url).ok_or("This link cannot be opened.")?;
    if shell_open(&url) {
        Ok(())
    } else {
        Err("Windows could not open this link.".into())
    }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/// The install folder, or the source checkout when running a development build.
fn install_root() -> (PathBuf, bool) {
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        if dir.join("release.json").is_file() {
            return (dir, true);
        }
    }
    if let Some(root) = std::env::var_os("MEMORIA_ROOT") {
        return (PathBuf::from(root), false);
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    (
        manifest
            .parent()
            .and_then(Path::parent)
            .map(Path::to_path_buf)
            .unwrap_or(manifest),
        false,
    )
}

/// True when another copy with this app id already runs. Checked before
/// anything binds a port, so a second start only hands off and exits.
#[cfg(windows)]
fn already_running(identifier: &str) -> bool {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    let name: Vec<u16> = format!(r"Local\{identifier}.running")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    // The handle is kept for the life of the process; Windows frees it on exit.
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    !handle.is_null() && unsafe { GetLastError() } == ERROR_ALREADY_EXISTS
}

#[cfg(not(windows))]
fn already_running(_identifier: &str) -> bool {
    false
}

fn main() {
    let mut context = tauri::generate_context!();
    // A check run against a scratch data folder must not hand off to the
    // player's own running copy, which shares the app id.
    if let Ok(instance) = std::env::var("MEMORIA_INSTANCE") {
        if !instance.is_empty() && instance.len() <= 32 && instance.bytes().all(|b| b.is_ascii_alphanumeric()) {
            let id = format!("{}.{instance}", context.config().identifier);
            context.config_mut().identifier = id;
        }
    }
    if already_running(&context.config().identifier) {
        // The single-instance plugin tells the open copy to show itself, then exits.
        let _ = tauri::Builder::default()
            .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
            .build(context);
        return;
    }

    let (root, installed) = install_root();
    // A check run (MEMORIA_INSTANCE) acts like a checkout: it never writes to
    // the registry that the player's own copy uses.
    let packaged = installed && std::env::var_os("MEMORIA_INSTANCE").is_none();
    let data = store::data_dir();
    if let Err(error) = store::migrate_legacy_data(&data).and_then(|_| std::fs::create_dir_all(&data)) {
        fatal(&format!(
            "The data folder {} could not be prepared: {error}",
            data.display()
        ));
    }
    // A test or a second profile may pin the ports.
    let ports: Vec<u16> = std::env::var("MEMORIA_PORTS")
        .ok()
        .map(|v| v.split(',').filter_map(|p| p.trim().parse().ok()).collect())
        .filter(|v: &Vec<u16>| !v.is_empty())
        .unwrap_or_else(|| server::PORTS.to_vec());
    let lan_port = std::env::var("MEMORIA_LAN_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(lan::LAN_PORT);

    let (changes, _) = broadcast::channel(16);
    let core = core::Core::start(data.join("state.json"), changes.clone());
    let _state_watcher = store::watch_state_file(&data, changes.clone());
    let lan = lan::Lan::new(data.clone(), core.clone(), lan_port);
    let token = store::new_token();
    let listener = tauri::async_runtime::block_on(server::bind(&ports)).unwrap_or_else(|error| fatal(&error));
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(ports[0]);
    let server = server::Server::new(
        port,
        root.clone(),
        root.join("app").join("dist"),
        token.clone(),
        core,
        lan.clone(),
        changes,
        update::Paths::new(&data),
    )
    .unwrap_or_else(|error| fatal(&error));
    let origin = server.origin();
    Arc::new(server).serve(listener);
    // The user's choice survives restarts. A bind failure does not block local work.
    tauri::async_runtime::spawn(async move { lan.restore().await });

    let state = App {
        root: root.clone(),
        data: data.clone(),
        packaged,
        origin,
        launch: launch::GameLaunch::new(&data),
        prefs: presence::PreferenceFile::new(&data),
        watcher: Mutex::new(None),
        update_paths: update::Paths::new(&data),
        latest_release: Mutex::new(None),
        downloading: tokio::sync::Mutex::new(()),
        close: Mutex::new(CloseState::default()),
        started_games: Mutex::new(HashMap::new()),
        bounds: Mutex::new(None),
        tray: Mutex::new(None),
        zoom: Mutex::new(1.0),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| focus_window(app)))
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            set_zoom,
            launch_list,
            launch_choose,
            launch_clear,
            launch_start,
            update_check,
            update_download,
            update_install,
            presence_get,
            presence_set,
            games_watch,
            game_notify,
            renderer_ready,
            close_result,
            open_external,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let state = handle.state::<App>();
            if state.packaged {
                register_notice_identity(&state.root);
            }
            let notices = handle.clone();
            *state.watcher.lock().unwrap() = Some(presence::GameWatcher::new(move |game_id| {
                let state = notices.state::<App>();
                if !state.close.lock().unwrap().ready || !state.prefs.get().game_start_notices {
                    return;
                }
                state
                    .started_games
                    .lock()
                    .unwrap()
                    .insert(game_id.clone(), Instant::now());
                emit(&notices, "memoria:game-started", json!(game_id));
            }));
            create_window(&handle, &token)?;
            create_tray(&handle)?;
            apply_preferences(&handle);
            Ok(())
        })
        .build(context)
        .unwrap_or_else(|error| fatal(&error.to_string()));

    app.run(|app, event| match event {
        RunEvent::ExitRequested { code: None, api, .. } => {
            // Only an explicit quit ends Memoria; the window never closes on its own.
            if !app.state::<App>().close.lock().unwrap().quitting {
                api.prevent_exit();
            }
        }
        RunEvent::Exit => {
            let state = app.state::<App>();
            if let Some(watcher) = state.watcher.lock().unwrap().as_ref() {
                watcher.stop();
            }
            let install = std::mem::take(&mut state.close.lock().unwrap().install_on_quit);
            if install {
                let _ = update::run_staged_installer(&state.root, &state.update_paths);
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_steps_through_browser_levels() {
        assert_eq!(zoom_step(1.0, 1), 1.1);
        assert_eq!(zoom_step(1.0, -1), 0.9);
        assert_eq!(zoom_step(0.5, -1), 0.5);
        assert_eq!(zoom_step(2.0, 1), 2.0);
        // A hand-edited or old value snaps to the nearest level first.
        assert_eq!(zoom_step(1.3, 0), 1.25);
        assert_eq!(zoom_step(9.0, 0), 2.0);
    }

    #[test]
    fn only_public_https_links_open_outside() {
        assert!(external_url("https://genshin.hoyoverse.com/en/news").is_some());
        for bad in [
            "http://example.com",
            "https://localhost/x",
            "https://192.168.1.1/",
            "https://user:pw@example.com/",
            "https://intranet/",
            "file:///C:/Windows",
        ] {
            assert!(external_url(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn windows_stay_on_screen() {
        let screen = Bounds {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let fresh = window_bounds(None, &[screen]);
        assert_eq!(
            fresh,
            Bounds {
                x: 320,
                y: 70,
                width: 1280,
                height: 900
            }
        );
        let saved = Bounds {
            x: 100,
            y: 50,
            width: 1000,
            height: 700,
        };
        assert_eq!(window_bounds(Some(saved), &[screen]), saved);
        // A window left on a monitor that is gone comes back to one that exists.
        let lost = Bounds {
            x: 4000,
            y: 50,
            width: 1000,
            height: 700,
        };
        assert_eq!(
            window_bounds(Some(lost), &[screen]),
            Bounds {
                x: 320,
                y: 70,
                width: 1280,
                height: 900
            }
        );
        let huge = Bounds {
            x: -50,
            y: 0,
            width: 3000,
            height: 2000,
        };
        let fitted = window_bounds(Some(huge), &[screen]);
        assert_eq!((fitted.width, fitted.height, fitted.x, fitted.y), (1920, 1040, 0, 0));
    }
}
