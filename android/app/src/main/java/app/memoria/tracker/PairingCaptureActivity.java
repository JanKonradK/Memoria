package app.memoria.tracker;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.journeyapps.barcodescanner.CameraPreview;
import com.journeyapps.barcodescanner.CaptureActivity;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;
import com.journeyapps.barcodescanner.camera.CameraSettings;

/** Return camera failures to the app, where the manual connection option remains available. */
public class PairingCaptureActivity extends CaptureActivity {
    static final String CAMERA_ERROR = "memoria.cameraError";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // CaptureManager replaces camera settings from the scan intent during
        // super.onCreate. Set focus afterwards, before onResume opens the camera.
        DecoratedBarcodeView view = findViewById(com.google.zxing.client.android.R.id.zxing_barcode_scanner);
        CameraSettings settings = view.getCameraSettings();
        // ZXing falls back to continuous-video, then auto, when unsupported.
        settings.setContinuousFocusEnabled(true);
        view.setCameraSettings(settings);
    }

    @Override
    protected DecoratedBarcodeView initializeContent() {
        DecoratedBarcodeView view = super.initializeContent();
        // Modern Android draws the fullscreen scanner behind system bars. Keep
        // its instructions and preview clear of navigation controls and cutouts.
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (target, windowInsets) -> {
            Insets safe = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            target.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);
        // Registered before CaptureManager so it sees isFinishing and skips its generic alert.
        view.getBarcodeView().addStateListener(new CameraPreview.StateListener() {
            public void previewSized() {}
            public void previewStarted() {}
            public void previewStopped() {}
            public void cameraClosed() {}
            public void cameraError(Exception error) {
                setResult(RESULT_CANCELED, new Intent().putExtra(CAMERA_ERROR, true));
                finish();
            }
        });
        return view;
    }
}
