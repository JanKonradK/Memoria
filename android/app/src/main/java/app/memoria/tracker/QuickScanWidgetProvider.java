package app.memoria.tracker;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

/**
 * Quick Scan, a 1×1 home screen shortcut: it opens `memoria://scan`, which
 * home-widget.ts routes to the camera reader. It shows no data of its own.
 */
public class QuickScanWidgetProvider extends AppWidgetProvider {
    static void redrawAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, QuickScanWidgetProvider.class));
        for (int id : ids) manager.updateAppWidget(id, views(context, id));
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, views(context, id));
    }

    private static RemoteViews views(Context context, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_quick_scan);
        views.setOnClickPendingIntent(
            R.id.scan_root,
            MemoriaWidgetProvider.open(context, "scan", MemoriaWidgetProvider.requestCode(appWidgetId, 0))
        );
        return views;
    }
}
