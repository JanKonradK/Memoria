package app.memoria.tracker;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Base64;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Glance, the 4×2 home screen widget: up to eight games in rows of two. Each
 * cell is the game's coin inside a ring of its dailies (one segment per daily,
 * lit when done), the account's name, the main energy reading and a live
 * countdown to full.
 *
 * It also holds what every Memoria widget shares: the app's snapshot, the queue
 * of dailies ticked on a widget, the request codes, the coin drawing and the
 * countdown. The app writes a snapshot whenever its data changes; the widgets
 * only read it and move energy forward by the clock, so they never need the app
 * running. The countdowns are Chronometers, which tick on the home screen by
 * themselves, and one inexact alarm redraws everything when the next bar fills
 * or the next dailies reset.
 */
public class MemoriaWidgetProvider extends AppWidgetProvider {
    static final String PREFERENCES = "memoria-widget";
    static final String SNAPSHOT = "snapshot";
    private static final String ACTION_REFRESH = "app.memoria.tracker.WIDGET_REFRESH";
    private static final String ACTION_DAILIES = "app.memoria.tracker.WIDGET_DAILIES";
    private static final String EXTRA_GAME = "gameId";
    /** Dailies ticked on a widget, waiting for the app: a JSON array of {gameId, at}. */
    static final String QUEUE = "dailiesDone";
    /**
     * Every read, write and clear of the queue and the snapshot holds this lock and
     * commits before letting go, so a tick on the widget never races the app taking
     * the queue or writing a new snapshot, and is never dropped.
     */
    private static final Object LOCK = new Object();
    /** Each placed widget owns this many request codes (see requestCode). */
    private static final int SLOTS = 32;
    /** The request code of the redraw alarm, outside every widget's block. */
    private static final int ALARM_REQUEST = -1;
    private static final int LOGO_PX = 132;
    private static final int[] LINES = { R.id.line0, R.id.line1, R.id.line2, R.id.line3 };
    // Cell, logo, label, energy, time to full, countdown.
    private static final int[][] CELLS = {
        { R.id.cell0, R.id.cell0_logo, R.id.cell0_label, R.id.cell0_energy, R.id.cell0_full, R.id.cell0_timer },
        { R.id.cell1, R.id.cell1_logo, R.id.cell1_label, R.id.cell1_energy, R.id.cell1_full, R.id.cell1_timer },
        { R.id.cell2, R.id.cell2_logo, R.id.cell2_label, R.id.cell2_energy, R.id.cell2_full, R.id.cell2_timer },
        { R.id.cell3, R.id.cell3_logo, R.id.cell3_label, R.id.cell3_energy, R.id.cell3_full, R.id.cell3_timer },
        { R.id.cell4, R.id.cell4_logo, R.id.cell4_label, R.id.cell4_energy, R.id.cell4_full, R.id.cell4_timer },
        { R.id.cell5, R.id.cell5_logo, R.id.cell5_label, R.id.cell5_energy, R.id.cell5_full, R.id.cell5_timer },
        { R.id.cell6, R.id.cell6_logo, R.id.cell6_label, R.id.cell6_energy, R.id.cell6_full, R.id.cell6_timer },
        { R.id.cell7, R.id.cell7_logo, R.id.cell7_label, R.id.cell7_energy, R.id.cell7_full, R.id.cell7_timer },
    };
    /** Height in dp the header and padding take, and each row of two adds. */
    private static final int CHROME_DP = 50;
    private static final int ROW_DP = 58;

    /**
     * A request code unique to one placed widget and one of its targets: widget
     * ids are unique, and each owns a block of SLOTS codes, so two widgets never
     * replace each other's intents.
     */
    static int requestCode(int appWidgetId, int slot) {
        return appWidgetId * SLOTS + slot;
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    /** Saves a new snapshot from the app and redraws every placed widget. */
    static void save(Context context, String snapshot) {
        synchronized (LOCK) {
            preferences(context).edit().putString(SNAPSHOT, snapshot).commit();
        }
        redrawEverything(context, snapshot);
    }

    /** Every Memoria widget on every home screen, from one snapshot. */
    static void redrawEverything(Context context, String snapshot) {
        redrawAll(context, snapshot);
        SingleGameWidgetProvider.redrawAll(context, snapshot);
        QuickScanWidgetProvider.redrawAll(context);
        scheduleRedraw(context, snapshot);
    }

    private static void redrawAll(Context context, String snapshot) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, MemoriaWidgetProvider.class));
        for (int id : ids) manager.updateAppWidget(id, views(context, manager, id, snapshot));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_REFRESH.equals(intent.getAction())) redrawEverything(context, stored(context));
        else if (ACTION_DAILIES.equals(intent.getAction())) dailiesDone(context, intent.getStringExtra(EXTRA_GAME));
        else super.onReceive(context, intent);
    }

    /**
     * A ring was tapped: queue "dailies done" for the app, which applies it when
     * it next opens, and show the ring full straight away on every widget.
     */
    private static void dailiesDone(Context context, String gameId) {
        if (gameId == null || gameId.isEmpty()) return;
        long now = System.currentTimeMillis();
        String text;
        synchronized (LOCK) {
            SharedPreferences preferences = preferences(context);
            try {
                JSONArray queue = new JSONArray(preferences.getString(QUEUE, "[]"));
                if (queue.length() < 200) queue.put(new JSONObject().put("gameId", gameId).put("at", now));
                JSONObject snapshot = new JSONObject(preferences.getString(SNAPSHOT, "{}"));
                JSONArray rows = snapshot.optJSONArray("rows");
                for (int index = 0; rows != null && index < rows.length(); index++) {
                    JSONObject row = rows.optJSONObject(index);
                    if (row != null && gameId.equals(row.optString("id"))) row.put("dailyDone", row.optInt("dailyTotal"));
                }
                text = snapshot.toString();
                preferences.edit().putString(QUEUE, queue.toString()).putString(SNAPSHOT, text).commit();
            } catch (Exception error) {
                // A damaged queue or snapshot is replaced by the app's next write.
                return;
            }
        }
        redrawEverything(context, text);
    }

    /** Returns the queued widget ticks and clears them, in one step under the lock. */
    static String takeQueue(Context context) {
        synchronized (LOCK) {
            SharedPreferences preferences = preferences(context);
            String queue = preferences.getString(QUEUE, "[]");
            preferences.edit().remove(QUEUE).commit();
            return queue;
        }
    }

    /** The "dailies done" tap for one game, owned by one placed widget's slot. */
    static PendingIntent dailiesIntent(Context context, String gameId, int request) {
        Intent intent = new Intent(ACTION_DAILIES).setClass(context, MemoriaWidgetProvider.class).putExtra(EXTRA_GAME, gameId);
        return PendingIntent.getBroadcast(context, request, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        String snapshot = stored(context);
        for (int id : ids) manager.updateAppWidget(id, views(context, manager, id, snapshot));
        scheduleRedraw(context, snapshot);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, views(context, manager, id, stored(context)));
    }

    static String stored(Context context) {
        synchronized (LOCK) {
            return preferences(context).getString(SNAPSHOT, "{}");
        }
    }

    static JSONObject parse(String text) {
        try {
            return new JSONObject(text);
        } catch (Exception error) {
            // An unreadable snapshot shows the empty state until the app writes a new one.
            return new JSONObject();
        }
    }

    /** Android 12 and later picks the layout for the widget's current size; older versions get one by height. */
    private static RemoteViews views(Context context, AppWidgetManager manager, int id, String text) {
        JSONObject snapshot = parse(text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Map<SizeF, RemoteViews> sizes = new LinkedHashMap<>();
            for (int rows = 1; rows <= LINES.length; rows++)
                sizes.put(new SizeF(160f, CHROME_DP + rows * ROW_DP - 14f), render(context, snapshot, rows, id));
            return new RemoteViews(sizes);
        }
        int height = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        int rows = height <= 0 ? 2 : (height - CHROME_DP + 14) / ROW_DP;
        return render(context, snapshot, Math.max(1, Math.min(LINES.length, rows)), id);
    }

    /** Opens the app on Today, on one game's page, or on the camera reader. */
    static PendingIntent open(Context context, String path, int request) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("memoria://" + path), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, request, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent refresh(Context context, int request) {
        Intent intent = new Intent(ACTION_REFRESH).setClass(context, MemoriaWidgetProvider.class);
        return PendingIntent.getBroadcast(context, request, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * One inexact alarm (no permission needed) for the next moment a widget's
     * picture goes stale: a bar filling, where its countdown stops, or dailies
     * resetting, where the ring empties. Replaced on every redraw.
     */
    static void scheduleRedraw(Context context, String text) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms == null) return;
        long now = System.currentTimeMillis();
        long next = Long.MAX_VALUE;
        JSONArray rows = parse(text).optJSONArray("rows");
        for (int index = 0; rows != null && index < rows.length(); index++) {
            JSONObject row = rows.optJSONObject(index);
            if (row == null) continue;
            JSONObject meter = row.optJSONObject("meter");
            long fullAt = meter == null ? 0 : meter.optLong("fullAt", 0);
            long resetAt = row.optLong("dailyResetAt", 0);
            if (fullAt > now) next = Math.min(next, fullAt);
            if (resetAt > now) next = Math.min(next, resetAt);
        }
        PendingIntent intent = refresh(context, ALARM_REQUEST);
        if (next == Long.MAX_VALUE) alarms.cancel(intent);
        else alarms.setWindow(AlarmManager.RTC, next + 1000, 10 * 60 * 1000L, intent);
    }

    static RemoteViews render(Context context, JSONObject snapshot, int maxRows, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_memoria);
        views.setOnClickPendingIntent(R.id.widget_root, open(context, "today", requestCode(appWidgetId, 0)));
        views.setOnClickPendingIntent(R.id.widget_refresh, refresh(context, requestCode(appWidgetId, 1)));
        JSONArray games = snapshot.optJSONArray("rows");
        if (games == null) games = new JSONArray();
        long now = System.currentTimeMillis();
        views.setViewVisibility(R.id.widget_empty, games.length() == 0 ? View.VISIBLE : View.GONE);
        for (int line = 0; line < LINES.length; line++)
            views.setViewVisibility(LINES[line], line < maxRows && line * 2 < games.length() ? View.VISIBLE : View.GONE);
        for (int index = 0; index < CELLS.length; index++) {
            int[] cell = CELLS[index];
            JSONObject game = index < maxRows * 2 ? games.optJSONObject(index) : null;
            // An empty cell keeps its space, so a lone game stays in its column.
            views.setViewVisibility(cell[0], game == null ? View.INVISIBLE : View.VISIBLE);
            if (game == null) continue;
            fillGame(context, views, cell[1], cell[2], cell[3], cell[4], cell[5], game, now, "Now");
            views.setOnClickPendingIntent(
                cell[0],
                open(context, "game/" + Uri.encode(game.optString("id")), requestCode(appWidgetId, 2 + index))
            );
            // The ring is its own button: "dailies done". The rest of the cell opens the game.
            if (game.optInt("dailyTotal") > 0)
                views.setOnClickPendingIntent(
                    cell[1],
                    dailiesIntent(context, game.optString("id"), requestCode(appWidgetId, 2 + CELLS.length + index))
                );
        }
        return views;
    }

    /**
     * One game's coin and ring, label, energy and time to full, into the given
     * views. `fullWord` is what a bar already at its cap says ("Now", "Full").
     */
    static void fillGame(
        Context context,
        RemoteViews views,
        int logoId,
        int labelId,
        int energyId,
        int fullId,
        int timerId,
        JSONObject game,
        long now,
        String fullWord
    ) {
        int total = game.optInt("dailyTotal");
        long resetAt = game.optLong("dailyResetAt", 0);
        // After the daily reset the app has not seen yet, nothing is done.
        int done = resetAt > 0 && now >= resetAt ? 0 : game.optInt("dailyDone");
        views.setImageViewBitmap(logoId, logo(context, game.optString("logo"), color(game.optString("ring")), done, total));
        views.setContentDescription(
            logoId,
            total > 0 ? game.optString("label") + ": " + done + " of " + total + " dailies" : game.optString("label")
        );
        views.setTextViewText(labelId, game.optString("label"));
        JSONObject meter = game.optJSONObject("meter");
        if (meter == null) {
            views.setTextViewText(energyId, "No reading");
            showCountdown(context, views, fullId, timerId, "", 0, now);
            return;
        }
        int cap = meter.optInt("cap");
        int value = meterValue(meter, now);
        long fullAt = meter.optLong("fullAt", 0);
        views.setTextViewText(energyId, value + "/" + cap);
        showCountdown(context, views, fullId, timerId, value >= cap ? fullWord : "", value >= cap ? 0 : fullAt, now);
    }

    /**
     * A live Chronometer counting down to `fullAt` while the bar fills, or the
     * plain text (the full word, or nothing) once it is full or has no time.
     */
    private static void showCountdown(
        Context context,
        RemoteViews views,
        int fullId,
        int timerId,
        String word,
        long fullAt,
        long now
    ) {
        if (fullAt > now) {
            views.setViewVisibility(fullId, View.GONE);
            views.setViewVisibility(timerId, View.VISIBLE);
            views.setChronometer(timerId, SystemClock.elapsedRealtime() + (fullAt - now), null, true);
            views.setChronometerCountDown(timerId, true);
            return;
        }
        views.setChronometer(timerId, SystemClock.elapsedRealtime(), null, false);
        views.setViewVisibility(timerId, View.GONE);
        views.setViewVisibility(fullId, View.VISIBLE);
        views.setTextViewText(fullId, word);
        textColor(context, views, fullId, word.isEmpty() ? R.color.widget_fg : R.color.widget_danger);
    }

    /** A text colour from resources, resolved by the home screen on Android 12+ so it follows the wallpaper. */
    private static void textColor(Context context, RemoteViews views, int viewId, int colorRes) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) views.setColor(viewId, "setTextColor", colorRes);
        else views.setTextColor(viewId, context.getColor(colorRes));
    }

    /** The coin from the app inside a ring split into one segment per daily, lit when done. */
    private static Bitmap logo(Context context, String png, int color, int done, int total) {
        Bitmap bitmap = Bitmap.createBitmap(LOGO_PX, LOGO_PX, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        float stroke = LOGO_PX * 0.075f;
        float inset = stroke / 2 + 1;
        RectF ring = new RectF(inset, inset, LOGO_PX - inset, LOGO_PX - inset);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(stroke);
        paint.setStrokeCap(Paint.Cap.BUTT);
        if (total <= 0) {
            paint.setColor(color);
            paint.setAlpha(110);
            canvas.drawArc(ring, 0, 360, false, paint);
        } else {
            int track = context.getColor(R.color.widget_track);
            float gap = total == 1 ? 0 : 10;
            float sweep = 360f / total;
            for (int segment = 0; segment < total; segment++) {
                paint.setColor(segment < done ? color : track);
                canvas.drawArc(ring, -90 + segment * sweep + gap / 2, sweep - gap, false, paint);
            }
        }
        float coinInset = stroke + LOGO_PX * 0.04f;
        RectF coin = new RectF(coinInset, coinInset, LOGO_PX - coinInset, LOGO_PX - coinInset);
        Bitmap image = null;
        try {
            byte[] bytes = Base64.decode(png, Base64.DEFAULT);
            image = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (IllegalArgumentException ignored) {
            // A missing coin leaves a plain disc.
        }
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(Color.WHITE);
        if (image != null) {
            canvas.drawBitmap(image, null, coin, paint);
            image.recycle();
        } else {
            paint.setColor(Color.parseColor("#16171B"));
            canvas.drawOval(coin, paint);
        }
        return bitmap;
    }

    static int meterValue(JSONObject meter, long now) {
        int cap = meter.optInt("cap");
        int value = meter.optInt("value");
        long fullAt = meter.optLong("fullAt", 0);
        double regenMs = meter.optDouble("regenMinutes", 0) * 60000;
        if (meter.optBoolean("isFull") || (fullAt > 0 && now >= fullAt)) return Math.max(value, cap);
        if (fullAt > 0 && regenMs > 0) return Math.max(value, cap - (int) Math.ceil((fullAt - now) / regenMs));
        return value;
    }

    private static int color(String value) {
        try {
            return Color.parseColor(value);
        } catch (IllegalArgumentException error) {
            return Color.parseColor("#9A9AA4");
        }
    }
}
