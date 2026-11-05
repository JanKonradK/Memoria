package app.memoria.tracker;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Installs a Memoria release from GitHub. The APK is checked against the
 * publisher-signed digest verified by app-update.ts, then Android's own installer asks the user to
 * confirm. Android only accepts it when it carries this app's signature.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String RELEASES = "https://github.com/JanKonradK/Memoria/releases/download/";
    private static final long MAX_APK_BYTES = 300L * 1024 * 1024;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean busy = false;

    @PluginMethod
    public void install(PluginCall call) {
        String apkUrl = call.getString("apkUrl");
        String expected = call.getString("expectedSha256", "");
        String version = call.getString("version", "").replaceAll("[^0-9A-Za-z.-]", "");
        if (apkUrl == null || !apkUrl.startsWith(RELEASES) || !expected.matches("[0-9a-f]{64}")) {
            call.reject("This download does not come from Memoria's releases.");
            return;
        }
        if (busy) {
            call.reject("An update is already downloading.");
            return;
        }
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
            getActivity().startActivity(settings);
            call.reject("Allow Memoria to install apps, then select Download and install again.", "INSTALL_PERMISSION");
            return;
        }
        busy = true;
        executor.execute(() -> {
            try {
                File directory = new File(context.getCacheDir(), "updates");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("No room for the update.");
                File apk = new File(directory, "Memoria-" + version + ".apk");
                // A verified copy from an earlier attempt is reused, anything else is replaced.
                if (!apk.isFile() || !expected.equals(sha256(apk))) {
                    File[] old = directory.listFiles();
                    if (old != null) for (File file : old) file.delete();
                    download(apkUrl, apk);
                    if (!expected.equals(sha256(apk))) {
                        apk.delete();
                        throw new IOException("The download is damaged. Try again.");
                    }
                }
                Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
                Intent installer = new Intent(Intent.ACTION_VIEW);
                installer.setDataAndType(uri, "application/vnd.android.package-archive");
                installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().runOnUiThread(() -> {
                    try {
                        getActivity().startActivity(installer);
                        call.resolve();
                    } catch (RuntimeException error) {
                        call.reject("Android could not open its installer.", error);
                    }
                });
            } catch (Exception error) {
                String message = error.getMessage();
                call.reject(message == null || message.isEmpty() ? "The update could not be downloaded. Try again." : message);
            } finally {
                busy = false;
            }
        });
    }

    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(60_000);
        connection.setRequestProperty("User-Agent", "Memoria-updater (+https://github.com/JanKonradK/Memoria)");
        int status = connection.getResponseCode();
        if (status != HttpURLConnection.HTTP_OK) {
            connection.disconnect();
            throw new IOException("GitHub responded " + status + ". Try again later.");
        }
        return connection;
    }

    private void download(String url, File destination) throws IOException {
        HttpURLConnection connection = open(url);
        long total = connection.getContentLengthLong();
        if (total > MAX_APK_BYTES) {
            connection.disconnect();
            throw new IOException("The download is larger than expected.");
        }
        long received = 0;
        long lastReport = 0;
        try (InputStream input = connection.getInputStream(); OutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                received += read;
                if (received > MAX_APK_BYTES) throw new IOException("The download is larger than expected.");
                output.write(buffer, 0, read);
                long now = System.currentTimeMillis();
                if (now - lastReport > 200) {
                    lastReport = now;
                    JSObject progress = new JSObject();
                    progress.put("received", received);
                    progress.put("total", total);
                    notifyListeners("progress", progress);
                }
            }
        } catch (IOException error) {
            destination.delete();
            throw error;
        } finally {
            connection.disconnect();
        }
    }

    private static String sha256(File file) throws IOException {
        try (InputStream input = new FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
            StringBuilder hex = new StringBuilder();
            for (byte value : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", value));
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException error) {
            throw new IOException("This device cannot check downloads.", error);
        }
    }
}
