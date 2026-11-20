package app.memoria.tracker;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.content.Intent;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeBackupPlugin.class);
        registerPlugin(PairingScannerPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(HomeWidgetPlugin.class);
        registerPlugin(DeviceKeyPlugin.class);
        registerPlugin(ReminderChannelsPlugin.class);
        registerPlugin(AlarmClockPlugin.class);
        super.onCreate(savedInstanceState);
        // Honour the page's viewport width, so the app can scale itself to the screen
        // (screen-scale.ts): larger on a tablet, a touch smaller on a small phone.
        getBridge().getWebView().getSettings().setUseWideViewPort(true);
        getBridge().getWebView().getSettings().setLoadWithOverviewMode(true);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        setIntent(intent);
        super.onNewIntent(intent);
    }
}
