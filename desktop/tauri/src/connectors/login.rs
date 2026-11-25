//! The HoYoLAB sign-in window.
//!
//! A separate WebView2 profile with no bridge script and no capabilities: the
//! page there is HoYoLAB's own and can call nothing in Memoria. Memoria only
//! reads its session cookies from WebView2's cookie manager once the
//! player has signed in, seals them, and closes the window.

use std::time::{Duration, Instant};

use serde_json::json;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow};

use super::Cookies;
use crate::App;

pub const LABEL: &str = "hoyolab-login";
const START: &str = "https://www.hoyolab.com/";
/// How long the window waits for a sign-in before it stops checking.
const GIVE_UP: Duration = Duration::from_secs(30 * 60);

const ALLOWED_HOSTS: [&str; 11] = [
    "hoyolab.com",
    "hoyoverse.com",
    "mihoyo.com",
    "geetest.com",
    "google.com",
    "gstatic.com",
    "recaptcha.net",
    "apple.com",
    "facebook.com",
    "twitter.com",
    "x.com",
];

/// HTTPS to HoYoLAB, its account pages, its captcha and the sign-in providers it offers. Nothing else.
pub fn allowed_login_url(url: &tauri::Url) -> bool {
    if url.scheme() == "about" && url.path() == "blank" {
        return true;
    }
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else { return false };
    ALLOWED_HOSTS
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

/// Opens the sign-in window, or brings the open one forward. A connected
/// account keeps its session, so a re-check needs no new password, 2FA or
/// captcha; `fresh` asks for a clean sign-in instead.
pub fn open(app: &AppHandle, fresh: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let state = app.state::<App>();
    let connected = state.connectors.status()["hoyolab"]["connected"] == true;
    let url: tauri::Url = START.parse().map_err(|_| "The HoYoLAB address is invalid.".to_string())?;
    let checker = app.clone();
    let mut builder = tauri::WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url.clone()))
        .title("Sign in to HoYoLAB · Memoria")
        .inner_size(520.0, 760.0)
        .min_inner_size(360.0, 480.0)
        .center()
        .data_directory(state.connectors.login_profile_dir())
        .on_navigation(allowed_login_url)
        .on_new_window(|url, _| if allowed_login_url(&url) { NewWindowResponse::Allow } else { NewWindowResponse::Deny })
        .on_page_load(move |window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                check_cookies(&checker, &window);
            }
        });
    if let Some(main) = crate::main_window(app) {
        builder = builder.parent(&main).map_err(|_| "The sign-in window could not open.".to_string())?;
    }
    let window = builder
        .build()
        .map_err(|_| "The sign-in window could not open.".to_string())?;
    if !connected || fresh {
        // A disconnected account, or one asked to start over, signs in from a clean profile.
        clear_cookies(&window);
        let _ = window.navigate(url);
    }
    let poller = app.clone();
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        while started.elapsed() < GIVE_UP {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let Some(window) = poller.get_webview_window(LABEL) else { return };
            check_cookies(&poller, &window);
        }
    });
    Ok(())
}

pub fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
}

/// Seals the cookies, reads the account's roles, closes the window and tells the page.
fn complete(app: AppHandle, cookies: Cookies) {
    let state = app.state::<App>();
    if state.connectors.completing.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let epoch = state.connectors.hoyolab_epoch();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<App>();
        let error = match state.connectors.store_cookies(&cookies, epoch) {
            Err(error) => Some(error),
            Ok(()) => match super::hoyolab::fetch_roles(&cookies).await {
                Ok(roles) => state.connectors.set_roles(roles, epoch).err(),
                Err(error) => Some(error),
            },
        };
        drop(cookies);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || close(&handle));
        let mut status = state.connectors.status();
        if let Some(error) = error {
            status["error"] = json!(error);
        }
        crate::emit(&app, "memoria:connector-status", status);
        state.connectors.finish_completing();
    });
}

#[cfg(windows)]
fn clear_cookies(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2;
        use windows_core::Interface;
        // SAFETY: called on the UI thread with WebView2's own controller.
        unsafe {
            if let Ok(manager) = webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_2>())
                .and_then(|core| core.CookieManager())
            {
                let _ = manager.DeleteAllCookies();
            }
        }
    });
}

#[cfg(not(windows))]
fn clear_cookies(_window: &WebviewWindow) {}

/// Asks WebView2 for the profile's cookies (HttpOnly included), keeps only
/// HoYoLAB's and HoYoverse's, and finishes the sign-in once all three session
/// cookies are there.
#[cfg(windows)]
fn check_cookies(app: &AppHandle, window: &WebviewWindow) {
    use webview2_com::GetCookiesCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2;
    use windows_core::Interface;

    if app.state::<App>().connectors.completing.load(std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    let _ = window.with_webview(move |webview| {
        let handler = GetCookiesCompletedHandler::create(Box::new(move |result, list| {
            result?;
            let Some(list) = list else { return Ok(()) };
            // SAFETY: WebView2 hands over a live cookie list for the length of this callback.
            if let Some(cookies) = unsafe { read_session(&list) }? {
                complete(handle, cookies);
            }
            Ok(())
        }));
        // SAFETY: called on the UI thread with WebView2's own controller.
        unsafe {
            if let Ok(manager) = webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_2>())
                .and_then(|core| core.CookieManager())
            {
                let _ = manager.GetCookies(windows_core::PCWSTR::null(), &handler);
            }
        }
    });
}

/// Whether a cookie's domain is HoYoLAB's or HoYoverse's own.
#[cfg_attr(not(windows), allow(dead_code))]
fn hoyo_domain(domain: &str) -> bool {
    let domain = domain.to_ascii_lowercase();
    let domain = domain.trim_start_matches('.');
    ["hoyolab.com", "hoyoverse.com"]
        .iter()
        .any(|allowed| domain == *allowed || domain.ends_with(&format!(".{allowed}")))
}

#[cfg(windows)]
unsafe fn read_session(
    list: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2CookieList,
) -> windows_core::Result<Option<Cookies>> {
    let mut count = 0u32;
    unsafe { list.Count(&mut count)? };
    let mut found: [String; 6] = Default::default();
    for index in 0..count.min(1000) {
        let cookie = unsafe { list.GetValueAtIndex(index)? };
        let mut name = windows_core::PWSTR::null();
        unsafe { cookie.Name(&mut name)? };
        let name = webview2_com::take_pwstr(name);
        let slot = match name.as_str() {
            "ltuid_v2" => 0,
            "ltoken_v2" => 1,
            "ltmid_v2" => 2,
            "cookie_token_v2" => 3,
            "account_id_v2" => 4,
            "account_mid_v2" => 5,
            _ => continue,
        };
        let mut domain = windows_core::PWSTR::null();
        unsafe { cookie.Domain(&mut domain)? };
        if !hoyo_domain(&webview2_com::take_pwstr(domain)) {
            continue;
        }
        let mut value = windows_core::PWSTR::null();
        unsafe { cookie.Value(&mut value)? };
        let value = webview2_com::take_pwstr(value);
        if !value.is_empty() {
            found[slot] = value;
        }
    }
    fn optional(v: &str) -> Option<&str> {
        (!v.is_empty()).then_some(v)
    }
    Ok(Cookies::new(&found[0], &found[1], &found[2]).map(|cookies| {
        cookies.with_account_tokens(optional(&found[3]), optional(&found[4]), optional(&found[5]))
    }))
}

#[cfg(not(windows))]
fn check_cookies(_app: &AppHandle, _window: &WebviewWindow) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_in_stays_on_known_hosts() {
        let ok = |u: &str| allowed_login_url(&u.parse().unwrap());
        assert!(ok("https://www.hoyolab.com/home"));
        assert!(ok("https://account.hoyoverse.com/login"));
        assert!(ok("https://static.geetest.com/x.js"));
        assert!(ok("https://accounts.google.com/o/oauth2"));
        assert!(ok("https://x.com/i/oauth2"));
        assert!(!ok("http://www.hoyolab.com/"));
        assert!(!ok("https://hoyolab.com.evil.example/"));
        assert!(!ok("https://evilhoyolab.com/"));
        assert!(!ok("https://user:pw@www.hoyolab.com/"));
        assert!(!ok("file:///C:/Windows"));
        assert!(!ok("https://example.com/"));
    }

    #[test]
    fn session_cookies_come_only_from_hoyo_domains() {
        assert!(hoyo_domain(".hoyolab.com"));
        assert!(hoyo_domain("www.hoyolab.com"));
        assert!(hoyo_domain(".account.HoYoverse.com"));
        assert!(hoyo_domain("hoyoverse.com"));
        assert!(!hoyo_domain("evilhoyolab.com"));
        assert!(!hoyo_domain("hoyolab.com.evil.example"));
        assert!(!hoyo_domain(".example.com"));
    }
}
