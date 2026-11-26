//! The one Memoria window's three faces: hidden in the tray, the full app, or
//! the quick card, a small floating card for one game's energy and dailies.
//!
//! The card is never a second window (a second WebView2 would double the
//! memory): the main window shrinks into it and comes back as it was, place,
//! size and maximized state included. `SurfaceMachine` is the pure state
//! behind that, so every move is tested without a window; the rest of this
//! file applies it to the real window and holds the card's global shortcut.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::locks::Locked;
use crate::{App, Bounds};

/// The card's size in logical pixels at 100% page zoom.
pub const CARD_WIDTH: f64 = 380.0;
pub const CARD_HEIGHT: f64 = 520.0;
/// The full window's minimum, as `create_window` sets it.
pub const FULL_MIN_WIDTH: f64 = 360.0;
pub const FULL_MIN_HEIGHT: f64 = 480.0;
/// The card's gap from the work area's corner on its first open, in logical pixels.
const CORNER_MARGIN: f64 = 16.0;
/// The quick card's id with `RegisterHotKey`; the capture shortcut's is `capture::HOTKEY_ID`.
pub const HOTKEY_ID: i32 = 2;
/// How long the page has to swap its view (and note its scroll) before the window changes size.
const PAGE_SWAP: Duration = Duration::from_millis(60);
/// How long a change of face suppresses bounds recording, so the moves and
/// resizes Windows reports for it never count as the player's own.
const SETTLE: Duration = Duration::from_millis(400);

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

/// The quick card, and what it takes to put the full window back.
#[derive(Clone, Debug, PartialEq)]
pub struct CompactCard {
    /// None: the page picks the most urgent game it tracks.
    pub game_id: Option<String>,
    /// Floats over other windows.
    pub pinned: bool,
    /// Opened by Memoria itself (a game closing), without taking focus.
    pub auto_opened: bool,
    /// The window was in the tray before the card, so dismissing goes back there.
    pub return_to_tray: bool,
    /// The full window was minimized in the taskbar before the card, so dismissing minimizes it again.
    pub was_minimized: bool,
    /// The full window was maximized, by Windows' own placement.
    pub was_maximized: bool,
    /// The full window's last place and size while neither maximized nor minimized.
    pub full_bounds: Option<Bounds>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Surface {
    Tray,
    Full,
    Compact(CompactCard),
}

/// Who asked for the card. Only the player's own asks take focus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Opener {
    Player,
    Auto,
}

/// Where the card goes when it is taken down.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Leave {
    Tray,
    Full,
    Minimized,
}

/// What entering asks of the window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Entered {
    /// The card was already up and now shows the asked-for game; the window stays as it is.
    Retargeted,
    /// Shrink the window into the card. The move settles with this generation.
    Shrink { generation: u64 },
}

/// What the window is showing, and whether it is still moving between faces.
pub struct SurfaceMachine {
    surface: Surface,
    /// A change of face is under way: the window's moves are not the player's.
    transitioning: bool,
    /// Bumped by each change of face, so a late step of an old one does nothing.
    generation: u64,
}

impl SurfaceMachine {
    /// `hidden`: started at sign-in, in the tray.
    pub fn new(hidden: bool) -> Self {
        Self {
            surface: if hidden { Surface::Tray } else { Surface::Full },
            transitioning: false,
            generation: 0,
        }
    }

    #[cfg(test)]
    pub fn surface(&self) -> &Surface {
        &self.surface
    }

    pub fn card(&self) -> Option<&CompactCard> {
        match &self.surface {
            Surface::Compact(card) => Some(card),
            _ => None,
        }
    }

    pub fn is_compact(&self) -> bool {
        self.card().is_some()
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// The full window's place may be recorded: settled, and not the card.
    pub fn records_full_bounds(&self) -> bool {
        !self.transitioning && !self.is_compact()
    }

    /// The card's own place may be recorded: settled in the card.
    pub fn records_card_bounds(&self) -> bool {
        !self.transitioning && self.is_compact()
    }

    /// Puts the card up for `game_id`, or points the card already up at it (a
    /// None keeps the game it shows). `visible`, `was_maximized` and `was_minimized`
    /// are the window's state as Windows reports it now.
    pub fn enter(
        &mut self,
        game_id: Option<String>,
        opener: Opener,
        pinned: bool,
        visible: bool,
        was_maximized: bool,
        was_minimized: bool,
        full_bounds: Option<Bounds>,
    ) -> Entered {
        if let Surface::Compact(card) = &mut self.surface {
            if game_id.is_some() {
                card.game_id = game_id;
            }
            // The player asking for a card Memoria opened makes it theirs.
            if opener == Opener::Player {
                card.auto_opened = false;
            }
            return Entered::Retargeted;
        }
        let return_to_tray = matches!(self.surface, Surface::Tray) || !visible;
        self.surface = Surface::Compact(CompactCard {
            game_id,
            pinned,
            auto_opened: opener == Opener::Auto,
            return_to_tray,
            was_minimized: visible && was_minimized,
            was_maximized,
            full_bounds,
        });
        Entered::Shrink {
            generation: self.begin(),
        }
    }

    /// Where dismissing the card goes (its close button, Escape, the shortcut,
    /// Windows' own close): back to the tray or taskbar it came from, or where
    /// closing the full window would go.
    pub fn dismiss_target(&self, close_to_tray: bool) -> Leave {
        match self.card() {
            Some(card) if card.return_to_tray => Leave::Tray,
            Some(card) if card.was_minimized => Leave::Minimized,
            Some(_) if close_to_tray => Leave::Tray,
            _ => Leave::Full,
        }
    }

    /// Takes the card down. Returns it, with the generation the move settles
    /// with, or None when no card was up.
    pub fn leave(&mut self, to: Leave) -> Option<(CompactCard, u64)> {
        let card = self.card()?.clone();
        self.surface = match to {
            Leave::Tray => Surface::Tray,
            Leave::Full | Leave::Minimized => Surface::Full,
        };
        Some((card, self.begin()))
    }

    fn begin(&mut self) -> u64 {
        self.transitioning = true;
        self.generation = self.generation.wrapping_add(1);
        self.generation
    }

    /// Ends the change of face `generation` started, unless another began since.
    pub fn settle(&mut self, generation: u64) -> bool {
        let current = generation == self.generation && self.transitioning;
        if current {
            self.transitioning = false;
        }
        current
    }

    /// The full window went into the tray. The card is left to `leave`.
    pub fn hidden(&mut self) {
        if !self.is_compact() {
            self.surface = Surface::Tray;
        }
    }

    /// The full window came on screen. The card is left to `leave`.
    pub fn shown(&mut self) {
        if !self.is_compact() {
            self.surface = Surface::Full;
        }
    }

    pub fn set_pinned(&mut self, pinned: bool) -> bool {
        match &mut self.surface {
            Surface::Compact(card) => {
                card.pinned = pinned;
                true
            }
            _ => false,
        }
    }

    /// What the page is told: the full app (in the tray or not) or the card.
    pub fn page_json(&self) -> Value {
        match self.card() {
            Some(card) => json!({
                "mode": "compact",
                "gameId": card.game_id,
                "pinned": card.pinned,
                "autoOpened": card.auto_opened,
            }),
            None => json!({ "mode": "full", "gameId": null, "pinned": false, "autoOpened": false }),
        }
    }
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/// The card's size in physical pixels. A page zoomed in gets a larger card,
/// so the same layout fits; zoomed out it stays at its own size.
pub fn card_size(scale: f64, zoom: f64) -> (u32, u32) {
    let factor = scale.max(0.5) * zoom.clamp(1.0, 3.0);
    (
        (CARD_WIDTH * factor).round() as u32,
        (CARD_HEIGHT * factor).round() as u32,
    )
}

/// Where the card goes: its saved place, clamped onto the display it overlaps
/// most, or the bottom-right corner of `home` (the work area the window is on)
/// the first time, or when its display is gone.
pub fn place_card(saved: Option<(i32, i32)>, size: (u32, u32), home: Bounds, areas: &[Bounds], margin: u32) -> Bounds {
    let fit = |area: &Bounds| (size.0.min(area.width), size.1.min(area.height));
    if let Some((x, y)) = saved {
        let card = Bounds {
            x,
            y,
            width: size.0,
            height: size.1,
        };
        if let Some(area) = crate::best_area(&card, areas) {
            let (width, height) = fit(&area);
            return Bounds {
                x: x.clamp(area.x, area.x + (area.width - width) as i32),
                y: y.clamp(area.y, area.y + (area.height - height) as i32),
                width,
                height,
            };
        }
    }
    let (width, height) = fit(&home);
    let (room_x, room_y) = (home.width - width, home.height - height);
    Bounds {
        x: home.x + (room_x - margin.min(room_x)) as i32,
        y: home.y + (room_y - margin.min(room_y)) as i32,
        width,
        height,
    }
}

const SW_SHOWMINIMIZED: u32 = 2;
const SW_SHOWMAXIMIZED: u32 = 3;
const WPF_RESTORETOMAXIMIZED: u32 = 2;

/// Whether a `GetWindowPlacement` answer means maximized: shown maximized, or
/// minimized from maximized, which would restore maximized.
pub fn placement_maximized(show_cmd: u32, flags: u32) -> bool {
    show_cmd == SW_SHOWMAXIMIZED || (show_cmd == SW_SHOWMINIMIZED && flags & WPF_RESTORETOMAXIMIZED != 0)
}

// ---------------------------------------------------------------------------
// Win32: what Tauri does not offer
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod win {
    use tauri::WebviewWindow;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GWL_STYLE, GetWindowLongW, GetWindowPlacement, SW_HIDE, SW_SHOWNOACTIVATE, SetWindowDisplayAffinity,
        SetWindowLongW, ShowWindow, WDA_EXCLUDEFROMCAPTURE, WDA_NONE, WINDOWPLACEMENT, WS_MAXIMIZE,
    };

    fn hwnd(window: &WebviewWindow) -> Option<HWND> {
        window.hwnd().ok().map(|handle| handle.0 as HWND)
    }

    /// Windows' own word on maximized, which it keeps while the window is
    /// hidden in the tray, where Tauri's may not.
    pub fn maximized(window: &WebviewWindow) -> Option<bool> {
        let hwnd = hwnd(window)?;
        // SAFETY: an out-parameter sized as the call requires, for our own window.
        let mut placement: WINDOWPLACEMENT = unsafe { std::mem::zeroed() };
        placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
        if unsafe { GetWindowPlacement(hwnd, &mut placement) } == 0 {
            return None;
        }
        Some(super::placement_maximized(placement.showCmd, placement.flags))
    }

    /// Drops the maximized style of a hidden window without showing it, so it
    /// never comes back stretched over the screen.
    pub fn clear_maximized(window: &WebviewWindow) {
        let Some(hwnd) = hwnd(window) else { return };
        // SAFETY: reads and writes our own window's style word.
        unsafe {
            let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
            if style & WS_MAXIMIZE != 0 {
                SetWindowLongW(hwnd, GWL_STYLE, (style & !WS_MAXIMIZE) as i32);
            }
        }
    }

    /// Shows the window where it is without activating it: a game or the app
    /// in front keeps the keyboard. Also restores a maximized window in place.
    pub fn show_inactive(window: &WebviewWindow) {
        if let Some(hwnd) = hwnd(window) {
            // SAFETY: a show command for our own window.
            unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE) };
        }
    }

    /// Hides the window even when Tauri believes it is hidden already (after `show_inactive`).
    pub fn hide(window: &WebviewWindow) {
        if let Some(hwnd) = hwnd(window) {
            // SAFETY: a show command for our own window.
            unsafe { ShowWindow(hwnd, SW_HIDE) };
        }
    }

    /// Excludes the quick card from screen capture so scanning a full-screen game
    /// never reads Memoria's own overlay next to the game HUD.
    pub fn set_capture_excluded(window: &WebviewWindow, excluded: bool) {
        if let Some(hwnd) = hwnd(window) {
            let affinity = if excluded { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
            // SAFETY: configures display affinity on our own top-level HWND.
            unsafe { SetWindowDisplayAffinity(hwnd, affinity) };
        }
    }
}

#[cfg(not(windows))]
mod win {
    use tauri::WebviewWindow;
    pub fn maximized(_: &WebviewWindow) -> Option<bool> {
        None
    }
    pub fn clear_maximized(_: &WebviewWindow) {}
    pub fn show_inactive(window: &WebviewWindow) {
        let _ = window.show();
    }
    pub fn hide(_: &WebviewWindow) {}
    pub fn set_capture_excluded(_: &WebviewWindow, _: bool) {}
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

/// Hides the main window. Win32's hide too: after `show_inactive` Tauri
/// believes the window is hidden already, and would leave it on screen.
pub fn hide_window(window: &WebviewWindow) {
    let _ = window.hide();
    win::hide(window);
}

/// Tells the page what it shows. `open_game`: the game the full app should turn to.
fn emit_surface(app: &AppHandle, open_game: Option<&str>) {
    let mut payload = app.state::<App>().surface.locked().page_json();
    if let Some(id) = open_game {
        payload["openGameId"] = json!(id);
    }
    crate::emit(app, "memoria:surface-changed", payload);
}

pub fn page_state(app: &AppHandle) -> Value {
    app.state::<App>().surface.locked().page_json()
}

/// Runs `step` on the main thread after `delay`, if no other change of face began meanwhile.
fn later(app: &AppHandle, delay: Duration, generation: u64, step: impl FnOnce(&AppHandle) + Send + 'static) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            if inner.state::<App>().surface.locked().generation() == generation {
                step(&inner);
            }
        });
    });
}

/// Once the window has stopped moving for a change of face, its place counts again.
fn settle_later(app: &AppHandle, generation: u64) {
    later(app, SETTLE, generation, move |app| {
        let state = app.state::<App>();
        let settled = state.surface.locked().settle(generation);
        if settled && let Some(window) = crate::main_window(app) {
            crate::record_bounds(&window);
        }
    });
}

/// A game id from the page or the watcher, or None when it is not one.
pub fn clean_game_id(game_id: Option<String>) -> Option<String> {
    game_id.filter(|id| !id.is_empty() && id.len() <= 160)
}

/// Puts the quick card up for `game_id` (None: the page picks). The player's
/// own asks bring it forward with focus; Memoria's own never take focus.
pub fn enter(app: &AppHandle, game_id: Option<String>, opener: Opener) {
    let Some(window) = crate::main_window(app) else { return };
    let state = app.state::<App>();
    let visible = window.is_visible().unwrap_or(false);
    let was_maximized = win::maximized(&window).unwrap_or_else(|| window.is_maximized().unwrap_or(false));
    let was_minimized = window.is_minimized().unwrap_or(false);
    let full_bounds = *state.bounds.locked();
    let pinned = state.prefs.get().compact_always_on_top;
    let entered = state.surface.locked().enter(
        clean_game_id(game_id),
        opener,
        pinned,
        visible,
        was_maximized,
        was_minimized,
        full_bounds,
    );
    // The page swaps to the card first, noting where it was, then the window shrinks.
    emit_surface(app, None);
    match entered {
        Entered::Retargeted => {
            if opener == Opener::Player {
                reveal(app, &window, true);
            }
        }
        Entered::Shrink { generation } => {
            later(app, PAGE_SWAP, generation, move |app| {
                shrink(app, generation, opener, visible)
            });
        }
    }
}

/// The window becomes the card: unmaximized first, then its size, place and
/// float, then on screen.
fn shrink(app: &AppHandle, generation: u64, opener: Opener, visible: bool) {
    let Some(window) = crate::main_window(app) else { return };
    let state = app.state::<App>();
    let Some(card) = state.surface.locked().card().cloned() else {
        return;
    };
    // Sized while maximized or minimized, Windows would keep the size for later
    // and bring the window back as it was: it comes out of either state first.
    if visible && (card.was_maximized || window.is_minimized().unwrap_or(false)) {
        // In place, without taking focus. The resize tells Tauri.
        win::show_inactive(&window);
    } else if card.was_maximized {
        // Hidden in the tray: only the style, so nothing comes on screen yet.
        win::clear_maximized(&window);
    }
    if card.was_maximized {
        let _ = window.unmaximize();
    }
    let bounds = card_bounds(app, &window);
    let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
    let _ = window.set_size(PhysicalSize::new(bounds.width, bounds.height));
    let _ = window.set_min_size(Some(PhysicalSize::new(bounds.width, bounds.height)));
    // A double-click on the card's bar, or Win+Up, would stretch it over the screen.
    let _ = window.set_maximizable(false);
    let _ = window.set_always_on_top(card.pinned);
    win::set_capture_excluded(&window, true);
    reveal(app, &window, opener == Opener::Player);
    settle_later(app, generation);
}

/// Brings the card on screen: with focus for the player, without it for Memoria.
fn reveal(app: &AppHandle, window: &WebviewWindow, focus: bool) {
    crate::set_background(window, false);
    if focus {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        app.state::<App>().inactive_reveal.store(false, Ordering::SeqCst);
        crate::arm_frame_fallback(app);
    } else {
        win::show_inactive(window);
        // Tauri still believes the window is hidden; the first focus puts that right.
        app.state::<App>().inactive_reveal.store(true, Ordering::SeqCst);
        crate::emit_window_state(app, Some(false));
    }
}

/// The scale factor of the monitor the saved card position overlaps most, falling back to `fallback`.
fn target_scale(saved: Option<(i32, i32)>, zoom: f64, fallback: f64, monitors: &[(Bounds, f64)]) -> f64 {
    let Some((x, y)) = saved else { return fallback };
    let probe = card_size(fallback, zoom);
    let card = Bounds {
        x,
        y,
        width: probe.0,
        height: probe.1,
    };
    monitors
        .iter()
        .filter(|(area, _)| crate::overlap(&card, area) > 0)
        .max_by_key(|(area, _)| crate::overlap(&card, area))
        .map(|(_, scale)| *scale)
        .unwrap_or(fallback)
}

/// The card's place and size for the window as it is now.
fn card_bounds(app: &AppHandle, window: &WebviewWindow) -> Bounds {
    let state = app.state::<App>();
    let zoom = *state.zoom.locked();
    let fallback_scale = window.scale_factor().unwrap_or(1.0);
    let monitors: Vec<(Bounds, f64)> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .filter_map(|monitor| {
            let area = monitor.work_area();
            let bounds = Bounds {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            };
            (bounds.width > 0 && bounds.height > 0).then(|| (bounds, monitor.scale_factor()))
        })
        .collect();
    let areas: Vec<Bounds> = monitors.iter().map(|(area, _)| *area).collect();
    let saved = state
        .compact_bounds
        .locked()
        .map(|b| (b.x, b.y))
        .or_else(|| saved_position(&state));
    let scale = target_scale(saved, zoom, fallback_scale, &monitors);
    let size = card_size(scale, zoom);
    let home = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            let area = monitor.work_area();
            Bounds {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        })
        .filter(|area| area.width > 0 && area.height > 0)
        .or_else(|| areas.first().copied())
        .unwrap_or(Bounds {
            x: 0,
            y: 0,
            width: size.0,
            height: size.1,
        });
    let margin = (CORNER_MARGIN * scale).round() as u32;
    place_card(saved, size, home, &areas, margin)
}

fn saved_position(state: &App) -> Option<(i32, i32)> {
    let saved = crate::store::read_json(&state.compact_file())?;
    if saved["physical"] != true {
        return None;
    }
    Some((saved["x"].as_i64()? as i32, saved["y"].as_i64()? as i32))
}

/// Keeps where the player left the card, apart from the full window's place.
pub fn save_card_position(app: &AppHandle) {
    let state = app.state::<App>();
    let placed = *state.compact_bounds.locked();
    if let Some(b) = placed {
        let _ = crate::store::write_json(&state.compact_file(), &json!({ "x": b.x, "y": b.y, "physical": true }));
    }
}

/// Takes the card down, into the tray or back to the full window as it was,
/// and tells the page, with the game to turn to if one was asked for. False
/// when no card was up.
pub fn leave(app: &AppHandle, to: Leave, open_game: Option<String>) -> bool {
    let state = app.state::<App>();
    let Some((card, generation)) = state.surface.locked().leave(to) else {
        return false;
    };
    save_card_position(app);
    if let Some(window) = crate::main_window(app) {
        if window.is_minimized().unwrap_or(false) {
            // Out of the taskbar first, or the full size would be kept for later.
            win::show_inactive(&window);
        }
        match to {
            Leave::Tray => {
                hide_window(&window);
                crate::set_background(&window, true);
            }
            Leave::Full => {
                crate::set_background(&window, false);
                // First, so Tauri knows it is on screen before it is maximized again.
                let _ = window.show();
            }
            Leave::Minimized => {
                crate::set_background(&window, false);
            }
        }
        let _ = window.set_always_on_top(false);
        win::set_capture_excluded(&window, false);
        let _ = window.set_maximizable(true);
        let _ = window.set_min_size(Some(LogicalSize::new(FULL_MIN_WIDTH, FULL_MIN_HEIGHT)));
        let bounds = crate::window_bounds(card.full_bounds, &crate::monitor_areas(app));
        let _ = window.set_size(PhysicalSize::new(bounds.width, bounds.height));
        let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
        if card.was_maximized {
            let _ = window.maximize();
        }
        if to == Leave::Minimized {
            let _ = window.minimize();
        }
        if to == Leave::Full {
            let _ = window.set_focus();
            state.inactive_reveal.store(false, Ordering::SeqCst);
            crate::arm_frame_fallback(app);
        }
    }
    // After the window has its size back, so the page restores its scroll against the full layout.
    let open = clean_game_id(open_game);
    later(app, PAGE_SWAP, generation, move |app| {
        emit_surface(app, open.as_deref())
    });
    settle_later(app, generation);
    true
}

/// Where `exitCompact` sends the card: the full app when a game is to be
/// opened or the full window is asked for, the tray when that is asked for,
/// else None, to dismiss it to where it came from.
pub fn exit_target(open_game: bool, to_tray: Option<bool>) -> Option<Leave> {
    match (open_game, to_tray) {
        (true, _) | (false, Some(false)) => Some(Leave::Full),
        (false, Some(true)) => Some(Leave::Tray),
        (false, None) => None,
    }
}

/// The card's close, Escape, the shortcut and Windows' own close.
pub fn dismiss(app: &AppHandle) -> bool {
    let to = {
        let state = app.state::<App>();
        let close_to_tray = state.prefs.get().close_to_tray;
        let machine = state.surface.locked();
        if !machine.is_compact() {
            return false;
        }
        machine.dismiss_target(close_to_tray)
    };
    leave(app, to, None)
}

/// Pins or unpins the card. The choice is kept for the next card too.
pub fn set_pinned(app: &AppHandle, pinned: bool) -> bool {
    let state = app.state::<App>();
    if !state.surface.locked().set_pinned(pinned) {
        return false;
    }
    if let Some(window) = crate::main_window(app) {
        let _ = window.set_always_on_top(pinned);
    }
    state.prefs.set(&json!({ "compactAlwaysOnTop": pinned }));
    emit_surface(app, None);
    true
}

/// The card for the game the player is on (the one in front, else running,
/// else the last one played), or for the page's own pick.
pub fn open_for_active_game(app: &AppHandle) {
    let game = app
        .state::<App>()
        .watcher
        .locked()
        .as_ref()
        .and_then(|watcher| watcher.active_game(Instant::now()));
    enter(app, game, Opener::Player);
}

/// The quick card shortcut: the card goes if it is up, and comes for the game in play if not.
fn toggle(app: &AppHandle) {
    if !dismiss(app) {
        open_for_active_game(app);
    }
}

/// A followed game closed after a real session: the card comes up for it,
/// without focus, unless the full app is already on screen.
pub fn pop_out_after(app: &AppHandle, game_id: String) {
    let Some(window) = crate::main_window(app) else { return };
    let state = app.state::<App>();
    let full_on_screen = !state.surface.locked().is_compact()
        && window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false);
    if full_on_screen {
        return;
    }
    enter(app, Some(game_id), Opener::Auto);
}

/// After `show_inactive` Tauri believes the window is hidden. The first focus
/// (the player clicking the card) tells it otherwise, so a later hide or show works.
pub fn focused(app: &AppHandle, window: &WebviewWindow) {
    if app.state::<App>().inactive_reveal.swap(false, Ordering::SeqCst) {
        let _ = window.show();
    }
}

// ---------------------------------------------------------------------------
// The quick card shortcut
// ---------------------------------------------------------------------------

/// Whether the card's shortcut is held by Memoria right now, and why not.
#[derive(Default)]
pub struct ShortcutRuntime {
    pub registered: bool,
    pub error: Option<String>,
}

/// Registers or releases the saved shortcut and records the outcome for the
/// presence state. Starts the shortcut thread the first time it is needed. Blocking, briefly.
#[cfg(windows)]
pub fn apply_shortcut(app: &AppHandle) {
    use crate::connectors::capture;
    let state = app.state::<App>();
    let prefs = state.prefs.get();
    let record = |registered: bool, error: Option<String>| {
        *state.compact_shortcut.locked() = ShortcutRuntime { registered, error };
    };
    let parsed = if prefs.compact_shortcut.is_empty() {
        None
    } else {
        match capture::parse_accelerator(&prefs.compact_shortcut) {
            Ok(parsed) => Some(parsed),
            Err(error) => return record(false, Some(error)),
        }
    };
    let wanted = parsed.filter(|_| prefs.compact_shortcut_enabled);
    let mut hotkey = state.compact_hotkey.locked();
    if hotkey.is_none() {
        if wanted.is_none() {
            return record(false, None);
        }
        let presser = app.clone();
        *hotkey = capture::Hotkey::start(HOTKEY_ID, move || {
            let app = presser.clone();
            let _ = presser.run_on_main_thread(move || toggle(&app));
        });
    }
    let Some(thread) = hotkey.as_ref() else {
        return record(false, Some("Memoria could not listen for the shortcut.".into()));
    };
    let held = wanted.is_some();
    match thread.set(wanted) {
        Ok(()) => record(held, None),
        Err(error) => record(false, Some(error)),
    }
}

#[cfg(not(windows))]
pub fn apply_shortcut(app: &AppHandle) {
    let state = app.state::<App>();
    let error = state
        .prefs
        .get()
        .compact_shortcut_enabled
        .then(|| "The quick card shortcut needs Windows.".to_string());
    *state.compact_shortcut.locked() = ShortcutRuntime {
        registered: false,
        error,
    };
}

/// Releases the shortcut at exit.
pub fn stop_shortcut(app: &AppHandle) {
    if let Some(thread) = app.state::<App>().compact_hotkey.locked().take() {
        thread.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULL: Bounds = Bounds {
        x: 100,
        y: 80,
        width: 1200,
        height: 800,
    };
    const SCREEN: Bounds = Bounds {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };

    fn entered(machine: &mut SurfaceMachine, opener: Opener, visible: bool, maximized: bool) -> Entered {
        machine.enter(Some("genshin".into()), opener, true, visible, maximized, false, Some(FULL))
    }

    #[test]
    fn full_to_card_and_back_keeps_the_full_window() {
        let mut machine = SurfaceMachine::new(false);
        assert_eq!(machine.surface(), &Surface::Full);
        assert!(machine.records_full_bounds());
        let Entered::Shrink { generation } = entered(&mut machine, Opener::Player, true, true) else {
            panic!("a new card shrinks the window");
        };
        let card = machine.card().unwrap().clone();
        assert_eq!(card.game_id.as_deref(), Some("genshin"));
        assert!(card.was_maximized && card.pinned && !card.auto_opened && !card.return_to_tray);
        assert_eq!(card.full_bounds, Some(FULL));
        // Nothing the window reports while it shrinks counts, as either place.
        assert!(!machine.records_full_bounds() && !machine.records_card_bounds());
        assert!(machine.settle(generation));
        assert!(machine.records_card_bounds() && !machine.records_full_bounds());
        assert_eq!(machine.page_json()["mode"], "compact");

        let (left, generation) = machine.leave(Leave::Full).unwrap();
        assert_eq!(left, card, "the full window comes back maximized, at its own place");
        assert_eq!(machine.surface(), &Surface::Full);
        assert!(
            !machine.records_full_bounds(),
            "the restore's own moves are not the player's"
        );
        assert!(machine.settle(generation));
        assert!(machine.records_full_bounds());
        assert_eq!(
            machine.page_json(),
            json!({ "mode": "full", "gameId": null, "pinned": false, "autoOpened": false })
        );
        assert!(machine.leave(Leave::Tray).is_none(), "no card, nothing to leave");
    }

    #[test]
    fn a_card_from_the_tray_goes_back_there() {
        let mut machine = SurfaceMachine::new(true);
        assert_eq!(machine.surface(), &Surface::Tray);
        entered(&mut machine, Opener::Auto, false, true);
        let card = machine.card().unwrap();
        assert!(card.return_to_tray && card.auto_opened && card.was_maximized);
        assert_eq!(machine.page_json()["autoOpened"], true);
        assert_eq!(machine.dismiss_target(false), Leave::Tray);
        machine.leave(Leave::Tray);
        assert_eq!(machine.surface(), &Surface::Tray);

        // From the full window, dismissing goes where closing the window would.
        machine.shown();
        entered(&mut machine, Opener::Player, true, false);
        assert_eq!(machine.dismiss_target(false), Leave::Full);
        assert_eq!(machine.dismiss_target(true), Leave::Tray);
        // A window hidden in the tray while Full was last known still counts as the tray.
        let mut hidden = SurfaceMachine::new(false);
        entered(&mut hidden, Opener::Player, false, false);
        assert_eq!(hidden.dismiss_target(false), Leave::Tray);
    }

    #[test]
    fn a_second_ask_points_the_card_at_another_game() {
        let mut machine = SurfaceMachine::new(false);
        let Entered::Shrink { generation } = entered(&mut machine, Opener::Auto, true, false) else {
            panic!()
        };
        assert_eq!(
            machine.enter(Some("zzz".into()), Opener::Player, false, true, false, false, None),
            Entered::Retargeted
        );
        let card = machine.card().unwrap();
        assert_eq!(card.game_id.as_deref(), Some("zzz"));
        assert!(!card.auto_opened, "the player's ask makes it theirs");
        assert_eq!(
            card.full_bounds,
            Some(FULL),
            "the full window's place is kept from the first ask"
        );
        assert!(card.pinned, "a retarget keeps the pin");
        machine.enter(None, Opener::Auto, false, true, false, false, None);
        assert_eq!(
            machine.card().unwrap().game_id.as_deref(),
            Some("zzz"),
            "None keeps the game"
        );
        // The first move still settles: a retarget is not a change of face.
        assert!(machine.settle(generation));
    }

    #[test]
    fn a_late_step_of_an_old_move_does_nothing() {
        let mut machine = SurfaceMachine::new(false);
        let Entered::Shrink { generation: first } = entered(&mut machine, Opener::Player, true, false) else {
            panic!()
        };
        let (_, second) = machine.leave(Leave::Full).unwrap();
        assert!(!machine.settle(first), "the card's shrink was overtaken");
        assert!(!machine.records_full_bounds());
        assert!(machine.settle(second));
        assert!(!machine.settle(second), "settles once");
    }

    #[test]
    fn hiding_and_showing_the_full_window_never_drops_the_card() {
        let mut machine = SurfaceMachine::new(false);
        machine.hidden();
        assert_eq!(machine.surface(), &Surface::Tray);
        machine.shown();
        assert_eq!(machine.surface(), &Surface::Full);
        entered(&mut machine, Opener::Player, true, false);
        machine.hidden();
        machine.shown();
        assert!(machine.is_compact());
        assert!(machine.set_pinned(false));
        assert!(!machine.card().unwrap().pinned);
        machine.leave(Leave::Full);
        assert!(!machine.set_pinned(true), "no card to pin");
    }

    #[test]
    fn the_card_is_sized_for_the_screen_and_the_zoom() {
        assert_eq!(card_size(1.0, 1.0), (380, 520));
        assert_eq!(card_size(1.5, 1.0), (570, 780));
        assert_eq!(card_size(1.0, 1.25), (475, 650));
        assert_eq!(card_size(1.0, 0.5), (380, 520), "zoomed out, the card keeps its size");
    }

    #[test]
    fn the_card_opens_in_the_corner_then_where_it_was_left() {
        let first = place_card(None, (380, 520), SCREEN, &[SCREEN], 16);
        assert_eq!(
            first,
            Bounds {
                x: 1920 - 380 - 16,
                y: 1040 - 520 - 16,
                width: 380,
                height: 520
            }
        );
        let left = place_card(Some((200, 300)), (380, 520), SCREEN, &[SCREEN], 16);
        assert_eq!((left.x, left.y), (200, 300));
        // Hanging off the edge, it is pulled back onto the display.
        let edge = place_card(Some((1800, 900)), (380, 520), SCREEN, &[SCREEN], 16);
        assert_eq!((edge.x, edge.y), (1920 - 380, 1040 - 520));
        // Left on a display that is gone, it comes back to the corner.
        let gone = place_card(Some((5000, 100)), (380, 520), SCREEN, &[SCREEN], 16);
        assert_eq!(gone, first);
        // A second display keeps its own card.
        let right = Bounds {
            x: 1920,
            y: 0,
            width: 1280,
            height: 1000,
        };
        let there = place_card(Some((2000, 50)), (380, 520), SCREEN, &[SCREEN, right], 16);
        assert_eq!((there.x, there.y), (2000, 50));
        // A screen smaller than the card gets a card its size.
        let tiny = Bounds {
            x: 0,
            y: 0,
            width: 360,
            height: 400,
        };
        assert_eq!(place_card(None, (380, 520), tiny, &[tiny], 16), tiny);
    }

    #[test]
    fn windows_placement_reads_as_maximized() {
        assert!(placement_maximized(SW_SHOWMAXIMIZED, 0));
        assert!(placement_maximized(SW_SHOWMINIMIZED, WPF_RESTORETOMAXIMIZED));
        assert!(!placement_maximized(SW_SHOWMINIMIZED, 0));
        assert!(!placement_maximized(1, 0));
        assert!(!placement_maximized(1, WPF_RESTORETOMAXIMIZED));
    }

    #[test]
    fn opening_a_game_always_leaves_for_the_full_app() {
        assert_eq!(exit_target(true, Some(true)), Some(Leave::Full));
        assert_eq!(exit_target(true, None), Some(Leave::Full));
        assert_eq!(exit_target(false, Some(true)), Some(Leave::Tray));
        assert_eq!(exit_target(false, Some(false)), Some(Leave::Full));
        assert_eq!(
            exit_target(false, None),
            None,
            "a plain dismiss goes where the card came from"
        );
    }

    #[test]
    fn only_real_game_ids_reach_the_card() {
        assert_eq!(clean_game_id(Some("genshin".into())), Some("genshin".into()));
        assert_eq!(clean_game_id(Some(String::new())), None);
        assert_eq!(clean_game_id(Some("x".repeat(161))), None);
        assert_eq!(clean_game_id(None), None);
    }

    #[test]
    fn a_minimized_window_returns_minimized_on_dismiss_and_opens_full_on_request() {
        let mut machine = SurfaceMachine::new(false);
        machine.enter(Some("genshin".into()), Opener::Auto, true, true, false, true, Some(FULL));
        assert!(machine.card().unwrap().was_minimized);
        // Closing to tray pref still returns to the taskbar state the full window had.
        assert_eq!(machine.dismiss_target(false), Leave::Minimized);
        assert_eq!(machine.dismiss_target(true), Leave::Minimized);
        assert!(machine.leave(Leave::Minimized).is_some());
        assert_eq!(machine.surface(), &Surface::Full);

        // Clicking "Open in Memoria" focuses the full window instead of minimizing it.
        machine.enter(Some("genshin".into()), Opener::Auto, true, true, false, true, Some(FULL));
        assert_eq!(exit_target(true, None), Some(Leave::Full));
        assert!(machine.leave(Leave::Full).is_some());
    }

    #[test]
    fn card_scale_follows_the_monitor_it_is_placed_on() {
        let secondary = Bounds {
            x: 1920,
            y: 0,
            width: 2560,
            height: 1440,
        };
        let monitors = [(SCREEN, 1.0), (secondary, 2.0)];
        assert_eq!(target_scale(None, 1.0, 1.0, &monitors), 1.0);
        assert_eq!(target_scale(Some((2100, 100)), 1.0, 1.0, &monitors), 2.0);
        assert_eq!(target_scale(Some((200, 100)), 1.0, 2.0, &monitors), 1.0);
    }
}
