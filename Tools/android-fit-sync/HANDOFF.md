# SleepVue sync handoff

## State of the work

- The browser dashboard is in `Tools/activity-dashboard`. It imports completed
  FIT files and its SleepVue FIT behavior is tested with **synthetic** fixtures;
  no real SleepVue FIT file has been validated. Browser Bluetooth diagnostics
  and sequential GATT setup are part of this branch.
- `Tools/android-fit-sync` is a **native BLE diagnostic app**, not a finished
  sync client or WebView wrapper. It requests only `BLUETOOTH_CONNECT`, selects
  an already-bonded watch, connects to UNA FTS, and lists filenames and folder
  names below `/Apps/SleepVue` (depth and directory-count limited). It never
  downloads file contents. The connection log can be copied from the app.
- On a Pixel 11 running Android 17, the app connected to an already-bonded
  UNA Watch, negotiated MTU 220, enabled notifications, read FTS version 5,
  and successfully listed directories. This is a successful connection and
  listing test, **not** a verified long-running sync test. Whether the UNA
  phone app was simultaneously active was not confirmed.
- The real watch reported `/Apps/SleepVue/Activity/202609`, `202610`, and
  `202611` as empty, but reported **51 CSV files directly under
  `/Apps/SleepVue`**. There were also 46 other files in that directory.
  No SleepVue FIT files were found by the probe. The CSV filenames, headers,
  and contents have not yet been inspected; do not assume the format matches
  the separately tracked SleepLab app.

## Build and run elsewhere

Install JDK 21 and Android SDK platform 37.0; the checked-in Gradle 9.6
wrapper downloads into `GRADLE_USER_HOME`. Run:

```sh
cd Tools/android-fit-sync
ANDROID_HOME=/path/to/android-sdk JAVA_HOME=/path/to/jdk \
  GRADLE_USER_HOME=/path/to/gradle-cache ./gradlew assembleDebug
```

Install `app/build/outputs/apk/debug/app-debug.apk` on the Pixel (or use
`adb install -r ...`). Grant Nearby devices, choose the already-bonded UNA
Watch, connect, and tap **Inspect SleepVue folders**. The app lists CSV and
FIT paths but does not read those files. The locally built debug APK and SDK
downloads are **not committed**. This server's tooling is under
`/mnt/repos/android-tooling`; that path is not required on another machine.

To inspect over USB on another computer, mount the watch drive and examine
`/Apps/SleepVue/` read-only. Start with **filenames and a representative CSV
header**, preferably with any health rows redacted. Do not add personal FIT,
CSV, or JSON files to the repository. Check whether CSVs are per-night
summaries, raw samples, or both before designing the import model.

## Protocol findings and cautions

- UNA FTS wire format: `una-sdk/Docs/BLE-File-Transfer-Service.md`. The public
  kernel implementation is at
  <https://github.com/UNAWatch/una-kernel-public/blob/main/Software/Libs/Source/Components/External/BLE/Services/FileTransferService.cpp>.
- The watch's `LISTDIR` error is a **two-byte notification with command
  `0x50` and status**, whereas normal directory entries use `0x51`. The
  Android probe handles this; the browser `FTSClient._handleList` still
  ignores the `0x50` error and waits for its 15-second timeout.
- FTS on the watch has service-global directory/read state and a single
  notification-enabled flag. Android can have more than one GATT client on
  a physical link, but concurrent FTS commands from two apps may interfere.
  Test alongside the UNA phone app without assuming simultaneous FTS use
  is safe. The native app currently serializes its own GATT operations.
- The browser debug server has a **development-only** diagnostic endpoint
  in `Tools/activity-dashboard/vite.config.js`; the production Vite build
  does not send logs. It was used for LAN testing, not for health data upload.

## Suggested next steps

1. Inspect one or two SleepVue CSV schemas on the USB-connected machine,
   then decide whether the dashboard should parse CSV directly or whether
   FIT is also produced by another version/configuration of SleepVue.
2. Add native READ and v5 DIGEST/CRC-32 verification, explicit selection,
   progress, cancellation, and local storage for the actual file type.
   Cover missing-file and interrupted-transfer behavior with tests.
3. Bundle the dashboard with `WebViewAssetLoader` and bridge only narrow,
   origin-checked operations; import verified bytes into the existing local
   library. WebView does not provide Web Bluetooth automatically.
4. Exercise repeat connect/disconnect, long transfers, and coexistence with
   the UNA app on real hardware. Avoid committing any personal recordings.

The existing Android app is intentionally a small, offline, read-only probe
until the actual SleepVue CSV format is known.
