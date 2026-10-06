package app.memoria.tracker;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.ExifInterface;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** Reads only user-selected/shared images. Recognition uses the bundled offline model. */
@CapacitorPlugin(name = "ScreenshotImport")
public class ScreenshotImportPlugin extends Plugin {
    private static final int MAX_BYTES = 8 * 1024 * 1024;
    private static final long MAX_PIXELS = 40_000_000;
    private static final String CONSUMED = "app.memoria.tracker.SCREENSHOT_CONSUMED";
    private final ArrayDeque<Intent> pending = new ArrayDeque<>();
    private final AtomicBoolean busy = new AtomicBoolean();
    private final ExecutorService reader = Executors.newSingleThreadExecutor();

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction()) ||
            intent.getType() == null || !intent.getType().startsWith("image/") ||
            intent.getBooleanExtra(CONSUMED, false)) return;
        synchronized (pending) {
            if (pending.contains(intent)) return;
            pending.add(intent);
        }
        notifyPending();
    }

    private void notifyPending() {
        synchronized (pending) {
            if (!pending.isEmpty()) notifyListeners("screenshotReceived", new JSObject(), true);
        }
    }

    @PluginMethod
    public void choose(PluginCall call) {
        if (!busy.compareAndSet(false, true)) {
            call.reject("Finish the current screenshot first.", "OCR_BUSY");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "chooseResult");
        } catch (RuntimeException error) {
            finish();
            call.reject("The image picker could not open. Try sharing the screenshot to Memoria.", "PICKER_UNAVAILABLE");
        }
    }

    @ActivityCallback
    private void chooseResult(PluginCall call, ActivityResult result) {
        if (call == null) { finish(); return; }
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            finish();
            call.reject("Screenshot selection cancelled.", "CANCELLED");
            return;
        }
        recognizeUri(call, data.getData(), false);
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        Intent intent;
        synchronized (pending) {
            if (pending.isEmpty() || !busy.compareAndSet(false, true)) {
                call.resolve(new JSObject().put("screenshot", JSONObject.NULL));
                return;
            }
            intent = pending.removeFirst();
            intent.putExtra(CONSUMED, true);
        }
        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null && intent.getClipData() != null && intent.getClipData().getItemCount() > 0) {
            uri = intent.getClipData().getItemAt(0).getUri();
        }
        recognizeUri(call, uri, true);
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        String encoded = call.getString("base64");
        if (encoded == null || encoded.length() > (MAX_BYTES * 4L / 3) + 1024) {
            call.reject("Choose an image smaller than 8 MB.", "INVALID_IMAGE");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("Finish the current screenshot first.", "OCR_BUSY");
            return;
        }
        reader.execute(() -> {
            try {
                String value = encoded;
                if (value.startsWith("data:")) {
                    int comma = value.indexOf(',');
                    if (comma < 0 || !value.substring(0, comma).startsWith("data:image/") ||
                        !value.substring(0, comma).endsWith(";base64")) throw new IOException("Choose a valid image.");
                    value = value.substring(comma + 1);
                }
                byte[] bytes = Base64.decode(value, Base64.DEFAULT);
                recognizeBytes(call, bytes, new JSObject(), false);
            } catch (Exception error) {
                fail(call, error);
            }
        });
    }

    private void recognizeUri(PluginCall call, Uri uri, boolean envelope) {
        reader.execute(() -> {
            try {
                if (uri == null || !"content".equals(uri.getScheme())) throw new IOException("Share or choose an image file.");
                String mime = getContext().getContentResolver().getType(uri);
                if (mime != null && !mime.startsWith("image/")) throw new IOException("Choose an image file.");
                JSObject metadata = metadata(uri);
                byte[] bytes;
                try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
                    if (stream == null) throw new IOException("The image could not be opened. Choose it again.");
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    byte[] chunk = new byte[8192];
                    int count;
                    while ((count = stream.read(chunk)) != -1) {
                        if (buffer.size() + count > MAX_BYTES) throw new IOException("Choose an image smaller than 8 MB.");
                        buffer.write(chunk, 0, count);
                    }
                    bytes = buffer.toByteArray();
                }
                recognizeBytes(call, bytes, metadata, envelope);
            } catch (Exception error) {
                fail(call, error);
            }
        });
    }

    private JSObject metadata(Uri uri) {
        JSObject result = new JSObject();
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null) {
                    name = name.replaceAll("[\\p{Cntrl}]", "");
                    result.put("name", name.substring(0, Math.min(name.length(), 200)));
                }
            }
        } catch (RuntimeException ignored) { /* Names are optional. */ }
        // date_taken is the capture instant. date_modified/date_added are not.
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { "datetaken" }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) putCaptureTime(result, cursor.getLong(0));
        } catch (RuntimeException ignored) { /* Some document providers do not expose capture time. */ }
        return result;
    }

    private static void putCaptureTime(JSObject result, long at) {
        if (at > 0 && at <= System.currentTimeMillis() + 300_000) result.put("capturedAt", at);
    }

    private void recognizeBytes(PluginCall call, byte[] bytes, JSObject metadata, boolean envelope) throws IOException {
        if (bytes.length == 0 || bytes.length > MAX_BYTES) throw new IOException("Choose an image smaller than 8 MB.");
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 ||
            (long) bounds.outWidth * bounds.outHeight > MAX_PIXELS || bounds.outMimeType == null ||
            !bounds.outMimeType.startsWith("image/")) throw new IOException("The image is invalid or too large. Crop it and try again.");
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = imageSampleSize(bounds.outWidth, bounds.outHeight);
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (bitmap == null) throw new IOException("This image format could not be opened. Use PNG or JPEG.");
        int rotation = 0;
        try {
            ExifInterface exif = new ExifInterface(new ByteArrayInputStream(bytes));
            int orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            if (orientation == ExifInterface.ORIENTATION_ROTATE_90) rotation = 90;
            if (orientation == ExifInterface.ORIENTATION_ROTATE_180) rotation = 180;
            if (orientation == ExifInterface.ORIENTATION_ROTATE_270) rotation = 270;
            String date = exif.getAttribute("DateTimeOriginal");
            String offset = exif.getAttribute("OffsetTimeOriginal");
            if (!metadata.has("capturedAt") && date != null && offset != null && offset.matches("[+-]\\d{2}:\\d{2}")) {
                SimpleDateFormat format = new SimpleDateFormat("yyyy:MM:dd HH:mm:ssXXX", Locale.ROOT);
                format.setLenient(false);
                Date parsed = format.parse(date + offset);
                if (parsed != null) putCaptureTime(metadata, parsed.getTime());
            }
        } catch (Exception ignored) { /* Missing metadata must never become the import time. */ }
        final Bitmap image = bitmap;
        TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        try {
            recognizer.process(InputImage.fromBitmap(image, rotation)).addOnCompleteListener(task -> {
                recognizer.close();
                image.recycle();
                finish();
                if (!task.isSuccessful()) {
                    call.reject("Text could not be read. Try a clearer screenshot.", "OCR_FAILED");
                    return;
                }
                metadata.put("text", task.getResult().getText());
                call.resolve(envelope ? new JSObject().put("screenshot", metadata) : metadata);
            });
        } catch (RuntimeException error) {
            recognizer.close();
            image.recycle();
            throw error;
        }
    }

    static int imageSampleSize(int width, int height) {
        if (width <= 0 || height <= 0 || (long) width * height > MAX_PIXELS)
            throw new IllegalArgumentException("Invalid image dimensions.");
        int sample = 1;
        while (Math.max(width, height) / sample > 4096 ||
            (long) (width / sample) * (height / sample) > 12_000_000) sample *= 2;
        return sample;
    }

    private void finish() {
        busy.set(false);
        notifyPending();
    }

    private void fail(PluginCall call, Exception error) {
        finish();
        call.reject(error instanceof IOException ? error.getMessage() : "The screenshot could not be read. Choose it again.", "OCR_FAILED");
    }

    @Override
    protected void handleOnDestroy() {
        reader.shutdown();
    }
}
