package app.memoria.tracker;

import com.getcapacitor.BridgeActivity;

/**
 * The GitHub build's own plugins: it installs its updates (AppUpdaterPlugin)
 * and rings alarm-style reminders as real alarms (AlarmClockPlugin).
 */
final class FlavorPlugins {
    private FlavorPlugins() {}

    static void register(BridgeActivity activity) {
        activity.registerPlugin(AppUpdaterPlugin.class);
        activity.registerPlugin(AlarmClockPlugin.class);
    }
}
