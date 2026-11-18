package app.memoria.tracker;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.format.DateFormat;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.Date;

/** The ringing alarm, full screen and over the lock screen, with Snooze and Dismiss. */
public class AlarmActivity extends Activity {
    private static final int BACKGROUND = 0xFF0C0D0F;
    private static final int TEXT = 0xFFF4F4F6;
    private static final int DIM = 0xFFA6A6B0;
    private static final int ACCENT = 0xFF8AB4FF;
    /** Held here: the service keeps only a weak reference. */
    private final Runnable close = this::finish;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        AlarmScheduler.Alarm alarm = AlarmService.ringing;
        if (alarm == null) {
            finish();
            return;
        }
        AlarmService.setOnStopped(close);

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setGravity(Gravity.CENTER);
        page.setBackgroundColor(BACKGROUND);
        int pad = dp(28);
        page.setPadding(pad, pad, pad, pad);

        page.addView(text(DateFormat.getTimeFormat(this).format(new Date()), 64, TEXT, true));
        TextView title = text(alarm.title, 26, TEXT, true);
        title.setPadding(0, dp(24), 0, dp(8));
        page.addView(title);
        page.addView(text(alarm.body, 18, DIM, false));

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.VERTICAL);
        buttons.setPadding(0, dp(48), 0, 0);
        buttons.addView(button("Snooze 10 min", false, AlarmService.ACTION_SNOOZE));
        buttons.addView(button("Dismiss", true, AlarmService.ACTION_DISMISS));
        page.addView(buttons, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        setContentView(page);
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    private Button button(String label, boolean primary, String action) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        button.setTextColor(primary ? BACKGROUND : TEXT);
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(28));
        if (primary) shape.setColor(ACCENT);
        else {
            shape.setColor(Color.TRANSPARENT);
            shape.setStroke(dp(2), DIM);
        }
        button.setBackground(shape);
        button.setMinHeight(dp(64));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64));
        params.topMargin = dp(12);
        button.setLayoutParams(params);
        button.setOnClickListener(view -> {
            startService(new Intent(this, AlarmService.class).setAction(action));
            finish();
        });
        return button;
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    @Override
    protected void onDestroy() {
        AlarmService.clearOnStopped(close);
        super.onDestroy();
    }
}
