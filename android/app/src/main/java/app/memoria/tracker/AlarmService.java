package app.memoria.tracker;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import androidx.core.app.NotificationCompat;
import java.lang.ref.WeakReference;

/**
 * Rings an alarm the way a clock app does: the chosen tone on a loop at alarm
 * volume, vibration, and a full-screen page over the lock screen, until it is
 * dismissed or snoozed. An alarm nobody answers stops after ten minutes and
 * leaves a quiet notification behind.
 */
public class AlarmService extends Service {
    static final String ACTION_RING = "app.memoria.tracker.ALARM_RING";
    static final String ACTION_SNOOZE = "app.memoria.tracker.ALARM_SNOOZE";
    static final String ACTION_DISMISS = "app.memoria.tracker.ALARM_DISMISS";
    static final String RINGING_CHANNEL = "memoria-alarm-ringing";
    private static final int RINGING_NOTIFICATION = 7_700_001;
    private static final long RING_FOR_MS = 10 * 60_000L;
    private static final long[] PATTERN = { 0, 700, 400, 700, 400, 700, 1200 };

    /** The alarm ringing now, for the full-screen page. */
    static volatile AlarmScheduler.Alarm ringing;
    private static WeakReference<Runnable> onStopped = new WeakReference<>(null);

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = this::missed;
    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;

    /** The full-screen page closes itself when the ringing stops from anywhere else. */
    static void setOnStopped(Runnable listener) {
        onStopped = new WeakReference<>(listener);
    }

    static void clearOnStopped(Runnable listener) {
        if (onStopped.get() == listener) onStopped = new WeakReference<>(null);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ReminderChannelsPlugin.createChannels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_RING.equals(action)) {
            ring(AlarmScheduler.Alarm.fromIntent(intent));
            return START_NOT_STICKY;
        }
        if (ACTION_SNOOZE.equals(action) && ringing != null) AlarmScheduler.snooze(this, ringing);
        stopRinging();
        return START_NOT_STICKY;
    }

    private void ring(AlarmScheduler.Alarm alarm) {
        ringing = alarm;
        Notification notification = notification(alarm);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(RINGING_NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(RINGING_NOTIFICATION, notification);
        }
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (wakeLock == null && power != null) {
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "memoria:alarm");
            wakeLock.acquire(RING_FOR_MS + 60_000L);
        }
        playTone(alarm.tone);
        vibrate();
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, RING_FOR_MS);
    }

    private Notification notification(AlarmScheduler.Alarm alarm) {
        Intent page = new Intent(this, AlarmActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        PendingIntent fullScreen = PendingIntent.getActivity(
            this,
            1,
            page,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, RINGING_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_alarm)
            .setContentTitle(alarm.title)
            .setContentText(alarm.body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(alarm.body))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(fullScreen)
            .setFullScreenIntent(fullScreen, true)
            .addAction(0, "Snooze 10 min", action(ACTION_SNOOZE, 2))
            .addAction(0, "Dismiss", action(ACTION_DISMISS, 3))
            .build();
    }

    private PendingIntent action(String action, int code) {
        return PendingIntent.getService(
            this,
            code,
            new Intent(this, AlarmService.class).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void playTone(String tone) {
        stopTone();
        int raw = getResources().getIdentifier("memoria_alarm_" + tone, "raw", getPackageName());
        if (raw == 0) raw = R.raw.memoria_alarm_classic;
        Uri uri = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + getPackageName() + "/" + raw);
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            );
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception failed) {
            stopTone();
        }
    }

    private void vibrate() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = manager == null ? null : manager.getDefaultVibrator();
        } else {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;
        AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(PATTERN, 0), attributes);
        } else {
            vibrator.vibrate(PATTERN, 0, attributes);
        }
    }

    /** Nobody answered: stop ringing and leave the reminder where it can still be read. */
    private void missed() {
        AlarmScheduler.Alarm alarm = ringing;
        stopRinging();
        if (alarm == null) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        manager.notify(
            alarm.id,
            new NotificationCompat.Builder(this, "memoria-silent")
                .setSmallIcon(R.drawable.ic_stat_alarm)
                .setContentTitle("Missed alarm: " + alarm.title)
                .setContentText(alarm.body)
                .setAutoCancel(true)
                .setContentIntent(
                    PendingIntent.getActivity(this, 4, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
                )
                .build()
        );
    }

    private void stopTone() {
        if (player == null) return;
        try {
            player.stop();
        } catch (IllegalStateException ignored) {
            // Never started.
        }
        player.release();
        player = null;
    }

    private void stopRinging() {
        handler.removeCallbacks(timeout);
        stopTone();
        if (vibrator != null) vibrator.cancel();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        ringing = null;
        Runnable listener = onStopped.get();
        if (listener != null) listener.run();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (ringing != null) stopRinging();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
