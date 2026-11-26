package app.memoria.tracker;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * One game on the home screen, 2×2 or a 2×1 strip, picked when the widget is
 * placed (SingleGameWidgetConfigActivity). It shows the game's coin inside its
 * dailies ring (tap the ring: dailies done), the main energy reading and a live
 * countdown to full; the rest of the widget opens the game's page.
 *
 * It draws from the same snapshot as Glance (MemoriaWidgetProvider), which also
 * redraws it whenever the app writes a new one.
 */
public class SingleGameWidgetProvider extends AppWidgetProvider {
    private static final String KEY = "single.";
    /** Below this height (dp) the strip layout is used. */
    private static final int TALL_DP = 100;

    /** The game a placed widget shows, or null before it is picked. */
    static String gameFor(Context context, int appWidgetId) {
        return context.getSharedPreferences(MemoriaWidgetProvider.PREFERENCES, Context.MODE_PRIVATE).getString(KEY + appWidgetId, null);
    }

    static void setGame(Context context, int appWidgetId, String gameId) {
        context
            .getSharedPreferences(MemoriaWidgetProvider.PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY + appWidgetId, gameId)
            .commit();
    }

    static void redrawAll(Context context, String snapshot) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, SingleGameWidgetProvider.class));
        for (int id : ids) redraw(context, manager, id, snapshot);
    }

    static void redraw(Context context, AppWidgetManager manager, int appWidgetId, String snapshot) {
        manager.updateAppWidget(appWidgetId, views(context, manager, appWidgetId, MemoriaWidgetProvider.parse(snapshot)));
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        String snapshot = MemoriaWidgetProvider.stored(context);
        for (int id : ids) redraw(context, manager, id, snapshot);
        MemoriaWidgetProvider.scheduleRedraw(context, snapshot);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        redraw(context, manager, id, MemoriaWidgetProvider.stored(context));
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        android.content.SharedPreferences.Editor editor = context
            .getSharedPreferences(MemoriaWidgetProvider.PREFERENCES, Context.MODE_PRIVATE)
            .edit();
        for (int id : ids) editor.remove(KEY + id);
        editor.commit();
    }

    /** Distinct game IDs pinned across all placed single-game widgets. */
    static JSONArray placedGameIds(Context context) {
        JSONArray ids = new JSONArray();
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return ids;
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int widgetId : manager.getAppWidgetIds(new ComponentName(context, SingleGameWidgetProvider.class))) {
            String gameId = gameFor(context, widgetId);
            if (gameId != null && !gameId.isEmpty() && seen.add(gameId)) ids.put(gameId);
        }
        return ids;
    }

    /** The picked game's row in the snapshot, or null when it is gone (deleted, paused) or not picked yet. */
    private static JSONObject row(JSONObject snapshot, String gameId) {
        JSONArray rows = snapshot.optJSONArray("rows");
        for (int index = 0; gameId != null && rows != null && index < rows.length(); index++) {
            JSONObject row = rows.optJSONObject(index);
            if (row != null && gameId.equals(row.optString("id"))) return row;
        }
        return null;
    }

    private static RemoteViews views(Context context, AppWidgetManager manager, int appWidgetId, JSONObject snapshot) {
        JSONObject game = row(snapshot, gameFor(context, appWidgetId));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Map<SizeF, RemoteViews> sizes = new LinkedHashMap<>();
            sizes.put(new SizeF(110f, 40f), render(context, R.layout.widget_single_small, appWidgetId, game));
            sizes.put(new SizeF(110f, TALL_DP), render(context, R.layout.widget_single, appWidgetId, game));
            return new RemoteViews(sizes);
        }
        int height = manager.getAppWidgetOptions(appWidgetId).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        int layout = height > 0 && height < TALL_DP ? R.layout.widget_single_small : R.layout.widget_single;
        return render(context, layout, appWidgetId, game);
    }

    private static RemoteViews render(Context context, int layout, int appWidgetId, JSONObject game) {
        RemoteViews views = new RemoteViews(context.getPackageName(), layout);
        int[] shown = { R.id.single_logo, R.id.single_label, R.id.single_energy, R.id.single_full };
        if (game == null) {
            for (int id : shown) views.setViewVisibility(id, View.GONE);
            views.setViewVisibility(R.id.single_timer, View.GONE);
            views.setViewVisibility(R.id.single_empty, View.VISIBLE);
            views.setOnClickPendingIntent(
                R.id.single_root,
                MemoriaWidgetProvider.open(context, "today", MemoriaWidgetProvider.requestCode(appWidgetId, 0))
            );
            return views;
        }
        views.setViewVisibility(R.id.single_empty, View.GONE);
        for (int id : shown) views.setViewVisibility(id, View.VISIBLE);
        String gameId = game.optString("id");
        MemoriaWidgetProvider.fillGame(
            context,
            views,
            R.id.single_logo,
            R.id.single_label,
            R.id.single_energy,
            R.id.single_full,
            R.id.single_timer,
            game,
            System.currentTimeMillis(),
            "Full"
        );
        views.setOnClickPendingIntent(
            R.id.single_root,
            MemoriaWidgetProvider.open(context, "game/" + Uri.encode(gameId), MemoriaWidgetProvider.requestCode(appWidgetId, 0))
        );
        // The ring is its own button: "dailies done". The rest opens the game.
        if (game.optInt("dailyTotal") > 0)
            views.setOnClickPendingIntent(
                R.id.single_logo,
                MemoriaWidgetProvider.dailiesIntent(context, gameId, MemoriaWidgetProvider.requestCode(appWidgetId, 1))
            );
        return views;
    }
}
