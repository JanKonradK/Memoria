package app.memoria.tracker;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Seals the phone's Wi-Fi sync key with an AES key held in the Android
 * Keystore. The sealed text can sit in WebView storage: without this device's
 * Keystore, it cannot be opened.
 */
@CapacitorPlugin(name = "DeviceKey")
public class DeviceKeyPlugin extends Plugin {
    private static final String ALIAS = "memoria-device-key";
    private static final int IV_BYTES = 12;
    private static final int MAX_LENGTH = 4096;

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

    @PluginMethod
    public void seal(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.length() > MAX_LENGTH) {
            call.reject("Nothing to seal.");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] sealed = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] out = ByteBuffer.allocate(iv.length + sealed.length).put(iv).put(sealed).array();
            JSObject result = new JSObject();
            result.put("sealed", Base64.encodeToString(out, Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("The device key store is unavailable.");
        }
    }

    @PluginMethod
    public void unseal(PluginCall call) {
        String sealed = call.getString("sealed");
        if (sealed == null || sealed.length() > MAX_LENGTH * 2) {
            call.reject("Nothing to open.");
            return;
        }
        try {
            byte[] data = Base64.decode(sealed, Base64.NO_WRAP);
            if (data.length <= IV_BYTES) throw new IllegalArgumentException();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, data, 0, IV_BYTES));
            byte[] plain = cipher.doFinal(data, IV_BYTES, data.length - IV_BYTES);
            JSObject result = new JSObject();
            result.put("value", new String(plain, StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("The saved key could not be opened on this device.");
        }
    }
}
