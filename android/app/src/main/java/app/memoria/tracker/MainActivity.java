package app.memoria.tracker;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeBackupPlugin.class);
        registerPlugin(PairingScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
