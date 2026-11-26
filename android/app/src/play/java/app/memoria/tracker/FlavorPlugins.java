package app.memoria.tracker;

import com.getcapacitor.BridgeActivity;

/**
 * The Google Play build adds no plugins of its own. Play installs its updates,
 * so it carries no APK installer, and alarm-style reminders arrive on the high
 * priority alarm notification channels (ReminderChannelsPlugin) instead of the
 * full-screen ringer: notifications.ts falls back to them when AlarmClock is
 * missing, and reads no full-screen status, so nothing asks for it.
 */
final class FlavorPlugins {
    private FlavorPlugins() {}

    static void register(BridgeActivity activity) {
        // Nothing to add: see the class comment.
    }
}
