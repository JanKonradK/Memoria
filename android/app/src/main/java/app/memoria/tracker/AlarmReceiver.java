package app.memoria.tracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/** Starts the ringing when an alarm's time comes, and sets every alarm again after a reboot or update. */
public class AlarmReceiver extends BroadcastReceiver {
    static final String ACTION_FIRE = "app.memoria.tracker.ALARM_FIRE";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (ACTION_FIRE.equals(action)) {
            AlarmScheduler.Alarm alarm = AlarmScheduler.take(context, intent.getIntExtra(AlarmScheduler.EXTRA_ID, 0));
            // Taken off the list since: a newer plan no longer wants it.
            if (alarm == null) return;
            Intent ring = alarm.toIntent(new Intent(context, AlarmService.class).setAction(AlarmService.ACTION_RING));
            ContextCompat.startForegroundService(context, ring);
            return;
        }
        // Boot, an app update, or the clock or time zone changing.
        AlarmScheduler.restore(context);
    }
}
