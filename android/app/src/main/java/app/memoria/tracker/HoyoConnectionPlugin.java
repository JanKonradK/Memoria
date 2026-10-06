package app.memoria.tracker;

import android.app.Activity;
import android.content.Intent;
import android.webkit.CookieManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** HoYoLAB credentials stay in Android's private WebView cookie store. */
@CapacitorPlugin(name = "HoyoConnection")
public class HoyoConnectionPlugin extends Plugin {
    static final String LOGIN_URL = "https://www.hoyolab.com/";
    private static final String[] ENDPOINTS = {
        "https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote",
        "https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note",
        "https://sg-act-public-api.hoyolab.com/event/game_record_zzz/api/zzz/note"
    };
    private static final Set<String> COOKIE_NAMES = new HashSet<>(Arrays.asList(
        "ltoken", "ltoken_v2", "ltuid", "ltuid_v2", "ltmid_v2", "cookie_token", "cookie_token_v2",
        "account_id", "account_id_v2", "account_mid_v2"
    ));
    private final AtomicBoolean busy = new AtomicBoolean();
    private final AtomicInteger generation = new AtomicInteger();
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Map<String, JSObject> cache = new ConcurrentHashMap<>();

    static boolean allowedLoginUrl(String value) {
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getUserInfo() != null ||
                (uri.getPort() != -1 && uri.getPort() != 443)) return false;
            host = host.toLowerCase(Locale.ROOT);
            return host.equals("hoyolab.com") || host.endsWith(".hoyolab.com") ||
                host.equals("hoyoverse.com") || host.endsWith(".hoyoverse.com");
        } catch (Exception error) { return false; }
    }

    static String filterCookies(String cookies) {
        if (cookies == null || cookies.length() > 32_000) return "";
        Map<String, String> selected = new LinkedHashMap<>();
        for (String part : cookies.split(";")) {
            String pair = part.trim();
            int equals = pair.indexOf('=');
            if (equals < 1 || !COOKIE_NAMES.contains(pair.substring(0, equals))) continue;
            if (pair.chars().anyMatch(character -> character < 32 || character == 127)) return "";
            if (pair.length() > equals + 1) selected.put(pair.substring(0, equals), pair.substring(equals + 1));
        }
        if (!(selected.containsKey("ltoken") || selected.containsKey("ltoken_v2")) ||
            !(selected.containsKey("ltuid") || selected.containsKey("ltuid_v2"))) return "";
        StringBuilder result = new StringBuilder();
        selected.forEach((name, value) -> {
            if (result.length() > 0) result.append("; ");
            result.append(name).append('=').append(value);
        });
        return result.toString();
    }

    static boolean hasSession() {
        return !filterCookies(CookieManager.getInstance().getCookie(LOGIN_URL)).isEmpty();
    }

    private boolean isConnected() {
        return getContext().getSharedPreferences("hoyo-session", 0).getBoolean("enabled", false) && hasSession();
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(new JSObject().put("connected", isConnected()));
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (!busy.compareAndSet(false, true)) {
            call.reject("Finish the current account request first.", "CONNECTION_BUSY");
            return;
        }
        cache.clear();
        generation.incrementAndGet();
        try {
            startActivityForResult(call, new Intent(getContext(), HoyoLoginActivity.class), "loginResult");
        } catch (RuntimeException error) {
            busy.set(false);
            call.reject("The HoYoLAB sign-in page could not open.", "LOGIN_UNAVAILABLE");
        }
    }

    @ActivityCallback
    private void loginResult(PluginCall call, ActivityResult result) {
        busy.set(false);
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("HoYoLAB sign-in cancelled.", "CANCELLED");
            return;
        }
        boolean connected = hasSession();
        getContext().getSharedPreferences("hoyo-session", 0).edit().putBoolean("enabled", connected).apply();
        call.resolve(new JSObject().put("connected", connected));
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        generation.incrementAndGet();
        cache.clear();
        getContext().getSharedPreferences("hoyo-session", 0).edit().putBoolean("enabled", false).apply();
        getActivity().runOnUiThread(() -> {
            CookieManager cookies = CookieManager.getInstance();
            // Only remove HoYo session cookies. Other app WebView sessions are preserved.
            String[] hosts = { "hoyolab.com", "www.hoyolab.com", "act.hoyolab.com", "sg-public-api.hoyolab.com",
                "bbs-api-os.hoyolab.com", "sg-act-public-api.hoyolab.com", "hoyoverse.com", "account.hoyoverse.com" };
            for (String host : hosts) {
                for (String name : COOKIE_NAMES) {
                    String expired = name + "=; Path=/; Max-Age=0; Secure";
                    cookies.setCookie("https://" + host + "/", expired);
                    cookies.setCookie("https://" + host + "/", expired + "; Domain=" + host);
                    String parent = host.endsWith("hoyolab.com") ? "hoyolab.com" : "hoyoverse.com";
                    cookies.setCookie("https://" + host + "/", expired + "; Domain=." + parent);
                }
            }
            cookies.flush();
            call.resolve(new JSObject().put("connected", false));
        });
    }

    static int providerIndex(String provider, String server) {
        if ("genshin".equals(provider) && Arrays.asList("os_euro", "os_usa", "os_asia", "os_cht").contains(server)) return 0;
        if ("hsr".equals(provider) && Arrays.asList("prod_official_eur", "prod_official_usa", "prod_official_asia", "prod_official_cht").contains(server)) return 1;
        if ("zzz".equals(provider) && Arrays.asList("prod_gf_eu", "prod_gf_us", "prod_gf_jp", "prod_gf_sg").contains(server)) return 2;
        return -1;
    }

    static String digest(long seconds, String nonce) throws Exception {
        byte[] hash = MessageDigest.getInstance("MD5").digest(
            ("salt=6s25p5ox5y14umn1p61aqyyvbvvl3lrt&t=" + seconds + "&r=" + nonce).getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte value : hash) result.append(String.format(Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }

    @PluginMethod
    public void fetchNotes(PluginCall call) {
        String provider = call.getString("provider");
        String uid = call.getString("uid");
        String server = call.getString("server");
        int index = providerIndex(provider, server);
        if (index < 0 || uid == null || !uid.matches("\\d{8,12}")) {
            call.reject("Choose a supported game, UID and server.", "INVALID_ACCOUNT");
            return;
        }
        if (!isConnected()) {
            call.reject("Sign in to HoYoLAB on this phone first.", "NOT_CONNECTED");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("Finish the current account request first.", "CONNECTION_BUSY");
            return;
        }
        String cookies = filterCookies(CookieManager.getInstance().getCookie(ENDPOINTS[index]));
        if (cookies.isEmpty()) cookies = filterCookies(CookieManager.getInstance().getCookie(LOGIN_URL));
        if (cookies.isEmpty()) {
            busy.set(false);
            call.reject("Sign in to HoYoLAB on this phone first.", "NOT_CONNECTED");
            return;
        }
        String key = provider + ":" + uid + ":" + server;
        JSObject cached = cache.get(key);
        if (cached != null && System.currentTimeMillis() - cached.optLong("observedAt") < 60_000) {
            busy.set(false);
            call.resolve(cached);
            return;
        }
        final String cookieHeader = cookies;
        final int requestGeneration = generation.get();
        network.execute(() -> {
            HttpsURLConnection connection = null;
            try {
                long observedAt = System.currentTimeMillis();
                connection = (HttpsURLConnection) new URL(ENDPOINTS[index] + "?role_id=" + uid + "&server=" + server).openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(15_000);
                connection.setRequestProperty("Cookie", cookieHeader);
                connection.setRequestProperty("Referer", "https://act.hoyolab.com/");
                connection.setRequestProperty("x-rpc-app_version", "1.5.0");
                connection.setRequestProperty("x-rpc-client_type", "5");
                connection.setRequestProperty("x-rpc-language", "en-us");
                connection.setRequestProperty("x-rpc-lang", "en-us");
                connection.setRequestProperty("User-Agent", "Memoria/2.0");
                String alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
                SecureRandom random = new SecureRandom();
                StringBuilder nonce = new StringBuilder();
                for (int i = 0; i < 6; i++) nonce.append(alphabet.charAt(random.nextInt(alphabet.length())));
                long seconds = observedAt / 1000;
                connection.setRequestProperty("DS", seconds + "," + nonce + "," + digest(seconds, nonce.toString()));
                int status = connection.getResponseCode();
                if (status == 429) throw new IOException("HoYoLAB asked us to wait. Try again later.");
                if (status != 200) throw new IOException("HoYoLAB is unavailable. Try again later.");
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                try (InputStream stream = connection.getInputStream()) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = stream.read(buffer)) != -1) {
                        if (bytes.size() + count > 1_000_000) throw new IOException("The account response was too large.");
                        bytes.write(buffer, 0, count);
                    }
                }
                JSONObject payload = new JSONObject(bytes.toString("UTF-8"));
                int code = payload.optInt("retcode", -1);
                if (Arrays.asList(10035, 5003, 10041, 1034).contains(code))
                    throw new IOException("Open HoYoLAB and complete its verification, then refresh again.");
                if (code == 10102 || code == 10103)
                    throw new IOException("Enable Real-Time Notes in HoYoLAB Battle Chronicle, then retry.");
                if (code != 0) throw new IOException("Check the UID and server, then sign in to HoYoLAB again.");
                JSONObject data = payload.optJSONObject("data");
                if (data == null) throw new IOException("HoYoLAB returned no readings.");
                if (generation.get() != requestGeneration) throw new IOException("The account connection changed. Refresh again.");
                JSObject result = new JSObject().put("provider", provider).put("uid", uid).put("observedAt", observedAt).put("data", data);
                cache.put(key, result);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error instanceof IOException ? error.getMessage() : "HoYoLAB could not be reached. Your saved readings are unchanged.", "ACCOUNT_READ_FAILED");
            } finally {
                if (connection != null) connection.disconnect();
                busy.set(false);
            }
        });
    }

    @Override
    protected void handleOnDestroy() { network.shutdown(); }
}
