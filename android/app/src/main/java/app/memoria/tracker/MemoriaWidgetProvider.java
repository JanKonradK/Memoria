package app.memoria.tracker;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home screen widget: up to eight games in rows of two. Each cell is the game's
 * coin inside a ring of its dailies (one segment per daily, lit when done), the
 * account's name, the main energy reading and the time until it is full.
 *
 * The app writes a snapshot whenever its data changes. The widget only reads it
 * and moves energy forward by the clock, so it never needs the app running.
 * Refresh redraws from the clock; a shorter widget shows fewer rows.
 */
public class MemoriaWidgetProvider extends AppWidgetProvider {
    static final String PREFERENCES = "memoria-widget";
    static final String SNAPSHOT = "snapshot";
    private static final String ACTION_REFRESH = "app.memoria.tracker.WIDGET_REFRESH";
    private static final int FG = Color.parseColor("#F4F4F6");
    private static final int MUTED = Color.parseColor("#9A9AA4");
    private static final int DANGER = Color.parseColor("#FF5A48");
    private static final int TRACK = Color.parseColor("#33FFFFFF");
    private static final int LOGO_PX = 132;
    private static final int[] LINES = { R.id.line0, R.id.line1, R.id.line2, R.id.line3 };
    // Cell, logo, label, energy, time to full.
    private static final int[][] CELLS = {
        { R.id.cell0, R.id.cell0_logo, R.id.cell0_label, R.id.cell0_energy, R.id.cell0_full },
        { R.id.cell1, R.id.cell1_logo, R.id.cell1_label, R.id.cell1_energy, R.id.cell1_full },
        { R.id.cell2, R.id.cell2_logo, R.id.cell2_label, R.id.cell2_energy, R.id.cell2_full },
        { R.id.cell3, R.id.cell3_logo, R.id.cell3_label, R.id.cell3_energy, R.id.cell3_full },
        { R.id.cell4, R.id.cell4_logo, R.id.cell4_label, R.id.cell4_energy, R.id.cell4_full },
        { R.id.cell5, R.id.cell5_logo, R.id.cell5_label, R.id.cell5_energy, R.id.cell5_full },
        { R.id.cell6, R.id.cell6_logo, R.id.cell6_label, R.id.cell6_energy, R.id.cell6_full },
        { R.id.cell7, R.id.cell7_logo, R.id.cell7_label, R.id.cell7_energy, R.id.cell7_full },
    };
    /** Height in dp the header and padding take, and each row of two adds. */
    private static final int CHROME_DP = 50;
    private static final int ROW_DP = 58;

    /** Saves a new snapshot from the app and redraws every placed widget. */
    static void save(Context context, String snapshot) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(SNAPSHOT, snapshot).apply();
        redrawAll(context, snapshot);
    }

    private static void redrawAll(Context context, String snapshot) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, MemoriaWidgetProvider.class));
        for (int id : ids) manager.updateAppWidget(id, views(context, manager, id, snapshot));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_REFRESH.equals(intent.getAction())) redrawAll(context, stored(context));
        else super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        String snapshot = stored(context);
        for (int id : ids) manager.updateAppWidget(id, views(context, manager, id, snapshot));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, views(context, manager, id, stored(context)));
    }

    private static String stored(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(SNAPSHOT, "{}");
    }

    /** Android 12 and later picks the layout for the widget's current size; older versions get one by height. */
    private static RemoteViews views(Context context, AppWidgetManager manager, int id, String text) {
        JSONObject snapshot;
        try {
            snapshot = new JSONObject(text);
        } catch (Exception error) {
            // An unreadable snapshot shows the empty state until the app writes a new one.
            snapshot = new JSONObject();
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Map<SizeF, RemoteViews> sizes = new LinkedHashMap<>();
            for (int rows = 1; rows <= LINES.length; rows++)
                sizes.put(new SizeF(160f, CHROME_DP + rows * ROW_DP - 14f), render(context, snapshot, rows));
            return new RemoteViews(sizes);
        }
        int height = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        int rows = height <= 0 ? LINES.length : (height - CHROME_DP + 14) / ROW_DP;
        return render(context, snapshot, Math.max(1, Math.min(LINES.length, rows)));
    }

    /** Opens the app on Today, or on one game's page. */
    private static PendingIntent open(Context context, String path, int request) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("memoria://" + path), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            context,
            request,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static PendingIntent refresh(Context context) {
        Intent intent = new Intent(ACTION_REFRESH).setClass(context, MemoriaWidgetProvider.class);
        return PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    static RemoteViews render(Context context, JSONObject snapshot, int maxRows) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_memoria);
        views.setOnClickPendingIntent(R.id.widget_root, open(context, "today", 0));
        views.setOnClickPendingIntent(R.id.widget_refresh, refresh(context));
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
            fillCell(views, cell, game, now);
            views.setOnClickPendingIntent(cell[0], open(context, "game/" + Uri.encode(game.optString("id")), index + 1));
        }
        return views;
    }

    private static void fillCell(RemoteViews views, int[] cell, JSONObject game, long now) {
        int total = game.optInt("dailyTotal");
        long resetAt = game.optLong("dailyResetAt", 0);
        // After the daily reset the app has not seen yet, nothing is done.
        int done = resetAt > 0 && now >= resetAt ? 0 : game.optInt("dailyDone");
        views.setImageViewBitmap(cell[1], logo(game.optString("logo"), color(game.optString("ring")), done, total));
        views.setTextViewText(cell[2], game.optString("label"));
        JSONObject meter = game.optJSONObject("meter");
        if (meter == null) {
            views.setTextViewText(cell[3], "No reading");
            views.setTextViewText(cell[4], "");
            return;
        }
        int cap = meter.optInt("cap");
        int value = meterValue(meter, now);
        long fullAt = meter.optLong("fullAt", 0);
        boolean full = value >= cap;
        views.setTextViewText(cell[3], value + "/" + cap);
        views.setTextViewText(cell[4], full ? "Now" : fullAt > 0 ? duration(fullAt - now) : "");
        views.setTextColor(cell[4], full ? DANGER : FG);
    }

    /** The coin from the app inside a ring split into one segment per daily, lit when done. */
    private static Bitmap logo(String png, int color, int done, int total) {
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
            float gap = total == 1 ? 0 : 10;
            float sweep = 360f / total;
            for (int segment = 0; segment < total; segment++) {
                paint.setColor(segment < done ? color : TRACK);
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
            return MUTED;
        }
    }

    static String duration(long ms) {
        long minutes = Math.max(1, ms / 60000);
        long days = minutes / 1440;
        long hours = (minutes % 1440) / 60;
        if (days > 0) return days + "d " + hours + "h";
        if (hours > 0) return String.format(Locale.ROOT, "%dh %02dm", hours, minutes % 60);
        return minutes + "m";
    }
}
