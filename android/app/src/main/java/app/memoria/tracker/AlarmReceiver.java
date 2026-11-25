package app.memoria.tracker;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.Arrays;

/** Starts the ringing when an alarm's time comes, and sets every alarm again after a reboot or update. */
public class AlarmReceiver extends BroadcastReceiver {
    static final String ACTION_FIRE = "app.memoria.tracker.ALARM_FIRE";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (ACTION_FIRE.equals(action)) {
            int id = intent.getIntExtra(AlarmScheduler.EXTRA_ID, 0);
            AlarmScheduler.Alarm alarm = AlarmScheduler.find(context, id);
            // Taken off the list since: a newer plan no longer wants it.
            if (alarm == null) return;
            // The alarm leaves the list only once it has reached the player, so a
            // failed start never loses it.
            if (ring(context, alarm) || notifyInstead(context, alarm)) AlarmScheduler.remove(context, id);
            return;
        }
        // Boot (including the locked boot before the first unlock), an app
        // update, or the clock or time zone changing.
        AlarmScheduler.restore(context);
    }

    /**
     * Starts the ringing service. Android 12 and later refuse a foreground
     * service started from the background unless the alarm was exact; an alarm
     * set inexactly (exact alarms switched off) lands here and is refused.
     */
    private static boolean ring(Context context, AlarmScheduler.Alarm alarm) {
        Intent ring = alarm.toIntent(new Intent(context, AlarmService.class).setAction(AlarmService.ACTION_RING));
        try {
            ComponentName started = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? context.startForegroundService(ring)
                : context.startService(ring);
            return started != null;
        } catch (RuntimeException refused) {
            // ForegroundServiceStartNotAllowedException (an IllegalStateException), or a SecurityException.
            return false;
        }
    }

    /** The ringing could not start: an alarm-channel notification, popping up full screen where allowed. */
    private static boolean notifyInstead(Context context, AlarmScheduler.Alarm alarm) {
        try {
            if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(context, "android.permission.POST_NOTIFICATIONS")
                    != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
            ReminderChannelsPlugin.createChannels(context);
            Intent open = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
            PendingIntent page = PendingIntent.getActivity(
                context,
                5,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channel(context, alarm.tone))
                .setSmallIcon(R.drawable.ic_stat_alarm)
                .setContentTitle(alarm.title)
                .setContentText(alarm.body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(alarm.body))
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(page)
                .setFullScreenIntent(page, true);
            NotificationManagerCompat manager = NotificationManagerCompat.from(context);
            if (!manager.areNotificationsEnabled()) return false;
            manager.notify(alarm.id, builder.build());
            return true;
        } catch (RuntimeException failed) {
            // SecurityException included: never crash the receiver over a notification.
            return false;
        }
    }

    /** The alarm channel for this tone, or the standard reminder channel when it does not exist. */
    private static String channel(Context context, String tone) {
        String alarm = "memoria-alarm-" + tone;
        if (!Arrays.asList(ReminderChannelsPlugin.TONES).contains(tone)) return "memoria-standard";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager == null || manager.getNotificationChannel(alarm) == null) return "memoria-standard";
        }
        return alarm;
    }
}
