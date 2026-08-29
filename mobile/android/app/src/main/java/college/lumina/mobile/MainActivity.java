package college.lumina.mobile;

import com.getcapacitor.BridgeActivity;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    private ConnectivityManager connectivity;
    private final ConnectivityManager.NetworkCallback networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) { updateNetworkState(); }
        @Override public void onLost(Network network) { updateNetworkState(); }
        @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) { updateNetworkState(); }
    };

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        connectivity = getSystemService(ConnectivityManager.class);
        connectivity.registerDefaultNetworkCallback(networkCallback);
        updateNetworkState();
    }

    private void updateNetworkState() {
        if (connectivity == null) return;
        NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());
        boolean online = capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        runOnUiThread(() -> {
            if (!isDestroyed() && getBridge() != null) getBridge().getWebView().setNetworkAvailable(online);
        });
    }

    @Override public void onResume() {
        super.onResume();
        updateNetworkState();
    }

    @Override public void onDestroy() {
        if (connectivity != null) connectivity.unregisterNetworkCallback(networkCallback);
        super.onDestroy();
    }
}
