package dev.una.fitsync;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.ViewGroup;
import android.view.Gravity;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public final class MainActivity extends Activity {
    private static final int CONNECT_REQUEST = 1;
    private static final int FILE_REQUEST = 2;
    private static final int EXPORT_REQUEST = 3;
    private static final String PAGE = "https://appassets.androidplatform.net/assets/dashboard/index.html";
    private BluetoothDevice selected;
    private FtsProbe probe;
    private WebView webView;
    private TextView status;
    private final StringBuilder log = new StringBuilder();
    private ValueCallback<Uri[]> fileChooser;
    private ByteArrayOutputStream exportBytes;
    private String exportFilename;
    private byte[] pendingExport;
    private boolean dashboardReady;
    private Uri sharedUri;
    private HealthExporter healthExporter;

    private void healthStatus(String message) {
        if (isDestroyed()) return;
        status.setText(message);
        if (isDashboardPage()) webView.evaluateJavascript(
                "window.unaHealthStatus(" + JSONObject.quote(message) + ")", null);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        probe = new FtsProbe(this, new FtsProbe.Listener() {
            @Override public void log(String message) {
                runOnUiThread(() -> {
                    log.append(message).append('\n');
                    status.setText(message);
                    android.util.Log.i("UnaFitSync", message);
                });
            }
            @Override public void progress(String message) {
                runOnUiThread(() -> status.setText(message));
            }
            @Override public void files(List<FtsProbe.FitFile> files) {
                runOnUiThread(() -> showFiles(files));
            }
            @Override public void imported(FtsProbe.FitFile file, byte[] bytes) {
                // No disk cache and no JS interface: only the verified bytes reach our local page.
                String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                runOnUiThread(() -> {
                    if (!isDashboardPage()) {
                        status.setText("Dashboard not ready; transfer discarded");
                        return;
                    }
                    if (file.path.startsWith("/DailyHealth/")) {
                        String json = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
                        webView.evaluateJavascript("window.unaImportDailyHealth([{filename:"
                                + JSONObject.quote(file.name()) + ",data:JSON.parse("
                                + JSONObject.quote(json) + ")}]).then(r=>{document.querySelector('#daily-status').textContent"
                                + "+=r.errors.length?' '+r.errors.join('; '):'';})", null);
                        status.setText("Transferred " + file.name() + " · daily heart rate");
                        return;
                    }
                    webView.evaluateJavascript("window.unaDashboardImportStart("
                            + JSONObject.quote(file.name()) + ","
                            + JSONObject.quote(file.path) + ")", null);
                    // Keep each WebView IPC message small even for multi-hour recordings.
                    for (int offset = 0; offset < base64.length(); offset += 32768) {
                        String chunk = base64.substring(offset, Math.min(offset + 32768, base64.length()));
                        webView.evaluateJavascript("window.unaDashboardImportChunk("
                                + JSONObject.quote(chunk) + ")", null);
                    }
                    webView.evaluateJavascript("window.unaDashboardImportFinish()", null);
                    status.setText("Transferred " + file.name() + " · checking FIT integrity");
                });
            }
        });

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(0xff080d14);
        // Android 15+ draws apps edge-to-edge even with older layout assumptions.
        // Keep both the native controls and WebView clear of the camera cutout,
        // system bars, and keyboard instead of relying on status-bar colors.
        getWindow().setDecorFitsSystemWindows(false);
        layout.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return insets;
        });
        int horizontalPadding = Math.round(getResources().getDisplayMetrics().density * 16);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(horizontalPadding, 0, horizontalPadding, 0);
        toolbar.setBackgroundColor(0xff0b1520);
        TextView brand = new TextView(this);
        brand.setText("UNA  /  Activity");
        brand.setTextColor(0xffedf4fb);
        brand.setTextSize(17);
        brand.setTypeface(null, android.graphics.Typeface.BOLD);
        toolbar.addView(brand, new LinearLayout.LayoutParams(0, -2, 1));
        Button watchButton = new Button(this);
        watchButton.setText("Watch");
        watchButton.setAllCaps(false);
        watchButton.setTextColor(0xff07110e);
        watchButton.setBackgroundTintList(ColorStateList.valueOf(0xff6cd8ae));
        watchButton.setContentDescription("Watch connection and FIT import options");
        watchButton.setOnClickListener(view -> watchMenu());
        toolbar.addView(watchButton, new LinearLayout.LayoutParams(-2, -2));
        layout.addView(toolbar, new LinearLayout.LayoutParams(-1, -2));
        status = new TextView(this);
        status.setText("Offline · Connect a bonded watch to import recordings");
        status.setTextColor(0xffa2b9bb);
        status.setTextSize(12);
        status.setMaxLines(2);
        status.setPadding(horizontalPadding, 0, horizontalPadding, 8);
        status.setBackgroundColor(0xff0b1520);
        layout.addView(status);
        webView = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(
                (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        webView.setBackgroundColor(0xff070b11);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(true); // SAF file picker for manual FIT import
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "AndroidExport",
                    java.util.Set.of("https://appassets.androidplatform.net"),
                    (view, message, origin, isMainFrame, reply) -> {
                        if (isMainFrame && "https".equals(origin.getScheme())
                                && "appassets.androidplatform.net".equals(origin.getHost())
                                && isDashboardPage()) {
                            handleExportMessage(message.getData());
                        }
                    });
        }
        final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("https".equals(url.getScheme()) && "appassets.androidplatform.net".equals(url.getHost())
                        && url.getPath() != null && url.getPath().startsWith("/assets/dashboard/")) {
                    return assets.shouldInterceptRequest(url);
                }
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !PAGE.equals(request.getUrl().toString().split("#", 2)[0]);
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (isDashboardPage()) view.evaluateJavascript("window.unaDashboardNative()", ignored -> {
                    dashboardReady = true;
                    importSharedFile();
                });
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                        FileChooserParams params) {
                if (fileChooser != null) fileChooser.onReceiveValue(null);
                fileChooser = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                boolean dailyJson = java.util.Arrays.stream(params.getAcceptTypes())
                        .anyMatch(type -> type.contains("json"));
                intent.setType(dailyJson ? "application/json" : "*/*");
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try { startActivityForResult(intent, FILE_REQUEST); }
                catch (Exception error) {
                    fileChooser.onReceiveValue(null);
                    fileChooser = null;
                    status.setText("File picker unavailable");
                }
                return true;
            }
        });
        layout.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(layout);
        WindowInsetsController bars = layout.getWindowInsetsController();
        if (bars != null) {
            bars.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
        webView.loadUrl(PAGE);
        receiveShare(getIntent());
        ensurePermission();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        receiveShare(intent);
    }

    @SuppressWarnings("deprecation")
    private void receiveShare(Intent intent) {
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return;
        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null || !"content".equals(uri.getScheme())) {
            status.setText("Please share a FIT file attachment");
            return;
        }
        sharedUri = uri;
        if (dashboardReady) importSharedFile();
    }

    private void importSharedFile() {
        if (sharedUri == null || !dashboardReady || !isDashboardPage()) return;
        Uri uri = sharedUri;
        sharedUri = null;
        status.setText("Reading shared FIT…");
        new Thread(() -> {
            try {
                String filename = "shared.fit";
                try (android.database.Cursor cursor = getContentResolver().query(uri,
                        new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) filename = cursor.getString(0);
                }
                if (filename == null || !filename.toLowerCase(java.util.Locale.ROOT).endsWith(".fit")) {
                    throw new IllegalArgumentException("The shared attachment is not a FIT file");
                }
                byte[] bytes;
                try (java.io.InputStream input = getContentResolver().openInputStream(uri);
                     ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (input == null) throw new IllegalStateException("Cannot read attachment");
                    byte[] buffer = new byte[16384];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (output.size() + count > 4 * 1024 * 1024) throw new IllegalArgumentException("FIT exceeds 4 MB");
                        output.write(buffer, 0, count);
                    }
                    bytes = output.toByteArray();
                }
                String name = filename;
                String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                runOnUiThread(() -> {
                    if (isDestroyed() || !isDashboardPage()) return;
                    webView.evaluateJavascript("window.unaDashboardShareStart(" + JSONObject.quote(name) + ")", null);
                    for (int offset = 0; offset < base64.length(); offset += 32768) {
                        webView.evaluateJavascript("window.unaDashboardImportChunk(" + JSONObject.quote(
                                base64.substring(offset, Math.min(offset + 32768, base64.length()))) + ")", null);
                    }
                    webView.evaluateJavascript("window.unaDashboardImportFinish()", null);
                    status.setText("Shared FIT received · checking integrity");
                });
            } catch (Exception error) {
                runOnUiThread(() -> { if (!isDestroyed()) status.setText("Share import failed: " + error.getMessage()); });
            }
        }, "shared-fit-import").start();
    }

    private boolean isDashboardPage() {
        String url = webView.getUrl();
        return url != null && PAGE.equals(url.split("#", 2)[0]);
    }

    private void handleExportMessage(String json) {
        try {
            if (json == null || json.length() > 2_000_000) throw new IllegalArgumentException("Export too large");
            JSONObject data = new JSONObject(json);
            switch (data.getString("type")) {
                case "health" -> {
                    if (android.os.Build.VERSION.SDK_INT < 34
                            || android.os.ext.SdkExtensions.getExtensionVersion(android.os.Build.VERSION_CODES.UPSIDE_DOWN_CAKE) < 7) {
                        healthStatus("Health Connect sharing requires Android 14 with Health Connect system updates");
                        data.put("success", false);
                        data.put("message", "Health Connect sharing requires Android 14 with Health Connect system updates");
                        webView.evaluateJavascript("window.unaHealthResult(" + data + ")", null);
                        return;
                    }
                    if (healthExporter == null) healthExporter = new HealthExporter(this, this::healthStatus,
                            result -> {
                                if (!isDestroyed() && isDashboardPage())
                                    webView.evaluateJavascript("window.unaHealthResult(" + result + ")", null);
                            });
                    healthExporter.offer(data);
                }
                case "start" -> {
                    String filename = data.getString("filename");
                    if (!filename.matches("(?i)[a-z0-9][a-z0-9_.-]{0,150}\\.fit")) {
                        throw new IllegalArgumentException("Invalid FIT filename");
                    }
                    exportFilename = filename;
                    exportBytes = new ByteArrayOutputStream();
                }
                case "chunk" -> {
                    if (exportBytes == null) throw new IllegalStateException("Export not started");
                    String chunk = data.getString("value");
                    if (chunk.length() > 32768 || exportBytes.size() + chunk.length() > 6_000_000) {
                        throw new IllegalArgumentException("Export exceeds size limit");
                    }
                    byte[] bytes = Base64.decode(chunk, Base64.DEFAULT);
                    exportBytes.write(bytes);
                }
                case "finish" -> {
                    if (exportBytes == null || exportBytes.size() == 0) {
                        throw new IllegalStateException("Export is empty");
                    }
                    pendingExport = exportBytes.toByteArray();
                    exportBytes = null;
                    Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    save.setType("application/octet-stream");
                    save.addCategory(Intent.CATEGORY_OPENABLE);
                    save.putExtra(Intent.EXTRA_TITLE, exportFilename);
                    startActivityForResult(save, EXPORT_REQUEST);
                }
                default -> throw new IllegalArgumentException("Unknown export message");
            }
        } catch (Exception error) {
            exportBytes = null;
            pendingExport = null;
            status.setText("FIT export failed: " + error.getMessage());
        }
    }

    private void watchMenu() {
        String[] actions = {"Choose bonded watch", "Connect", "Find activity FIT files",
                "Disconnect", "Cancel transfer", "Copy connection log", "Find daily heart-rate files"};
        new AlertDialog.Builder(this).setTitle("UNA Watch")
                .setItems(actions, (dialog, which) -> {
                    switch (which) {
                        case 0 -> chooseBondedWatch();
                        case 1 -> {
                            if (selected == null) status.setText("Choose a bonded watch first");
                            else if (ensurePermission()) probe.connect(selected);
                        }
                        case 2 -> probe.inspectActivities();
                        case 6 -> probe.inspectDailyHealth();
                        case 3 -> probe.disconnect();
                        case 4 -> probe.cancel();
                        case 5 -> {
                            getSystemService(ClipboardManager.class).setPrimaryClip(
                                    ClipData.newPlainText("UNA FIT Sync log", log.toString()));
                            status.setText("Connection log copied");
                        }
                        default -> { }
                    }
                }).show();
    }

    private void showFiles(List<FtsProbe.FitFile> files) {
        if (files.isEmpty()) {
            status.setText("No matching files on watch");
            return;
        }
        String[] names = files.stream().map(file ->
                file.path.split("/")[2] + " · " + file.name() + " · "
                        + Math.round(file.size / 1024.0) + " KB").toArray(String[]::new);
        boolean[] checked = new boolean[files.size()];
        new AlertDialog.Builder(this).setTitle(files.size() + " watch files")
                .setMultiChoiceItems(names, checked, (dialog, index, selected) -> checked[index] = selected)
                .setNegativeButton("Cancel", null)
                .setNeutralButton("Import all", (dialog, which) -> {
                    if (!isDashboardPage()) { status.setText("Dashboard not ready"); return; }
                    for (FtsProbe.FitFile file : files) probe.importFit(file);
                })
                .setPositiveButton("Import selected", (dialog, which) -> {
                    if (!isDashboardPage()) { status.setText("Dashboard not ready"); return; }
                    for (int i = 0; i < files.size(); i++) {
                        if (checked[i]) probe.importFit(files.get(i));
                    }
                }).show();
    }

    private boolean ensurePermission() {
        if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) return true;
        requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, CONNECT_REQUEST);
        return false;
    }

    private void chooseBondedWatch() {
        if (!ensurePermission()) return;
        if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) return;
        BluetoothManager manager = getSystemService(BluetoothManager.class);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            status.setText("Turn on Bluetooth in Android settings");
            return;
        }
        List<BluetoothDevice> devices = new ArrayList<>(adapter.getBondedDevices());
        devices.sort(Comparator.comparing(this::deviceName));
        if (devices.isEmpty()) { status.setText("Pair the watch in the UNA phone app first"); return; }
        String[] names = devices.stream().map(this::deviceName).toArray(String[]::new);
        new AlertDialog.Builder(this).setTitle("Bonded devices")
                .setItems(names, (dialog, index) -> {
                    selected = devices.get(index);
                    status.setText("Selected " + names[index]);
                }).show();
    }

    private String deviceName(BluetoothDevice device) {
        try { return String.valueOf(device.getName()); }
        catch (SecurityException denied) { return "Bluetooth permission revoked"; }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == EXPORT_REQUEST) {
            if (result == RESULT_OK && data != null && data.getData() != null && pendingExport != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData(), "w")) {
                    if (out == null) throw new IllegalStateException("Cannot open destination");
                    out.write(pendingExport);
                    status.setText("Saved " + exportFilename + " · ready to upload to Strava");
                    new AlertDialog.Builder(this).setMessage("FIT saved. Open Strava's free file upload page?")
                            .setNegativeButton("Later", null)
                            .setPositiveButton("Open Strava", (dialog, which) -> {
                                Intent browser = new Intent(Intent.ACTION_VIEW,
                                        Uri.parse("https://www.strava.com/upload/select"));
                                browser.addCategory(Intent.CATEGORY_BROWSABLE);
                                startActivity(browser);
                            }).show();
                } catch (Exception error) {
                    status.setText("FIT save failed: " + error.getMessage());
                }
            }
            pendingExport = null;
            exportFilename = null;
            return;
        }
        if (request != FILE_REQUEST || fileChooser == null) return;
        Uri[] chosen = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                chosen = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < chosen.length; i++) chosen[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) chosen = new Uri[]{data.getData()};
        }
        fileChooser.onReceiveValue(chosen);
        fileChooser = null;
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == HealthExporter.REQUEST && healthExporter != null
                && android.os.Build.VERSION.SDK_INT >= 34
                && android.os.ext.SdkExtensions.getExtensionVersion(android.os.Build.VERSION_CODES.UPSIDE_DOWN_CAKE) >= 7) {
            healthExporter.permissionResult();
            return;
        }
        if (code == CONNECT_REQUEST && (results.length == 0 || results[0] != PackageManager.PERMISSION_GRANTED)) {
            status.setText("Nearby devices permission is required");
        }
    }

    @Override protected void onDestroy() {
        if (fileChooser != null) fileChooser.onReceiveValue(null);
        probe.shutdown();
        webView.destroy();
        super.onDestroy();
    }
}
