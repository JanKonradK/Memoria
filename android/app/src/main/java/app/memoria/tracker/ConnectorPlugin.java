package app.memoria.tracker;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Opt-in live numbers on Android: a HoYoLAB sign-in, a SKPORT sign-in and
 * screenshots chosen or shared into Memoria.
 *
 * HoYoLAB cookies and SKPORT tokens are sealed with an AES key held in the
 * Android Keystore and never cross into the page, a log or the app state. The page sees status,
 * the notes' numbers and downscaled screenshot images only.
 */
@CapacitorPlugin(name = "Connector")
public class ConnectorPlugin extends Plugin {
    static final String PREFS = "memoria_connectors";
    private static final String ALIAS = "memoria-connector-key";
    private static final int IV_BYTES = 12;

    /** The account's game roles: by cookie token first, by ltoken second. */
    private static final String[] ROLES_URLS = {
        "https://api-account-os.hoyolab.com/account/binding/api/getUserGameRolesByCookie",
        "https://api-account-os.hoyolab.com/account/binding/api/getUserGameRolesByLtoken",
    };
    /** The profile's Battle Chronicle cards, which also name its roles. Read only when the bindings list none. */
    private static final String RECORD_CARD_URL = "https://bbs-api-os.hoyolab.com/game_record/card/wapi/getGameRecordCard";
    /** HoYoLAB's overseas DS salt (genshin.py's DS_SALT[Region.OVERSEAS]). A wrong salt fails every signed call. */
    static final String DS_SALT = "6s25p5ox5y14umn1p61aqyyvbvvl3lrt";
    private static final String USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    private static final long BACKOFF_MS = 2L * 60 * 60 * 1000;
    private static final long MANUAL_GAP_MS = 10_000;
    private static final long AUTO_GAP_MS = 15L * 60 * 1000;
    private static final int MAX_BODY = 2 * 1024 * 1024;

    private static final int MAX_IMAGE_SIDE = 1080;
    private static final long MAX_IMAGE_BYTES = 25L * 1024 * 1024;

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Map<String, Long> LAST_FETCH = new ConcurrentHashMap<>();
    private static final Object SHARE_LOCK = new Object();
    private static JSObject pendingShare;
    private static WeakReference<ConnectorPlugin> active = new WeakReference<>(null);

    private boolean signingIn = false;
    private boolean skportSigningIn = false;
    private boolean picking = false;

    @Override
    public void load() {
        active = new WeakReference<>(this);
    }

    @Override
    protected void handleOnDestroy() {
        if (active.get() == this) active = new WeakReference<>(null);
    }

    // ------------------------------------------------------------------
    // Sealed storage
    // ------------------------------------------------------------------

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
            new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    private static String seal(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        byte[] sealed = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(ByteBuffer.allocate(iv.length + sealed.length).put(iv).put(sealed).array(), Base64.NO_WRAP);
    }

    private static String unseal(String sealed) throws Exception {
        byte[] data = Base64.decode(sealed, Base64.NO_WRAP);
        if (data.length <= IV_BYTES) throw new IllegalArgumentException();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, data, 0, IV_BYTES));
        return new String(cipher.doFinal(data, IV_BYTES, data.length - IV_BYTES), StandardCharsets.UTF_8);
    }

    static boolean validCookie(String value) {
        if (value == null || value.isEmpty() || value.length() > 512) return false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c <= ' ' || c > '~' || c == ';' || c == ',') return false;
        }
        return true;
    }

    static String maskUid(String uid) {
        if (uid.length() <= 4) return "****";
        return uid.substring(0, 2) + "****" + uid.substring(uid.length() - 2);
    }

    /** The account tokens that let Memoria redeem codes. Optional: notes work without them. */
    private static final String[] ACCOUNT_COOKIES = { "cookie_token_v2", "account_id_v2", "account_mid_v2" };

    /** Seals the three session cookies. Fails closed: nothing is kept unsealed. */
    static boolean storeCookies(Context context, String ltuid, String ltoken, String ltmid) {
        return storeCookies(context, ltuid, ltoken, ltmid, null, null, null);
    }

    /** Seals the session cookies and whichever account tokens look like cookie values. */
    static boolean storeCookies(
        Context context,
        String ltuid,
        String ltoken,
        String ltmid,
        String cookieToken,
        String accountId,
        String accountMid
    ) {
        if (!validCookie(ltuid) || !validCookie(ltoken) || !validCookie(ltmid)) return false;
        try {
            JSONObject plain = new JSONObject();
            plain.put("ltuid_v2", ltuid);
            plain.put("ltoken_v2", ltoken);
            plain.put("ltmid_v2", ltmid);
            String[] account = { cookieToken, accountId, accountMid };
            for (int i = 0; i < ACCOUNT_COOKIES.length; i++) {
                if (validCookie(account[i])) plain.put(ACCOUNT_COOKIES[i], account[i]);
            }
            String sealed = seal(plain.toString());
            return prefs(context)
                .edit()
                .putString("sealedCookies", sealed)
                .putString("maskedUid", maskUid(ltuid))
                // A fresh sign-in is the player answering HoYoLAB's check.
                .remove("backoffUntilMs")
                .commit();
        } catch (Exception error) {
            return false;
        }
    }

    /** The cookie header, or null when there is no usable sign-in. */
    private static String cookieHeader(Context context) {
        String sealed = prefs(context).getString("sealedCookies", null);
        if (sealed == null) return null;
        try {
            JSONObject plain = new JSONObject(unseal(sealed));
            String ltuid = plain.optString("ltuid_v2");
            String ltoken = plain.optString("ltoken_v2");
            String ltmid = plain.optString("ltmid_v2");
            if (!validCookie(ltuid) || !validCookie(ltoken) || !validCookie(ltmid)) return null;
            StringBuilder header = new StringBuilder("ltuid_v2=" + ltuid + "; ltoken_v2=" + ltoken + "; ltmid_v2=" + ltmid);
            for (String name : ACCOUNT_COOKIES) {
                String value = plain.optString(name);
                if (validCookie(value)) header.append("; ").append(name).append('=').append(value);
            }
            return header.toString();
        } catch (Exception error) {
            return null;
        }
    }

    private static JSONArray jsonArray(String text) {
        try {
            return text == null ? new JSONArray() : new JSONArray(text);
        } catch (Exception error) {
            return new JSONArray();
        }
    }

    private static JSONObject jsonObject(String text) {
        try {
            return text == null ? new JSONObject() : new JSONObject(text);
        } catch (Exception error) {
            return new JSONObject();
        }
    }

    private static long backoffUntil(Context context) {
        long until = prefs(context).getLong("backoffUntilMs", 0);
        return until > System.currentTimeMillis() ? until : 0;
    }

    /** What the page may know: no cookies. */
    static JSObject status(Context context) {
        SharedPreferences prefs = prefs(context);
        JSObject hoyolab = new JSObject();
        hoyolab.put("connected", prefs.getString("sealedCookies", null) != null);
        String masked = prefs.getString("maskedUid", null);
        hoyolab.put("maskedUid", masked == null ? JSONObject.NULL : masked);
        hoyolab.put("roles", jsonArray(prefs.getString("roles", null)));
        hoyolab.put("gameLinks", jsonObject(prefs.getString("gameLinks", null)));
        long until = backoffUntil(context);
        hoyolab.put("backoffUntilMs", until > 0 ? (Object) until : JSONObject.NULL);
        hoyolab.put("autoRefreshOnExit", prefs.getBoolean("autoRefreshOnExit", false));
        JSObject watch = new JSObject();
        watch.put("enabled", false);
        watch.put("folderName", JSONObject.NULL);
        JSObject result = new JSObject();
        result.put("hoyolab", hoyolab);
        result.put("skport", skportStatus(prefs));
        result.put("screenshotWatch", watch);
        return result;
    }

    private void announce() {
        notifyListeners("statusChanged", status(getContext()));
    }

    // ------------------------------------------------------------------
    // HoYoLAB
    // ------------------------------------------------------------------

    static String md5Hex(String text) throws Exception {
        byte[] digest = MessageDigest.getInstance("MD5").digest(text.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) hex.append(String.format("%02x", b & 0xff));
        return hex.toString();
    }

    private static final String DS_LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    private static final SecureRandom RANDOM = new SecureRandom();

    /** `"{t},{r},{md5}"`, as genshin.py signs: md5 of `salt={salt}&t={t}&r={r}`. */
    static String ds(long t, String r) throws Exception {
        return t + "," + r + "," + md5Hex("salt=" + DS_SALT + "&t=" + t + "&r=" + r);
    }

    /** The DS header for now, with 6 random ASCII letters as the nonce. */
    private static String ds() throws Exception {
        StringBuilder r = new StringBuilder();
        for (int i = 0; i < 6; i++) r.append(DS_LETTERS.charAt(RANDOM.nextInt(DS_LETTERS.length())));
        return ds(System.currentTimeMillis() / 1000, r.toString());
    }

    /** The response body as JSON. Errors are fixed sentences: no address or body is echoed. */
    private static JSONObject get(String address, String cookies) throws HoyolabError {
        return get(address, cookies, 15_000);
    }

    private static JSONObject get(String address, String cookies, int timeoutMs) throws HoyolabError {
        return request(address, cookies, timeoutMs, null, null, null);
    }

    /**
     * One HoYoLAB call. `site` set means HoYoverse's web redemption (its own Origin,
     * no DS); otherwise HoYoLAB's signed headers. `body` set makes it a JSON POST.
     */
    private static JSONObject request(String address, String cookies, int timeoutMs, String site, String signGame, String body)
        throws HoyolabError {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(address).openConnection();
            connection.setConnectTimeout(timeoutMs);
            connection.setReadTimeout(timeoutMs);
            connection.setInstanceFollowRedirects(false);
            if (site == null) {
                connection.setRequestProperty("DS", ds());
                connection.setRequestProperty("x-rpc-app_version", "1.5.0");
                connection.setRequestProperty("x-rpc-client_type", "5");
                connection.setRequestProperty("x-rpc-language", "en-us");
                connection.setRequestProperty("x-rpc-lang", "en-us");
                connection.setRequestProperty("Origin", "https://act.hoyolab.com");
                connection.setRequestProperty("Referer", "https://act.hoyolab.com/");
            } else {
                connection.setRequestProperty("Origin", site);
                connection.setRequestProperty("Referer", site + "/");
            }
            if (signGame != null) connection.setRequestProperty("x-rpc-signgame", signGame);
            connection.setRequestProperty("Accept", "application/json, text/plain, */*");
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Cookie", cookies);
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }
            }
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new HoyolabError("HoYoLAB answered with an error (" + code + "). Try again later.");
            try (InputStream input = connection.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    if (out.size() > MAX_BODY) throw new HoyolabError("HoYoLAB sent an answer Memoria could not read.");
                }
                return new JSONObject(out.toString("UTF-8"));
            }
        } catch (HoyolabError error) {
            throw error;
        } catch (org.json.JSONException error) {
            throw new HoyolabError("HoYoLAB sent an answer Memoria could not read.");
        } catch (Exception error) {
            throw new HoyolabError("HoYoLAB could not be reached. Check your connection and try again.");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static final class HoyolabError extends Exception {
        HoyolabError(String message) {
            super(message);
        }
    }

    private static String presetForBiz(String biz) {
        switch (biz) {
            case "hk4e_global":
                return "genshin";
            case "hkrpg_global":
                return "hsr";
            case "nap_global":
                return "zzz";
            default:
                return null;
        }
    }

    private static boolean validPreset(String preset) {
        return "genshin".equals(preset) || "hsr".equals(preset) || "zzz".equals(preset);
    }

    private static boolean validUid(String uid) {
        return uid != null && !uid.isEmpty() && uid.length() <= 20 && uid.matches("[0-9]+");
    }

    private static boolean validRegion(String region) {
        return region != null && !region.isEmpty() && region.length() <= 40 && region.matches("[A-Za-z0-9_-]+");
    }

    private static String clip(String text, int max) {
        return text.length() > max ? text.substring(0, max) : text;
    }

    /** The game a Battle Chronicle card's `game_id` belongs to, by Memoria preset key. */
    static String presetForCardGame(int gameId) {
        switch (gameId) {
            case 2:
                return "genshin";
            case 6:
                return "hsr";
            case 8:
                return "zzz";
            default:
                return null;
        }
    }

    /** One cookie's value in a `name=value; name=value` header, or null. */
    static String cookieValue(String header, String name) {
        if (header == null) return null;
        for (String part : header.split(";")) {
            String pair = part.trim();
            if (pair.startsWith(name + "=")) return pair.substring(name.length() + 1);
        }
        return null;
    }

    /**
     * The failure worth reporting once every address failed: a HoYoLAB code beats a
     * connection or HTTP error, and any other code beats the gateway's -10001, which only
     * says the request reached the wrong host. Ties keep the first.
     */
    static final class Failure {
        Integer retcode;
        String error;

        static int rank(Integer retcode) {
            if (retcode == null) return 0;
            return retcode == -10001 ? 1 : 2;
        }

        void keep(Integer code, String message) {
            // A 0 without data is no refusal: it is kept without a code.
            if (code != null && code == 0) code = null;
            if (error == null || rank(code) > rank(retcode)) {
                retcode = code;
                error = message == null ? "" : message;
            }
        }
    }

    private static String rolesError(int retcode) {
        if (retcode == -100 || retcode == 10001) return "HoYoLAB did not accept the sign-in. Sign in again.";
        return "HoYoLAB could not list your game accounts (code " + retcode + ").";
    }

    /**
     * The signed-in account's Genshin, Star Rail and Zenless roles, sanitised. The cookie-token
     * binding is asked first and the ltoken one second; when neither lists a tracked role, the
     * profile's Battle Chronicle cards are read for them. Fails only when no source answered.
     */
    private static JSONArray fetchRoles(String cookies) throws Exception {
        java.util.List<String> addresses = new java.util.ArrayList<>(java.util.Arrays.asList(ROLES_URLS));
        // HoYoLAB account ids are digits; anything else never reaches a URL.
        String ltuid = cookieValue(cookies, "ltuid_v2");
        if (validUid(ltuid)) addresses.add(RECORD_CARD_URL + "?uid=" + ltuid);
        Failure failure = new Failure();
        boolean answered = false;
        for (String address : addresses) {
            JSONObject body;
            try {
                body = get(address, cookies);
            } catch (HoyolabError error) {
                failure.keep(null, error.getMessage());
                continue;
            }
            int retcode = body.optInt("retcode", -1);
            if (retcode != 0) {
                failure.keep(retcode, rolesError(retcode));
                continue;
            }
            answered = true;
            JSONArray roles = new JSONArray();
            JSONObject data = body.optJSONObject("data");
            JSONArray list = data == null ? null : data.optJSONArray("list");
            boolean cards = address.startsWith(RECORD_CARD_URL);
            for (int i = 0; list != null && i < list.length() && i < 100 && roles.length() < 50; i++) {
                JSONObject role = list.optJSONObject(i);
                if (role == null) continue;
                String preset = cards ? presetForCardGame(role.optInt("game_id", -1)) : presetForBiz(role.optString("game_biz"));
                String uid = role.optString(cards ? "game_role_id" : "game_uid");
                addRole(roles, preset, uid, role.optString("region"), role);
            }
            if (roles.length() > 0) return roles;
        }
        if (!answered && failure.error != null) throw new HoyolabError(failure.error);
        return new JSONArray();
    }

    /** Adds one sanitised role unless it is malformed or already listed. */
    private static void addRole(JSONArray roles, String preset, String uid, String region, JSONObject role) throws Exception {
        if (preset == null || !validUid(uid) || !validRegion(region) || findRole(roles, preset, uid) != null) return;
        JSONObject clean = new JSONObject();
        clean.put("presetKey", preset);
        clean.put("uid", uid);
        clean.put("region", region);
        clean.put("nickname", role.has("nickname") ? clip(role.optString("nickname"), 40) : JSONObject.NULL);
        clean.put("level", role.has("level") ? (Object) role.optInt("level") : JSONObject.NULL);
        clean.put("regionName", role.has("region_name") ? clip(role.optString("region_name"), 40) : JSONObject.NULL);
        roles.put(clean);
    }

    /** Saves new roles, dropping links to accounts that are no longer on this sign-in. */
    private static void saveRoles(Context context, JSONArray roles) throws Exception {
        JSONObject links = jsonObject(prefs(context).getString("gameLinks", null));
        JSONObject kept = new JSONObject();
        Iterator<String> ids = links.keys();
        while (ids.hasNext()) {
            String id = ids.next();
            JSONObject link = links.optJSONObject(id);
            if (link != null && findRole(roles, link.optString("presetKey"), link.optString("uid")) != null) kept.put(id, link);
        }
        prefs(context).edit().putString("roles", roles.toString()).putString("gameLinks", kept.toString()).apply();
    }

    private static JSONObject findRole(JSONArray roles, String preset, String uid) {
        for (int i = 0; i < roles.length(); i++) {
            JSONObject role = roles.optJSONObject(i);
            if (role != null && preset.equals(role.optString("presetKey")) && uid.equals(role.optString("uid"))) return role;
        }
        return null;
    }

    private static final int ENDGAME_TIMEOUT_MS = 8_000;
    private static final String GENSHIN_SG = "https://sg-public-api.hoyolab.com/event/game_record/genshin/api/";
    private static final String GENSHIN_BBS = "https://bbs-api-os.hoyolab.com/game_record/genshin/api/";
    private static final String HSR_SG = "https://sg-public-api.hoyolab.com/event/game_record/hkrpg/api/";
    private static final String HSR_BBS = "https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/";
    private static final String ZZZ_NAP = "https://sg-act-nap-api.hoyolab.com/event/game_record_zzz/api/zzz/";

    /**
     * A game's Real-Time Notes, as the addresses to try in order: HoYoLAB's newer
     * sg-public-api gateway first, the older bbs-api-os one second. Empty for a game without notes.
     */
    static String[] noteUrls(String preset, String region, String uid) {
        String role = "?server=" + region + "&role_id=" + uid;
        if (preset == null) return new String[0];
        switch (preset) {
            case "genshin":
                return new String[] { GENSHIN_SG + "dailyNote" + role, GENSHIN_BBS + "dailyNote" + role };
            case "hsr":
                return new String[] { HSR_SG + "note" + role, HSR_BBS + "note" + role };
            case "zzz":
                return new String[] { ZZZ_NAP + "note" + role };
            default:
                return new String[0];
        }
    }

    /** The notes themselves. */
    static final int NOTE_OK = 0;
    /** HoYoLAB asked for a captcha: stop and leave it alone for two hours. */
    static final int NOTE_CAPTCHA = 1;
    /** A refused sign-in or private notes: every gateway gives the same answer, so stop. */
    static final int NOTE_FINAL = 2;
    /** A gateway mismatch (-10001), any other code or an empty answer: try the other gateway. */
    static final int NOTE_RETRY = 3;

    /** What one notes answer means for the addresses still to try. */
    static int noteAnswer(int retcode, boolean hasData) {
        if (retcode == 0) return hasData ? NOTE_OK : NOTE_RETRY;
        if (retcode == 1034) return NOTE_CAPTCHA;
        if (retcode == -100 || retcode == 10001 || retcode == 10102) return NOTE_FINAL;
        return NOTE_RETRY;
    }

    static String noteError(int retcode) {
        if (retcode == -100 || retcode == 10001) return "HoYoLAB did not accept the sign-in. Sign in again.";
        if (retcode == 10102) return "This account keeps its Real-Time Notes private on HoYoLAB.";
        if (retcode == 0) return "HoYoLAB sent no notes for this account.";
        return "HoYoLAB could not read this account's notes (code " + retcode + ").";
    }

    /**
     * Optional endgame reads after the notes succeed. Every failure is swallowed;
     * a 1034 verification stops the rest at once without touching the notes.
     */
    private static final class Endgame {
        private final String cookies;
        private boolean blocked = false;

        Endgame(String cookies) {
            this.cookies = cookies;
        }

        /** The answer's `data`, or null on any failure. */
        JSONObject fetch(String address) {
            if (blocked) return null;
            try {
                JSONObject body = get(address, cookies, ENDGAME_TIMEOUT_MS);
                int retcode = body.optInt("retcode", -1);
                if (retcode == 1034) {
                    blocked = true;
                    return null;
                }
                return retcode == 0 ? body.optJSONObject("data") : null;
            } catch (Exception error) {
                return null;
            }
        }

        /** The first address, then the fallback when the first gave nothing and no verification was asked. */
        JSONObject fetch(String address, String fallback) {
            JSONObject data = fetch(address);
            return data != null ? data : fetch(fallback);
        }
    }

    private static void putEndgame(JSONObject endgame, String key, JSONObject data) {
        if (data == null) return;
        try {
            endgame.put(key, data);
        } catch (Exception ignored) {
            // Best effort.
        }
    }

    /** Spiral Abyss, Theater, Stygian; MoC, PF, AS; Shiyu, Deadly Assault. Empty when none answered. */
    private static JSONObject fetchEndgame(String preset, String region, String uid, String cookies) {
        JSONObject endgame = new JSONObject();
        Endgame reader = new Endgame(cookies);
        String role = "?server=" + region + "&role_id=" + uid;
        switch (preset) {
            case "genshin": {
                String abyss = "spiralAbyss" + role + "&schedule_type=1";
                putEndgame(endgame, "spiralAbyss", reader.fetch(GENSHIN_SG + abyss, GENSHIN_BBS + abyss));
                String theater = "role_combat" + role + "&need_detail=false";
                putEndgame(endgame, "roleCombat", reader.fetch(GENSHIN_SG + theater, GENSHIN_BBS + theater));
                String stygian = "hard_challenge" + role + "&need_detail=false";
                putEndgame(endgame, "hardChallenge", reader.fetch(GENSHIN_SG + stygian, GENSHIN_BBS + stygian));
                break;
            }
            case "hsr": {
                String query = role + "&schedule_type=1&need_all=true";
                String moc = "challenge" + query;
                putEndgame(endgame, "moc", reader.fetch(HSR_SG + moc, HSR_BBS + moc));
                String fiction = "challenge_story" + query;
                putEndgame(endgame, "pf", reader.fetch(HSR_SG + fiction, HSR_BBS + fiction));
                String shadow = "challenge_boss" + query;
                putEndgame(endgame, "as", reader.fetch(HSR_SG + shadow, HSR_BBS + shadow));
                break;
            }
            case "zzz": {
                String query = role + "&schedule_type=1";
                putEndgame(endgame, "shiyu", reader.fetch(ZZZ_NAP + "hadal_info_v2" + query));
                putEndgame(endgame, "deadlyAssault", reader.fetch(ZZZ_NAP + "hadal_mem_detail_v2" + query + "&uid=" + uid));
                break;
            }
            default:
                break;
        }
        return endgame;
    }

    /** HoYoLAB's daily check-in act id for a game, or null. */
    static String checkinActId(String preset) {
        if (preset == null) return null;
        switch (preset) {
            case "genshin":
                return "e202102251931481";
            case "hsr":
                return "e202303301540311";
            case "zzz":
                return "e202406031448091";
            default:
                return null;
        }
    }

    /**
     * The check-in hosts to try in order, each { base URL, x-rpc-signgame or null }. Star Rail's
     * own luna/hkrpg/os (which wants x-rpc-signgame: hkrpg) comes first, the shared luna/os second.
     */
    static String[][] checkinHosts(String preset) {
        if (preset == null) return new String[0][];
        switch (preset) {
            case "genshin":
                return new String[][] { { "https://sg-hk4e-api.hoyolab.com/event/sol", null } };
            case "hsr":
                return new String[][] {
                    { "https://sg-public-api.hoyolab.com/event/luna/hkrpg/os", "hkrpg" },
                    { "https://sg-public-api.hoyolab.com/event/luna/os", null },
                };
            case "zzz":
                return new String[][] { { "https://sg-act-nap-api.hoyolab.com/event/luna/zzz/os", "zzz" } };
            default:
                return new String[0][];
        }
    }

    /** Whether a claim answer settles it, so no other host is asked: claimed, already, or a refused sign-in. */
    static boolean checkinSettled(int retcode) {
        return retcode == 0 || retcode == -5003 || retcode == -100 || retcode == 10001;
    }

    /** HoYoverse's web code redemption for a game: { URL, game_biz, site }, or null. */
    private static String[] redeemTarget(String preset) {
        if (preset == null) return null;
        switch (preset) {
            case "genshin":
                return new String[] {
                    "https://sg-hk4e-api.hoyoverse.com/common/apicdkey/api/webExchangeCdkey",
                    "hk4e_global",
                    "https://genshin.hoyoverse.com",
                };
            case "hsr":
                return new String[] {
                    "https://public-operation-hkrpg.hoyoverse.com/common/apicdkey/api/webExchangeCdkey",
                    "hkrpg_global",
                    "https://hsr.hoyoverse.com",
                };
            case "zzz":
                return new String[] {
                    "https://public-operation-nap.hoyoverse.com/common/apicdkey/api/webExchangeCdkey",
                    "nap_global",
                    "https://zenless.hoyoverse.com",
                };
            default:
                return null;
        }
    }

    /** A redemption code as typed: trimmed, 1-80 letters, digits, `_` or `-`; else null. */
    static String cleanCode(String code) {
        if (code == null) return null;
        code = code.trim();
        if (code.isEmpty() || code.length() > 80) return null;
        for (int i = 0; i < code.length(); i++) {
            char c = code.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
            if (!ok) return null;
        }
        return code;
    }

    /** Today's check-in state from the first host that answers, best effort: null on any failure. */
    private static JSONObject fetchCheckin(String preset, String cookies) {
        String actId = checkinActId(preset);
        if (actId == null) return null;
        for (String[] host : checkinHosts(preset)) {
            try {
                String address = host[0] + "/info?lang=en-us&act_id=" + actId;
                JSONObject body = request(address, cookies, ENDGAME_TIMEOUT_MS, null, host[1], null);
                JSONObject data = body.optJSONObject("data");
                if (body.optInt("retcode", -1) == 0 && data != null) return data;
            } catch (Exception error) {
                // Best effort: the next host may answer.
            }
        }
        return null;
    }

    private static JSObject actionResult(boolean ok, String status, Integer retcode, String message) {
        JSObject result = new JSObject();
        result.put("ok", ok);
        result.put("status", status);
        result.put("retcode", retcode == null ? JSONObject.NULL : retcode);
        result.put("message", message);
        return result;
    }

    static JSObject checkinAnswer(int retcode, JSONObject data) {
        if (retcode == 0) {
            JSONObject gt = data == null ? null : data.optJSONObject("gt_result");
            boolean risky = (data != null && data.optBoolean("is_risk", false))
                || (gt != null && (gt.optBoolean("is_risk", false) || gt.optLong("risk_code", 0) != 0));
            if (risky) return actionResult(false, "captcha", 5001, "HoYoLAB asked for verification. Open the check-in page to claim.");
            return actionResult(true, "claimed", 0, "Claimed HoYoLAB daily check-in.");
        }
        if (retcode == -5003) return actionResult(true, "already", -5003, "Already checked in on HoYoLAB today.");
        if (retcode == -100 || retcode == 10001) {
            return actionResult(false, "auth", retcode, "HoYoLAB sign-in expired. Sign in again in Settings \u2192 Connections.");
        }
        return actionResult(false, "failed", retcode, "HoYoLAB check-in failed (code " + retcode + ").");
    }

    static JSObject redeemAnswer(int retcode) {
        switch (retcode) {
            case 0:
                return actionResult(true, "redeemed", retcode, "Code redeemed! Check in-game mail.");
            case -2017:
            case -2018:
                return actionResult(true, "already", retcode, "Already redeemed on this account.");
            case -2001:
                return actionResult(false, "expired", retcode, "This code has expired.");
            case -2003:
                return actionResult(false, "invalid", retcode, "Invalid redemption code.");
            case -2016:
                return actionResult(false, "cooldown", retcode, "Cooldown active \u2014 wait 5 seconds and try again.");
            case -1071:
            case -100:
            case 10001:
                return actionResult(
                    false,
                    "auth",
                    retcode,
                    "Sign in to HoYoLAB again in Settings \u2192 Connections for 1-click claiming, or open the redeem page."
                );
            case -2006:
                return actionResult(false, "expired", retcode, "Max redemptions reached for this code.");
            case -2004:
                return actionResult(false, "failed", retcode, "Account level is too low to claim this code.");
            case -1073:
                return actionResult(false, "failed", retcode, "No character found on that server.");
            default:
                return actionResult(false, "failed", retcode, "Redemption failed (code " + retcode + ").");
        }
    }

    private static JSObject claimCheckin(Context context, String gameId) {
        JSONObject link = jsonObject(prefs(context).getString("gameLinks", null)).optJSONObject(gameId == null ? "" : gameId);
        if (link == null) return actionResult(false, "failed", null, "Link this game to a HoYoLAB account first.");
        String cookies = cookieHeader(context);
        if (cookies == null) return actionResult(false, "auth", null, "Sign in to HoYoLAB first.");
        String preset = link.optString("presetKey");
        String actId = checkinActId(preset);
        if (actId == null) return actionResult(false, "failed", null, "This game has no HoYoLAB check-in.");
        String payload;
        try {
            payload = new JSONObject().put("act_id", actId).toString();
        } catch (Exception error) {
            return actionResult(false, "failed", null, "HoYoLAB check-in failed.");
        }
        // The next host is asked only when this one could not settle the claim.
        // HoYoLAB keeps one claim a day, so asking twice never claims twice.
        Failure failure = new Failure();
        for (String[] host : checkinHosts(preset)) {
            try {
                JSONObject body = request(host[0] + "/sign?lang=en-us", cookies, 15_000, null, host[1], payload);
                int retcode = body.optInt("retcode", -1);
                if (checkinSettled(retcode)) return checkinAnswer(retcode, body.optJSONObject("data"));
                failure.keep(retcode, "");
            } catch (HoyolabError error) {
                failure.keep(null, error.getMessage());
            }
        }
        if (failure.retcode != null) return checkinAnswer(failure.retcode, null);
        return actionResult(false, "failed", null, failure.error == null || failure.error.isEmpty() ? "HoYoLAB check-in failed." : failure.error);
    }

    private static JSObject redeemCode(Context context, String gameId, String rawCode) {
        String code = cleanCode(rawCode);
        if (code == null) return actionResult(false, "invalid", null, "Invalid redemption code.");
        JSONObject link = jsonObject(prefs(context).getString("gameLinks", null)).optJSONObject(gameId == null ? "" : gameId);
        if (link == null) return actionResult(false, "failed", null, "Link this game to a HoYoLAB account first.");
        String cookies = cookieHeader(context);
        if (cookies == null) return actionResult(false, "auth", null, "Sign in to HoYoLAB first.");
        String[] target = redeemTarget(link.optString("presetKey"));
        String uid = link.optString("uid");
        String region = link.optString("region");
        if (target == null || !validUid(uid) || !validRegion(region)) {
            return actionResult(false, "failed", null, "This game has no HoYoverse code redemption.");
        }
        String address =
            target[0] + "?uid=" + uid + "&region=" + region + "&lang=en&cdkey=" + code + "&game_biz=" + target[1] + "&sLangKey=en-us";
        try {
            JSONObject body = request(address, cookies, 15_000, target[2], null, null);
            return redeemAnswer(body.optInt("retcode", -1));
        } catch (HoyolabError error) {
            return actionResult(false, "failed", null, error.getMessage());
        }
    }

    private static JSObject refreshResult(boolean ok, Integer retcode, long backoff, String preset, Object raw, String error) {
        JSObject result = new JSObject();
        result.put("ok", ok);
        result.put("retcode", retcode == null ? JSONObject.NULL : retcode);
        result.put("backoffUntilMs", backoff > 0 ? (Object) backoff : JSONObject.NULL);
        result.put("presetKey", preset == null ? JSONObject.NULL : preset);
        result.put("observedAt", System.currentTimeMillis());
        result.put("raw", raw == null ? JSONObject.NULL : raw);
        result.put("error", error == null ? JSONObject.NULL : error);
        return result;
    }

    private static JSObject refresh(Context context, String gameId, boolean auto) {
        JSONObject link = jsonObject(prefs(context).getString("gameLinks", null)).optJSONObject(gameId == null ? "" : gameId);
        if (link == null) return refreshResult(false, null, backoffUntil(context), null, null, "Link this game to a HoYoLAB account first.");
        String preset = link.optString("presetKey");
        long until = backoffUntil(context);
        if (until > 0) {
            return refreshResult(false, 1034, until, preset, null, "HoYoLAB asked for a verification. Memoria is waiting before it asks again.");
        }
        String cookies = cookieHeader(context);
        if (cookies == null) return refreshResult(false, null, 0, preset, null, "Sign in to HoYoLAB first.");
        long now = SystemClock.elapsedRealtime();
        long gap = auto ? AUTO_GAP_MS : MANUAL_GAP_MS;
        Long last = LAST_FETCH.get(gameId);
        if (last != null && now - last < gap) {
            long wait = Math.max(1, (gap - (now - last)) / 1000);
            return refreshResult(false, null, 0, preset, null, "Read just now. Try again in " + wait + " s.");
        }
        LAST_FETCH.put(gameId, now);
        String region = link.optString("region");
        String uid = link.optString("uid");
        if (!validUid(uid) || !validRegion(region)) {
            return refreshResult(false, null, 0, preset, null, "Link this game to a HoYoLAB account again.");
        }
        String[] addresses = noteUrls(preset, region, uid);
        if (addresses.length == 0) return refreshResult(false, null, 0, preset, null, "This game has no live notes on HoYoLAB.");
        Failure failure = new Failure();
        for (String address : addresses) {
            JSONObject body;
            try {
                body = get(address, cookies);
            } catch (HoyolabError error) {
                failure.keep(null, error.getMessage());
                continue;
            }
            int retcode = body.optInt("retcode", -1);
            JSONObject data = body.optJSONObject("data");
            switch (noteAnswer(retcode, data != null)) {
                case NOTE_OK: {
                    JSONObject endgame = fetchEndgame(preset, region, uid, cookies);
                    JSONObject checkin = fetchCheckin(preset, cookies);
                    try {
                        if (endgame.length() > 0) data.put("_endgame", endgame);
                        if (checkin != null) data.put("_checkin", checkin);
                    } catch (Exception ignored) {
                        // The notes stand on their own.
                    }
                    return refreshResult(true, 0, 0, preset, data, null);
                }
                case NOTE_CAPTCHA: {
                    long backoff = System.currentTimeMillis() + BACKOFF_MS;
                    prefs(context).edit().putLong("backoffUntilMs", backoff).apply();
                    return refreshResult(
                        false,
                        1034,
                        backoff,
                        preset,
                        null,
                        "HoYoLAB asked for a verification. Open Battle Chronicle on HoYoLAB once, then try again."
                    );
                }
                case NOTE_FINAL:
                    return refreshResult(false, retcode, 0, preset, null, noteError(retcode));
                default:
                    failure.keep(retcode, noteError(retcode));
            }
        }
        String error = failure.error == null ? "HoYoLAB could not be reached. Check your connection and try again." : failure.error;
        return refreshResult(false, failure.retcode, 0, preset, null, error);
    }

    // ------------------------------------------------------------------
    // Plugin methods
    // ------------------------------------------------------------------

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(status(getContext()));
    }

    @PluginMethod
    public void hoyolabLogin(PluginCall call) {
        if (signingIn) {
            call.reject("The HoYoLAB sign-in is already open.", "LOGIN_BUSY");
            return;
        }
        signingIn = true;
        try {
            Intent intent = new Intent(getContext(), HoyolabLoginActivity.class)
                .putExtra(HoyolabLoginActivity.EXTRA_FRESH, Boolean.TRUE.equals(call.getBoolean("fresh", false)));
            startActivityForResult(call, intent, "loginResult");
        } catch (RuntimeException error) {
            signingIn = false;
            call.reject("The HoYoLAB sign-in could not open.", "LOGIN_UNAVAILABLE", error);
        }
    }

    @ActivityCallback
    private void loginResult(PluginCall call, ActivityResult result) {
        signingIn = false;
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK) {
            String error = data == null ? null : data.getStringExtra(HoyolabLoginActivity.EXTRA_ERROR);
            if (error != null) call.reject(error, "LOGIN_FAILED");
            else call.reject("Sign-in cancelled.", "CANCELLED");
            return;
        }
        Context context = getContext().getApplicationContext();
        EXECUTOR.execute(() -> {
            String error = null;
            try {
                String cookies = cookieHeader(context);
                if (cookies == null) throw new HoyolabError("The HoYoLAB sign-in could not be saved on this phone.");
                saveRoles(context, fetchRoles(cookies));
            } catch (HoyolabError failure) {
                error = failure.getMessage();
            } catch (Exception failure) {
                error = "HoYoLAB could not list your game accounts.";
            }
            JSObject status = status(context);
            if (error != null) status.put("error", error);
            notifyListeners("statusChanged", status);
            call.resolve(status);
        });
    }

    /** Clears every HoYoLAB pref and cooldown; SKPORT's stay. */
    static void clearHoyolab(Context context) {
        prefs(context)
            .edit()
            .remove("sealedCookies")
            .remove("maskedUid")
            .remove("roles")
            .remove("gameLinks")
            .remove("backoffUntilMs")
            .commit();
        Iterator<String> keys = LAST_FETCH.keySet().iterator();
        while (keys.hasNext()) {
            if (!keys.next().startsWith(SKPORT_FETCH_PREFIX)) keys.remove();
        }
    }

    /** Forgets the sign-in here and in the WebView's cookie jar. */
    @PluginMethod
    public void hoyolabDisconnect(PluginCall call) {
        Context context = getContext().getApplicationContext();
        clearHoyolab(context);
        // Again behind any sign-in or import in flight, so nothing it saves outlives the
        // disconnect, and the page hears the final state after that request's own answer.
        EXECUTOR.execute(() -> {
            clearHoyolab(context);
            notifyListeners("statusChanged", status(context));
        });
        HoyolabLoginActivity.expireSessionCookies();
        announce();
        call.resolve(status(getContext()));
    }

    @PluginMethod
    public void hoyolabLink(PluginCall call) {
        String gameId = call.getString("gameId");
        String preset = call.getString("presetKey");
        String uid = call.getString("uid");
        String region = call.getString("region");
        if (gameId == null || gameId.isEmpty() || gameId.length() > 160) {
            call.reject("Choose a game first.");
            return;
        }
        SharedPreferences prefs = prefs(getContext());
        JSONObject links = jsonObject(prefs.getString("gameLinks", null));
        try {
            if (uid == null || uid.isEmpty()) {
                links.remove(gameId);
            } else {
                JSONObject role = validPreset(preset) && validUid(uid)
                    ? findRole(jsonArray(prefs.getString("roles", null)), preset, uid)
                    : null;
                if (role == null) {
                    call.reject("Choose one of the accounts on your HoYoLAB sign-in.");
                    return;
                }
                String roleRegion = role.optString("region");
                if (region == null || region.isEmpty()) region = roleRegion;
                if (!validRegion(region) || !region.equals(roleRegion)) {
                    call.reject("That account's server does not match HoYoLAB.");
                    return;
                }
                if (!links.has(gameId) && links.length() >= 200) {
                    call.reject("Unlink a game before linking another.");
                    return;
                }
                JSONObject link = new JSONObject();
                link.put("presetKey", preset);
                link.put("uid", uid);
                link.put("region", region);
                links.put(gameId, link);
            }
        } catch (Exception error) {
            call.reject("The link could not be saved.");
            return;
        }
        prefs.edit().putString("gameLinks", links.toString()).apply();
        call.resolve(status(getContext()));
    }

    @PluginMethod
    public void hoyolabRefresh(PluginCall call) {
        String gameId = call.getString("gameId");
        boolean auto = Boolean.TRUE.equals(call.getBoolean("auto", false));
        Context context = getContext().getApplicationContext();
        EXECUTOR.execute(() -> call.resolve(refresh(context, gameId, auto)));
    }

    @PluginMethod
    public void hoyolabRedeemCode(PluginCall call) {
        String gameId = call.getString("gameId");
        String code = call.getString("code");
        Context context = getContext().getApplicationContext();
        EXECUTOR.execute(() -> call.resolve(redeemCode(context, gameId, code)));
    }

    @PluginMethod
    public void hoyolabCheckIn(PluginCall call) {
        String gameId = call.getString("gameId");
        Context context = getContext().getApplicationContext();
        EXECUTOR.execute(() -> call.resolve(claimCheckin(context, gameId)));
    }

    @PluginMethod
    public void hoyolabPrefs(PluginCall call) {
        JSObject changes = call.getObject("changes", call.getData());
        if (changes != null && changes.has("autoRefreshOnExit")) {
            prefs(getContext()).edit().putBoolean("autoRefreshOnExit", changes.optBoolean("autoRefreshOnExit", false)).apply();
        }
        call.resolve(status(getContext()));
    }

    // ------------------------------------------------------------------
    // SKPORT (Arknights: Endfield)
    // ------------------------------------------------------------------

    static final String SKPORT_SEALED = "skportSealed";
    private static final String SKPORT_MASKED_UID = "skportMaskedUid";
    private static final String SKPORT_ROLES = "skportRoles";
    private static final String SKPORT_LINKS = "skportGameLinks";
    private static final String SKPORT_AUTO = "skportAutoRefreshOnExit";
    private static final String SKPORT_PRESET = "endfield";
    private static final String SKPORT_FETCH_PREFIX = "skport:";
    private static final String SKPORT_GRANT_URL = "https://as.gryphline.com/user/oauth2/v2/grant";
    private static final String SKPORT_CRED_URL = "https://zonai.skport.com/web/v1/user/auth/generate_cred_by_code";
    private static final String SKPORT_REFRESH_URL = "https://zonai.skport.com/web/v1/auth/refresh";
    private static final String SKPORT_HOST = "https://zonai.skport.com";
    private static final String SKPORT_BINDING_PATH = "/api/v1/game/player/binding";
    private static final String SKPORT_CARD_PATH = "/api/v1/game/endfield/card/detail";
    private static final String SKPORT_APP_CODE = "6eb76d4e13aa36e6";
    private static final String SKPORT_ORIGIN = "https://www.skport.com";
    private static final String SKPORT_REFERER = "https://www.skport.com/";
    private static final String SKPORT_RELOGIN = "SKPORT did not accept the sign-in. Sign in again.";
    private static final String SKPORT_UNSAVED = "The SKPORT sign-in could not be saved securely on this phone.";

    static final class SkportError extends Exception {
        SkportError(String message) {
            super(message);
        }
    }

    /** The decrypted SKPORT credentials. Lives only on the executor thread. */
    private static final class SkportCreds {
        String accountToken;
        String cred;
        String signToken;
    }

    private static final class SkportResponse {
        final int http;
        final JSONObject body;

        SkportResponse(int http, JSONObject body) {
            this.http = http;
            this.body = body;
        }
    }

    static boolean validSkportToken(String value) {
        if (value == null || value.isEmpty() || value.length() > 4096) return false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c <= ' ' || c > '~' || c == ';' || c == ',' || c == '"' || c == '\\') return false;
        }
        return true;
    }

    private static boolean validSkportUid(String uid) {
        return uid != null && !uid.isEmpty() && uid.length() <= 32 && uid.matches("[A-Za-z0-9]+");
    }

    private static JSObject skportStatus(SharedPreferences prefs) {
        JSObject skport = new JSObject();
        skport.put("connected", prefs.getString(SKPORT_SEALED, null) != null);
        String masked = prefs.getString(SKPORT_MASKED_UID, null);
        skport.put("maskedUid", masked == null ? JSONObject.NULL : masked);
        skport.put("roles", jsonArray(prefs.getString(SKPORT_ROLES, null)));
        skport.put("gameLinks", jsonObject(prefs.getString(SKPORT_LINKS, null)));
        skport.put("autoRefreshOnExit", prefs.getBoolean(SKPORT_AUTO, false));
        return skport;
    }

    private static boolean writeSkportCreds(Context context, SkportCreds creds, String maskedUid) {
        try {
            JSONObject plain = new JSONObject();
            plain.put("accountToken", creds.accountToken == null ? "" : creds.accountToken);
            plain.put("cred", creds.cred == null ? "" : creds.cred);
            plain.put("signToken", creds.signToken == null ? "" : creds.signToken);
            SharedPreferences.Editor editor = prefs(context).edit().putString(SKPORT_SEALED, seal(plain.toString()));
            if (maskedUid != null) editor.putString(SKPORT_MASKED_UID, maskedUid);
            return editor.commit();
        } catch (Exception error) {
            return false;
        }
    }

    /**
     * Seals what the SKPORT sign-in left behind: the Gryphline account token,
     * the SKPORT cred, or both. Fails closed: nothing is kept unsealed.
     */
    static boolean storeSkportSeed(Context context, String accountToken, String credKey) {
        boolean hasToken = validSkportToken(accountToken);
        boolean hasCred = validSkportToken(credKey);
        if (!hasToken && !hasCred) return false;
        SkportCreds creds = new SkportCreds();
        creds.accountToken = hasToken ? accountToken : "";
        creds.cred = hasCred ? credKey : "";
        creds.signToken = "";
        return writeSkportCreds(context, creds, null);
    }

    private static SkportCreds readSkportCreds(Context context) {
        String sealed = prefs(context).getString(SKPORT_SEALED, null);
        if (sealed == null) return null;
        try {
            JSONObject plain = new JSONObject(unseal(sealed));
            SkportCreds creds = new SkportCreds();
            creds.accountToken = plain.optString("accountToken", "");
            creds.cred = plain.optString("cred", "");
            creds.signToken = plain.optString("signToken", "");
            if (!validSkportToken(creds.accountToken) && !validSkportToken(creds.cred)) return null;
            return creds;
        } catch (Exception error) {
            return null;
        }
    }

    /** Clears every SKPORT pref and cooldown. */
    static void clearSkport(Context context) {
        prefs(context)
            .edit()
            .remove(SKPORT_SEALED)
            .remove(SKPORT_MASKED_UID)
            .remove(SKPORT_ROLES)
            .remove(SKPORT_LINKS)
            .remove(SKPORT_AUTO)
            .commit();
        Iterator<String> keys = LAST_FETCH.keySet().iterator();
        while (keys.hasNext()) {
            if (keys.next().startsWith(SKPORT_FETCH_PREFIX)) keys.remove();
        }
    }

    static String hmacSha256Hex(String key, String text) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] digest = mac.doFinal(text.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) hex.append(String.format("%02x", b & 0xff));
        return hex.toString();
    }

    /** SKPORT's V2 request signature headers. */
    private static Map<String, String> skportSignedHeaders(SkportCreds creds, String path, String queryOrBody) throws Exception {
        String ts = Long.toString(System.currentTimeMillis() / 1000);
        String headerJson = "{\"platform\":\"3\",\"timestamp\":\"" + ts + "\",\"dId\":\"\",\"vName\":\"1.0.0\"}";
        String toSign = path + (queryOrBody == null ? "" : queryOrBody) + ts + headerJson;
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("cred", creds.cred);
        headers.put("platform", "3");
        headers.put("timestamp", ts);
        headers.put("dId", "");
        headers.put("vName", "1.0.0");
        headers.put("sign", md5Hex(hmacSha256Hex(creds.signToken, toSign)));
        return headers;
    }

    /** SKPORT's `code` (zonai) or Gryphline's `status`; -1 when neither is there. */
    private static int skportCode(JSONObject body) {
        if (body == null) return -1;
        if (body.has("code")) return body.optInt("code", -1);
        if (body.has("status")) return body.optInt("status", -1);
        return -1;
    }

    /** One request. Errors are fixed sentences: no address, token or body is echoed. */
    private static SkportResponse skportHttp(String method, String address, Map<String, String> headers, String body)
        throws SkportError {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(address).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(15_000);
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json, text/plain, */*");
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Origin", SKPORT_ORIGIN);
            connection.setRequestProperty("Referer", SKPORT_REFERER);
            if (headers != null) {
                for (Map.Entry<String, String> header : headers.entrySet()) {
                    connection.setRequestProperty(header.getKey(), header.getValue());
                }
            }
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }
            }
            int code = connection.getResponseCode();
            if (code == 401) return new SkportResponse(401, new JSONObject());
            if (code < 200 || code >= 300) throw new SkportError("SKPORT answered with an error (" + code + "). Try again later.");
            try (InputStream input = connection.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    if (out.size() > MAX_BODY) throw new SkportError("SKPORT sent an answer Memoria could not read.");
                }
                return new SkportResponse(code, new JSONObject(out.toString("UTF-8")));
            }
        } catch (SkportError error) {
            throw error;
        } catch (org.json.JSONException error) {
            throw new SkportError("SKPORT sent an answer Memoria could not read.");
        } catch (Exception error) {
            throw new SkportError("SKPORT could not be reached. Check your connection and try again.");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static boolean skportAuthFailure(SkportResponse response) {
        int code = skportCode(response.body);
        return response.http == 401 || code == 10000 || code == 10002;
    }

    /** Account token -> OAuth code -> cred and sign token, sealed. */
    private static void skportExchange(Context context, SkportCreds creds) throws Exception {
        if (!validSkportToken(creds.accountToken)) throw new SkportError(SKPORT_RELOGIN);
        JSONObject grantBody = new JSONObject();
        grantBody.put("token", creds.accountToken);
        grantBody.put("appCode", SKPORT_APP_CODE);
        grantBody.put("type", 0);
        SkportResponse grant = skportHttp("POST", SKPORT_GRANT_URL, null, grantBody.toString());
        JSONObject grantData = grant.body.optJSONObject("data");
        String code = grantData == null ? null : grantData.optString("code", null);
        if (grant.http == 401 || skportCode(grant.body) != 0 || !validSkportToken(code)) throw new SkportError(SKPORT_RELOGIN);
        JSONObject credBody = new JSONObject();
        credBody.put("code", code);
        credBody.put("kind", 1);
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("platform", "3");
        SkportResponse issued = skportHttp("POST", SKPORT_CRED_URL, headers, credBody.toString());
        JSONObject data = issued.body.optJSONObject("data");
        String cred = data == null ? null : data.optString("cred", null);
        String signToken = data == null ? null : data.optString("token", null);
        if (issued.http == 401 || skportCode(issued.body) != 0 || !validSkportToken(cred) || !validSkportToken(signToken)) {
            throw new SkportError(SKPORT_RELOGIN);
        }
        creds.cred = cred;
        creds.signToken = signToken;
        String userId = data.optString("userId", "");
        String masked = validSkportUid(userId) ? maskUid(userId) : null;
        if (!writeSkportCreds(context, creds, masked)) throw new SkportError(SKPORT_UNSAVED);
    }

    /** A fresh sign token for the current cred; falls back to the account token. */
    private static void skportRefreshSign(Context context, SkportCreds creds) throws Exception {
        if (validSkportToken(creds.cred)) {
            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("cred", creds.cred);
            headers.put("platform", "3");
            headers.put("vName", "1.0.0");
            SkportResponse response = skportHttp("GET", SKPORT_REFRESH_URL, headers, null);
            JSONObject data = response.body.optJSONObject("data");
            String token = data == null ? null : data.optString("token", null);
            if (response.http != 401 && skportCode(response.body) == 0 && validSkportToken(token)) {
                creds.signToken = token;
                if (!writeSkportCreds(context, creds, null)) throw new SkportError(SKPORT_UNSAVED);
                return;
            }
        }
        // The cred itself has expired: start again from the account token, if there is one.
        skportExchange(context, creds);
    }

    /** Usable credentials: cred and sign token, minted when missing. */
    private static SkportCreds skportCreds(Context context) throws Exception {
        SkportCreds creds = readSkportCreds(context);
        if (creds == null) throw new SkportError("Sign in to SKPORT first.");
        if (validSkportToken(creds.cred) && validSkportToken(creds.signToken)) return creds;
        if (validSkportToken(creds.cred)) skportRefreshSign(context, creds);
        else skportExchange(context, creds);
        return creds;
    }

    /** A signed zonai GET, with one sign-token refresh on an auth failure. */
    private static JSONObject skportSignedGet(Context context, String path, String query, Map<String, String> extra)
        throws Exception {
        SkportCreds creds = skportCreds(context);
        String address = SKPORT_HOST + path + (query == null || query.isEmpty() ? "" : "?" + query);
        for (int attempt = 0; attempt < 2; attempt++) {
            Map<String, String> headers = skportSignedHeaders(creds, path, query);
            if (extra != null) headers.putAll(extra);
            SkportResponse response = skportHttp("GET", address, headers, null);
            if (!skportAuthFailure(response)) return response.body;
            if (attempt == 0) skportRefreshSign(context, creds);
        }
        throw new SkportError(SKPORT_RELOGIN);
    }

    private static void addSkportRole(JSONArray roles, JSONObject role) throws Exception {
        if (role == null || roles.length() >= 50) return;
        String uid = role.optString("roleId", role.optString("uid", ""));
        String region = role.optString("serverId", "");
        if (!validSkportUid(uid) || !validRegion(region)) return;
        if (findRole(roles, SKPORT_PRESET, uid) != null) return;
        JSONObject clean = new JSONObject();
        clean.put("presetKey", SKPORT_PRESET);
        clean.put("uid", uid);
        clean.put("region", region);
        String nickname = role.optString("nickname", role.optString("nickName", ""));
        clean.put("nickname", nickname.isEmpty() ? JSONObject.NULL : clip(nickname, 40));
        clean.put("level", role.has("level") ? (Object) role.optInt("level") : JSONObject.NULL);
        String serverName = role.optString("serverName", "");
        clean.put("regionName", serverName.isEmpty() ? JSONObject.NULL : clip(serverName, 40));
        roles.put(clean);
    }

    /** The signed-in account's Endfield roles, sanitised. */
    private static JSONArray fetchSkportRoles(Context context) throws Exception {
        JSONObject body = skportSignedGet(context, SKPORT_BINDING_PATH, "", null);
        int code = skportCode(body);
        if (code != 0) throw new SkportError("SKPORT could not list your game accounts (code " + code + ").");
        JSONObject data = body.optJSONObject("data");
        JSONArray apps = data == null ? null : data.optJSONArray("list");
        JSONArray roles = new JSONArray();
        if (apps == null) return roles;
        for (int i = 0; i < apps.length() && i < 50; i++) {
            JSONObject app = apps.optJSONObject(i);
            if (app == null || !SKPORT_PRESET.equals(app.optString("appCode"))) continue;
            JSONArray bindings = app.optJSONArray("bindingList");
            if (bindings == null) continue;
            for (int j = 0; j < bindings.length() && j < 50; j++) {
                JSONObject binding = bindings.optJSONObject(j);
                if (binding == null) continue;
                JSONArray bound = binding.optJSONArray("roles");
                if (bound != null && bound.length() > 0) {
                    for (int k = 0; k < bound.length() && k < 50; k++) addSkportRole(roles, bound.optJSONObject(k));
                } else if (binding.optJSONObject("defaultRole") != null) {
                    addSkportRole(roles, binding.optJSONObject("defaultRole"));
                } else {
                    addSkportRole(roles, binding);
                }
            }
        }
        return roles;
    }

    /** Saves new roles, dropping links to accounts that are no longer on this sign-in. */
    private static void saveSkportRoles(Context context, JSONArray roles) throws Exception {
        SharedPreferences prefs = prefs(context);
        JSONObject links = jsonObject(prefs.getString(SKPORT_LINKS, null));
        JSONObject kept = new JSONObject();
        Iterator<String> ids = links.keys();
        while (ids.hasNext()) {
            String id = ids.next();
            JSONObject link = links.optJSONObject(id);
            if (link != null && findRole(roles, SKPORT_PRESET, link.optString("uid")) != null) kept.put(id, link);
        }
        SharedPreferences.Editor editor = prefs.edit().putString(SKPORT_ROLES, roles.toString()).putString(SKPORT_LINKS, kept.toString());
        if (prefs.getString(SKPORT_MASKED_UID, null) == null && roles.length() > 0) {
            JSONObject first = roles.optJSONObject(0);
            if (first != null) editor.putString(SKPORT_MASKED_UID, maskUid(first.optString("uid")));
        }
        editor.apply();
    }

    private static JSObject skportRefresh(Context context, String gameId, boolean auto) {
        JSONObject link = jsonObject(prefs(context).getString(SKPORT_LINKS, null)).optJSONObject(gameId == null ? "" : gameId);
        if (link == null) return refreshResult(false, null, 0, SKPORT_PRESET, null, "Link this game to a SKPORT account first.");
        if (prefs(context).getString(SKPORT_SEALED, null) == null) {
            return refreshResult(false, null, 0, SKPORT_PRESET, null, "Sign in to SKPORT first.");
        }
        String uid = link.optString("uid");
        String region = link.optString("region");
        if (!validSkportUid(uid) || !validRegion(region)) {
            return refreshResult(false, null, 0, SKPORT_PRESET, null, "Link this game to a SKPORT account again.");
        }
        String fetchKey = SKPORT_FETCH_PREFIX + gameId;
        long now = SystemClock.elapsedRealtime();
        long gap = auto ? AUTO_GAP_MS : MANUAL_GAP_MS;
        Long last = LAST_FETCH.get(fetchKey);
        if (last != null && now - last < gap) {
            long wait = Math.max(1, (gap - (now - last)) / 1000);
            return refreshResult(false, null, 0, SKPORT_PRESET, null, "Read just now. Try again in " + wait + " s.");
        }
        LAST_FETCH.put(fetchKey, now);
        try {
            Map<String, String> extra = new LinkedHashMap<>();
            extra.put("sk-game-role", "3_" + uid + "_" + region);
            JSONObject body = skportSignedGet(context, SKPORT_CARD_PATH, "roleId=" + uid + "&serverId=" + region, extra);
            int code = skportCode(body);
            if (code == 0) return refreshResult(true, 0, 0, SKPORT_PRESET, body.optJSONObject("data"), null);
            return refreshResult(false, code, 0, SKPORT_PRESET, null, "SKPORT could not read this account's card (code " + code + ").");
        } catch (SkportError error) {
            return refreshResult(false, null, 0, SKPORT_PRESET, null, error.getMessage());
        } catch (Exception error) {
            return refreshResult(false, null, 0, SKPORT_PRESET, null, "SKPORT could not read this account's card.");
        }
    }

    @PluginMethod
    public void skportLogin(PluginCall call) {
        if (skportSigningIn) {
            call.reject("The SKPORT sign-in is already open.", "LOGIN_BUSY");
            return;
        }
        skportSigningIn = true;
        try {
            startActivityForResult(call, new Intent(getContext(), SkportLoginActivity.class), "skportLoginResult");
        } catch (RuntimeException error) {
            skportSigningIn = false;
            call.reject("The SKPORT sign-in could not open.", "LOGIN_UNAVAILABLE", error);
        }
    }

    @ActivityCallback
    private void skportLoginResult(PluginCall call, ActivityResult result) {
        skportSigningIn = false;
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK) {
            String error = data == null ? null : data.getStringExtra(SkportLoginActivity.EXTRA_ERROR);
            if (error != null) call.reject(error, "LOGIN_FAILED");
            else call.reject("Sign-in cancelled.", "CANCELLED");
            return;
        }
        Context context = getContext().getApplicationContext();
        EXECUTOR.execute(() -> {
            String error = null;
            try {
                skportCreds(context);
                saveSkportRoles(context, fetchSkportRoles(context));
            } catch (SkportError failure) {
                error = failure.getMessage();
            } catch (Exception failure) {
                error = "SKPORT could not list your game accounts.";
            }
            JSObject status = status(context);
            if (error != null) status.put("error", error);
            notifyListeners("statusChanged", status);
            call.resolve(status);
        });
    }

    // ------------------------------------------------------------------
    // Connecting with cookies copied from the player's own browser
    // ------------------------------------------------------------------

    private static final int MAX_BROWSER_INPUT = 64 * 1024;
    private static final String[] HOYOLAB_BROWSER_COOKIES = {
        "ltuid_v2", "ltoken_v2", "ltmid_v2", "cookie_token_v2", "account_id_v2", "account_mid_v2",
    };
    private static final String[] SKPORT_BROWSER_COOKIES = { "ACCOUNT_TOKEN", "SK_OAUTH_CRED_KEY" };
    private static final String MISSING_LTOKEN =
        "The HoYoLAB cookie ltoken_v2 is missing. It is HttpOnly, so document.cookie and most page copies leave it out. "
            + "On a computer, press F12 on hoyolab.com, open Network, pick any request to hoyolab.com and copy its whole Cookie request header.";
    private static final String MISSING_IDS =
        "The HoYoLAB cookies ltuid_v2 and ltmid_v2 are missing. Copy the whole Cookie request header from a hoyolab.com request in DevTools (F12, Network).";
    private static final String NO_SKPORT =
        "No SKPORT sign-in was found. Sign in on skport.com, then copy the Cookie request header of a skport.com request from DevTools (F12, Network).";
    private static final String TOO_LARGE = "That is too much text to be a cookie copy. Copy only the Cookie header.";

    private static boolean cookieNameChar(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
    }

    private static boolean cookieValueEnd(char c) {
        return Character.isWhitespace(c) || c == ';' || c == ',' || c == '\'' || c == '"' || c == '\\' || c == '`';
    }

    private static void putCookie(Map<String, String> found, String[] names, String name, String value) {
        if (name == null || value == null || value.isEmpty() || found.containsKey(name)) return;
        for (String allowed : names) {
            if (allowed.equals(name)) {
                found.put(name, value);
                return;
            }
        }
    }

    private static void collectJson(Object node, String[] names, Map<String, String> found, int depth) {
        if (depth > 8 || node == null) return;
        if (node instanceof JSONArray) {
            JSONArray array = (JSONArray) node;
            for (int i = 0; i < Math.min(array.length(), 1000); i++) collectJson(array.opt(i), names, found, depth + 1);
        } else if (node instanceof JSONObject) {
            JSONObject object = (JSONObject) node;
            Object name = object.opt("name");
            Object value = object.opt("value");
            if (name instanceof String && (value instanceof String || value instanceof Number)) {
                putCookie(found, names, (String) name, String.valueOf(value).trim());
                return;
            }
            Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                Object child = object.opt(key);
                if (child instanceof String || child instanceof Number) putCookie(found, names, key, String.valueOf(child).trim());
                else collectJson(child, names, found, depth + 1);
            }
        }
    }

    /**
     * The allowlisted cookies in a Cookie header, a DevTools "Copy as cURL/fetch",
     * a cookie-export JSON or a DevTools table copy. Everything else is dropped unread.
     */
    static Map<String, String> parseBrowserCookies(String raw, String[] names) {
        Map<String, String> found = new LinkedHashMap<>();
        String text = raw == null ? "" : raw.trim();
        if (text.startsWith("{") || text.startsWith("[")) {
            try {
                collectJson(text.startsWith("{") ? new JSONObject(text) : new JSONArray(text), names, found, 0);
            } catch (Exception ignored) {
                // Not JSON after all: the scan below reads it.
            }
        }
        // A Windows "Copy as cURL (cmd)" escapes quotes and percents with ^.
        if (text.contains("^\"") || text.contains("^%")) text = text.replace("^", "");
        for (String line : text.split("\n")) {
            String[] fields = line.split("\t");
            if (fields.length >= 2) putCookie(found, names, fields[0].trim(), fields[1].trim());
        }
        int index = 0;
        while (true) {
            int eq = text.indexOf('=', index);
            if (eq < 0) break;
            int start = eq;
            while (start > 0 && cookieNameChar(text.charAt(start - 1))) start--;
            int end = eq + 1;
            while (end < text.length() && !cookieValueEnd(text.charAt(end))) end++;
            if (start < eq) putCookie(found, names, text.substring(start, eq), text.substring(eq + 1, end));
            index = eq + 1;
        }
        return found;
    }

    /** A SKPORT cookie as the API wants it: unquoted, percent-decoded, and the cred field of a JSON value. */
    static String cleanSkportCookie(String raw) {
        if (raw == null) return null;
        String value = raw.trim().replaceAll("^\"+|\"+$", "");
        if (value.contains("%")) {
            try {
                value = java.net.URLDecoder.decode(value.replace("+", "%2B"), "UTF-8").trim().replaceAll("^\"+|\"+$", "");
            } catch (Exception error) {
                return null;
            }
        }
        if (value.startsWith("{")) {
            try {
                JSONObject parsed = new JSONObject(value);
                String inner = null;
                for (String key : new String[] { "cred", "token", "value" }) {
                    if (parsed.opt(key) instanceof String) {
                        inner = parsed.optString(key);
                        break;
                    }
                }
                value = inner;
            } catch (Exception error) {
                return null;
            }
        }
        return validSkportToken(value) ? value : null;
    }

    /** Connects HoYoLAB with cookies copied from a browser. Checked live before anything is saved. */
    @PluginMethod
    public void hoyolabImportBrowser(PluginCall call) {
        String raw = call.getString("raw", "");
        Context context = getContext().getApplicationContext();
        EXECUTOR.execute(() -> {
            String error = null;
            try {
                if (raw.length() > MAX_BROWSER_INPUT) throw new HoyolabError(TOO_LARGE);
                Map<String, String> found = parseBrowserCookies(raw, HOYOLAB_BROWSER_COOKIES);
                String ltuid = found.get("ltuid_v2");
                String ltoken = found.get("ltoken_v2");
                String ltmid = found.get("ltmid_v2");
                if (!validCookie(ltoken)) throw new HoyolabError(MISSING_LTOKEN);
                if (!validCookie(ltuid) || !validCookie(ltmid)) throw new HoyolabError(MISSING_IDS);
                StringBuilder header = new StringBuilder("ltuid_v2=" + ltuid + "; ltoken_v2=" + ltoken + "; ltmid_v2=" + ltmid);
                for (String name : ACCOUNT_COOKIES) {
                    String value = found.get(name);
                    if (validCookie(value)) header.append("; ").append(name).append('=').append(value);
                }
                JSONArray roles = fetchRoles(header.toString());
                if (!storeCookies(context, ltuid, ltoken, ltmid, found.get("cookie_token_v2"), found.get("account_id_v2"), found.get("account_mid_v2"))) {
                    throw new HoyolabError("The HoYoLAB sign-in could not be saved securely on this phone.");
                }
                saveRoles(context, roles);
            } catch (HoyolabError failure) {
                error = failure.getMessage();
            } catch (Exception failure) {
                error = "HoYoLAB could not list your game accounts.";
            }
            finishBrowserImport(call, context, error);
        });
    }

    /** Connects SKPORT with a token copied from a browser. A refusal keeps the earlier sign-in. */
    @PluginMethod
    public void skportImportBrowser(PluginCall call) {
        String raw = call.getString("raw", "");
        Context context = getContext().getApplicationContext();
        EXECUTOR.execute(() -> {
            String error = null;
            String previous = prefs(context).getString(SKPORT_SEALED, null);
            boolean seeded = false;
            try {
                if (raw.length() > MAX_BROWSER_INPUT) throw new SkportError(TOO_LARGE);
                Map<String, String> found = parseBrowserCookies(raw, SKPORT_BROWSER_COOKIES);
                String accountToken = cleanSkportCookie(found.get("ACCOUNT_TOKEN"));
                String credKey = cleanSkportCookie(found.get("SK_OAUTH_CRED_KEY"));
                if (accountToken == null && credKey == null) throw new SkportError(NO_SKPORT);
                if (!storeSkportSeed(context, accountToken, credKey)) throw new SkportError(SKPORT_UNSAVED);
                seeded = true;
                skportCreds(context);
                saveSkportRoles(context, fetchSkportRoles(context));
            } catch (SkportError failure) {
                error = failure.getMessage();
            } catch (Exception failure) {
                error = "SKPORT could not list your game accounts.";
            }
            if (error != null && seeded) {
                SharedPreferences.Editor editor = prefs(context).edit();
                if (previous == null) editor.remove(SKPORT_SEALED);
                else editor.putString(SKPORT_SEALED, previous);
                editor.commit();
            }
            finishBrowserImport(call, context, error);
        });
    }

    private void finishBrowserImport(PluginCall call, Context context, String error) {
        JSObject status = status(context);
        if (error != null) {
            JSObject event = status(context);
            event.put("error", error);
            notifyListeners("statusChanged", event);
            call.reject(error, "IMPORT_FAILED");
            return;
        }
        notifyListeners("statusChanged", status);
        call.resolve(status);
    }

    /** Forgets the SKPORT sign-in here and in the WebView's cookie jar. */
    @PluginMethod
    public void skportDisconnect(PluginCall call) {
        Context context = getContext().getApplicationContext();
        clearSkport(context);
        // Again behind any request in flight, so nothing it seals outlives the disconnect,
        // and the page hears the final state after that request's own answer.
        EXECUTOR.execute(() -> {
            clearSkport(context);
            notifyListeners("statusChanged", status(context));
        });
        SkportLoginActivity.expireSessionCookies();
        announce();
        call.resolve(status(getContext()));
    }

    @PluginMethod
    public void skportLink(PluginCall call) {
        String gameId = call.getString("gameId");
        String preset = call.getString("presetKey");
        String uid = call.getString("uid");
        String region = call.getString("region");
        if (gameId == null || gameId.isEmpty() || gameId.length() > 160) {
            call.reject("Choose a game first.");
            return;
        }
        SharedPreferences prefs = prefs(getContext());
        JSONObject links = jsonObject(prefs.getString(SKPORT_LINKS, null));
        try {
            if (uid == null || uid.isEmpty()) {
                links.remove(gameId);
            } else {
                JSONObject role = (preset == null || SKPORT_PRESET.equals(preset)) && validSkportUid(uid)
                    ? findRole(jsonArray(prefs.getString(SKPORT_ROLES, null)), SKPORT_PRESET, uid)
                    : null;
                if (role == null) {
                    call.reject("Choose one of the accounts on your SKPORT sign-in.");
                    return;
                }
                String roleRegion = role.optString("region");
                if (region == null || region.isEmpty()) region = roleRegion;
                if (!validRegion(region) || !region.equals(roleRegion)) {
                    call.reject("That account's server does not match SKPORT.");
                    return;
                }
                if (!links.has(gameId) && links.length() >= 200) {
                    call.reject("Unlink a game before linking another.");
                    return;
                }
                JSONObject link = new JSONObject();
                link.put("presetKey", SKPORT_PRESET);
                link.put("uid", uid);
                link.put("region", region);
                links.put(gameId, link);
            }
        } catch (Exception error) {
            call.reject("The link could not be saved.");
            return;
        }
        prefs.edit().putString(SKPORT_LINKS, links.toString()).apply();
        call.resolve(status(getContext()));
    }

    @PluginMethod
    public void skportRefresh(PluginCall call) {
        String gameId = call.getString("gameId");
        boolean auto = Boolean.TRUE.equals(call.getBoolean("auto", false));
        Context context = getContext().getApplicationContext();
        EXECUTOR.execute(() -> call.resolve(skportRefresh(context, gameId, auto)));
    }

    @PluginMethod
    public void skportPrefs(PluginCall call) {
        JSObject changes = call.getObject("changes", call.getData());
        if (changes != null && changes.has("autoRefreshOnExit")) {
            prefs(getContext()).edit().putBoolean(SKPORT_AUTO, changes.optBoolean("autoRefreshOnExit", false)).apply();
        }
        call.resolve(status(getContext()));
    }

    // ------------------------------------------------------------------
    // Screenshots
    // ------------------------------------------------------------------

    @PluginMethod
    public void pickScreenshot(PluginCall call) {
        if (picking) {
            call.reject("The picker is already open.", "PICK_BUSY");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        picking = true;
        try {
            startActivityForResult(call, intent, "pickResult");
        } catch (RuntimeException error) {
            picking = false;
            call.reject("The picker could not open.", "PICK_UNAVAILABLE", error);
        }
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        picking = false;
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }
        Uri uri = data.getData();
        Context context = getContext().getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                call.resolve(readImage(context, uri));
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : "The screenshot could not be read.");
            }
        });
    }

    /** The latest image shared into Memoria, once. `{ image: null }` when there is none. */
    @PluginMethod
    public void consumePendingShare(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (SHARE_LOCK) {
            result.put("image", pendingShare == null ? JSONObject.NULL : pendingShare);
            pendingShare = null;
        }
        call.resolve(result);
    }

    /**
     * An image another app shared with Memoria. Read off the main thread; the
     * page is told with `screenshotShared` and collects it with consumePendingShare.
     */
    static void queueSharedImage(Context context, Uri uri) {
        if (uri == null || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) return;
        // Never this app's own files, whatever another app claims to share.
        String authority = uri.getAuthority();
        if (authority == null || authority.startsWith(context.getPackageName())) return;
        Context app = context.getApplicationContext();
        EXECUTOR.execute(() -> {
            JSObject image;
            try {
                image = readImage(app, uri);
            } catch (Exception error) {
                return;
            }
            synchronized (SHARE_LOCK) {
                pendingShare = image;
            }
            ConnectorPlugin plugin = active.get();
            if (plugin != null) {
                JSObject event = new JSObject();
                event.put("available", true);
                plugin.notifyListeners("screenshotShared", event, true);
            }
        });
    }

    /** `{ fileName, observedAt, dataUrl }`: the image downscaled to 1080 px, as JPEG. */
    private static JSObject readImage(Context context, Uri uri) throws Exception {
        ContentResolver resolver = context.getContentResolver();
        String name = "Screenshot";
        long observedAt = 0;
        long size = -1;
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = clip(cursor.getString(nameColumn), 200);
                int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn);
                int taken = cursor.getColumnIndex(MediaStore.Images.ImageColumns.DATE_TAKEN);
                if (taken >= 0 && !cursor.isNull(taken)) observedAt = cursor.getLong(taken);
                int modified = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                if (observedAt <= 0 && modified >= 0 && !cursor.isNull(modified)) observedAt = cursor.getLong(modified);
            }
        } catch (RuntimeException ignored) {
            // Some providers refuse queries; the image itself may still open.
        }
        if (observedAt <= 0) observedAt = System.currentTimeMillis();
        if (size > MAX_IMAGE_BYTES) throw new Exception("This screenshot is larger than 25 MB.");

        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream input = resolver.openInputStream(uri)) {
            if (input == null) throw new Exception("The screenshot could not be opened.");
            BitmapFactory.decodeStream(input, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new Exception("This file is not an image Memoria can read.");
        int longest = Math.max(bounds.outWidth, bounds.outHeight);
        int sample = 1;
        while (longest / (sample * 2) >= MAX_IMAGE_SIDE) sample *= 2;
        BitmapFactory.Options decode = new BitmapFactory.Options();
        decode.inSampleSize = sample;
        Bitmap bitmap;
        try (InputStream input = resolver.openInputStream(uri)) {
            if (input == null) throw new Exception("The screenshot could not be opened.");
            bitmap = BitmapFactory.decodeStream(input, null, decode);
        }
        if (bitmap == null) throw new Exception("This file is not an image Memoria can read.");
        int side = Math.max(bitmap.getWidth(), bitmap.getHeight());
        if (side > MAX_IMAGE_SIDE) {
            float scale = (float) MAX_IMAGE_SIDE / side;
            Bitmap scaled = Bitmap.createScaledBitmap(
                bitmap,
                Math.max(1, Math.round(bitmap.getWidth() * scale)),
                Math.max(1, Math.round(bitmap.getHeight() * scale)),
                true
            );
            if (scaled != bitmap) bitmap.recycle();
            bitmap = scaled;
        }
        ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.JPEG, 82, jpeg);
        bitmap.recycle();
        JSObject image = new JSObject();
        image.put("fileName", name);
        image.put("observedAt", observedAt);
        image.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(jpeg.toByteArray(), Base64.NO_WRAP));
        return image;
    }
}
