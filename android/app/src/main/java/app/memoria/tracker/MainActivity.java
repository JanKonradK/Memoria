package app.memoria.tracker;

import com.getcapacitor.BridgeActivity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.WebView;

public class MainActivity extends BridgeActivity {
    /** Tailwind v4 needs color-mix(), @property and oklch(): Chromium 111 and later. */
    private static final int MIN_WEBVIEW_MAJOR = 111;
    /** Where Android 7 looks for its WebView, in order, before getCurrentWebViewPackage exists. */
    private static final String[] WEBVIEW_PACKAGES = {
        "com.google.android.webview",
        "com.android.webview",
        "com.android.chrome",
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeBackupPlugin.class);
        registerPlugin(PairingScannerPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(HomeWidgetPlugin.class);
        registerPlugin(DeviceKeyPlugin.class);
        registerPlugin(ReminderChannelsPlugin.class);
        registerPlugin(AlarmClockPlugin.class);
        registerPlugin(ConnectorPlugin.class);
        super.onCreate(savedInstanceState);
        // Honour the page's viewport width, so the app can scale itself to the screen
        // (screen-scale.ts): larger on a tablet, a touch smaller on a small phone.
        getBridge().getWebView().getSettings().setUseWideViewPort(true);
        getBridge().getWebView().getSettings().setLoadWithOverviewMode(true);
        if (savedInstanceState == null) {
            warnIfWebViewTooOld();
            queueSharedImage(getIntent());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        setIntent(intent);
        super.onNewIntent(intent);
        queueSharedImage(intent);
    }

    /** A screenshot shared into Memoria goes to ConnectorPlugin, which reads it off the main thread. */
    private void queueSharedImage(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();
        if (type == null || !type.startsWith("image/")) return;
        try {
            Uri stream = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                : legacyStream(intent);
            ConnectorPlugin.queueSharedImage(this, stream);
        } catch (RuntimeException ignored) {
            // A malformed share is ignored.
        }
    }

    @SuppressWarnings("deprecation")
    private static Uri legacyStream(Intent intent) {
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    /** An old Android System WebView draws Memoria wrongly: say so once, and offer the update. */
    private void warnIfWebViewTooOld() {
        try {
            PackageInfo webView = currentWebView();
            if (webView == null) return;
            int major = leadingNumber(webView.versionName);
            if (major < 0 || major >= MIN_WEBVIEW_MAJOR) return;
            String pkg = webView.packageName;
            new AlertDialog.Builder(this)
                .setTitle("Update Android System WebView")
                .setMessage(
                    "Memoria needs Android System WebView " + MIN_WEBVIEW_MAJOR + " or newer to display properly. "
                        + "This phone has version " + webView.versionName + ", so some screens may look wrong until it is updated."
                )
                .setPositiveButton("Update", (dialog, which) -> openStore(pkg))
                .setNegativeButton("Continue anyway", (dialog, which) -> dialog.dismiss())
                .show();
        } catch (RuntimeException ignored) {
            // A warning only: never stop the app from opening.
        }
    }

    private PackageInfo currentWebView() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return WebView.getCurrentWebViewPackage();
        }
        PackageManager packages = getPackageManager();
        for (String pkg : WEBVIEW_PACKAGES) {
            try {
                PackageInfo info = packages.getPackageInfo(pkg, 0);
                if (info.applicationInfo == null || info.applicationInfo.enabled) return info;
            } catch (PackageManager.NameNotFoundException missing) {
                // Try the next one.
            }
        }
        return null;
    }

    /** "109.0.5414.117" gives 109; anything without a leading number gives -1. */
    private static int leadingNumber(String version) {
        if (version == null) return -1;
        int end = 0;
        while (end < version.length() && end < 9 && Character.isDigit(version.charAt(end))) end++;
        if (end == 0) return -1;
        return Integer.parseInt(version.substring(0, end));
    }

    private void openStore(String pkg) {
        Intent[] tries = {
            new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)),
            new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)),
            new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)),
        };
        for (Intent intent : tries) {
            try {
                startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return;
            } catch (ActivityNotFoundException | SecurityException unavailable) {
                // Try the next way there.
            }
        }
    }
}
