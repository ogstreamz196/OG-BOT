package og.bot;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            WebSettings s = getBridge().getWebView().getSettings();
            // Keep a persistent on-device cache so repeat launches skip the network.
            s.setCacheMode(WebSettings.LOAD_DEFAULT);
            s.setDomStorageEnabled(true);
            s.setDatabaseEnabled(true);
        } catch (Exception ignored) {
        }
    }
}
