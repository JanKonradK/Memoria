package app.memoria.tracker;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.UserManager;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Alarm-style reminders as real alarms: each one is set with
 * AlarmManager.setAlarmClock, which fires on the minute even in Doze and shows
 * in the status bar like a clock app's alarm. The list is kept on disk so a
 * reboot or an app update can set them again. That list lives in
 * device-protected storage, so it can be read straight after a reboot, before
 * the phone is first unlocked (Direct Boot), and alarms still ring then.
 */
final class AlarmScheduler {
    static final String EXTRA_ID = "memoria.alarm.id";
    static final long SNOOZE_MS = 10 * 60_000L;
    /** An alarm a reboot made late still rings for this long after its time. */
    private static final long LATE_GRACE_MS = 10 * 60_000L;
    private static final String PREFS = "memoria-alarms";
    private static final String KEY = "alarms";
    /** Set once the list kept in credential-protected storage by older versions has moved over. */
    private static final String KEY_MIGRATED = "alarms-migrated";

    private AlarmScheduler() {}

    static final class Alarm {
        final int id;
        final long at;
        final String title;
        final String body;
        final String tone;
        final boolean snoozed;

        Alarm(int id, long at, String title, String body, String tone, boolean snoozed) {
            this.id = id;
            this.at = at;
            this.title = title == null ? "Memoria" : title;
            this.body = body == null ? "" : body;
            this.tone = tone == null ? "classic" : tone;
            this.snoozed = snoozed;
        }

        JSONObject toJson() throws JSONException {
            return new JSONObject()
                .put("id", id)
                .put("at", at)
                .put("title", title)
                .put("body", body)
                .put("tone", tone)
                .put("snoozed", snoozed);
        }

        static Alarm fromJson(JSONObject json) {
            return new Alarm(
                json.optInt("id"),
                json.optLong("at"),
                json.optString("title", "Memoria"),
                json.optString("body", ""),
                json.optString("tone", "classic"),
                json.optBoolean("snoozed", false)
            );
        }

        Intent toIntent(Intent intent) {
            return intent
                .putExtra(EXTRA_ID, id)
                .putExtra("title", title)
                .putExtra("body", body)
                .putExtra("tone", tone)
                .putExtra("snoozed", snoozed);
        }

        static Alarm fromIntent(Intent intent) {
            return new Alarm(
                intent.getIntExtra(EXTRA_ID, 0),
                System.currentTimeMillis(),
                intent.getStringExtra("title"),
                intent.getStringExtra("body"),
                intent.getStringExtra("tone"),
                intent.getBooleanExtra("snoozed", false)
            );
        }
    }

    static synchronized JSONArray read(Context context) {
        migrate(context);
        return parse(prefs(context).getString(KEY, null));
    }

    private static JSONArray parse(String stored) {
        if (stored == null) return new JSONArray();
        try {
            return new JSONArray(stored);
        } catch (JSONException broken) {
            return new JSONArray();
        }
    }

    private static void write(Context context, JSONArray alarms) {
        prefs(context).edit().putString(KEY, alarms.toString()).apply();
    }

    /** Device-protected: readable before the first unlock after a reboot. */
    private static SharedPreferences prefs(Context context) {
        return context.createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Older versions kept the list in credential-protected storage, which only
     * opens once the phone is unlocked. The first time it can be read, its
     * alarms join the device-protected list (an alarm already there wins) and
     * the old copy is cleared. Until then nothing is lost: the old list stays
     * where it is and is merged in later.
     */
    private static void migrate(Context context) {
        SharedPreferences device = prefs(context);
        if (device.getBoolean(KEY_MIGRATED, false)) return;
        UserManager users = context.getSystemService(UserManager.class);
        if (users != null && !users.isUserUnlocked()) return;
        try {
            SharedPreferences legacy = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray merged = parse(device.getString(KEY, null));
            JSONArray old = parse(legacy.getString(KEY, null));
            for (int i = 0; i < old.length(); i++) {
                JSONObject json = old.optJSONObject(i);
                if (json != null && !hasId(merged, json.optInt("id"))) merged.put(json);
            }
            device.edit().putString(KEY, merged.toString()).putBoolean(KEY_MIGRATED, true).commit();
            if (legacy != device) legacy.edit().remove(KEY).apply();
        } catch (IllegalStateException locked) {
            // Still in Direct Boot: credential-protected storage opens after the first unlock.
        }
    }

    private static boolean hasId(JSONArray alarms, int id) {
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject json = alarms.optJSONObject(i);
            if (json != null && json.optInt("id") == id) return true;
        }
        return false;
    }

    /**
     * Replaces the planned alarms with a new plan. A snoozed alarm is the
     * player's own and survives a rebuilt plan.
     */
    static synchronized int replacePlanned(Context context, JSONArray plan) throws JSONException {
        JSONArray kept = new JSONArray();
        JSONArray old = read(context);
        for (int i = 0; i < old.length(); i++) {
            Alarm alarm = Alarm.fromJson(old.getJSONObject(i));
            if (alarm.snoozed) kept.put(alarm.toJson());
            else cancel(context, alarm.id);
        }
        long now = System.currentTimeMillis();
        int count = 0;
        for (int i = 0; i < plan.length(); i++) {
            JSONObject item = plan.getJSONObject(i);
            Alarm alarm = new Alarm(
                item.getInt("id"),
                item.getLong("at"),
                item.optString("title", "Memoria"),
                item.optString("body", ""),
                item.optString("tone", "classic"),
                false
            );
            if (alarm.at <= now) continue;
            kept.put(alarm.toJson());
            set(context, alarm);
            count++;
        }
        write(context, kept);
        return count;
    }

    /**
     * The id a snoozed alarm rings under. Planned ids are 1..2_000_000_000, so
     * setting the sign bit gives each its own negative id that no planned
     * alarm uses, and snoozing a snoozed alarm again keeps the same id.
     */
    static int snoozeId(int id) {
        return id < 0 ? id : (id | 0x80000000);
    }

    /** The same alarm again in ten minutes. */
    static synchronized void snooze(Context context, Alarm alarm) {
        long at = System.currentTimeMillis() + SNOOZE_MS;
        Alarm again = new Alarm(snoozeId(alarm.id), at, alarm.title, alarm.body, alarm.tone, true);
        JSONArray alarms = withoutId(read(context), again.id);
        try {
            alarms.put(again.toJson());
        } catch (JSONException ignored) {
            return;
        }
        write(context, alarms);
        set(context, again);
    }

    /** The alarm with this id, still on the list; null when a newer plan dropped it. */
    static synchronized Alarm find(Context context, int id) {
        JSONArray alarms = read(context);
        Alarm found = null;
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject json = alarms.optJSONObject(i);
            if (json != null && json.optInt("id") == id) found = Alarm.fromJson(json);
        }
        return found;
    }

    /** Takes the alarm off the list once it has been delivered (ringing, or posted as a notification). */
    static synchronized void remove(Context context, int id) {
        write(context, withoutId(read(context), id));
    }

    /** After a reboot, an update or a clock change: set every alarm again, dropping long-missed ones. */
    static synchronized void restore(Context context) {
        JSONArray alarms = read(context);
        JSONArray kept = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject json = alarms.optJSONObject(i);
            if (json == null) continue;
            Alarm alarm = Alarm.fromJson(json);
            if (alarm.at < now - LATE_GRACE_MS) continue;
            kept.put(json);
            set(context, alarm.at < now ? new Alarm(alarm.id, now + 1000, alarm.title, alarm.body, alarm.tone, alarm.snoozed) : alarm);
        }
        write(context, kept);
    }

    private static JSONArray withoutId(JSONArray alarms, int id) {
        JSONArray out = new JSONArray();
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject json = alarms.optJSONObject(i);
            if (json != null && json.optInt("id") != id) out.put(json);
        }
        return out;
    }

    private static PendingIntent fireIntent(Context context, int id) {
        Intent intent = new Intent(context, AlarmReceiver.class).setAction(AlarmReceiver.ACTION_FIRE).putExtra(EXTRA_ID, id);
        return PendingIntent.getBroadcast(
            context,
            id,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    /** Opens Memoria when the alarm icon in the status bar is tapped. */
    private static PendingIntent showIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void set(Context context, Alarm alarm) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        PendingIntent fire = fireIntent(context, alarm.id);
        try {
            manager.setAlarmClock(new AlarmManager.AlarmClockInfo(alarm.at, showIntent(context)), fire);
        } catch (SecurityException notAllowed) {
            // Exact alarms switched off in Android settings: ring a little late rather than never.
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.at, fire);
        }
    }

    private static void cancel(Context context, int id) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager != null) manager.cancel(fireIntent(context, id));
    }

    static boolean canRingOnTime(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return manager != null && manager.canScheduleExactAlarms();
    }
}
