package app.memoria.tracker;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.zxing.client.android.Intents;
import com.journeyapps.barcodescanner.ScanOptions;

/** The scanner only returns text. The app validates the pairing data before use. */
@CapacitorPlugin(
    name = "PairingScanner",
    permissions = @Permission(alias = "camera", strings = Manifest.permission.CAMERA)
)
public class PairingScannerPlugin extends Plugin {
    private boolean scanning = false;

    @PluginMethod
    public void scan(PluginCall call) {
        if (scanning) {
            call.reject("The camera is already open.", "SCAN_BUSY");
            return;
        }
        if (!getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            call.reject("This phone has no camera. Enter the PC details to connect.", "CAMERA_UNAVAILABLE");
            return;
        }
        scanning = true;
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionResult");
        } else {
            openScanner(call);
        }
    }

    @PermissionCallback
    private void cameraPermissionResult(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            scanning = false;
            call.reject("Allow camera access in Android Settings for Memoria, then try again. You can also enter the PC details.", "CAMERA_DENIED");
            return;
        }
        openScanner(call);
    }

    private void openScanner(PluginCall call) {
        ScanOptions options = new ScanOptions()
            .setCaptureActivity(PairingCaptureActivity.class)
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("Point your camera at the code on your PC.\nPress Back to cancel.")
            .setOrientationLocked(false)
            .setBeepEnabled(false)
            .setBarcodeImageEnabled(false);
        options.addExtra(Intents.Scan.SHOW_MISSING_CAMERA_PERMISSION_DIALOG, false);
        try {
            startActivityForResult(call, options.createScanIntent(getContext()), "scanResult");
        } catch (RuntimeException error) {
            scanning = false;
            call.reject("The camera could not open. Close other camera apps and try again.", "CAMERA_UNAVAILABLE", error);
        }
    }

    @ActivityCallback
    private void scanResult(PluginCall call, ActivityResult result) {
        scanning = false;
        if (call == null) return;
        Intent data = result.getData();
        if (data != null && data.getBooleanExtra(Intents.Scan.MISSING_CAMERA_PERMISSION, false)) {
            call.reject("Allow camera access in Android Settings for Memoria, then try again.", "CAMERA_DENIED");
            return;
        }
        if (data != null && data.getBooleanExtra(PairingCaptureActivity.CAMERA_ERROR, false)) {
            call.reject("The camera is unavailable. Close other camera apps and try again, or enter the PC details.", "CAMERA_UNAVAILABLE");
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.reject("Scan cancelled.", "CANCELLED");
            return;
        }
        String text = data.getStringExtra(Intents.Scan.RESULT);
        if (text == null || !ScanOptions.QR_CODE.equals(data.getStringExtra(Intents.Scan.RESULT_FORMAT))) {
            call.reject("Scan the square code shown in Memoria on your PC.", "INVALID_CODE");
            return;
        }
        JSObject response = new JSObject();
        response.put("text", text);
        call.resolve(response);
    }
}
