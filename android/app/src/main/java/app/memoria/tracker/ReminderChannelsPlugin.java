package app.memoria.tracker;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

/**
 * The reminder styles as Android notification channels, and the system pages a
 * player needs to let reminders through. Channels are made here rather than by
 * the notification plugin so alarm channels can ring at alarm volume.
 */
@CapacitorPlugin(name = "ReminderChannels")
public class ReminderChannelsPlugin extends Plugin {
    static final String[] TONES = { "classic", "pulse", "chime", "ring" };
    static final String[] TONE_NAMES = { "Classic", "Pulse", "Chime", "Ring" };

    /** Safe to call on every start: an existing channel keeps the player's own changes. */
    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        AudioAttributes notification = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        AudioAttributes alarm = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        List<NotificationChannel> channels = new ArrayList<>();

        NotificationChannel silent = new NotificationChannel(
            "memoria-silent",
            "Silent reminders",
            NotificationManager.IMPORTANCE_LOW
        );
        silent.setDescription("No sound. They wait in the notification shade.");
        silent.setSound(null, null);
        channels.add(silent);

        NotificationChannel gentle = new NotificationChannel(
            "memoria-gentle",
            "Gentle reminders",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        gentle.setDescription("A soft chime, without popping up over what you are doing.");
        gentle.setSound(raw(context, "memoria_gentle"), notification);
        channels.add(gentle);

        NotificationChannel standard = new NotificationChannel(
            "memoria-standard",
            "Reminders",
            NotificationManager.IMPORTANCE_HIGH
        );
        standard.setDescription("Pops up with your notification sound.");
        standard.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, notification);
        standard.enableVibration(true);
        channels.add(standard);

        for (int i = 0; i < TONES.length; i++) {
            NotificationChannel channel = new NotificationChannel(
                "memoria-alarm-" + TONES[i],
                "Alarm reminders: " + TONE_NAMES[i],
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Rings at alarm volume, for the reminders you set as alarms.");
            channel.setSound(raw(context, "memoria_alarm_" + TONES[i]), alarm);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[] { 0, 700, 400, 700, 400, 700, 1200, 700, 400, 700 });
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            channels.add(channel);
        }
        manager.createNotificationChannels(channels);
    }

    private static Uri raw(Context context, String name) {
        return Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + context.getPackageName() + "/raw/" + name);
    }

    @Override
    public void load() {
        createChannels(getContext());
    }

    /** Whether each channel still makes sound, and whether battery saving can hold reminders back. */
    @PluginMethod
    public void status(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        JSObject muted = new JSObject();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null) {
            for (NotificationChannel channel : manager.getNotificationChannels()) {
                if (channel.getId().startsWith("memoria-")) {
                    muted.put(channel.getId(), channel.getImportance() == NotificationManager.IMPORTANCE_NONE);
                }
            }
        }
        result.put("blockedChannels", muted);
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        boolean unrestricted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
            || (power != null && power.isIgnoringBatteryOptimizations(context.getPackageName()));
        result.put("batteryUnrestricted", unrestricted);
        call.resolve(result);
    }

    /** Memoria's page in Android's notification settings. */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context context = getContext();
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.getPackageName()));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        call.resolve();
    }

    /** The list where Memoria can be left out of battery saving, so reminders are not held back. */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (Exception missing) {
            Intent details = new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getContext().getPackageName())
            );
            details.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(details);
        }
        call.resolve();
    }
}
