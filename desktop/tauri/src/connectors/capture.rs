//! Screen captures read by Windows OCR, and the global shortcut that starts one.
//!
//! A capture freezes the monitor the game is on before anything else draws:
//! the foreground window's monitor is copied with GDI into memory. "window"
//! mode reads the game's client area straight away; "snip" mode shows the
//! frozen screen in a borderless window (`screenshot-snip`) for the player to
//! drag up to eight rectangles on (or read it whole). The frozen screen stays in memory; only the small JPEG
//! of what was read is kept, in the captures folder the player can open and
//! clear. Nothing leaves the PC; the page gets the recognised lines, that JPEG
//! as a preview and the game's program name (no path).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::App;
use crate::locks::Locked;

pub const SNIP_LABEL: &str = "screenshot-snip";
/// Served by the loopback server; see `server.rs`.
pub const SNIP_PATH: &str = "/__memoria-snip.html";
pub const SNIP_SCRIPT_PATH: &str = "/__memoria-snip.js";
pub const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+M";
const FILE_NAME: &str = "Screen capture";
/// Larger than any real monitor, so a broken size never allocates gigabytes.
const MAX_SIDE: u32 = 16_384;
/// A selection smaller than this, in captured pixels, is a stray click.
const MIN_SELECTION: u32 = 8;
/// A foreground window smaller than this is a tray menu or a tooltip: read the whole monitor.
const MIN_WINDOW: u32 = 64;
/// The most rectangles one snip may read.
pub const MAX_REGIONS: usize = 8;
/// The dark border around and between regions on a contact sheet, in pixels.
const SHEET_GAP: u32 = 8;
/// A region on a contact sheet is scaled down to at most this wide.
const SHEET_MAX_WIDTH: u32 = 1080;
/// A contact sheet's preview keeps up to this on its longest side, so each
/// region in a tall stack stays readable.
const SHEET_PREVIEW_MAX_SIDE: u32 = 2160;
/// The contact sheet's background: a dark neutral grey, opaque BGRA.
const SHEET_BACKGROUND: [u8; 4] = [0x1f, 0x1c, 0x1b, 0xff];

/// One rectangle the player drew on the snip window, in CSS pixels.
#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize)]
pub struct SnipRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub const MOD_ALT: u32 = 0x1;
pub const MOD_CONTROL: u32 = 0x2;
pub const MOD_SHIFT: u32 = 0x4;
pub const MOD_WIN: u32 = 0x8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// The foreground window's client area, read at once.
    Window,
    /// A rectangle the player drags on the frozen screen.
    Snip,
}

impl Mode {
    pub fn parse(mode: &str) -> Option<Self> {
        match mode {
            "window" => Some(Self::Window),
            "snip" => Some(Self::Snip),
            _ => None,
        }
    }
}

/// A screen rectangle in physical pixels, right and bottom exclusive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    fn width(&self) -> u32 {
        (self.right - self.left).max(0) as u32
    }

    fn height(&self) -> u32 {
        (self.bottom - self.top).max(0) as u32
    }
}

/// A frozen monitor, held in memory while the player snips.
pub struct PendingCapture {
    pub id: u64,
    pub width: u32,
    pub height: u32,
    pub monitor_left: i32,
    pub monitor_top: i32,
    /// Top-down BGRA, `width * height * 4` bytes.
    pub bgra: Vec<u8>,
    pub process_name: Option<String>,
    pub observed_at: u64,
    /// The frozen screen at full size as a PNG data URL, for the snip window.
    pub preview_data_url: String,
}

/// One monitor copied from the screen, and what was in front when it was taken.
struct Grab {
    monitor: Rect,
    width: u32,
    height: u32,
    bgra: Vec<u8>,
    /// The foreground window's client area in screen pixels, unless it was Memoria.
    foreground: Option<Rect>,
    process_name: Option<String>,
    observed_at: u64,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/// A copy of `width x height` pixels at `(x, y)` from a top-down BGRA buffer,
/// with alpha made opaque. None when the area is empty or falls outside.
pub fn crop_bgra(
    src: &[u8],
    src_width: u32,
    src_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Option<Vec<u8>> {
    let stride = usize::try_from(src_width).ok()?.checked_mul(4)?;
    if width == 0
        || height == 0
        || src.len() < stride.checked_mul(usize::try_from(src_height).ok()?)?
        || x.checked_add(width)? > src_width
        || y.checked_add(height)? > src_height
    {
        return None;
    }
    let row = width as usize * 4;
    let mut out = Vec::with_capacity(row * height as usize);
    for line in y as usize..(y + height) as usize {
        let start = line * stride + x as usize * 4;
        out.extend_from_slice(&src[start..start + row]);
    }
    // GDI leaves alpha at zero; a premultiplied bitmap would read as transparent.
    for alpha in out.iter_mut().skip(3).step_by(4) {
        *alpha = 255;
    }
    Some(out)
}

/// The snip rectangle the page drew, in CSS pixels of a `view_width x
/// view_height` viewport, as `(x, y, width, height)` in captured pixels.
pub fn scale_selection(
    selection: (f64, f64, f64, f64),
    view: (f64, f64),
    buffer_width: u32,
    buffer_height: u32,
) -> Option<(u32, u32, u32, u32)> {
    let (x, y, width, height) = selection;
    let (view_width, view_height) = view;
    let finite = [x, y, width, height, view_width, view_height]
        .iter()
        .all(|v| v.is_finite());
    if !finite || view_width <= 0.0 || view_height <= 0.0 || width <= 0.0 || height <= 0.0 {
        return None;
    }
    let (scale_x, scale_y) = (
        f64::from(buffer_width) / view_width,
        f64::from(buffer_height) / view_height,
    );
    let clamp_x = |v: f64| (v * scale_x).round().clamp(0.0, f64::from(buffer_width)) as u32;
    let clamp_y = |v: f64| (v * scale_y).round().clamp(0.0, f64::from(buffer_height)) as u32;
    let (left, right) = (clamp_x(x), clamp_x(x + width));
    let (top, bottom) = (clamp_y(y), clamp_y(y + height));
    let (width, height) = (right.saturating_sub(left), bottom.saturating_sub(top));
    (width >= MIN_SELECTION && height >= MIN_SELECTION).then_some((left, top, width, height))
}

/// Every snip rectangle scaled to captured pixels, in the order drawn. Errs
/// on none, more than `MAX_REGIONS`, or one too small to read (named by its
/// number when there are several), so the frozen screen stays up to redraw.
pub fn scale_regions(
    regions: &[SnipRegion],
    view: (f64, f64),
    buffer_width: u32,
    buffer_height: u32,
) -> Result<Vec<(u32, u32, u32, u32)>, String> {
    if regions.is_empty() {
        return Err("Drag around a larger area.".into());
    }
    if regions.len() > MAX_REGIONS {
        return Err(format!("Read up to {MAX_REGIONS} regions at once."));
    }
    regions
        .iter()
        .enumerate()
        .map(|(index, region)| {
            scale_selection(
                (region.x, region.y, region.width, region.height),
                view,
                buffer_width,
                buffer_height,
            )
            .ok_or_else(|| {
                if regions.len() == 1 {
                    "Drag around a larger area.".to_string()
                } else {
                    format!("Region {} is too small. Drag around a larger area.", index + 1)
                }
            })
        })
        .collect()
}

/// The crops stacked top to bottom on a dark sheet, each centred and scaled
/// down to at most `SHEET_MAX_WIDTH` wide, with `SHEET_GAP` around and
/// between them: `(pixels, width, height)`. None when there is nothing to stack.
pub fn contact_sheet(crops: &[(Vec<u8>, u32, u32)]) -> Option<(Vec<u8>, u32, u32)> {
    let fitted: Vec<(std::borrow::Cow<'_, [u8]>, u32, u32)> = crops
        .iter()
        .map(|(pixels, width, height)| {
            if *width <= SHEET_MAX_WIDTH {
                return Some((std::borrow::Cow::Borrowed(pixels.as_slice()), *width, *height));
            }
            let to_height = ((u64::from(*height) * u64::from(SHEET_MAX_WIDTH)) / u64::from(*width)).max(1) as u32;
            let scaled = super::ocr::resize_bgra(pixels, *width, *height, SHEET_MAX_WIDTH, to_height)?;
            Some((std::borrow::Cow::Owned(scaled), SHEET_MAX_WIDTH, to_height))
        })
        .collect::<Option<_>>()?;
    let inner = fitted.iter().map(|(_, width, _)| *width).max()?;
    let width = inner + 2 * SHEET_GAP;
    let height = fitted.iter().map(|(_, _, height)| *height + SHEET_GAP).sum::<u32>() + SHEET_GAP;
    if width > MAX_SIDE || height > MAX_SIDE {
        return None;
    }
    let stride = width as usize * 4;
    let mut sheet = SHEET_BACKGROUND.repeat(width as usize * height as usize);
    let mut top = SHEET_GAP as usize;
    for (pixels, crop_width, crop_height) in &fitted {
        let left = (SHEET_GAP + (inner - crop_width) / 2) as usize;
        let row = *crop_width as usize * 4;
        for (line, source) in pixels.chunks_exact(row).take(*crop_height as usize).enumerate() {
            let start = (top + line) * stride + left * 4;
            sheet[start..start + row].copy_from_slice(source);
        }
        top += *crop_height as usize + SHEET_GAP as usize;
    }
    Some((sheet, width, height))
}

/// The regions' lines in order, one empty line between regions (always one
/// fewer separator than regions, even around a region with no text), so a
/// reader can split them back apart. Recognised lines are never empty.
pub fn join_region_lines(regions: Vec<Vec<String>>) -> Vec<String> {
    let mut lines = Vec::new();
    for (index, region) in regions.into_iter().enumerate() {
        if index > 0 {
            lines.push(String::new());
        }
        lines.extend(region);
    }
    lines
}

/// The part of the monitor "window" mode reads, as `(x, y, width, height)` in
/// captured pixels: the foreground window clamped to the monitor, or the whole
/// monitor when there is none, it was Memoria, or it is too small to be a game.
pub fn window_area(foreground: Option<Rect>, monitor: Rect) -> (u32, u32, u32, u32) {
    let whole = (0, 0, monitor.width(), monitor.height());
    let Some(window) = foreground else { return whole };
    let clamped = Rect {
        left: window.left.max(monitor.left),
        top: window.top.max(monitor.top),
        right: window.right.min(monitor.right),
        bottom: window.bottom.min(monitor.bottom),
    };
    if clamped.width() < MIN_WINDOW || clamped.height() < MIN_WINDOW {
        return whole;
    }
    (
        (clamped.left - monitor.left) as u32,
        (clamped.top - monitor.top) as u32,
        clamped.width(),
        clamped.height(),
    )
}

/// A global shortcut, as `RegisterHotKey` takes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedHotkey {
    pub modifiers: u32,
    pub vk: u32,
    /// The normalised name, such as `Ctrl+Shift+M`.
    pub display: String,
}

/// `(virtual key, name, may stand alone)` for one key name, lowercased.
fn parse_key(key: &str) -> Option<(u32, String, bool)> {
    match key {
        "printscreen" | "prtsc" | "prtscn" | "prtscr" | "print" => return Some((0x2C, "PrintScreen".into(), true)),
        _ => {}
    }
    if let [byte] = key.as_bytes()
        && byte.is_ascii_alphanumeric()
    {
        let upper = byte.to_ascii_uppercase();
        return Some((u32::from(upper), (upper as char).to_string(), false));
    }
    let number: u32 = key.strip_prefix('f')?.parse().ok()?;
    (1..=12)
        .contains(&number)
        .then(|| (0x70 + number - 1, format!("F{number}"), true))
}

/// Reads `Ctrl+Shift+M`-style shortcuts: Ctrl, Alt, Shift and Win with one of
/// A-Z, 0-9, F1-F12 or PrintScreen. A letter or digit needs a modifier.
pub fn parse_accelerator(spec: &str) -> Result<ParsedHotkey, String> {
    let invalid = || "Choose a shortcut such as Ctrl+Shift+M.".to_string();
    if spec.len() > 64 {
        return Err(invalid());
    }
    let mut modifiers = 0;
    let mut key: Option<(u32, String, bool)> = None;
    for part in spec.split('+').map(str::trim) {
        if part.is_empty() {
            return Err(invalid());
        }
        let lower = part.to_ascii_lowercase();
        let modifier = match lower.as_str() {
            "ctrl" | "control" => MOD_CONTROL,
            "alt" => MOD_ALT,
            "shift" => MOD_SHIFT,
            "win" | "windows" | "super" | "meta" => MOD_WIN,
            _ => 0,
        };
        if modifier != 0 {
            if modifiers & modifier != 0 {
                return Err(invalid());
            }
            modifiers |= modifier;
            continue;
        }
        if key.is_some() {
            return Err("Use one key with Ctrl, Alt, Shift or Win.".into());
        }
        key = Some(parse_key(&lower).ok_or_else(invalid)?);
    }
    let (vk, name, alone) = key.ok_or_else(invalid)?;
    if modifiers == 0 && !alone {
        return Err("Add Ctrl, Alt, Shift or Win to the shortcut.".into());
    }
    let mut display: Vec<&str> = [
        (MOD_CONTROL, "Ctrl"),
        (MOD_ALT, "Alt"),
        (MOD_SHIFT, "Shift"),
        (MOD_WIN, "Win"),
    ]
    .iter()
    .filter(|(flag, _)| modifiers & flag != 0)
    .map(|(_, name)| *name)
    .collect();
    display.push(&name);
    Ok(ParsedHotkey {
        modifiers,
        vk,
        display: display.join("+"),
    })
}

/// `YYYY-MM-DD_HH-MM-SS` in this PC's time zone, for a capture's file name.
fn capture_stamp(observed_at: u64) -> String {
    i64::try_from(observed_at)
        .ok()
        .and_then(|ms| jiff::Timestamp::from_millisecond(ms).ok())
        .unwrap_or(jiff::Timestamp::UNIX_EPOCH)
        .to_zoned_datetime(jiff::tz::TimeZone::system())
        .strftime("%Y-%m-%d_%H-%M-%S")
        .to_string()
}

/// The program name reduced to `[A-Za-z0-9_-]`, or `capture`.
fn capture_label(process_name: Option<&str>) -> String {
    let label: String = process_name
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(64)
        .collect();
    if label.is_empty() { "capture".into() } else { label }
}

/// Keeps a capture's JPEG as `{stamp}_{program}.jpg` in `dir`, adding `-2`,
/// `-3`… when the name is taken. Best effort: None when it could not be saved.
pub fn save_capture_jpeg(dir: &Path, jpeg: &[u8], observed_at: u64, process_name: Option<&str>) -> Option<PathBuf> {
    if jpeg.is_empty() {
        return None;
    }
    std::fs::create_dir_all(dir).ok()?;
    let base = format!("{}_{}", capture_stamp(observed_at), capture_label(process_name));
    for n in 1..=999 {
        let name = if n == 1 { format!("{base}.jpg") } else { format!("{base}-{n}.jpg") };
        let path = dir.join(name);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if file.write_all(jpeg).is_ok() {
                    return Some(path);
                }
                drop(file);
                let _ = std::fs::remove_file(&path);
                return None;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return None,
        }
    }
    None
}

/// A capture's reading for the page. `regionCount` says how many areas were
/// read; with more than one, `lines` holds one empty line between areas
/// (see `join_region_lines`) and `dataUrl` is their contact sheet.
fn payload(observed_at: u64, lines: Vec<String>, data_url: &str, process_name: Option<&str>, regions: usize) -> Value {
    json!({
        "fileName": FILE_NAME,
        "observedAt": observed_at,
        "lines": lines,
        "dataUrl": super::ocr::data_url_json(data_url),
        "processName": process_name,
        "regionCount": regions,
    })
}

// ---------------------------------------------------------------------------
// Windows: the screen, WinRT bitmaps and the shortcut thread
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod win {
    use std::path::Path;
    use std::sync::mpsc;
    use std::time::Duration;

    use windows_sys::Win32::Foundation::{CloseHandle, HWND, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BitBlt, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC,
        DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, GetMonitorInfoW, HBITMAP, HDC, HGDIOBJ,
        MONITOR_DEFAULTTOPRIMARY, MONITORINFO, MonitorFromWindow, ReleaseDC, SRCCOPY, SelectObject,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentThreadId, OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MOD_NOREPEAT, RegisterHotKey, UnregisterHotKey};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId, MSG, PM_NOREMOVE, PeekMessageW,
        PostThreadMessageW, WM_APP, WM_HOTKEY, WM_QUIT,
    };

    use super::{Grab, MAX_SIDE, ParsedHotkey, Rect};

    struct ScreenDc(HDC);
    impl Drop for ScreenDc {
        fn drop(&mut self) {
            // SAFETY: obtained from GetDC(null) and released once.
            unsafe { ReleaseDC(std::ptr::null_mut(), self.0) };
        }
    }

    struct MemoryDc(HDC);
    impl Drop for MemoryDc {
        fn drop(&mut self) {
            // SAFETY: created by CreateCompatibleDC and deleted once.
            unsafe { DeleteDC(self.0) };
        }
    }

    struct Bitmap(HBITMAP);
    impl Drop for Bitmap {
        fn drop(&mut self) {
            // SAFETY: created by CreateCompatibleBitmap, no longer selected, deleted once.
            unsafe { DeleteObject(self.0) };
        }
    }

    struct Selected {
        dc: HDC,
        old: HGDIOBJ,
    }
    impl Drop for Selected {
        fn drop(&mut self) {
            // SAFETY: puts back what SelectObject replaced.
            unsafe { SelectObject(self.dc, self.old) };
        }
    }

    struct Process(windows_sys::Win32::Foundation::HANDLE);
    impl Drop for Process {
        fn drop(&mut self) {
            // SAFETY: opened by OpenProcess and closed once.
            unsafe { CloseHandle(self.0) };
        }
    }

    /// The program's file name without `.exe`; never its folder.
    fn process_name(pid: u32) -> Option<String> {
        // SAFETY: a query-only handle, closed by the guard.
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return None;
        }
        let _guard = Process(handle);
        let mut buffer = [0u16; 1024];
        let mut length = buffer.len() as u32;
        // SAFETY: the buffer holds `length` UTF-16 units.
        let ok = unsafe { QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut length) };
        if ok == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buffer[..length as usize]);
        Path::new(&path)
            .file_stem()
            .map(|stem| stem.to_string_lossy().chars().take(64).collect())
    }

    fn client_rect(window: HWND) -> Option<Rect> {
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let mut origin = POINT { x: 0, y: 0 };
        // SAFETY: plain out-parameters for a window handle Windows gave us.
        let ok = unsafe { GetClientRect(window, &mut rect) != 0 && ClientToScreen(window, &mut origin) != 0 };
        ok.then(|| Rect {
            left: origin.x,
            top: origin.y,
            right: origin.x + (rect.right - rect.left),
            bottom: origin.y + (rect.bottom - rect.top),
        })
    }

    /// Copies the foreground window's monitor. Blocking, and quick: one BitBlt.
    pub(super) fn grab() -> Result<Grab, String> {
        let failed = || "Windows could not capture the screen.".to_string();
        // SAFETY: Win32 calls on handles Windows hands back, each checked
        // before use and released by a guard.
        unsafe {
            let foreground = GetForegroundWindow();
            let mut pid = 0u32;
            if !foreground.is_null() {
                GetWindowThreadProcessId(foreground, &mut pid);
            }
            let ours = pid == std::process::id();
            let monitor = MonitorFromWindow(foreground, MONITOR_DEFAULTTOPRIMARY);
            let mut info: MONITORINFO = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
            if monitor.is_null() || GetMonitorInfoW(monitor, &mut info) == 0 {
                return Err(failed());
            }
            let area = Rect {
                left: info.rcMonitor.left,
                top: info.rcMonitor.top,
                right: info.rcMonitor.right,
                bottom: info.rcMonitor.bottom,
            };
            let (width, height) = (area.width(), area.height());
            if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE {
                return Err(failed());
            }
            let observed_at = crate::connectors::now_ms();

            let screen = GetDC(std::ptr::null_mut());
            if screen.is_null() {
                return Err(failed());
            }
            let screen = ScreenDc(screen);
            let memory = CreateCompatibleDC(screen.0);
            if memory.is_null() {
                return Err(failed());
            }
            let memory = MemoryDc(memory);
            let bitmap = CreateCompatibleBitmap(screen.0, width as i32, height as i32);
            if bitmap.is_null() {
                return Err(failed());
            }
            let bitmap = Bitmap(bitmap);
            {
                let old = SelectObject(memory.0, bitmap.0);
                if old.is_null() {
                    return Err(failed());
                }
                let _selected = Selected { dc: memory.0, old };
                if BitBlt(
                    memory.0,
                    0,
                    0,
                    width as i32,
                    height as i32,
                    screen.0,
                    area.left,
                    area.top,
                    SRCCOPY,
                ) == 0
                {
                    return Err(failed());
                }
            }
            let mut header: BITMAPINFO = std::mem::zeroed();
            header.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                // Negative: rows top to bottom.
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..std::mem::zeroed()
            };
            let mut bgra = vec![0u8; width as usize * height as usize * 4];
            let rows = GetDIBits(
                memory.0,
                bitmap.0,
                0,
                height,
                bgra.as_mut_ptr().cast(),
                &mut header,
                DIB_RGB_COLORS,
            );
            if rows != height as i32 {
                return Err(failed());
            }
            Ok(Grab {
                monitor: area,
                width,
                height,
                bgra,
                foreground: (!ours && !foreground.is_null())
                    .then(|| client_rect(foreground))
                    .flatten(),
                process_name: (!ours && pid != 0).then(|| process_name(pid)).flatten(),
                observed_at,
            })
        }
    }

    const HOTKEY_ID: i32 = 1;
    /// Wakes the shortcut thread to read its request channel.
    const WM_CONTROL: u32 = WM_APP + 0x4D;

    type Reply = mpsc::Sender<Result<(), String>>;

    /// The thread that owns the global shortcut. Hotkeys belong to the thread
    /// that registers them, so this one registers, listens and unregisters.
    pub struct Hotkey {
        thread_id: u32,
        requests: mpsc::Sender<(Option<ParsedHotkey>, Reply)>,
    }

    impl Hotkey {
        pub fn start(on_press: impl Fn() + Send + 'static) -> Option<Self> {
            let (requests, inbox) = mpsc::channel::<(Option<ParsedHotkey>, Reply)>();
            let (ready, started) = mpsc::channel::<u32>();
            std::thread::Builder::new()
                .name("memoria-capture-shortcut".into())
                .spawn(move || {
                    // SAFETY: a message loop on this thread's own queue.
                    unsafe {
                        let mut message: MSG = std::mem::zeroed();
                        // Creates the queue, so PostThreadMessageW can reach it.
                        PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
                        let _ = ready.send(GetCurrentThreadId());
                        let mut registered = false;
                        loop {
                            let got = GetMessageW(&mut message, std::ptr::null_mut(), 0, 0);
                            if got == 0 || got == -1 {
                                break;
                            }
                            match message.message {
                                WM_HOTKEY if message.wParam == HOTKEY_ID as usize => on_press(),
                                WM_CONTROL => {
                                    while let Ok((hotkey, reply)) = inbox.try_recv() {
                                        if registered {
                                            UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID);
                                            registered = false;
                                        }
                                        let result = match hotkey {
                                            None => Ok(()),
                                            Some(hotkey) => {
                                                registered = RegisterHotKey(
                                                    std::ptr::null_mut(),
                                                    HOTKEY_ID,
                                                    hotkey.modifiers | MOD_NOREPEAT,
                                                    hotkey.vk,
                                                ) != 0;
                                                if registered {
                                                    Ok(())
                                                } else {
                                                    Err(format!(
                                                        "Another app already uses {}. Choose a different shortcut.",
                                                        hotkey.display
                                                    ))
                                                }
                                            }
                                        };
                                        let _ = reply.send(result);
                                    }
                                }
                                _ => {}
                            }
                        }
                        if registered {
                            UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID);
                        }
                    }
                })
                .ok()?;
            let thread_id = started.recv_timeout(Duration::from_secs(2)).ok()?;
            Some(Self { thread_id, requests })
        }

        /// Registers `hotkey`, or releases the shortcut when None.
        pub fn set(&self, hotkey: Option<ParsedHotkey>) -> Result<(), String> {
            let stopped = || "The capture shortcut stopped. Restart Memoria.".to_string();
            let (reply, answer) = mpsc::channel();
            self.requests.send((hotkey, reply)).map_err(|_| stopped())?;
            // SAFETY: posts to a thread whose queue exists.
            if unsafe { PostThreadMessageW(self.thread_id, WM_CONTROL, 0, 0) } == 0 {
                return Err(stopped());
            }
            answer.recv_timeout(Duration::from_secs(2)).map_err(|_| stopped())?
        }

        pub fn stop(&self) {
            // SAFETY: asks the thread to leave its loop; it unregisters on the way out.
            unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0) };
        }
    }
}

#[cfg(windows)]
pub use win::Hotkey;

/// Without Windows there is no global shortcut.
#[cfg(not(windows))]
pub struct Hotkey;

#[cfg(not(windows))]
impl Hotkey {
    pub fn stop(&self) {}
}

// ---------------------------------------------------------------------------
// The capture flow
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn grab_blocking() -> Result<Grab, String> {
    win::grab()
}

#[cfg(not(windows))]
fn grab_blocking() -> Result<Grab, String> {
    Err("Screen capture needs Windows.".into())
}

/// Reads text in crops of a grab, in order: `(lines, preview data URL, JPEG
/// bytes)`. Several areas' lines are joined by `join_region_lines` and
/// previewed as one contact sheet; one area previews as itself. Blocking.
#[cfg(windows)]
fn read_crops(
    bgra: &[u8],
    width: u32,
    height: u32,
    areas: &[(u32, u32, u32, u32)],
) -> Result<(Vec<String>, String, Vec<u8>), String> {
    let crops = areas
        .iter()
        .map(|&(x, y, crop_width, crop_height)| {
            crop_bgra(bgra, width, height, x, y, crop_width, crop_height)
                .map(|pixels| (pixels, crop_width, crop_height))
                .ok_or_else(|| "That part of the screen could not be read.".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let read = crops
        .iter()
        .map(|(pixels, crop_width, crop_height)| super::ocr::recognize_bgra(pixels, *crop_width, *crop_height))
        .collect::<Result<Vec<_>, _>>()?;
    let lines = join_region_lines(read);
    // The preview is best effort, like the JPEG kept: the text is what counts.
    let (data_url, jpeg) = match crops.as_slice() {
        [(pixels, crop_width, crop_height)] => super::ocr::software_bitmap(pixels, *crop_width, *crop_height)
            .map(|bitmap| super::ocr::encode_preview(&bitmap, super::ocr::PREVIEW_MAX_SIDE))
            .unwrap_or_default(),
        _ => contact_sheet(&crops)
            .and_then(|(sheet, sheet_width, sheet_height)| {
                super::ocr::software_bitmap(&sheet, sheet_width, sheet_height).ok()
            })
            .map(|bitmap| super::ocr::encode_preview(&bitmap, SHEET_PREVIEW_MAX_SIDE))
            .unwrap_or_default(),
    };
    Ok((lines, data_url, jpeg))
}

#[cfg(not(windows))]
fn read_crops(_: &[u8], _: u32, _: u32, _: &[(u32, u32, u32, u32)]) -> Result<(Vec<String>, String, Vec<u8>), String> {
    Err("Screen capture needs Windows.".into())
}

/// The whole frozen screen as a PNG data URL. Blocking.
#[cfg(windows)]
fn frozen_preview(grab: &Grab) -> Result<String, String> {
    use base64::Engine;
    let opaque = crop_bgra(&grab.bgra, grab.width, grab.height, 0, 0, grab.width, grab.height)
        .ok_or("Windows could not capture the screen.")?;
    let bitmap = super::ocr::software_bitmap(&opaque, grab.width, grab.height)?;
    let id = windows::Graphics::Imaging::BitmapEncoder::PngEncoderId()
        .map_err(|_| "Windows could not encode the screenshot.".to_string())?;
    let png = super::ocr::encode_bitmap(&bitmap, id, MAX_SIDE)?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

#[cfg(not(windows))]
fn frozen_preview(_grab: &Grab) -> Result<String, String> {
    Err("Screen capture needs Windows.".into())
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "The screen capture stopped unexpectedly.".to_string())?
}

/// Delivers a reading to the page and brings Memoria forward to confirm it.
/// `saved` says a JPEG was kept, so the captures count is sent too.
fn deliver(app: &AppHandle, payload: &Value, saved: bool) {
    crate::emit(app, "memoria:screenshot-ocr", payload.clone());
    if saved {
        crate::emit(app, "memoria:connector-status", app.state::<App>().connectors.status());
    }
    crate::focus_window(app);
}

/// Tells the page a capture failed, the way sign-ins report theirs.
fn report(app: &AppHandle, error: &str) {
    let mut status = app.state::<App>().connectors.status();
    status["error"] = json!(error);
    crate::emit(app, "memoria:connector-status", status);
}

/// Captures in `mode`. "window" returns the reading (and also delivers it);
/// "snip" opens the snip window and returns None, delivering on commit.
pub async fn start(app: &AppHandle, mode: Mode) -> Result<Option<Value>, String> {
    if let Some(window) = app.get_webview_window(SNIP_LABEL) {
        // One snip at a time; capturing now would freeze the snip window itself.
        let _ = window.set_focus();
        return Ok(None);
    }
    match mode {
        Mode::Window => {
            let dir = app.state::<App>().connectors.captures_dir().to_path_buf();
            let (lines, data_url, observed_at, process_name, saved) = blocking(move || {
                let grab = grab_blocking()?;
                let area = window_area(grab.foreground, grab.monitor);
                let (lines, data_url, jpeg) = read_crops(&grab.bgra, grab.width, grab.height, &[area])?;
                let saved =
                    save_capture_jpeg(&dir, &jpeg, grab.observed_at, grab.process_name.as_deref()).is_some();
                Ok((lines, data_url, grab.observed_at, grab.process_name, saved))
            })
            .await?;
            let reading = payload(observed_at, lines, &data_url, process_name.as_deref(), 1);
            deliver(app, &reading, saved);
            Ok(Some(reading))
        }
        Mode::Snip => {
            let pending = blocking(|| {
                let grab = grab_blocking()?;
                let preview_data_url = frozen_preview(&grab)?;
                Ok(PendingCapture {
                    id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                    width: grab.width,
                    height: grab.height,
                    monitor_left: grab.monitor.left,
                    monitor_top: grab.monitor.top,
                    bgra: grab.bgra,
                    process_name: grab.process_name,
                    observed_at: grab.observed_at,
                    preview_data_url,
                })
            })
            .await?;
            let place = (pending.monitor_left, pending.monitor_top, pending.width, pending.height);
            let id = pending.id;
            *app.state::<App>().connectors.pending_capture.locked() = Some(pending);
            if let Err(error) = open_snip(app, id, place) {
                app.state::<App>().connectors.pending_capture.locked().take();
                return Err(error);
            }
            Ok(None)
        }
    }
}

/// Starts a capture from the tray or the shortcut, after `delay` so a closing
/// menu is not in the picture. Failures reach the page as a status error.
pub fn trigger(app: &AppHandle, mode: Mode, delay: Duration) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
        if let Err(error) = start(&app, mode).await {
            report(&app, &error);
        }
    });
}

/// The borderless, topmost window over the frozen monitor.
fn open_snip(app: &AppHandle, id: u64, place: (i32, i32, u32, u32)) -> Result<(), String> {
    use tauri::webview::NewWindowResponse;
    let state = app.state::<App>();
    let failed = || "The capture window could not open.".to_string();
    let page = format!("{}{SNIP_PATH}", state.origin);
    let url: tauri::Url = page.parse().map_err(|_| failed())?;
    let builder = tauri::WebviewWindowBuilder::new(app, SNIP_LABEL, tauri::WebviewUrl::External(url))
        .title("Capture game screenshot · Memoria")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .focused(true)
        .background_color(tauri::window::Color(0, 0, 0, 255))
        // The main window's profile: no second browser process to start.
        .data_directory(state.data.join("webview"))
        .on_navigation(move |url| url.as_str() == page)
        .on_new_window(|_, _| NewWindowResponse::Deny);
    let builder = match crate::webview_browser_args() {
        Some(args) => builder.additional_browser_args(&args),
        None => builder,
    };
    let window = builder.build().map_err(|_| failed())?;
    let (left, top, width, height) = place;
    let _ = window.set_position(tauri::PhysicalPosition::new(left, top));
    let _ = window.set_size(tauri::PhysicalSize::new(width, height));
    let _ = window.show();
    let _ = window.set_focus();
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let state = handle.state::<App>();
            let mut pending = state.connectors.pending_capture.locked();
            if pending.as_ref().is_some_and(|p| p.id == id) {
                *pending = None;
            }
        }
    });
    Ok(())
}

fn close_snip(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SNIP_LABEL) {
        let _ = window.destroy();
    }
}

/// `{ dataUrl, width, height, processName }` for the snip page.
pub fn snip_data(app: &AppHandle) -> Result<Value, String> {
    let state = app.state::<App>();
    let pending = state.connectors.pending_capture.locked();
    let pending = pending.as_ref().ok_or("The capture has ended.")?;
    Ok(json!({
        "dataUrl": pending.preview_data_url,
        "width": pending.width,
        "height": pending.height,
        "processName": pending.process_name,
    }))
}

/// Reads the dragged rectangles (up to `MAX_REGIONS`, in the order drawn),
/// closes the snip window and delivers the text.
pub fn snip_commit(app: &AppHandle, regions: &[SnipRegion], view: (f64, f64)) -> Result<(), String> {
    let state = app.state::<App>();
    let (pending, areas) = {
        let mut slot = state.connectors.pending_capture.locked();
        let current = slot.as_ref().ok_or("The capture has ended.")?;
        // A stray click leaves the frozen screen up for another try.
        let areas = scale_regions(regions, view, current.width, current.height)?;
        (slot.take().ok_or("The capture has ended.")?, areas)
    };
    close_snip(app);
    let dir = state.connectors.captures_dir().to_path_buf();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let PendingCapture {
            bgra,
            width,
            height,
            observed_at,
            process_name,
            ..
        } = pending;
        let label = process_name.clone();
        let count = areas.len();
        let read = blocking(move || {
            let (lines, data_url, jpeg) = read_crops(&bgra, width, height, &areas)?;
            let saved = save_capture_jpeg(&dir, &jpeg, observed_at, label.as_deref()).is_some();
            Ok((lines, data_url, saved))
        });
        match read.await {
            Ok((lines, data_url, saved)) => deliver(
                &app,
                &payload(observed_at, lines, &data_url, process_name.as_deref(), count),
                saved,
            ),
            Err(error) => {
                crate::focus_window(&app);
                report(&app, &error);
            }
        }
    });
    Ok(())
}

pub fn snip_cancel(app: &AppHandle) {
    app.state::<App>().connectors.pending_capture.locked().take();
    close_snip(app);
}

// ---------------------------------------------------------------------------
// The shortcut
// ---------------------------------------------------------------------------

/// Registers or releases the saved shortcut and records the outcome for `status()`.
/// Starts the shortcut thread the first time it is needed. Blocking, briefly.
#[cfg(windows)]
pub fn apply_shortcut(app: &AppHandle) {
    let state = app.state::<App>();
    let connectors = &state.connectors;
    let (enabled, accelerator) = connectors.shortcut_setting();
    let parsed = match parse_accelerator(&accelerator) {
        Ok(parsed) => parsed,
        Err(error) => {
            connectors.set_shortcut_runtime(false, Some(error));
            return;
        }
    };
    let mut hotkey = connectors.hotkey.locked();
    if hotkey.is_none() {
        if !enabled {
            connectors.set_shortcut_runtime(false, None);
            return;
        }
        let presser = app.clone();
        *hotkey = win::Hotkey::start(move || trigger(&presser, Mode::Snip, Duration::ZERO));
    }
    let Some(thread) = hotkey.as_ref() else {
        connectors.set_shortcut_runtime(false, Some("Memoria could not listen for the shortcut.".into()));
        return;
    };
    match thread.set(enabled.then_some(parsed)) {
        Ok(()) => connectors.set_shortcut_runtime(enabled, None),
        Err(error) => connectors.set_shortcut_runtime(false, Some(error)),
    }
}

#[cfg(not(windows))]
pub fn apply_shortcut(app: &AppHandle) {
    let state = app.state::<App>();
    let (enabled, _) = state.connectors.shortcut_setting();
    let error = enabled.then(|| "The capture shortcut needs Windows.".to_string());
    state.connectors.set_shortcut_runtime(false, error);
}

/// Releases the shortcut at exit.
pub fn stop_shortcut(app: &AppHandle) {
    if let Some(thread) = app.state::<App>().connectors.hotkey.locked().take() {
        thread.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 4x3 buffer whose pixel (x, y) is [x, y, 7, 0].
    fn sample() -> Vec<u8> {
        let mut pixels = Vec::new();
        for y in 0..3u8 {
            for x in 0..4u8 {
                pixels.extend_from_slice(&[x, y, 7, 0]);
            }
        }
        pixels
    }

    #[test]
    fn crops_rows_and_makes_alpha_opaque() {
        let src = sample();
        let crop = crop_bgra(&src, 4, 3, 1, 1, 2, 2).unwrap();
        assert_eq!(crop, vec![1, 1, 7, 255, 2, 1, 7, 255, 1, 2, 7, 255, 2, 2, 7, 255]);
        assert_eq!(crop_bgra(&src, 4, 3, 0, 0, 4, 3).unwrap().len(), 48);
        assert!(crop_bgra(&src, 4, 3, 3, 0, 2, 1).is_none());
        assert!(crop_bgra(&src, 4, 3, 0, 2, 1, 2).is_none());
        assert!(crop_bgra(&src, 4, 3, 0, 0, 0, 1).is_none());
        assert!(crop_bgra(&src[..10], 4, 3, 0, 0, 1, 1).is_none());
        assert!(crop_bgra(&src, 4, 3, u32::MAX, 0, 2, 1).is_none());
    }

    #[test]
    fn selections_scale_from_css_to_captured_pixels() {
        // A 150% display: 1280x720 CSS pixels over 1920x1080 captured ones.
        assert_eq!(
            scale_selection((100.0, 50.0, 200.0, 100.0), (1280.0, 720.0), 1920, 1080),
            Some((150, 75, 300, 150))
        );
        // Enter: the whole viewport is the whole monitor.
        assert_eq!(
            scale_selection((0.0, 0.0, 1280.0, 720.0), (1280.0, 720.0), 1920, 1080),
            Some((0, 0, 1920, 1080))
        );
        // A drag past the edge is clamped to it.
        assert_eq!(
            scale_selection((1200.0, 700.0, 500.0, 500.0), (1280.0, 720.0), 1920, 1080),
            Some((1800, 1050, 120, 30))
        );
        assert!(scale_selection((10.0, 10.0, 2.0, 2.0), (1280.0, 720.0), 1920, 1080).is_none());
        assert!(scale_selection((0.0, 0.0, 10.0, 10.0), (0.0, 720.0), 1920, 1080).is_none());
        assert!(scale_selection((f64::NAN, 0.0, 10.0, 10.0), (1280.0, 720.0), 1920, 1080).is_none());
        assert!(scale_selection((2000.0, 0.0, 100.0, 100.0), (1280.0, 720.0), 1920, 1080).is_none());
    }

    #[test]
    fn window_mode_reads_the_game_or_the_whole_monitor() {
        let monitor = Rect {
            left: 1920,
            top: 0,
            right: 3840,
            bottom: 1080,
        };
        let game = Rect {
            left: 2000,
            top: 100,
            right: 3280,
            bottom: 820,
        };
        assert_eq!(window_area(Some(game), monitor), (80, 100, 1280, 720));
        // A window hanging off the monitor is clamped to it.
        let off = Rect {
            left: 1800,
            top: -50,
            right: 2600,
            bottom: 600,
        };
        assert_eq!(window_area(Some(off), monitor), (0, 0, 680, 600));
        // Nothing usable in front: the whole monitor.
        assert_eq!(window_area(None, monitor), (0, 0, 1920, 1080));
        let tooltip = Rect {
            left: 2000,
            top: 100,
            right: 2040,
            bottom: 120,
        };
        assert_eq!(window_area(Some(tooltip), monitor), (0, 0, 1920, 1080));
        let elsewhere = Rect {
            left: 0,
            top: 0,
            right: 800,
            bottom: 600,
        };
        assert_eq!(window_area(Some(elsewhere), monitor), (0, 0, 1920, 1080));
    }

    #[test]
    fn accelerators_parse_and_normalise() {
        let default = parse_accelerator(DEFAULT_SHORTCUT).unwrap();
        assert_eq!(default.modifiers, MOD_CONTROL | MOD_SHIFT);
        assert_eq!(default.vk, u32::from(b'M'));
        assert_eq!(default.display, "Ctrl+Shift+M");
        assert_eq!(
            parse_accelerator("shift + control + m").unwrap().display,
            "Ctrl+Shift+M"
        );
        assert_eq!(
            parse_accelerator("Alt+Win+5").unwrap(),
            ParsedHotkey {
                modifiers: MOD_ALT | MOD_WIN,
                vk: u32::from(b'5'),
                display: "Alt+Win+5".into(),
            }
        );
        let f9 = parse_accelerator("F9").unwrap();
        assert_eq!((f9.modifiers, f9.vk, f9.display.as_str()), (0, 0x78, "F9"));
        assert_eq!(parse_accelerator("F12").unwrap().vk, 0x7B);
        let print = parse_accelerator("Ctrl+PrtSc").unwrap();
        assert_eq!((print.vk, print.display.as_str()), (0x2C, "Ctrl+PrintScreen"));
        assert_eq!(parse_accelerator("PrintScreen").unwrap().modifiers, 0);
        for bad in [
            "A",
            "5",
            "",
            "Ctrl",
            "Ctrl+",
            "Ctrl+Ctrl+M",
            "Ctrl+M+N",
            "Ctrl+F13",
            "Ctrl+F0",
            "Ctrl+Space",
            "Ctrl+Shift+MM",
        ] {
            assert!(parse_accelerator(bad).is_err(), "{bad}");
        }
        assert!(parse_accelerator(&"Ctrl+".repeat(20)).is_err());
    }

    #[test]
    fn modes_and_payloads() {
        assert_eq!(Mode::parse("window"), Some(Mode::Window));
        assert_eq!(Mode::parse("snip"), Some(Mode::Snip));
        assert_eq!(Mode::parse("full"), None);
        let reading = payload(5, vec!["Sanity 120/180".into()], "", Some("Endfield"), 1);
        assert_eq!(reading["fileName"], "Screen capture");
        assert_eq!(reading["dataUrl"], Value::Null);
        assert_eq!(reading["processName"], "Endfield");
        assert_eq!(reading["lines"][0], "Sanity 120/180");
        assert_eq!(reading["regionCount"], 1);
    }

    fn region(x: f64, y: f64, width: f64, height: f64) -> SnipRegion {
        SnipRegion { x, y, width, height }
    }

    #[test]
    fn regions_scale_in_order_and_refuse_what_cannot_be_read() {
        let view = (1280.0, 720.0);
        assert_eq!(
            scale_regions(
                &[region(100.0, 50.0, 200.0, 100.0), region(0.0, 0.0, 1280.0, 720.0)],
                view,
                1920,
                1080
            ),
            Ok(vec![(150, 75, 300, 150), (0, 0, 1920, 1080)])
        );
        assert_eq!(
            scale_regions(&[region(10.0, 10.0, 2.0, 2.0)], view, 1920, 1080),
            Err("Drag around a larger area.".to_string())
        );
        // With several, the too-small one is named so it can be redrawn.
        assert_eq!(
            scale_regions(
                &[region(0.0, 0.0, 100.0, 100.0), region(10.0, 10.0, 2.0, 2.0)],
                view,
                1920,
                1080
            ),
            Err("Region 2 is too small. Drag around a larger area.".to_string())
        );
        assert!(scale_regions(&[], view, 1920, 1080).is_err());
        let nine = vec![region(0.0, 0.0, 100.0, 100.0); MAX_REGIONS + 1];
        assert!(scale_regions(&nine, view, 1920, 1080).is_err());
        assert_eq!(scale_regions(&nine[..MAX_REGIONS], view, 1920, 1080).unwrap().len(), MAX_REGIONS);
    }

    #[test]
    fn regions_lines_keep_one_separator_between_areas() {
        assert_eq!(
            join_region_lines(vec![
                vec!["Trailblaze Power   145/200".into()],
                vec![],
                vec!["Echo of War".into(), "1/3".into()],
            ]),
            ["Trailblaze Power   145/200", "", "", "Echo of War", "1/3"]
        );
        assert_eq!(join_region_lines(vec![vec!["Only".into()]]), ["Only"]);
        assert!(join_region_lines(Vec::new()).is_empty());
    }

    #[test]
    fn contact_sheets_stack_regions_on_a_dark_background() {
        let white = |width: u32, height: u32| ([255u8; 4].repeat((width * height) as usize), width, height);
        let (sheet, width, height) = contact_sheet(&[white(4, 2), white(2, 3)]).unwrap();
        // 8 px around and between: (4 + 16) wide, (8 + 2 + 8 + 3 + 8) tall.
        assert_eq!((width, height), (20, 29));
        assert_eq!(sheet.len(), (20 * 29 * 4) as usize);
        let at = |x: u32, y: u32| &sheet[((y * width + x) * 4) as usize..][..4];
        assert_eq!(at(0, 0), SHEET_BACKGROUND);
        assert_eq!(at(8, 8), [255; 4]);
        assert_eq!(at(11, 9), [255; 4]);
        assert_eq!(at(12, 8), SHEET_BACKGROUND);
        assert_eq!(at(8, 10), SHEET_BACKGROUND);
        // The narrower region is centred: columns 9 and 10 of rows 18 to 20.
        assert_eq!(at(8, 18), SHEET_BACKGROUND);
        assert_eq!(at(9, 18), [255; 4]);
        assert_eq!(at(10, 20), [255; 4]);
        assert_eq!(at(11, 20), SHEET_BACKGROUND);
        assert_eq!(at(9, 21), SHEET_BACKGROUND);
        assert!(contact_sheet(&[]).is_none());

        // A region wider than the sheet allows is scaled down to fit, keeping its shape.
        let (_, width, height) = contact_sheet(&[white(2160, 100), white(10, 10)]).unwrap();
        assert_eq!((width, height), (SHEET_MAX_WIDTH + 16, 8 + 50 + 8 + 10 + 8));
    }

    #[test]
    fn captures_save_with_safe_names_and_never_overwrite() {
        let dir = std::env::temp_dir()
            .join(format!("memoria-capture-save-{}", std::process::id()))
            .join("captures");
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
        let at = 1_700_000_000_123;
        let stamp = capture_stamp(at);
        assert_eq!(stamp.len(), 19);
        assert!(
            stamp
                .bytes()
                .enumerate()
                .all(|(i, b)| if [4, 7, 13, 16].contains(&i) { b == b'-' } else if i == 10 { b == b'_' } else { b.is_ascii_digit() }),
            "{stamp}"
        );
        assert_eq!(capture_label(Some("Endfield")), "Endfield");
        assert_eq!(capture_label(Some("Zenless Zone Zero!")), "ZenlessZoneZero");
        assert_eq!(capture_label(Some("../..\\x")), "x");
        assert_eq!(capture_label(Some("ゲーム")), "capture");
        assert_eq!(capture_label(None), "capture");

        // The folder is made on first use.
        let first = save_capture_jpeg(&dir, b"\xFF\xD8one", at, Some("Star Rail.exe")).unwrap();
        assert_eq!(first, dir.join(format!("{stamp}_StarRailexe.jpg")));
        assert_eq!(std::fs::read(&first).unwrap(), b"\xFF\xD8one");
        let second = save_capture_jpeg(&dir, b"\xFF\xD8two", at, Some("Star Rail.exe")).unwrap();
        assert_eq!(second, dir.join(format!("{stamp}_StarRailexe-2.jpg")));
        let third = save_capture_jpeg(&dir, b"\xFF\xD8three", at, Some("Star Rail.exe")).unwrap();
        assert_eq!(third, dir.join(format!("{stamp}_StarRailexe-3.jpg")));
        assert_eq!(std::fs::read(&first).unwrap(), b"\xFF\xD8one");
        let plain = save_capture_jpeg(&dir, b"\xFF\xD8", at, None).unwrap();
        assert_eq!(plain, dir.join(format!("{stamp}_capture.jpg")));
        // Nothing encoded, nothing kept.
        assert!(save_capture_jpeg(&dir, b"", at, None).is_none());
        // A folder that cannot exist (a file is in the way) is not an error.
        assert!(save_capture_jpeg(&first.join("inside"), b"\xFF\xD8", at, None).is_none());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 4);
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[cfg(windows)]
    #[test]
    fn hotkey_thread_starts_answers_and_stops() {
        let thread = win::Hotkey::start(|| {}).unwrap();
        // Releasing when nothing is held always succeeds.
        assert!(thread.set(None).is_ok());
        thread.stop();
    }
}
