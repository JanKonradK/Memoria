package app.memoria.tracker;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Alarm-style reminders as ringing alarms; see AlarmScheduler and AlarmService. */
@CapacitorPlugin(name = "AlarmClock")
public class AlarmClockPlugin extends Plugin {
    /** Replaces the planned alarms: [{ id, at, title, body, tone }]. */
    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray alarms = call.getArray("alarms", new JSArray());
        try {
            JSObject result = new JSObject();
            result.put("scheduled", AlarmScheduler.replacePlanned(getContext(), alarms));
            call.resolve(result);
        } catch (Exception failed) {
            call.reject("Alarms could not be set.", failed);
        }
    }

    /** Whether alarms ring on the minute, and whether they may open full screen over the lock screen. */
    @PluginMethod
    public void status(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("exact", AlarmScheduler.canRingOnTime(context));
        boolean fullScreen = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            fullScreen = manager != null && manager.canUseFullScreenIntent();
        }
        result.put("fullScreen", fullScreen);
        call.resolve(result);
    }

    /** The Android page that lets alarms open full screen (Android 14 and later). */
    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        Context context = getContext();
        Intent intent = Build.VERSION.SDK_INT >= 34
            ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + context.getPackageName()))
            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        call.resolve();
    }

    /** Rings an alarm now, to hear the tone. */
    @PluginMethod
    public void test(PluginCall call) {
        Context context = getContext();
        AlarmScheduler.Alarm alarm = new AlarmScheduler.Alarm(
            7_700_002,
            System.currentTimeMillis(),
            call.getString("title", "Test alarm"),
            call.getString("body", "This is how alarms ring."),
            call.getString("tone", "classic"),
            false
        );
        ContextCompat.startForegroundService(
            context,
            alarm.toIntent(new Intent(context, AlarmService.class).setAction(AlarmService.ACTION_RING))
        );
        call.resolve();
    }
}
