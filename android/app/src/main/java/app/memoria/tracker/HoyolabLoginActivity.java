package app.memoria.tracker;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * HoYoLAB's own sign-in page in a plain WebView: no bridge, no JavaScript
 * interface, and only HoYoLAB, its captcha and the sign-in providers it offers.
 * Once the three session cookies appear they (and any account tokens) are sealed by ConnectorPlugin,
 * every HoYoLAB and HoYoverse cookie is expired from the shared WebView jar, and the activity closes;
 * the cookies are never handed back in the result. The WebView's cache, form data and HoYoLAB's web
 * storage are cleared with it.
 */
public class HoyolabLoginActivity extends Activity {
    static final String EXTRA_ERROR = "error";
    private static final String START = "https://www.hoyolab.com/";
    private static final String COOKIE_URL = "https://www.hoyolab.com";
    private static final String ACCOUNT_URL = "https://account.hoyoverse.com";
    private static final long POLL_MS = 2000;
    private static final String[] ALLOWED_HOSTS = {
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
    };
    private static final String[] SESSION_COOKIES = {
        "ltuid_v2", "ltoken_v2", "ltmid_v2", "account_id_v2", "account_mid_v2", "cookie_token_v2",
    };

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private boolean done = false;
    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            checkCookies();
            if (!done) handler.postDelayed(this, POLL_MS);
        }
    };

    /** HTTPS to an allowed host or one of its subdomains. Nothing else loads. */
    static boolean allowed(Uri uri) {
        if (uri == null || !"https".equals(uri.getScheme()) || uri.getUserInfo() != null) return false;
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase(java.util.Locale.ROOT);
        for (String allowed : ALLOWED_HOSTS) {
            if (host.equals(allowed) || host.endsWith("." + allowed)) return true;
        }
        return false;
    }

    /** Expires HoYoLAB's session cookies in the app's shared cookie jar. */
    static void expireSessionCookies() {
        CookieManager cookies = CookieManager.getInstance();
        String[][] jars = {
            { COOKIE_URL, ".hoyolab.com" },
            { COOKIE_URL, "www.hoyolab.com" },
            { ACCOUNT_URL, ".hoyoverse.com" },
            { ACCOUNT_URL, "account.hoyoverse.com" },
        };
        for (String[] jar : jars) {
            for (String name : SESSION_COOKIES) {
                cookies.setCookie(jar[0], name + "=; Max-Age=0; Path=/; Domain=" + jar[1]);
            }
        }
        // Host-only copies (set without a Domain) match no Domain attribute: expire those too,
        // as SkportLoginActivity does, so a disconnect leaves no session behind.
        for (String url : new String[] { COOKIE_URL, ACCOUNT_URL }) {
            for (String name : SESSION_COOKIES) {
                cookies.setCookie(url, name + "=; Max-Age=0; Path=/");
            }
        }
        cookies.flush();
    }

    /** Every HoYoLAB and HoYoverse page the sign-in can set cookies for. */
    private static final String[] COOKIE_ORIGINS = {
        "https://www.hoyolab.com",
        "https://hoyolab.com",
        "https://act.hoyolab.com",
        "https://m.hoyolab.com",
        "https://account.hoyolab.com",
        "https://account.hoyoverse.com",
        "https://hoyoverse.com",
        "https://www.hoyoverse.com",
    };

    /**
     * Expires every cookie the shared WebView jar holds for HoYoLAB and HoYoverse,
     * whatever its name: once the session is sealed in the Keystore no raw copy
     * stays in the jar, which Memoria's own WebView shares.
     */
    static void expireAllHoyoCookies() {
        CookieManager cookies = CookieManager.getInstance();
        for (String origin : COOKIE_ORIGINS) {
            String header = cookies.getCookie(origin);
            if (header == null) continue;
            String host = Uri.parse(origin).getHost();
            String site = host != null && host.endsWith("hoyoverse.com") ? ".hoyoverse.com" : ".hoyolab.com";
            for (String part : header.split(";")) {
                int eq = part.indexOf('=');
                String name = (eq > 0 ? part.substring(0, eq) : part).trim();
                if (name.isEmpty()) continue;
                cookies.setCookie(origin, name + "=; Max-Age=0; Path=/; Domain=" + site);
                cookies.setCookie(origin, name + "=; Max-Age=0; Path=/; Domain=" + host);
                cookies.setCookie(origin, name + "=; Max-Age=0; Path=/");
            }
        }
        expireSessionCookies();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle("Sign in to HoYoLAB");
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !allowed(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                checkCookies();
            }
        });
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                applyLegacyInsets(view, insets);
            }
            return insets;
        });
        setContentView(webView);
        webView.requestApplyInsets();
        // Every sign-in starts from a clean jar: a sealed session never stays in it
        // (see checkCookies), so nothing from an earlier visit is reused.
        expireAllHoyoCookies();
        webView.loadUrl(START);
        handler.postDelayed(poll, POLL_MS);
    }

    @SuppressWarnings("deprecation")
    private static void applyLegacyInsets(View view, WindowInsets insets) {
        view.setPadding(
            insets.getSystemWindowInsetLeft(),
            insets.getSystemWindowInsetTop(),
            insets.getSystemWindowInsetRight(),
            insets.getSystemWindowInsetBottom()
        );
    }

    private void checkCookies() {
        if (done) return;
        // HoYoLAB's own cookies first; HoYoverse's account pages fill in the rest.
        java.util.Map<String, String> found = new java.util.HashMap<>();
        for (String url : new String[] { COOKIE_URL, ACCOUNT_URL }) {
            String header = CookieManager.getInstance().getCookie(url);
            if (header == null) continue;
            for (String part : header.split(";")) {
                int eq = part.indexOf('=');
                if (eq <= 0) continue;
                String name = part.substring(0, eq).trim();
                String value = part.substring(eq + 1).trim();
                for (String session : SESSION_COOKIES) {
                    if (session.equals(name) && ConnectorPlugin.validCookie(value) && !found.containsKey(name)) {
                        found.put(name, value);
                    }
                }
            }
        }
        String ltuid = found.get("ltuid_v2");
        String ltoken = found.get("ltoken_v2");
        String ltmid = found.get("ltmid_v2");
        if (!ConnectorPlugin.validCookie(ltuid) || !ConnectorPlugin.validCookie(ltoken) || !ConnectorPlugin.validCookie(ltmid)) return;
        done = true;
        handler.removeCallbacks(poll);
        boolean stored = ConnectorPlugin.storeCookies(
            this,
            ltuid,
            ltoken,
            ltmid,
            found.get("cookie_token_v2"),
            found.get("account_id_v2"),
            found.get("account_mid_v2")
        );
        // Sealed (or refused): either way no raw session stays in the shared WebView jar.
        expireAllHoyoCookies();
        if (stored) {
            setResult(RESULT_OK);
        } else {
            setResult(RESULT_CANCELED, new Intent().putExtra(EXTRA_ERROR, "The HoYoLAB sign-in could not be saved securely on this phone."));
        }
        finish();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(poll);
        if (webView != null) {
            webView.stopLoading();
            // Nothing from the sign-in pages outlives them: memory cache, form data,
            // history and HoYoLAB's own storage go with the WebView without wiping
            // the main app's disk HTTP cache.
            webView.clearCache(false);
            webView.clearFormData();
            webView.clearHistory();
            webView.destroy();
            webView = null;
        }
        WebStorage storage = WebStorage.getInstance();
        for (String origin : COOKIE_ORIGINS) storage.deleteOrigin(origin);
        expireAllHoyoCookies();
        super.onDestroy();
    }
}
