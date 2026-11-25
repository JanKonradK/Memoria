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
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * SKPORT's own sign-in page in a plain WebView: no bridge, no JavaScript
 * interface, and only SKPORT, Gryphline, its captcha and the sign-in providers
 * it offers. Once the account token or the SKPORT cred appears it is sealed by
 * ConnectorPlugin and the activity closes; nothing is handed back in the result.
 */
public class SkportLoginActivity extends Activity {
    static final String EXTRA_ERROR = "error";
    private static final String START = "https://www.skport.com/";
    private static final String[] COOKIE_URLS = {
        "https://www.skport.com",
        "https://game.skport.com",
        "https://as.gryphline.com",
    };
    private static final long POLL_MS = 2000;
    private static final String[] ALLOWED_HOSTS = {
        "skport.com",
        "gryphline.com",
        "hypergryph.com",
        "geetest.com",
        "google.com",
        "gstatic.com",
        "recaptcha.net",
        "apple.com",
        "facebook.com",
        "twitter.com",
        "x.com",
    };
    private static final String ACCOUNT_TOKEN = "ACCOUNT_TOKEN";
    private static final String CRED_KEY = "SK_OAUTH_CRED_KEY";
    private static final String[] SESSION_COOKIES = { ACCOUNT_TOKEN, CRED_KEY };

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

    /** Expires SKPORT's and Gryphline's session cookies in the app's shared cookie jar. */
    static void expireSessionCookies() {
        CookieManager cookies = CookieManager.getInstance();
        for (String url : COOKIE_URLS) {
            String host = Uri.parse(url).getHost();
            String parent = host.substring(host.indexOf('.'));
            for (String name : SESSION_COOKIES) {
                // Host-only, the host itself, and the parent domain.
                cookies.setCookie(url, name + "=; Max-Age=0; Path=/");
                cookies.setCookie(url, name + "=; Max-Age=0; Path=/; Domain=" + host);
                cookies.setCookie(url, name + "=; Max-Age=0; Path=/; Domain=" + parent);
            }
        }
        cookies.flush();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle("Sign in to SKPORT");
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
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
        boolean connected = getSharedPreferences(ConnectorPlugin.PREFS, MODE_PRIVATE).getString(ConnectorPlugin.SKPORT_SEALED, null) != null;
        if (!connected) {
            // A disconnected account starts from a clean sign-in.
            expireSessionCookies();
        }
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

    /** The named cookie's value, percent-decoded, or null. */
    private static String cookieValue(String header, String wanted) {
        if (header == null) return null;
        for (String part : header.split(";")) {
            int eq = part.indexOf('=');
            if (eq <= 0) continue;
            if (!wanted.equals(part.substring(0, eq).trim())) continue;
            String value = Uri.decode(part.substring(eq + 1).trim());
            if (ConnectorPlugin.validSkportToken(value)) return value;
        }
        return null;
    }

    private void checkCookies() {
        if (done) return;
        CookieManager cookies = CookieManager.getInstance();
        String accountToken = null;
        String credKey = null;
        for (String url : COOKIE_URLS) {
            String header = cookies.getCookie(url);
            if (accountToken == null) accountToken = cookieValue(header, ACCOUNT_TOKEN);
            if (credKey == null) credKey = cookieValue(header, CRED_KEY);
        }
        if (accountToken == null && credKey == null) return;
        done = true;
        handler.removeCallbacks(poll);
        if (ConnectorPlugin.storeSkportSeed(this, accountToken, credKey)) {
            setResult(RESULT_OK);
        } else {
            setResult(RESULT_CANCELED, new Intent().putExtra(EXTRA_ERROR, "The SKPORT sign-in could not be saved securely on this phone."));
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
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
