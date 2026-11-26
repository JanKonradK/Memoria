//! Screenshot text, read by the OCR engine built into Windows.
//!
//! Only the recognised lines, the file's name, when it was taken and a small
//! JPEG preview (for the player to check the numbers against) reach the page.
//! The folder path stays here, and nothing is sent anywhere.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tauri::AppHandle;

pub const IMAGE_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "bmp"];
const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
const SETTLE: Duration = Duration::from_millis(800);
/// The preview's longest side, in pixels.
pub const PREVIEW_MAX_SIDE: u32 = 1080;

pub fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// When the file was last written, in epoch milliseconds.
fn observed_at(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or_else(super::now_ms, |d| d.as_millis() as u64)
}

/// A preview data URL as the page gets it: null when it could not be made.
pub fn data_url_json(data_url: &str) -> Value {
    if data_url.is_empty() {
        Value::Null
    } else {
        json!(data_url)
    }
}

/// The size an image is scaled to so its longest side is at most `max_side`.
pub fn fit_within(width: u32, height: u32, max_side: u32) -> (u32, u32) {
    let longest = width.max(height);
    if longest <= max_side || longest == 0 {
        return (width, height);
    }
    let scale = |side: u32| {
        ((u64::from(side) * u64::from(max_side) + u64::from(longest) / 2) / u64::from(longest)).max(1) as u32
    };
    (scale(width), scale(height))
}

/// Crops narrower or shorter than this are upscaled before OCR: Windows reads
/// small HUD digits (`145/200`, `1,200/2,400`) far better at twice the size.
const UPSCALE_BELOW: (u32, u32) = (960, 540);
/// An upscaled crop's longest side stays within this, so OCR stays quick.
const UPSCALE_MAX_SIDE: u32 = 2400;

/// The size a crop is upscaled to before OCR: twice its size, or less when that
/// would pass `max_side` on its longest side. None when it is large enough
/// already, empty, or could not grow by at least a pixel.
pub fn upscale_size(width: u32, height: u32, max_side: u32) -> Option<(u32, u32)> {
    let longest = width.max(height);
    if width == 0 || height == 0 || (width >= UPSCALE_BELOW.0 && height >= UPSCALE_BELOW.1) {
        return None;
    }
    let scale = (f64::from(max_side) / f64::from(longest)).min(2.0);
    let size = |side: u32| (f64::from(side) * scale).round().max(1.0) as u32;
    let (scaled_width, scaled_height) = (size(width), size(height));
    (scaled_width > width && scaled_height > height).then_some((scaled_width, scaled_height))
}

/// Resizes top-down BGRA pixels with bilinear filtering, sampling at pixel
/// centres. None when a size is zero or the buffer is short.
pub fn resize_bgra(src: &[u8], width: u32, height: u32, to_width: u32, to_height: u32) -> Option<Vec<u8>> {
    let (w, h, tw, th) = (width as usize, height as usize, to_width as usize, to_height as usize);
    if w == 0 || h == 0 || tw == 0 || th == 0 || src.len() < w.checked_mul(h)?.checked_mul(4)? {
        return None;
    }
    // Each destination column or row: the two source ones it lies between, and its weight toward the second.
    let taps = |from: usize, to: usize| -> Vec<(usize, usize, f32)> {
        let ratio = from as f32 / to as f32;
        (0..to)
            .map(|i| {
                let at = ((i as f32 + 0.5) * ratio - 0.5).clamp(0.0, (from - 1) as f32);
                let low = at.floor() as usize;
                (low, (low + 1).min(from - 1), at - low as f32)
            })
            .collect()
    };
    let (columns, rows) = (taps(w, tw), taps(h, th));
    let mut out = vec![0u8; tw.checked_mul(th)?.checked_mul(4)?];
    for (y, &(top, bottom, fy)) in rows.iter().enumerate() {
        let (top_row, bottom_row) = (&src[top * w * 4..][..w * 4], &src[bottom * w * 4..][..w * 4]);
        let line = &mut out[y * tw * 4..][..tw * 4];
        for (x, &(left, right, fx)) in columns.iter().enumerate() {
            for channel in 0..4 {
                let at = |row: &[u8], column: usize| f32::from(row[column * 4 + channel]);
                let upper = at(top_row, left) + (at(top_row, right) - at(top_row, left)) * fx;
                let lower = at(bottom_row, left) + (at(bottom_row, right) - at(bottom_row, left)) * fx;
                line[x * 4 + channel] = (upper + (lower - upper) * fy).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    Some(out)
}

/// Bright HUD text as dark text on white, for OCR to read past busy art.
///
/// Brightness is `V = max(R, G, B)`. The brightest text sets the level: the
/// 99.5th percentile of V (at least 160), so a stray hot pixel does not. Pixels
/// well above `threshold = peak - max(12% of peak, 24)` turn black and those
/// well below it white, on a 32-level ramp around it. Run it on the 2x
/// upscaled pixels, so a 1px slash is about 2px wide before it is thresholded.
pub fn bright_text_pass(bgra: &[u8]) -> Vec<u8> {
    let brightness = |px: &[u8]| px[0].max(px[1]).max(px[2]);
    let mut histogram = [0u64; 256];
    for px in bgra.chunks_exact(4) {
        histogram[usize::from(brightness(px))] += 1;
    }
    let total: u64 = histogram.iter().sum();
    let wanted = (total * 995).div_ceil(1000).max(1);
    let mut seen = 0;
    let mut peak = 255;
    for (level, count) in histogram.iter().enumerate() {
        seen += count;
        if seen >= wanted {
            peak = level as i32;
            break;
        }
    }
    let peak = peak.max(160);
    let threshold = peak - (peak * 12 / 100).max(24);
    let mut out = Vec::with_capacity(bgra.len());
    for px in bgra.chunks_exact(4) {
        let v = i32::from(brightness(px));
        let ink = (255 - (v - (threshold - 16)) * 255 / 32).clamp(0, 255) as u8;
        out.extend_from_slice(&[ink, ink, ink, 255]);
    }
    out
}

/// One way an image is read; its name is what the page sees.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PassKind {
    /// As captured.
    Raw1x,
    /// Upscaled twice (see `upscale_size`), so small HUD digits read.
    Raw2x,
    /// Upscaled twice, then bright text on white (see `bright_text_pass`).
    Bright2x,
    /// A window's top band (see `top_band`), upscaled twice: where HUD bars sit.
    TopBand2x,
}

impl PassKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::Raw1x => "raw1x",
            Self::Raw2x => "raw2x",
            Self::Bright2x => "bright2x",
            Self::TopBand2x => "topBand2x",
        }
    }
}

/// A crop smaller than this is too small for Windows to read as it is: only its upscaled passes run.
const TINY_BELOW: (u32, u32) = (48, 24);
/// A snip with up to this many areas reads each in every pass; more read only the primary one.
pub const MULTI_PASS_MAX_CROPS: usize = 4;
/// A window's top band: its top fifth, where stamina bars and endgame floors sit.
const TOP_BAND_PERCENT: u32 = 20;
/// A top band shorter than this holds nothing worth reading.
const TOP_BAND_MIN_HEIGHT: u32 = 16;
/// The upscaled top band's longest side stays within this.
const TOP_BAND_MAX_SIDE: u32 = 4096;

/// The passes a snipped area or a picked image is read with, the primary one
/// (whose lines the page keeps as `lines`) first. A large image is read once,
/// as it is; a small one upscaled, then (with `multi`) as it is too, unless
/// tiny, since 2x can drop a line 1x reads, and as bright text on white.
/// `engine_max` is the longest side Windows OCR reads.
pub fn image_plan(width: u32, height: u32, engine_max: u32, multi: bool) -> Vec<PassKind> {
    if upscale_size(width, height, UPSCALE_MAX_SIDE.min(engine_max)).is_none() {
        return vec![PassKind::Raw1x];
    }
    if !multi {
        return vec![PassKind::Raw2x];
    }
    let tiny = width < TINY_BELOW.0 || height < TINY_BELOW.1;
    let mut plan = vec![PassKind::Raw2x];
    if !tiny {
        plan.push(PassKind::Raw1x);
    }
    plan.push(PassKind::Bright2x);
    plan
}

/// The passes a whole game window is read with: all of it as it is (or
/// upscaled, when the window is small enough to be upscaled whole), and its
/// top band upscaled twice.
pub fn window_plan(width: u32, height: u32, engine_max: u32) -> Vec<PassKind> {
    if upscale_size(width, height, UPSCALE_MAX_SIDE.min(engine_max)).is_some() {
        return vec![PassKind::Raw2x];
    }
    let mut plan = vec![PassKind::Raw1x];
    if top_band(width, height, engine_max).is_some() {
        plan.push(PassKind::TopBand2x);
    }
    plan
}

/// A window's top band as `(band height, upscaled width, upscaled height)`,
/// or None when it is too short or cannot grow.
pub fn top_band(width: u32, height: u32, engine_max: u32) -> Option<(u32, u32, u32)> {
    let band = height * TOP_BAND_PERCENT / 100;
    if band < TOP_BAND_MIN_HEIGHT {
        return None;
    }
    let (to_width, to_height) = upscale_size(width, band, TOP_BAND_MAX_SIDE.min(engine_max))?;
    Some((band, to_width, to_height))
}

/// One recognised word and where it sits, in the pixels of the image its region was cut from.
#[derive(Clone, Debug, PartialEq)]
pub struct WordBox {
    pub text: String,
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

/// At most this many word boxes are kept from one pass.
const MAX_WORDS: usize = 1000;

/// What one pass read: its lines in rows (see `arrange_lines`) and its words.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PassText {
    pub lines: Vec<String>,
    pub words: Vec<WordBox>,
}

/// One pass over one region.
#[derive(Clone, Debug, PartialEq)]
pub struct Pass {
    pub kind: PassKind,
    pub text: PassText,
}

/// The passes of one region as the page takes them: `{ name, region, lines,
/// words: [{ text, l, t, r, b }] }`, word edges in whole pixels.
pub fn passes_json(region: usize, passes: &[Pass]) -> Vec<Value> {
    passes
        .iter()
        .map(|pass| {
            let words: Vec<Value> = pass
                .text
                .words
                .iter()
                .map(|word| {
                    json!({
                        "text": word.text,
                        "l": word.left.round() as i64,
                        "t": word.top.round() as i64,
                        "r": word.right.round() as i64,
                        "b": word.bottom.round() as i64,
                    })
                })
                .collect();
            json!({ "name": pass.kind.name(), "region": region, "lines": pass.text.lines, "words": words })
        })
        .collect()
}

/// Word boxes read from a scaled image, put back in the source image's pixels.
fn unscale_words(words: Vec<WordBox>, scale: (f32, f32)) -> Vec<WordBox> {
    words
        .into_iter()
        .map(|word| WordBox {
            left: word.left * scale.0,
            top: word.top * scale.1,
            right: word.right * scale.0,
            bottom: word.bottom * scale.1,
            ..word
        })
        .collect()
}

/// One recognised line and where it sits in the image, in pixels.
#[derive(Clone, Debug, PartialEq)]
pub struct LineBox {
    pub text: String,
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

impl LineBox {
    fn center_y(&self) -> f32 {
        (self.top + self.bottom) / 2.0
    }

    fn height(&self) -> f32 {
        (self.bottom - self.top).max(0.0)
    }

    /// No horizontal overlap: side by side, not stacked.
    fn apart(&self, other: &LineBox) -> bool {
        self.right <= other.left || other.right <= self.left
    }

    /// On the same row: vertical centres within 0.55 of the shorter line's
    /// height, and side by side.
    fn beside(&self, other: &LineBox) -> bool {
        (self.center_y() - other.center_y()).abs() <= 0.55 * self.height().min(other.height()) && self.apart(other)
    }
}

/// Lines between the columns of one row, so a label and its value read as one line.
pub const ROW_GAP: &str = "   ";
/// A recognised line is clipped to this many characters.
const MAX_LINE_CHARS: usize = 500;
/// At most this many lines are read from one image.
const MAX_LINES: usize = 400;

/// The lines top to bottom, then left to right. Lines sitting side by side on
/// one row (a two-column HUD table: `Trailblaze Power` and `145/200`) are
/// joined left to right with `ROW_GAP`, replacing the separate fragments, so
/// a label and its number stay on one line for matching.
pub fn arrange_lines(mut boxes: Vec<LineBox>) -> Vec<String> {
    boxes.sort_by(|a, b| a.center_y().total_cmp(&b.center_y()).then(a.left.total_cmp(&b.left)));
    let mut rows: Vec<Vec<LineBox>> = Vec::new();
    for line in boxes {
        // Measured against the row's first line, so a row never drifts down the page.
        if let Some(row) = rows.last_mut()
            && row[0].beside(&line)
            && row.iter().all(|other| other.apart(&line))
        {
            row.push(line);
            continue;
        }
        rows.push(vec![line]);
    }
    rows.into_iter()
        .map(|mut row| {
            row.sort_by(|a, b| a.left.total_cmp(&b.left));
            let texts: Vec<&str> = row.iter().map(|line| line.text.trim()).collect();
            texts.join(ROW_GAP).chars().take(MAX_LINE_CHARS).collect()
        })
        .collect()
}

/// `{ fileName, observedAt, lines, passes, source, dataUrl }` for one image:
/// `lines` is the primary pass's. Blocking: run it off the async runtime.
pub fn read_image(path: &Path) -> Result<Value, String> {
    if !is_image(path) {
        return Err("Choose a PNG, JPEG, WebP or BMP screenshot.".into());
    }
    let meta = std::fs::metadata(path).map_err(|_| "The screenshot could not be opened.".to_string())?;
    if meta.len() > MAX_IMAGE_BYTES {
        return Err("This screenshot is larger than 25 MB.".into());
    }
    let (passes, data_url) = recognize_file(path)?;
    let lines = passes.first().map(|pass| pass.text.lines.clone()).unwrap_or_default();
    Ok(json!({
        "fileName": file_name(path),
        "observedAt": observed_at(path),
        "lines": lines,
        "passes": passes_json(0, &passes),
        "source": "file",
        "dataUrl": data_url_json(&data_url),
    }))
}

/// The longest side Windows OCR reads.
#[cfg(windows)]
pub fn engine_max_side() -> u32 {
    windows::Media::Ocr::OcrEngine::MaxImageDimension().unwrap_or(10_000)
}

#[cfg(windows)]
fn recognize_file(path: &Path) -> Result<(Vec<Pass>, String), String> {
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Storage::{FileAccessMode, StorageFile};
    use windows::core::HSTRING;

    let unreadable = |_| "Windows could not read this image.".to_string();
    // WinRT wants a plain absolute Windows path.
    let absolute = std::path::absolute(path).map_err(|_| "The screenshot could not be opened.".to_string())?;
    let text = absolute.to_string_lossy().replace('/', "\\");
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(text))
        .and_then(|op| op.join())
        .map_err(|_| "The screenshot could not be opened.".to_string())?;
    let stream = file
        .OpenAsync(FileAccessMode::Read)
        .and_then(|op| op.join())
        .map_err(unreadable)?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .and_then(|op| op.join())
        .map_err(unreadable)?;
    let max = windows::Media::Ocr::OcrEngine::MaxImageDimension().unwrap_or(10_000);
    let (width, height) = (
        decoder.PixelWidth().map_err(unreadable)?,
        decoder.PixelHeight().map_err(unreadable)?,
    );
    if width > max || height > max {
        return Err(format!(
            "This image is larger than Windows can read ({max} pixels on a side)."
        ));
    }
    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .and_then(|op| op.join())
        .map_err(unreadable)?;
    // A small image (a cropped snip from another tool) is read in every pass, like a capture's crop.
    let plan = image_plan(width, height, max, true);
    let pixels = (plan != [PassKind::Raw1x]).then(|| bitmap_bgra(&bitmap).ok()).flatten();
    let passes = match pixels {
        Some(pixels) => recognize_passes(&pixels, width, height, &plan)?,
        None => vec![Pass {
            kind: PassKind::Raw1x,
            text: recognize_bitmap(&bitmap)?,
        }],
    };
    let (data_url, _) = encode_preview(&bitmap, PREVIEW_MAX_SIDE);
    Ok((passes, data_url))
}

#[cfg(not(windows))]
fn recognize_file(_path: &Path) -> Result<(Vec<Pass>, String), String> {
    Err("Screenshot reading needs Windows.".into())
}

/// A JPEG of a bitmap no larger than `max_side`, as a data URL and as the same
/// JPEG's bytes (encoded once). Both are empty when Windows could not encode
/// it: the text is what counts. Blocking.
#[cfg(windows)]
pub fn encode_preview(bitmap: &windows::Graphics::Imaging::SoftwareBitmap, max_side: u32) -> (String, Vec<u8>) {
    use base64::Engine;
    use windows::Graphics::Imaging::BitmapEncoder;

    let jpeg = BitmapEncoder::JpegEncoderId()
        .ok()
        .and_then(|id| encode_bitmap(bitmap, id, max_side).ok())
        .unwrap_or_default();
    let data_url = if jpeg.is_empty() {
        String::new()
    } else {
        format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&jpeg)
        )
    };
    (data_url, jpeg)
}

/// A WinRT bitmap from opaque top-down BGRA pixels.
#[cfg(windows)]
pub fn software_bitmap(
    bgra: &[u8],
    width: u32,
    height: u32,
) -> Result<windows::Graphics::Imaging::SoftwareBitmap, String> {
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Storage::Streams::DataWriter;
    let failed = |_| "Windows could not read the screen capture.".to_string();
    let writer = DataWriter::new().map_err(failed)?;
    writer.WriteBytes(bgra).map_err(failed)?;
    let buffer = writer.DetachBuffer().map_err(failed)?;
    SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        width as i32,
        height as i32,
        BitmapAlphaMode::Premultiplied,
    )
    .map_err(failed)
}

/// A bitmap's pixels as opaque top-down BGRA, `width * height * 4` bytes.
#[cfg(windows)]
fn bitmap_bgra(bitmap: &windows::Graphics::Imaging::SoftwareBitmap) -> Result<Vec<u8>, String> {
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Storage::Streams::{Buffer, DataReader};
    let failed = |_| "Windows could not read this image.".to_string();
    let converted = SoftwareBitmap::ConvertWithAlpha(bitmap, BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore)
        .map_err(failed)?;
    let (width, height) = (
        converted.PixelWidth().map_err(failed)?.max(0) as u64,
        converted.PixelHeight().map_err(failed)?.max(0) as u64,
    );
    let size = u32::try_from(width * height * 4).map_err(|_| "This image is too large.".to_string())?;
    let buffer = Buffer::Create(size).map_err(failed)?;
    converted.CopyToBuffer(&buffer).map_err(failed)?;
    if buffer.Length().map_err(failed)? != size {
        return Err("Windows could not read this image.".into());
    }
    let reader = DataReader::FromBuffer(&buffer).map_err(failed)?;
    let mut pixels = vec![0u8; size as usize];
    reader.ReadBytes(&mut pixels).map_err(failed)?;
    for alpha in pixels.iter_mut().skip(3).step_by(4) {
        *alpha = 255;
    }
    Ok(pixels)
}

/// The text in opaque top-down BGRA pixels, read once per pass in `plan`
/// (see `image_plan` and `window_plan`), word boxes in these pixels. The
/// first pass is the primary one and its failure is the read's; a later pass
/// that fails is left out. Blocking.
#[cfg(windows)]
pub fn recognize_passes(bgra: &[u8], width: u32, height: u32, plan: &[PassKind]) -> Result<Vec<Pass>, String> {
    let max = engine_max_side();
    // Reads pixels of `size` and puts the words back in the pixels of `source`, the part they were scaled from.
    let read = |pixels: &[u8], size: (u32, u32), source: (u32, u32)| -> Result<PassText, String> {
        let text = recognize_bitmap(&software_bitmap(pixels, size.0, size.1)?)?;
        let scale = (source.0 as f32 / size.0 as f32, source.1 as f32 / size.1 as f32);
        Ok(PassText {
            words: unscale_words(text.words, scale),
            ..text
        })
    };
    // Upscaled once for both 2x passes, and left as it is when it cannot grow.
    let doubled = plan
        .iter()
        .any(|kind| matches!(kind, PassKind::Raw2x | PassKind::Bright2x))
        .then(|| upscale_size(width, height, UPSCALE_MAX_SIDE.min(max)))
        .flatten()
        .and_then(|(to_width, to_height)| {
            resize_bgra(bgra, width, height, to_width, to_height).map(|pixels| (pixels, to_width, to_height))
        });
    let (double, double_size) = match &doubled {
        Some((pixels, to_width, to_height)) => (pixels.as_slice(), (*to_width, *to_height)),
        None => (bgra, (width, height)),
    };
    let mut passes = Vec::new();
    for (index, &kind) in plan.iter().enumerate() {
        let text = match kind {
            PassKind::Raw1x => read(bgra, (width, height), (width, height)),
            PassKind::Raw2x => {
                // Skip when upscaling could not grow the image: 1x is already read or covers it.
                if doubled.is_none() && plan.contains(&PassKind::Raw1x) {
                    continue;
                }
                read(double, double_size, (width, height))
            }
            PassKind::Bright2x => read(&bright_text_pass(double), double_size, (width, height)),
            PassKind::TopBand2x => {
                // Top-down rows: the band is the start of the buffer.
                let band = top_band(width, height, max).and_then(|(band, to_width, to_height)| {
                    let rows = bgra.get(..width as usize * band as usize * 4)?;
                    let pixels = resize_bgra(rows, width, band, to_width, to_height)?;
                    Some((pixels, (to_width, to_height), (width, band)))
                });
                let Some((pixels, size, source)) = band else { continue };
                read(&pixels, size, source)
            }
        };
        match text {
            Ok(text) => passes.push(Pass { kind, text }),
            Err(error) if index == 0 => return Err(error),
            Err(_) => {}
        }
    }
    Ok(passes)
}

#[cfg(windows)]
fn recognize_bitmap(bitmap: &windows::Graphics::Imaging::SoftwareBitmap) -> Result<PassText, String> {
    use windows::Media::Ocr::OcrEngine;

    let unreadable = |_| "Windows could not read this image.".to_string();
    let max = OcrEngine::MaxImageDimension().unwrap_or(10_000);
    let (width, height) = (
        bitmap.PixelWidth().map_err(unreadable)?,
        bitmap.PixelHeight().map_err(unreadable)?,
    );
    if width <= 0 || height <= 0 {
        return Err("This image is empty.".into());
    }
    if width as u32 > max || height as u32 > max {
        return Err(format!(
            "This image is larger than Windows can read ({max} pixels on a side)."
        ));
    }
    let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| {
        "Windows has no text recognition for your languages. Add a language pack in Windows Settings.".to_string()
    })?;
    let result = engine
        .RecognizeAsync(bitmap)
        .and_then(|op| op.join())
        .map_err(|_| "Windows could not read text in this image.".to_string())?;
    let mut boxes = Vec::new();
    // Lines Windows gave without a position keep its order, after the placed ones.
    let mut unplaced = Vec::new();
    let mut placed_words = Vec::new();
    for line in result.Lines().map_err(unreadable)? {
        let mut words = Vec::new();
        let mut bounds: Option<(f32, f32, f32, f32)> = None;
        for word in line.Words().into_iter().flatten() {
            let Ok(text) = word.Text() else { continue };
            let text = text.to_string();
            if let Ok(rect) = word.BoundingRect() {
                let (left, top, right, bottom) = (rect.X, rect.Y, rect.X + rect.Width, rect.Y + rect.Height);
                bounds = Some(match bounds {
                    None => (left, top, right, bottom),
                    Some((l, t, r, b)) => (l.min(left), t.min(top), r.max(right), b.max(bottom)),
                });
                if placed_words.len() < MAX_WORDS && !text.trim().is_empty() {
                    placed_words.push(WordBox {
                        text: text.chars().take(MAX_LINE_CHARS).collect(),
                        left,
                        top,
                        right,
                        bottom,
                    });
                }
            }
            words.push(text);
        }
        let text = if words.is_empty() {
            line.Text().map(|t| t.to_string()).unwrap_or_default()
        } else {
            words.join(" ")
        };
        if text.trim().is_empty() {
            continue;
        }
        let text: String = text.chars().take(MAX_LINE_CHARS).collect();
        match bounds {
            Some((left, top, right, bottom)) => boxes.push(LineBox {
                text,
                left,
                top,
                right,
                bottom,
            }),
            None => unplaced.push(text),
        }
        if boxes.len() + unplaced.len() >= MAX_LINES {
            break;
        }
    }
    let mut lines = arrange_lines(boxes);
    lines.extend(unplaced);
    Ok(PassText {
        lines,
        words: placed_words,
    })
}

/// Encodes a bitmap with a WinRT encoder (`JpegEncoderId`, `PngEncoderId`),
/// scaled down so its longest side is at most `max_side`. Blocking.
#[cfg(windows)]
pub fn encode_bitmap(
    bitmap: &windows::Graphics::Imaging::SoftwareBitmap,
    encoder_id: windows::core::GUID,
    max_side: u32,
) -> Result<Vec<u8>, String> {
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapEncoder, BitmapInterpolationMode, BitmapPixelFormat, SoftwareBitmap,
    };
    use windows::Storage::Streams::{DataReader, InMemoryRandomAccessStream};

    let failed = |_| "Windows could not encode the screenshot.".to_string();
    let converted;
    let source = if bitmap.BitmapPixelFormat().map_err(failed)? == BitmapPixelFormat::Bgra8 {
        bitmap
    } else {
        converted = SoftwareBitmap::ConvertWithAlpha(bitmap, BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied)
            .map_err(failed)?;
        &converted
    };
    let (width, height) = (
        source.PixelWidth().map_err(failed)?.max(0) as u32,
        source.PixelHeight().map_err(failed)?.max(0) as u32,
    );
    let stream = InMemoryRandomAccessStream::new().map_err(failed)?;
    let encoder = BitmapEncoder::CreateAsync(encoder_id, &stream)
        .and_then(|op| op.join())
        .map_err(failed)?;
    encoder.SetSoftwareBitmap(source).map_err(failed)?;
    let (scaled_width, scaled_height) = fit_within(width, height, max_side);
    if (scaled_width, scaled_height) != (width, height) {
        let transform = encoder.BitmapTransform().map_err(failed)?;
        transform.SetScaledWidth(scaled_width).map_err(failed)?;
        transform.SetScaledHeight(scaled_height).map_err(failed)?;
        transform
            .SetInterpolationMode(BitmapInterpolationMode::Fant)
            .map_err(failed)?;
    }
    encoder.FlushAsync().and_then(|op| op.join()).map_err(failed)?;
    let size = u32::try_from(stream.Size().map_err(failed)?).map_err(|_| "The screenshot is too large.".to_string())?;
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).map_err(failed)?).map_err(failed)?;
    reader.LoadAsync(size).and_then(|op| op.join()).map_err(failed)?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).map_err(failed)?;
    Ok(bytes)
}

/// Picks one image in a native dialog and reads it. None when the player cancels.
pub fn pick_and_read(parent: Option<tauri::WebviewWindow>) -> Result<Option<Value>, String> {
    let mut dialog = rfd::FileDialog::new()
        .set_title("Choose a screenshot")
        .add_filter("Images", &IMAGE_EXTENSIONS);
    if let Some(window) = &parent {
        dialog = dialog.set_parent(window);
    }
    match dialog.pick_file() {
        Some(path) => read_image(&path).map(Some),
        None => Ok(None),
    }
}

/// Watches one folder (not its subfolders) for new screenshots. Each settles
/// for ~800 ms after its last write, then its text goes to the page as
/// `memoria:screenshot-ocr`. Dropping the watcher ends the worker thread.
pub fn watch_folder(app: &AppHandle, dir: &Path) -> Option<notify::RecommendedWatcher> {
    use notify::{EventKind, RecursiveMode, Watcher};
    let (sender, receiver) = mpsc::channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event
            && matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_))
        {
            for path in event.paths.into_iter().filter(|p| is_image(p)) {
                let _ = sender.send(path);
            }
        }
    })
    .ok()?;
    watcher.watch(dir, RecursiveMode::NonRecursive).ok()?;
    let app = app.clone();
    std::thread::Builder::new()
        .name("memoria-screenshot-watch".into())
        .spawn(move || {
            let mut pending: HashMap<PathBuf, Instant> = HashMap::new();
            loop {
                match receiver.recv_timeout(Duration::from_millis(200)) {
                    Ok(path) => {
                        pending.insert(path, Instant::now());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
                let ready: Vec<PathBuf> = pending
                    .iter()
                    .filter(|(_, at)| at.elapsed() >= SETTLE)
                    .map(|(path, _)| path.clone())
                    .collect();
                for path in ready {
                    pending.remove(&path);
                    if path.is_file()
                        && let Ok(payload) = read_image(&path)
                    {
                        crate::emit(&app, "memoria:screenshot-ocr", payload);
                    }
                }
                pending.retain(|_, at| at.elapsed() < Duration::from_secs(60));
            }
        })
        .ok()?;
    Some(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_images_are_read() {
        assert!(is_image(Path::new(r"C:\Shots\a.PNG")));
        assert!(is_image(Path::new("b.jpeg")));
        assert!(!is_image(Path::new("c.gif")));
        assert!(!is_image(Path::new("d")));
        assert!(read_image(Path::new("notes.txt")).is_err());
    }

    #[test]
    fn previews_fit_the_longest_side() {
        assert_eq!(fit_within(1920, 1080, 1080), (1080, 608));
        assert_eq!(fit_within(1080, 2400, 1080), (486, 1080));
        assert_eq!(fit_within(800, 600, 1080), (800, 600));
        assert_eq!(fit_within(5000, 1, 1080), (1080, 1));
        assert_eq!(fit_within(0, 0, 1080), (0, 0));
        assert_eq!(data_url_json(""), Value::Null);
        assert_eq!(
            data_url_json("data:image/jpeg;base64,AA"),
            json!("data:image/jpeg;base64,AA")
        );
    }

    #[test]
    fn small_crops_are_upscaled_within_the_limit() {
        assert_eq!(upscale_size(300, 80, 2400), Some((600, 160)));
        assert_eq!(upscale_size(959, 1080, 2400), Some((1918, 2160)));
        // Wide but short: grows only as far as the longest side allows.
        assert_eq!(upscale_size(1900, 100, 2400), Some((2400, 126)));
        // Large enough already, or no room to grow.
        assert_eq!(upscale_size(960, 540, 2400), None);
        assert_eq!(upscale_size(1920, 1080, 2400), None);
        assert_eq!(upscale_size(2400, 100, 2400), None);
        assert_eq!(upscale_size(0, 100, 2400), None);
        assert_eq!(upscale_size(100, 0, 2400), None);
    }

    #[test]
    fn bilinear_resize_keeps_flat_colour_and_blends_edges() {
        // A flat 3x2 image stays flat at any size.
        let flat: Vec<u8> = [10u8, 20, 30, 255].repeat(6);
        let doubled = resize_bgra(&flat, 3, 2, 6, 4).unwrap();
        assert_eq!(doubled.len(), 6 * 4 * 4);
        assert!(doubled.chunks(4).all(|px| px == [10, 20, 30, 255]));
        // Black then white: the doubled row ramps between them, ends kept exact.
        let edge = [0u8, 0, 0, 255, 255, 255, 255, 255];
        let row = resize_bgra(&edge, 2, 1, 4, 1).unwrap();
        let blue: Vec<u8> = row.chunks(4).map(|px| px[0]).collect();
        assert_eq!(blue, [0, 64, 191, 255]);
        assert!(row.chunks(4).all(|px| px[3] == 255));
        // Same size is a copy.
        assert_eq!(resize_bgra(&edge, 2, 1, 2, 1).unwrap(), edge);
        assert!(resize_bgra(&edge, 2, 1, 0, 1).is_none());
        assert!(resize_bgra(&edge[..4], 2, 1, 4, 1).is_none());
    }

    /// A `size x size` BGRA image: `V = 60` ground, a `V = 200` grey block at
    /// 4..10, and a 1px `V = 230` slash down the diagonal, crossing the block.
    fn slash_over_grey(size: usize) -> Vec<u8> {
        let mut pixels = Vec::with_capacity(size * size * 4);
        for y in 0..size {
            for x in 0..size {
                let px: [u8; 4] = if x == y {
                    [230, 120, 40, 255]
                } else if (4..10).contains(&x) && (4..10).contains(&y) {
                    [200, 200, 200, 255]
                } else {
                    [30, 45, 60, 255]
                };
                pixels.extend_from_slice(&px);
            }
        }
        pixels
    }

    #[test]
    fn bright_text_keeps_the_slash_dark_and_the_grey_light() {
        let size = 20;
        let out = bright_text_pass(&slash_over_grey(size));
        assert_eq!(out.len(), size * size * 4);
        let at = |x: usize, y: usize| &out[(y * size + x) * 4..][..4];
        // The 99.5th percentile is the slash: peak 230, threshold 230 - 27 = 203.
        for i in 0..size {
            assert_eq!(at(i, i), [0, 0, 0, 255], "slash at {i}");
        }
        // Inside the block the slash is still the darkest thing there.
        assert_eq!(at(6, 6), [0, 0, 0, 255]);
        // The grey block falls on the white side of the ramp around the threshold...
        let grey = at(5, 7)[0];
        assert_eq!(grey, 152);
        assert!(grey > 128 && at(5, 7) == [grey, grey, grey, 255]);
        // ...and the ground is plain white.
        assert_eq!(at(15, 2), [255, 255, 255, 255]);
        assert_eq!(at(0, 19), [255, 255, 255, 255]);
    }

    #[test]
    fn bright_text_needs_bright_text() {
        // Nothing past 160: the peak floor keeps a dim picture from turning to ink.
        let dim = [90u8, 100, 80, 255].repeat(64);
        assert!(bright_text_pass(&dim).chunks(4).all(|px| px == [255, 255, 255, 255]));
        assert!(bright_text_pass(&[]).is_empty());
    }

    #[test]
    fn passes_are_planned_by_size() {
        use PassKind::*;
        // A small snip: upscaled first (the primary), then as it is, then as bright text.
        assert_eq!(image_plan(300, 80, 10_000, true), [Raw2x, Raw1x, Bright2x]);
        // Tiny: 1x is not worth reading.
        assert_eq!(image_plan(40, 18, 10_000, true), [Raw2x, Bright2x]);
        // Many areas: only the primary pass.
        assert_eq!(image_plan(300, 80, 10_000, false), [Raw2x]);
        // Large: read once, as it is.
        assert_eq!(image_plan(1920, 1080, 10_000, true), [Raw1x]);
        // A whole window: all of it, and its top band.
        assert_eq!(window_plan(1920, 1080, 10_000), [Raw1x, TopBand2x]);
        // A small window is upscaled whole, so it has no band of its own.
        assert_eq!(window_plan(800, 450, 10_000), [Raw2x]);
        assert_eq!(
            [Raw1x, Raw2x, Bright2x, TopBand2x].map(PassKind::name),
            ["raw1x", "raw2x", "bright2x", "topBand2x"]
        );
    }

    #[test]
    fn the_top_band_is_the_top_fifth_upscaled() {
        assert_eq!(top_band(1920, 1080, 10_000), Some((216, 3840, 432)));
        // A wide window grows only as far as the band's longest side allows.
        assert_eq!(top_band(3840, 2160, 10_000), Some((432, 4096, 461)));
        // Too short to hold a HUD.
        assert_eq!(top_band(1920, 70, 10_000), None);
    }

    #[test]
    fn passes_reach_the_page_with_their_region_and_words() {
        let passes = [
            Pass {
                kind: PassKind::Raw2x,
                text: PassText {
                    lines: vec!["388   61/240".into()],
                    words: vec![WordBox {
                        text: "61/240".into(),
                        left: 40.4,
                        top: 2.5,
                        right: 90.0,
                        bottom: 20.2,
                    }],
                },
            },
            Pass {
                kind: PassKind::Bright2x,
                text: PassText::default(),
            },
        ];
        let json = passes_json(2, &passes);
        assert_eq!(
            json[0],
            json!({
                "name": "raw2x",
                "region": 2,
                "lines": ["388   61/240"],
                "words": [{ "text": "61/240", "l": 40, "t": 3, "r": 90, "b": 20 }],
            })
        );
        assert_eq!(json[1], json!({ "name": "bright2x", "region": 2, "lines": [], "words": [] }));
        // Words read at twice the size go back to the crop's own pixels.
        let words = unscale_words(passes[0].text.words.clone(), (0.5, 0.5));
        assert_eq!((words[0].left, words[0].right, words[0].bottom), (20.2, 45.0, 10.1));
    }

    fn line(text: &str, left: f32, top: f32, right: f32, bottom: f32) -> LineBox {
        LineBox {
            text: text.into(),
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn side_by_side_lines_read_as_one_row() {
        // A two-column HUD table, given out of order with the values a little lower.
        let lines = arrange_lines(vec![
            line("145/200", 600.0, 104.0, 700.0, 124.0),
            line("Daily Training", 40.0, 150.0, 260.0, 170.0),
            line("Trailblaze Power", 40.0, 100.0, 300.0, 120.0),
            line("400/500", 600.0, 151.0, 700.0, 171.0),
            line("Simulated Universe", 40.0, 220.0, 380.0, 240.0),
        ]);
        assert_eq!(
            lines,
            [
                "Trailblaze Power   145/200",
                "Daily Training   400/500",
                "Simulated Universe",
            ]
        );
    }

    #[test]
    fn stacked_or_distant_lines_stay_apart() {
        // Overlapping horizontally: a line under another, not beside it.
        let stacked = arrange_lines(vec![
            line("Stellar Jade", 40.0, 100.0, 300.0, 120.0),
            line("1,200", 100.0, 108.0, 200.0, 128.0),
        ]);
        assert_eq!(stacked, ["Stellar Jade", "1,200"]);
        // Centres further apart than 0.55 of the shorter height: two rows.
        let rows = arrange_lines(vec![
            line("Echo of War", 40.0, 100.0, 300.0, 120.0),
            line("1/3", 600.0, 112.0, 650.0, 132.0),
        ]);
        assert_eq!(rows, ["Echo of War", "1/3"]);
        // Three columns join left to right.
        let three = arrange_lines(vec![
            line("C", 500.0, 0.0, 520.0, 20.0),
            line("A", 0.0, 0.0, 20.0, 20.0),
            line("B", 250.0, 2.0, 270.0, 22.0),
        ]);
        assert_eq!(three, ["A   B   C"]);
        assert!(arrange_lines(Vec::new()).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn bitmap_pixels_round_trip() {
        let (width, height) = (5u32, 3u32);
        let pixels: Vec<u8> = (0..width * height)
            .flat_map(|i| [i as u8, 2 * i as u8, 3 * i as u8, 255])
            .collect();
        let bitmap = software_bitmap(&pixels, width, height).unwrap();
        assert_eq!(bitmap_bgra(&bitmap).unwrap(), pixels);
    }

    /// A real round trip through Windows: pixels in, a JPEG preview out.
    #[cfg(windows)]
    #[test]
    fn bitmaps_encode_to_a_jpeg_preview() {
        use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapEncoder, BitmapPixelFormat, SoftwareBitmap};
        use windows::Storage::Streams::DataWriter;
        let (width, height) = (64, 32);
        let pixels = vec![200u8; width * height * 4];
        let writer = DataWriter::new().unwrap();
        writer.WriteBytes(&pixels).unwrap();
        let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
            &writer.DetachBuffer().unwrap(),
            BitmapPixelFormat::Bgra8,
            width as i32,
            height as i32,
            BitmapAlphaMode::Premultiplied,
        )
        .unwrap();
        let jpeg = encode_bitmap(&bitmap, BitmapEncoder::JpegEncoderId().unwrap(), 16).unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8]);
        let png = encode_bitmap(&bitmap, BitmapEncoder::PngEncoderId().unwrap(), 1080).unwrap();
        assert_eq!(&png[1..4], b"PNG");
    }
}
