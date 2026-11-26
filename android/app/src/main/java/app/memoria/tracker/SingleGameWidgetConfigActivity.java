package app.memoria.tracker;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Opened by the home screen as a single-game widget is placed (or reconfigured):
 * a list of the games in the app's latest snapshot. Picking one sets the widget
 * to it; backing out leaves the widget unplaced.
 */
public class SingleGameWidgetConfigActivity extends Activity {
    private int appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Until a game is picked, the home screen removes the widget again.
        setResult(RESULT_CANCELED);
        Intent intent = getIntent();
        if (intent != null) appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        AppWidgetProviderInfo info = AppWidgetManager.getInstance(this).getAppWidgetInfo(appWidgetId);
        if (info == null || info.provider == null || !new ComponentName(this, SingleGameWidgetProvider.class).equals(info.provider)) {
            finish();
            return;
        }
        List<String> ids = new ArrayList<>();
        List<String> names = new ArrayList<>();
        JSONArray rows = MemoriaWidgetProvider.parse(MemoriaWidgetProvider.stored(this)).optJSONArray("rows");
        for (int index = 0; rows != null && index < rows.length(); index++) {
            JSONObject row = rows.optJSONObject(index);
            if (row == null || row.optString("id").isEmpty()) continue;
            ids.add(row.optString("id"));
            String name = row.optString("name");
            names.add(name.isEmpty() ? row.optString("label") : name);
        }

        int pad = dp(20);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, dp(8));
        TextView title = new TextView(this);
        title.setText(names.isEmpty() ? getString(R.string.widget_single_none) : getString(R.string.widget_single_pick));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, names.isEmpty() ? 15 : 18);
        title.setPadding(0, 0, 0, dp(12));
        root.addView(title);
        if (names.isEmpty()) {
            Button close = new Button(this);
            close.setText(R.string.cancel);
            close.setOnClickListener((view) -> finish());
            root.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        } else {
            ListView list = new ListView(this);
            list.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, names));
            list.setOnItemClickListener((parent, view, position, id) -> pick(ids.get(position)));
            root.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }
        setContentView(root);
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    private void pick(String gameId) {
        SingleGameWidgetProvider.setGame(this, appWidgetId, gameId);
        String snapshot = MemoriaWidgetProvider.stored(this);
        SingleGameWidgetProvider.redraw(this, AppWidgetManager.getInstance(this), appWidgetId, snapshot);
        MemoriaWidgetProvider.scheduleRedraw(this, snapshot);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId));
        finish();
    }
}
