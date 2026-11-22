# UNA Activity — Android activity dashboard

## Navigation

- **Library:** import files, filter recordings, and open one recording at a time.
- **Trends:** workout and sleep charts for the selected period.
- **Settings:** units, bulk Health Connect sharing, and optional auto-sharing.
- **Recording detail:** metrics, workout-type correction, export/share actions,
  and the local Health Connect sharing receipt.

## Daily heart-rate history

The watch already records `/DailyHealth/YYYYMM/dh_YYYYMMDD.json`. No extra
watch recorder is required. In **Settings → Daily heart rate**, set the time
zone the watch used for those dates, import these JSON files, then tap
**Sync daily heart rate**. History stays in a separate local database and does
not create workouts. Sync is manual; the FIT auto-sharing switch does not
enable daily-history sharing.

For Bluetooth imports, use **Watch → Connect → Find daily heart-rate files**
and import all or selected days, then sync in Settings. Transfers use the
existing size/CRC-32 verification. This path requires FTS v5; physical
Bluetooth daily-health transfer was verified by the user.

- Preserve the watch's minute summaries; zero/invalid/future values are omitted.
- Export the watch's valid daily `restingHeartRate` as a separate Health Connect
  resting-HR record. It is dated at the last recorded minute of that day; the
  source provides a daily summary rather than an exact measurement timestamp.
  Reimport older daily files once to backfill this field, then Sync.
- Preserve `averageHeartRate` locally. Health Connect has no separate writable
  daily-average or time-in-HR-zones record; apps can aggregate the exported
  readings. These files do not contain HRV/RMSSD or beat-to-beat intervals.
  Resting HR is not substituted for HRV, and Google-specific zone/trend displays
  remain controlled by Google Health.
- A day has 1440 local-clock buckets without a time-zone offset. Use the
  historical IANA time zone; ambiguous or missing DST minutes are omitted.
  Import travel dates separately with their correct time zone.
- Intervals covered by previously shared FIT recordings are excluded. Sync
  daily history again after sharing new FITs to reconcile those overlaps.
- Stable day IDs replace earlier daily exports instead of adding copies;
  unchanged exports are skipped. Reimporting a changed day updates it locally.
- If a previously exported day becomes fully covered by FIT intervals, its old
  daily HR record may need manual removal in Health Connect. Resting-HR summaries
  are independent of that overlap.
- Removing local data does not remove Health Connect copies.

## Health Connect / Google Fit / Google Health

The Health Connect panel can **share all unshared recordings** across the entire
library (not just the current filter). Optional auto-sharing sends future imports
and workout-type corrections after explicit opt-in. Exports run sequentially and
stop on failure/cancellation; unfinished records remain unshared for retry.
Per-record status is persisted only after a successful native export. Records
shared with an older build initially show “Not marked shared”; resending is safe.
Status is a local export receipt, not a live check for deletion in Health Connect.

Workout details include a type editor with walking, hiking, outdoor rowing and
indoor rowing options. Corrections persist across reimports and update dashboard
analytics. Sharing a correction updates the existing Health Connect session using
a higher client record version. The original FIT bytes, including their sport
classification for FIT/Strava exports, remain unchanged.

On Android 14+, open an imported sleep or workout recording and tap **Share to
Health Connect**. Confirm the export and grant the requested write permissions.
The app shares sleep sessions with recorded awake/light/deep stages, workout
sessions (unknown/multisport sessions use Other workout), recorded heart-rate
samples, and workout distance when available. GPS routes and calorie totals
are not exported in this version.

In Google Fit, enable **Profile → Settings → Sync Fit with Health Connect** and
allow it to read the relevant data. Export success means Health Connect accepted
the records; Google Fit controls when and how it displays them.
For Google Health (formerly Fitbit), enable Health Connect reading for heart rate,
**resting heart rate**, sleep and exercise. Weekly/monthly resting-HR trends were
confirmed working after the resting-HR backfill; Google Health may take time to
refresh. Data availability does not guarantee Google-specific scores or zones.

Each export is opt-in. UNA Activity does not read other apps' health data.
Manage permissions and remove shared records through Android's Health Connect
settings. Deleting a local FIT does not delete its shared copy.

Repeated imports of the same FIT bytes (even renamed or imported concurrently)
are rejected using SHA-256 identity in an IndexedDB transaction. Health Connect
records use stable client IDs derived from that identity, so repeating an export
does not create more records. Different FIT files representing the same event,
or records shared by another app, are not automatically treated as duplicates.

The HTML/CSS/JS dashboard in `../activity-dashboard` is built into the APK and
runs offline in a WebView. Native Android selects an **already-bonded** watch,
connects to the UNA File Transfer Service, lists completed FIT files from watch
apps under `Activity/YYYYMM/`, and imports selected files. Native code checks the
watch's FTS v5 CRC-32 digest and size before passing bytes to the local page;
the dashboard's FIT parser separately checks FIT integrity and stores accepted
recordings in on-device IndexedDB. No recording is deleted from the watch.
The user confirmed Bluetooth imports work. Long-transfer interruption and
simultaneous use with the official app are not comprehensively tested.

Android requests `BLUETOOTH_CONNECT` (Nearby devices) and only the Health Connect
write permissions needed for the selected export. No Internet, location, or
broad storage permission is requested. The Android document picker supports
manual FIT and DailyHealth JSON imports. Watch access is read-only.

### Import from the official UNA app

Keep official UNA for watch/account syncing. Open an activity, then choose
**⋮ → Download → UNA Activity**. The receiving app validates the original FIT
and deduplicates it by content. No cloud login is needed.

Workout details include **Save FIT for Strava**. This saves the original FIT
through Android's document picker and offers to open Strava's official upload
page in the browser. Strava's free website supports manual FIT upload without
a developer API subscription; the user selects the saved file and confirms
upload. There is no automatic Strava API connection or background sharing.

## Build

Install Node.js/npm, JDK 21 and Android SDK platform 37.0 (SDK package
`platforms;android-37.0`, not `platforms;android-37`). The Gradle wrapper downloads
Gradle 9.6 (with a pinned SHA-256) on first use. The Android Gradle plugin
selects its compatible build-tools package.
Run from this directory:

```sh
ANDROID_HOME=/path/to/android-sdk JAVA_HOME=/path/to/jdk \
  GRADLE_USER_HOME=/path/to/gradle-cache ./gradlew assembleDebug
```

The APK is `app/build/outputs/apk/debug/app-debug.apk`. Install it on the phone,
grant Nearby devices, open **Watch**, choose the bonded UNA watch, connect,
then find activity FIT files and select recordings to import. Use **Copy
connection log** for diagnostics (avoid sharing health data). The watch and
phone should not be running competing FTS clients during a transfer.

The watch kernel uses a single FTS service instance for the BLE link. Android
may allow two GATT clients on the same phone, but simultaneous FTS commands
from this app and the UNA app should be avoided until tested on hardware.

## Verification and project status

Run `npm test` in `../activity-dashboard`, then build the APK as above.
`./gradlew lintDebug` checks Android integration. Debug builds permit WebView
inspection; release builds do not enable it.

- [Handoff and verification history](HANDOFF.md)
- [Paused cloud-account research](UNA-CLOUD-RESEARCH.md)
- [HRV feasibility research — custom kernel work deferred](HRV-RESEARCH.md)

No custom watch kernel is part of this project. SleepVue remains a separately
maintained upstream app. Personal recordings, backups, phone automation logs,
downloaded vendor binaries, and APK/build artifacts are not committed.
