package app.memoria.tracker;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Which build this is, and what it may unlock. The seam Play Billing will fill:
 * today every build is `free` with nothing locked (entitlements.ts keeps every
 * feature open), and `distribution` comes from the Gradle flavour, so the page
 * knows not to offer GitHub updates in the Google Play build.
 */
@CapacitorPlugin(name = "Entitlements")
public class EntitlementsPlugin extends Plugin {
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("distribution", BuildConfig.IS_PLAY_BUILD ? "play" : "direct");
        result.put("tier", "free");
        result.put("proUnlocked", false);
        result.put("billingReady", false);
        call.resolve(result);
    }
}
