package app.memoria.tracker;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Backups only ever go where the player chose: one file saved through the
 * system's save window, or an automatic backup kept in a folder picked once
 * through the system's folder picker (Storage Access Framework). Memoria holds
 * a persistable grant to that one folder and needs no storage permission.
 */
@CapacitorPlugin(name = "NativeBackup")
public class NativeBackupPlugin extends Plugin {
    private static final String PREFS = "memoria_auto_backup";
    private static final String TREE = "treeUri";
    private static final String FOLDER = "folderName";
    private static final String LAST = "lastBackupAt";
    private static final String ERROR = "error";
    private static final String FILE_URI = "fileUri";
    private static final String FILE_NAME = "fileName";
    private static final String TEMP_URI = "tempUri";
    private static final String DEFAULT_FILE = "memoria-auto-backup.json";
    private static final int GRANT = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    /** Writes run here, one at a time, never on the main thread. */
    private static final ExecutorService WRITER = Executors.newSingleThreadExecutor();
    private static final Object WRITE_LOCK = new Object();
    private boolean saving = false;
    private boolean picking = false;

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

    // ------------------------------------------------------------------
    // Automatic backups
    // ------------------------------------------------------------------

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Whether Android still holds the persisted read and write grant for `tree`. */
    private static boolean granted(Context context, Uri tree) {
        for (UriPermission permission : context.getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(tree) && permission.isReadPermission() && permission.isWritePermission()) return true;
        }
        return false;
    }

    /** `{ enabled, folderName, lastBackupAt, error }`. A folder whose grant is gone reads as off, with why. */
    static JSObject status(Context context) {
        SharedPreferences prefs = prefs(context);
        String tree = prefs.getString(TREE, null);
        boolean enabled = tree != null && granted(context, Uri.parse(tree));
        String error = prefs.getString(ERROR, null);
        if (tree != null && !enabled) error = "Memoria can no longer reach the backup folder. Choose it again.";
        long last = prefs.getLong(LAST, 0);
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        String folder = prefs.getString(FOLDER, null);
        result.put("folderName", tree != null && folder != null ? folder : JSONObject.NULL);
        result.put("lastBackupAt", tree != null && last > 0 ? (Object) last : JSONObject.NULL);
        result.put("error", error != null ? error : JSONObject.NULL);
        return result;
    }

    /** Opens the system folder picker; the folder chosen keeps a persistable read and write grant. */
    @PluginMethod
    public void pickAutoBackupFolder(PluginCall call) {
        if (picking) {
            call.reject("The folder picker is already open.", "PICK_BUSY");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(GRANT | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        picking = true;
        try {
            startActivityForResult(call, intent, "folderResult");
        } catch (RuntimeException error) {
            picking = false;
            call.reject("The folder picker could not open.", "PICK_UNAVAILABLE", error);
        }
    }

    @ActivityCallback
    private void folderResult(PluginCall call, ActivityResult result) {
        picking = false;
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("No folder chosen.", "CANCELLED");
            return;
        }
        Context context = getContext();
        Uri tree = data.getData();
        ContentResolver resolver = context.getContentResolver();
        try {
            resolver.takePersistableUriPermission(tree, GRANT);
        } catch (SecurityException error) {
            call.reject("Memoria cannot keep access to that folder. Choose another one.", error);
            return;
        }
        SharedPreferences prefs = prefs(context);
        String previous = prefs.getString(TREE, null);
        if (previous != null && !previous.equals(tree.toString())) release(context, Uri.parse(previous));
        DocumentFile folder = DocumentFile.fromTreeUri(context, tree);
        String name = folder != null && folder.getName() != null ? folder.getName() : "Chosen folder";
        prefs
            .edit()
            .putString(TREE, tree.toString())
            .putString(FOLDER, name)
            .remove(LAST)
            .remove(ERROR)
            .remove(FILE_URI)
            .remove(FILE_NAME)
            .remove(TEMP_URI)
            .commit();
        call.resolve(status(context));
    }

    @PluginMethod
    public void autoBackupStatus(PluginCall call) {
        call.resolve(status(getContext()));
    }

    /** Only a plain `.json` name, so nothing can reach outside the chosen folder. */
    private static String fileName(String requested) {
        if (requested == null || !requested.matches("[A-Za-z0-9._-]{1,80}\\.json") || requested.startsWith(".")) return DEFAULT_FILE;
        return requested;
    }

    private static DocumentFile cachedFile(Context context, String uriText, String expectedName) {
        if (uriText == null) return null;
        try {
            DocumentFile file = DocumentFile.fromSingleUri(context, Uri.parse(uriText));
            if (file != null && file.exists() && file.isFile() && (expectedName == null || expectedName.equals(file.getName()))) {
                return file;
            }
        } catch (RuntimeException ignored) {
            // Stale or revoked document URI; fall back to folder lookup.
        }
        return null;
    }

    private static void deleteTemp(Context context, SharedPreferences prefs) {
        String stale = prefs.getString(TEMP_URI, null);
        if (stale != null) {
            DocumentFile file = cachedFile(context, stale, null);
            if (file != null) file.delete();
            prefs.edit().remove(TEMP_URI).commit();
        }
    }

    private static boolean supportsRename(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { DocumentsContract.Document.COLUMN_FLAGS }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) {
                int flags = cursor.getInt(0);
                return (flags & DocumentsContract.Document.FLAG_SUPPORTS_RENAME) != 0;
            }
        } catch (RuntimeException ignored) {
            // Unknown provider capabilities fall back to recreate-and-write.
        }
        return false;
    }

    /** Writes to a temporary document first so a process kill never leaves a truncated backup. */
    @PluginMethod
    public void writeAutoBackup(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("The backup is empty.");
            return;
        }
        String name = fileName(call.getString("fileName"));
        Context context = getContext().getApplicationContext();
        WRITER.execute(() -> {
            synchronized (WRITE_LOCK) {
                SharedPreferences prefs = prefs(context);
                String tree = prefs.getString(TREE, null);
                try {
                    if (tree == null) throw new IllegalStateException("No backup folder is chosen.");
                    Uri treeUri = Uri.parse(tree);
                    if (!granted(context, treeUri))
                        throw new IllegalStateException("Memoria can no longer reach the backup folder. Choose it again.");
                    DocumentFile folder = DocumentFile.fromTreeUri(context, treeUri);
                    if (folder == null || !folder.canWrite()) throw new IllegalStateException("The backup folder cannot be written to.");
                    ContentResolver resolver = context.getContentResolver();
                    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);

                    deleteTemp(context, prefs);
                    String tempName = name + ".tmp";
                    DocumentFile stray = folder.findFile(tempName);
                    if (stray != null && stray.isFile()) stray.delete();

                    DocumentFile temp = folder.createFile("application/octet-stream", tempName);
                    if (temp == null) throw new IllegalStateException("The backup file could not be created.");
                    prefs.edit().putString(TEMP_URI, temp.getUri().toString()).commit();
                    try {
                        write(resolver, temp.getUri(), bytes);
                    } catch (Exception writeError) {
                        temp.delete();
                        prefs.edit().remove(TEMP_URI).commit();
                        throw writeError;
                    }

                    DocumentFile existing = name.equals(prefs.getString(FILE_NAME, null))
                        ? cachedFile(context, prefs.getString(FILE_URI, null), name)
                        : null;
                    if (existing == null) existing = folder.findFile(name);

                    Uri finalUri = null;
                    boolean existingDeleted = false;
                    if (supportsRename(resolver, temp.getUri())) {
                        if (existing != null && existing.isFile()) {
                            existing.delete();
                            existingDeleted = true;
                        }
                        try {
                            finalUri = DocumentsContract.renameDocument(resolver, temp.getUri(), name);
                        } catch (Exception ignored) {
                            finalUri = null;
                        }
                    }
                    if (finalUri == null) {
                        if (existing != null && existing.isFile() && !existingDeleted) existing.delete();
                        DocumentFile fresh = folder.createFile("application/json", name);
                        if (fresh == null) throw new IllegalStateException("The backup file could not be created.");
                        write(resolver, fresh.getUri(), bytes);
                        finalUri = fresh.getUri();
                        temp.delete();
                    }

                    prefs
                        .edit()
                        .putString(FILE_URI, finalUri.toString())
                        .putString(FILE_NAME, name)
                        .putLong(LAST, System.currentTimeMillis())
                        .remove(TEMP_URI)
                        .remove(ERROR)
                        .commit();
                    call.resolve(status(context));
                } catch (Exception error) {
                    String message = error instanceof IllegalStateException && error.getMessage() != null
                        ? error.getMessage()
                        : "The automatic backup could not be saved.";
                    if (tree != null) prefs.edit().putString(ERROR, message).commit();
                    call.reject(message);
                }
            }
        });
    }

    /** Truncates and writes; a provider without truncating writes gets a plain write. */
    private static void write(ContentResolver resolver, Uri uri, byte[] bytes) throws Exception {
        OutputStream output;
        try {
            output = resolver.openOutputStream(uri, "wt");
        } catch (IllegalArgumentException | UnsupportedOperationException unsupported) {
            output = resolver.openOutputStream(uri, "w");
        }
        if (output == null) throw new java.io.IOException("The backup file cannot be opened.");
        // Closing reports a provider's late failure, so success is only after close.
        try (OutputStream stream = output) {
            stream.write(bytes);
            stream.flush();
        }
    }

    private static void release(Context context, Uri tree) {
        try {
            context.getContentResolver().releasePersistableUriPermission(tree, GRANT);
        } catch (SecurityException ignored) {
            // Already gone.
        }
    }

    /** Stops automatic backups and gives the folder grant back. The file already written stays. */
    @PluginMethod
    public void clearAutoBackup(PluginCall call) {
        Context context = getContext();
        WRITER.execute(() -> {
            synchronized (WRITE_LOCK) {
                SharedPreferences prefs = prefs(context);
                String tree = prefs.getString(TREE, null);
                if (tree != null) release(context, Uri.parse(tree));
                prefs.edit().clear().commit();
                call.resolve(status(context));
            }
        });
    }
}
