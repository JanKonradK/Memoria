package app.memoria.tracker;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Save a backup only to a document location selected by the user. */
@CapacitorPlugin(name = "NativeBackup")
public class NativeBackupPlugin extends Plugin {
    private boolean saving = false;

    @PluginMethod
    public void save(PluginCall call) {
        if (saving) {
            call.reject("The save window is already open.", "SAVE_BUSY");
            return;
        }
        if (call.getString("text") == null) {
            call.reject("The backup is empty.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("fileName", "Memoria-backup.json"));
        saving = true;
        try {
            startActivityForResult(call, intent, "saveResult");
        } catch (RuntimeException error) {
            saving = false;
            call.reject("The save window could not open. Try again.", "SAVE_UNAVAILABLE", error);
        }
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        saving = false;
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("Backup cancelled.", "CANCELLED");
            return;
        }
        try (OutputStream output = getContext().getContentResolver().openOutputStream(data.getData(), "wt")) {
            if (output == null) throw new java.io.IOException("The selected file cannot be opened.");
            output.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            call.reject("The backup could not be saved. Select another location.", error);
            return;
        }
        // A document provider can fail while closing the stream. Report success
        // only after all bytes have been written and the stream has closed.
        call.resolve();
    }
}
