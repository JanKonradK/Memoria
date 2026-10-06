package app.memoria.tracker;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/** Official sign-in pages only. This WebView has no JavaScript bridge to Memoria. */
public class HoyoLoginActivity extends AppCompatActivity {
    private WebView web;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(Activity.RESULT_CANCELED);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.WHITE);
        ViewCompat.setOnApplyWindowInsetsListener(layout, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        LinearLayout actions = new LinearLayout(this);
        Button cancel = new Button(this);
        cancel.setText("Cancel");
        cancel.setOnClickListener(view -> finish());
        TextView title = new TextView(this);
        title.setText("HoYoLAB sign-in");
        title.setTextColor(Color.BLACK);
        title.setGravity(android.view.Gravity.CENTER);
        Button done = new Button(this);
        done.setText("Done");
        done.setOnClickListener(view -> {
            CookieManager.getInstance().flush();
            if (!HoyoConnectionPlugin.hasSession()) {
                Toast.makeText(this, "Sign in to HoYoLAB before you select Done.", Toast.LENGTH_LONG).show();
                return;
            }
            setResult(Activity.RESULT_OK);
            finish();
        });
        actions.addView(cancel);
        actions.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1));
        actions.addView(done);
        layout.addView(actions);
        TextView host = new TextView(this);
        host.setTextColor(Color.DKGRAY);
        host.setText("https://www.hoyolab.com");
        host.setPadding(16, 4, 16, 8);
        layout.addView(host);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        // HoYoLAB redirects Android user agents to an app-download landing page.
        // Keep this WebView's actual Chromium version, but request the sign-in-capable desktop site.
        settings.setUserAgentString(settings.getUserAgentString()
            .replaceFirst("\\([^)]*\\)", "(X11; Linux x86_64)")
            .replace(" Version/4.0", "")
            .replace(" Mobile", ""));
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (HoyoConnectionPlugin.allowedLoginUrl(request.getUrl().toString())) return false;
                Toast.makeText(HoyoLoginActivity.this, "Only official HoYoLAB sign-in pages open here.", Toast.LENGTH_SHORT).show();
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (!HoyoConnectionPlugin.allowedLoginUrl(url)) {
                    view.stopLoading();
                    return;
                }
                host.setText("https://" + android.net.Uri.parse(url).getHost());
            }
        });
        layout.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(layout);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack();
                else finish();
            }
        });
        web.loadUrl(HoyoConnectionPlugin.LOGIN_URL);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            ((ViewGroup) web.getParent()).removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }
}
