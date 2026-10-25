//! Window and link boundaries. Ported from desktop/native-policy.mjs.

use serde::{Deserialize, Serialize};
use url::Url;

pub const PORTS: [u16; 3] = [17817, 17818, 17819];

/// A token Memoria mints: 32 random bytes as base64url, 43 characters.
pub fn is_token(value: &str) -> bool {
    value.len() == 43 && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Only the authenticated launcher may provide the first page for the app.
pub fn launch_origin(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    let port = url.port()?;
    let ticket = url.path().strip_prefix("/api/launch/")?;
    let valid = url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && PORTS.contains(&port)
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && is_token(ticket);
    valid.then(|| format!("http://127.0.0.1:{port}"))
}

pub fn is_app_url(value: &str, origin: &str) -> bool {
    let Ok(url) = Url::parse(value) else { return false };
    !origin.is_empty()
        && url.origin().ascii_serialization() == origin
        && url.username().is_empty()
        && url.password().is_none()
}

/// Game source links may open outside the app, but never execute a local handler.
pub fn external_url(value: &str) -> Option<String> {
    if value.len() > 4096 {
        return None;
    }
    let url = Url::parse(value).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = match url.host()? {
        url::Host::Domain(domain) => domain.to_ascii_lowercase(),
        // IP literals, v4 or v6, are never a game's source page.
        _ => return None,
    };
    let local = host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || !host.contains('.');
    (!local).then(|| url.to_string())
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// JavaScript's Math.round, which rounds halves up rather than away from zero.
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// Restores a saved window onto the display it overlaps most, or centres a
/// default-size window when the saved one no longer fits any display.
pub fn window_bounds(saved: Option<Rect>, areas: &[Rect]) -> Rect {
    let areas: Vec<Rect> = areas
        .iter()
        .copied()
        .filter(|a| [a.x, a.y, a.width, a.height].iter().all(|v| v.is_finite()) && a.width > 0.0 && a.height > 0.0)
        .collect();
    let saved = saved.filter(|s| {
        [s.x, s.y, s.width, s.height].iter().all(|v| v.is_finite())
            && s.width >= 360.0
            && s.height >= 320.0
            && s.width <= 10000.0
            && s.height <= 10000.0
    });
    let overlap = |area: &Rect| match saved {
        Some(s) => {
            (0f64).max((s.x + s.width).min(area.x + area.width) - s.x.max(area.x))
                * (0f64).max((s.y + s.height).min(area.y + area.height) - s.y.max(area.y))
        }
        None => 0.0,
    };
    let fallback = Rect { x: 0.0, y: 0.0, width: 1280.0, height: 900.0 };
    let area = areas.iter().copied().fold(areas.first().copied().unwrap_or(fallback), |best, item| {
        if overlap(&item) > overlap(&best) { item } else { best }
    });
    let restore = saved.filter(|_| overlap(&area) > 0.0);
    let width = area.width.min((360f64).max(restore.map_or(1280.0, |s| s.width)));
    let height = area.height.min((480f64).max(restore.map_or(900.0, |s| s.height)));
    let (x, y) = match restore {
        Some(s) => {
            (area.x.max(s.x.min(area.x + area.width - width)), area.y.max(s.y.min(area.y + area.height - height)))
        }
        None => (area.x + (area.width - width) / 2.0, area.y + (area.height - height) / 2.0),
    };
    Rect { x: js_round(x), y: js_round(y), width: js_round(width), height: js_round(height) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect { x, y, width, height }
    }

    #[test]
    fn accepts_only_the_authenticated_launch_url() {
        let ticket = "a".repeat(43);
        assert_eq!(
            launch_origin(&format!("http://127.0.0.1:17817/api/launch/{ticket}")).as_deref(),
            Some("http://127.0.0.1:17817")
        );
        for bad in [
            format!("https://127.0.0.1:17817/api/launch/{ticket}"),
            format!("http://127.0.0.1:17820/api/launch/{ticket}"),
            format!("http://evil.example:17817/api/launch/{ticket}"),
            format!("http://user@127.0.0.1:17817/api/launch/{ticket}"),
            format!("http://127.0.0.1:17817/api/launch/{ticket}?token=extra"),
            "file:///C:/private.txt".into(),
            "not a URL".into(),
        ] {
            assert_eq!(launch_origin(&bad), None, "{bad}");
        }
    }

    #[test]
    fn keeps_navigation_on_the_app_origin() {
        let origin = "http://127.0.0.1:17817";
        assert!(is_app_url(&format!("{origin}/#games"), origin));
        for bad in
            ["http://127.0.0.1:17818/", "https://example.com", "file:///C:/x", "http://127.0.0.1:17817.evil.test/"]
        {
            assert!(!is_app_url(bad, origin), "{bad}");
        }
        assert!(!is_app_url(origin, ""));
    }

    #[test]
    fn opens_only_public_https_pages() {
        assert_eq!(external_url("https://hoyolab.com/article/123").as_deref(), Some("https://hoyolab.com/article/123"));
        for bad in [
            "file:///C:/x.exe",
            "javascript:alert(1)",
            "ms-settings:windowsupdate",
            "https://localhost/",
            "https://127.0.0.1/",
            "https://[::1]/",
            "https://printer.local/",
            "https://name:password@example.com",
            "http://example.com",
            "not a URL",
        ] {
            assert_eq!(external_url(bad), None, "{bad}");
        }
    }

    #[test]
    fn recovers_a_window_from_a_disconnected_monitor() {
        let displays = [rect(0.0, 0.0, 1920.0, 1080.0)];
        let saved = rect(100.0, 100.0, 1200.0, 800.0);
        assert_eq!(window_bounds(Some(saved), &displays), saved);
        let centred = rect(320.0, 90.0, 1280.0, 900.0);
        assert_eq!(window_bounds(Some(rect(4000.0, 100.0, 1200.0, 800.0)), &displays), centred);
        assert_eq!(window_bounds(Some(rect(100.0, 100.0, f64::INFINITY, 800.0)), &displays), centred);
    }

    #[test]
    fn fits_a_small_display() {
        let displays = [rect(0.0, 0.0, 800.0, 560.0)];
        assert_eq!(window_bounds(None, &displays), rect(0.0, 0.0, 800.0, 560.0));
        assert_eq!(window_bounds(Some(rect(10.0, 20.0, 1920.0, 1080.0)), &displays), rect(0.0, 0.0, 800.0, 560.0));
        assert_eq!(window_bounds(Some(rect(0.0, 200.0, 600.0, 350.0)), &displays), rect(0.0, 80.0, 600.0, 480.0));
    }

    #[test]
    fn clamps_placement_on_a_secondary_display() {
        let displays = [rect(0.0, 0.0, 1920.0, 1040.0), rect(-1280.0, 0.0, 1280.0, 720.0)];
        let compact = rect(0.0, 0.0, 360.0, 480.0);
        assert_eq!(window_bounds(Some(compact), &displays), compact);
        assert_eq!(
            window_bounds(Some(rect(-1200.0, 600.0, 1000.0, 600.0)), &displays),
            rect(-1200.0, 120.0, 1000.0, 600.0)
        );
    }
}
