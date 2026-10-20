package app.versado.app;

import android.os.Bundle;
import android.content.pm.ActivityInfo;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VersadoNativePlugin.class);
        super.onCreate(savedInstanceState);
        setRequestedOrientation(getResources().getConfiguration().smallestScreenWidthDp >= 600
            ? ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
    }
}
