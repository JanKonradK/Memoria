package app.memoria.tracker;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Receives the home screen widget's snapshot from the app. */
@CapacitorPlugin(name = "HomeWidget")
public class HomeWidgetPlugin extends Plugin {
    private static final int MAX_LENGTH = 400000;

    @PluginMethod
    public void update(PluginCall call) {
        String snapshot = call.getString("snapshot");
        if (snapshot == null || snapshot.length() > MAX_LENGTH) {
            call.reject("The widget data is missing or too large.");
            return;
        }
        MemoriaWidgetProvider.save(getContext(), snapshot);
        call.resolve();
    }

    /** Dailies ticked on the widget since the app last looked, as JSON. */
    @PluginMethod
    public void takeQueue(PluginCall call) {
        JSObject result = new JSObject();
        result.put("queue", MemoriaWidgetProvider.takeQueue(getContext()));
        call.resolve(result);
    }
}
