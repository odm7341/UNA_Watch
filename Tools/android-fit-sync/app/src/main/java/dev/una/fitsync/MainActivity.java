package dev.una.fitsync;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.text.method.ScrollingMovementMethod;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

public final class MainActivity extends Activity {
    private static final int CONNECT_REQUEST = 1;
    private BluetoothDevice selected;
    private FtsProbe probe;
    private TextView selectedLabel;
    private TextView logView;
    private TextView filesView;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        probe = new FtsProbe(this, new FtsProbe.Listener() {
            @Override
            public void log(String message) {
                runOnUiThread(() -> {
                    logView.append(message + "\n");
                    android.util.Log.i("UnaFitSync", message);
                });
            }

            @Override
            public void files(List<String> names) {
                runOnUiThread(() -> filesView.setText(
                        names.isEmpty() ? "No FIT files found" : String.join("\n", names)));
            }
        });

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (16 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding, padding, padding);
        layout.setLayoutParams(new ViewGroup.LayoutParams(-1, -1));
        TextView title = new TextView(this);
        title.setText("UNA FIT Sync · BLE probe");
        title.setTextSize(22);
        layout.addView(title);
        selectedLabel = new TextView(this);
        selectedLabel.setText("No watch selected");
        layout.addView(selectedLabel);
        addButton(layout, "Choose already-paired watch", this::chooseBondedWatch);
        addButton(layout, "Connect", () -> {
            if (selected == null) append("Choose a watch first");
            else probe.connect(selected);
        });
        addButton(layout, "Inspect SleepVue folders", () -> probe.inspectSleepVue());
        addButton(layout, "Disconnect", () -> probe.disconnect());
        addButton(layout, "Copy connection log", () -> {
            ClipboardManager clipboard = getSystemService(ClipboardManager.class);
            clipboard.setPrimaryClip(ClipData.newPlainText("UNA FIT Sync log", logView.getText()));
            append("Connection log copied");
        });
        filesView = new TextView(this);
        filesView.setText("No files listed yet");
        filesView.setTextIsSelectable(true);
        layout.addView(filesView);
        TextView heading = new TextView(this);
        heading.setText("\nConnection log (no FIT data is downloaded):");
        layout.addView(heading);
        ScrollView scroll = new ScrollView(this);
        logView = new TextView(this);
        logView.setTextIsSelectable(true);
        logView.setMovementMethod(new ScrollingMovementMethod());
        scroll.addView(logView);
        layout.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);
        ensurePermission();
    }

    private void addButton(LinearLayout parent, String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setOnClickListener(view -> action.run());
        parent.addView(button);
    }

    private boolean ensurePermission() {
        if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
            return true;
        }
        requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, CONNECT_REQUEST);
        return false;
    }

    private void chooseBondedWatch() {
        if (!ensurePermission()) return;
        BluetoothManager manager = getSystemService(BluetoothManager.class);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            append("Turn on Bluetooth in Android settings first");
            return;
        }
        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        List<BluetoothDevice> devices = new ArrayList<>(bonded);
        devices.sort(Comparator.comparing(device -> String.valueOf(device.getName())));
        if (devices.isEmpty()) {
            append("No Android-bonded devices. Pair the UNA watch using the phone app first.");
            return;
        }
        String[] labels = devices.stream()
                .map(device -> String.valueOf(device.getName()) + " (" + device.getAddress() + ")")
                .toArray(String[]::new);
        new AlertDialog.Builder(this)
                .setTitle("Already-paired devices")
                .setItems(labels, (dialog, index) -> {
                    selected = devices.get(index);
                    selectedLabel.setText("Selected: " + labels[index]);
                    append("Selected bonded device " + selected.getName());
                })
                .show();
    }

    private void append(String message) {
        logView.append(message + "\n");
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == CONNECT_REQUEST && (results.length == 0
                || results[0] != PackageManager.PERMISSION_GRANTED)) {
            append("Nearby devices permission is required to use the watch");
        }
    }

    @Override
    protected void onDestroy() {
        probe.shutdown();
        super.onDestroy();
    }
}
