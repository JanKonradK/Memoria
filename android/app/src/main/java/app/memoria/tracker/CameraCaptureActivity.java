package app.memoria.tracker;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.ComponentActivity;
import androidx.annotation.NonNull;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The camera reader's viewfinder: point the phone at a game screen (a PC
 * monitor, a handheld, a tablet), press the shutter, and the picture goes back
 * to ConnectorPlugin, which reads it with ML Kit on the phone and deletes it.
 *
 * The picture is a temporary JPEG in this app's own cache, never the gallery.
 * Only the path comes back in the result; nothing leaves the phone.
 */
public class CameraCaptureActivity extends ComponentActivity {
    static final String EXTRA_PATH = "path";
    static final String EXTRA_ERROR = "error";
    /** Where temporary captures live, under the cache directory. */
    static final String DIRECTORY = "camera";
    private static final int PERMISSION_REQUEST = 41;

    private final ExecutorService saver = Executors.newSingleThreadExecutor();
    private PreviewView preview;
    private TextView shutter;
    private TextView torch;
    private ImageCapture capture;
    private Camera camera;
    private boolean torchOn = false;
    private boolean taking = false;

    /** The capture directory, emptied of anything an earlier session left behind. */
    static File cleanDirectory(File cache) {
        File directory = new File(cache, DIRECTORY);
        File[] old = directory.listFiles();
        if (old != null) for (File file : old) file.delete();
        if (!directory.isDirectory()) directory.mkdirs();
        return directory;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        setContentView(buildLayout());
        saver.execute(() -> cleanDirectory(getCacheDir()));
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            requestPermissions(new String[] { Manifest.permission.CAMERA }, PERMISSION_REQUEST);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != PERMISSION_REQUEST) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) startCamera();
        else fail("Camera access is off for Memoria. Turn it on in Android settings to scan.");
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    /** A rounded text button on the dark bar. */
    private TextView button(String label, String description) {
        TextView view = new TextView(this);
        view.setText(label);
        view.setContentDescription(description);
        view.setTextColor(Color.parseColor("#F4F4F6"));
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        view.setGravity(Gravity.CENTER);
        view.setMinHeight(dp(48));
        view.setMinWidth(dp(88));
        view.setPadding(dp(16), 0, dp(16), 0);
        GradientDrawable ground = new GradientDrawable();
        ground.setCornerRadius(dp(24));
        ground.setColor(Color.parseColor("#26FFFFFF"));
        view.setBackground(ground);
        view.setClickable(true);
        view.setFocusable(true);
        return view;
    }

    private View buildLayout() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        preview = new PreviewView(this);
        preview.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        preview.setScaleType(PreviewView.ScaleType.FIT_CENTER);
        root.addView(preview, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#CC0C0D0F"));
        bar.setPadding(dp(20), dp(16), dp(20), dp(16));

        TextView cancel = button("Cancel", "Cancel");
        cancel.setOnClickListener((view) -> finish());
        bar.addView(cancel);

        View left = new View(this);
        bar.addView(left, new LinearLayout.LayoutParams(0, 1, 1f));

        shutter = new TextView(this);
        shutter.setContentDescription("Take picture");
        GradientDrawable ring = new GradientDrawable();
        ring.setShape(GradientDrawable.OVAL);
        ring.setColor(Color.parseColor("#F4F4F6"));
        ring.setStroke(dp(4), Color.parseColor("#80C3FF"));
        shutter.setBackground(ring);
        shutter.setClickable(true);
        shutter.setFocusable(true);
        shutter.setEnabled(false);
        shutter.setOnClickListener((view) -> takePicture());
        bar.addView(shutter, new LinearLayout.LayoutParams(dp(72), dp(72)));

        View right = new View(this);
        bar.addView(right, new LinearLayout.LayoutParams(0, 1, 1f));

        torch = button("Light", "Light off");
        torch.setVisibility(View.INVISIBLE);
        torch.setOnClickListener((view) -> toggleTorch());
        bar.addView(torch);

        FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        );
        root.addView(bar, barParams);
        // Clear of the navigation bar and cutouts, whatever the edge-to-edge mode.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int bottom;
            int top;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                bottom = bars.bottom;
                top = bars.top;
            } else {
                bottom = legacyBottom(insets);
                top = legacyTop(insets);
            }
            bar.setPadding(dp(20), dp(16), dp(20), dp(16) + bottom);
            preview.setPadding(0, top, 0, 0);
            return insets;
        });
        return root;
    }

    @SuppressWarnings("deprecation")
    private static int legacyBottom(WindowInsets insets) {
        return insets.getSystemWindowInsetBottom();
    }

    @SuppressWarnings("deprecation")
    private static int legacyTop(WindowInsets insets) {
        return insets.getSystemWindowInsetTop();
    }

    private int rotation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && getDisplay() != null) return getDisplay().getRotation();
        return legacyRotation();
    }

    @SuppressWarnings("deprecation")
    private int legacyRotation() {
        return getWindowManager().getDefaultDisplay().getRotation();
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                ProcessCameraProvider provider = future.get();
                Preview viewfinder = new Preview.Builder().build();
                viewfinder.setSurfaceProvider(preview.getSurfaceProvider());
                capture = new ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                    .setTargetRotation(rotation())
                    .build();
                provider.unbindAll();
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, viewfinder, capture);
                torch.setVisibility(camera.getCameraInfo().hasFlashUnit() ? View.VISIBLE : View.INVISIBLE);
                shutter.setEnabled(true);
            } catch (Exception error) {
                fail("The camera could not start. Close other apps using it and try again.");
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void toggleTorch() {
        if (camera == null) return;
        torchOn = !torchOn;
        camera.getCameraControl().enableTorch(torchOn);
        torch.setContentDescription(torchOn ? "Light on" : "Light off");
        torch.setTextColor(Color.parseColor(torchOn ? "#80C3FF" : "#F4F4F6"));
    }

    private void takePicture() {
        if (capture == null || taking) return;
        taking = true;
        shutter.setEnabled(false);
        // The phone may have turned since the camera started: the JPEG records the current way up.
        capture.setTargetRotation(rotation());
        File directory = new File(getCacheDir(), DIRECTORY);
        if (!directory.isDirectory()) directory.mkdirs();
        File file = new File(directory, "scan-" + System.currentTimeMillis() + ".jpg");
        ImageCapture.OutputFileOptions options = new ImageCapture.OutputFileOptions.Builder(file).build();
        capture.takePicture(options, ContextCompat.getMainExecutor(this), new ImageCapture.OnImageSavedCallback() {
            @Override
            public void onImageSaved(@NonNull ImageCapture.OutputFileResults output) {
                setResult(RESULT_OK, new Intent().putExtra(EXTRA_PATH, file.getAbsolutePath()));
                finish();
            }

            @Override
            public void onError(@NonNull ImageCaptureException error) {
                try {
                    saver.execute(file::delete);
                } catch (RuntimeException ignored) {
                    file.delete();
                }
                fail("The picture could not be taken. Try again.");
            }
        });
    }

    private void fail(String message) {
        setResult(RESULT_CANCELED, new Intent().putExtra(EXTRA_ERROR, message));
        finish();
    }

    @Override
    protected void onDestroy() {
        saver.shutdown();
        super.onDestroy();
    }
}
