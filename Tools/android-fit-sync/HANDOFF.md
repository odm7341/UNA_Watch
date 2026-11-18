# UNA Activity handoff

Updated: 2026-11-18.

## Current state

UNA Activity is an offline Android dashboard, not the earlier filename-only
SleepVue probe. It bundles `Tools/activity-dashboard` in an origin-restricted
WebView and imports original FIT files through Android sharing, the document
picker, or native Bluetooth FTS v5.

- **Library / Trends / Settings**, with a dedicated recording-detail screen,
  adaptive icon, and system-bar/cutout-safe native layout.
- Read-only watch discovery across `/Apps/<app>/Activity/YYYYMM/`.
  Downloads are serialized, size/CRC-32 checked against the watch digest,
  then independently checked for FIT integrity.
- Exact-byte SHA-256 deduplication, including concurrent and renamed imports.
  Original FIT bytes remain available for saving/manual Strava upload.
- Persistent workout-type corrections, including outdoor and indoor rowing.
  Corrections affect dashboard/Health Connect, not original FIT exports.
- Opt-in Health Connect sharing: sleep sessions and recorded stages, exercise
  sessions, heart-rate samples, and distance. Bulk sharing spans the entire
  library. Optional auto-sharing applies to future FIT imports/corrections.
- Stable client IDs, increasing correction versions, persisted success receipts,
  and sequential export queues. A stale acknowledgment cannot mark a newer
  correction fully shared.
- Separate DailyHealth storage/import and manual sync for minute heart-rate
  summaries and daily resting HR. No additional watch recorder is required.
  Bluetooth discovery uses `/DailyHealth/YYYYMM/dh_YYYYMMDD.json`.

## Verified on the phone/watch

During the November 18 session:

- Official UNA **Activity → ⋮ → Download → UNA Activity** imported real FITs,
  preserving SleepVue stage data. A temporary UI-automation script accelerated
  imports; a full-history inventory found one skipped recording, which was
  imported before the final reconciliation.
- All **59 official activities** were present locally: **47 sleep, 12 workouts**.
  All received successful Health Connect export acknowledgments. One hiking
  recording was corrected to outdoor rowing and its higher version exported.
- **69 daily-health files** were imported and shared. **68,057 minute samples**
  were exported after excluding **24,271** overlapping samples from shared FIT
  intervals; **60** ambiguous fall-back DST minutes were omitted.
- All **69 resting-HR summaries** were subsequently backfilled and shared.
- A repeat daily sync exported zero unchanged days.
- Google Fit displayed imported sleep. The user confirmed Google Health's
  resting-HR trends worked after the backfill/refresh.
- The user confirmed Bluetooth importing works, including daily HR.
  Long-transfer interruption/recovery and concurrent FTS clients remain
  incompletely tested.
- The dashboard suite has **21 passing tests**, using synthetic fixtures and
  fake IndexedDB; debug APK builds succeeded and were installed.
- Final repository checks passed: production dashboard build, Android
  `assembleDebug lintDebug` (non-blocking lint warnings remain), Python probe
  syntax validation, and whitespace checks. Vite was updated to 8.3.8; npm's
  audit reported zero vulnerabilities.

Counts are a point-in-time verification record, not app limits or bundled data.
No personal FIT/CSV/JSON, screenshots, credentials, or account identifiers
belong in the repository.

## SleepVue maintenance

SleepVue **0.10.1** was built from `cnakamoto/una-sleep-vue` commit
`5924417dba3eec32c56502d1e8d8da5383c3c1dd`, with UNA SDK commit
`bde35b84221e6de9ef12d32e5b40e31413ee11e1`; **82 upstream host tests passed**.
The previous package was backed up, the replacement verified by SHA-256, and
all **98 non-package files** preserved. The drive was safely ejected after that
installation. Firmware/app activation after a watch power-cycle was not
independently verified in this session.

SleepVue remains external upstream software. Its probe CSVs are not FITs and
are not imported by the dashboard. Preserve recordings/configuration and avoid
a competing overnight recorder.

## Build and checks

Prerequisites: Node 22+, JDK 21, Android SDK `platforms;android-37.0`.
The executable Gradle wrapper pins Gradle 9.6 and its checksum.

```sh
cd Tools/activity-dashboard
npm ci
npm test
npm run build
cd ../android-fit-sync
ANDROID_HOME=/path/to/android-sdk JAVA_HOME=/path/to/jdk21 \
  ./gradlew assembleDebug lintDebug --console=plain
```

The APK is `app/build/outputs/apk/debug/app-debug.apk`.
Install updates with `adb install -r` to preserve local databases.
Debug-only WebView inspection is enabled; production pages cannot navigate to
remote content or invoke the narrow native bridge from another origin.

## Data and protocol caveats

- Health Connect receipts report successful exports, not a live readback.
  Removing data in Health Connect does not clear local receipts.
- Deleting a local activity does not delete its Health Connect records.
- Different FIT binaries representing the same event are not semantically
  deduplicated; exports from other apps can also overlap.
- Daily files contain local clock minutes without offsets. Choose the history's
  IANA time zone; reimport travel dates separately. Omit missing/invalid/future
  readings and ambiguous/nonexistent DST minutes.
- Re-sync daily history after sharing new FITs to reconcile overlap. Native
  exports upsert present record types; removing a previously exported metric
  entirely may require manually deleting its old Health Connect record.
- Raw daily averages are retained locally; no fabricated HRV or Google-specific
  time-in-zone/cardio-load records are exported. Routes/calories are not shared.
- The watch FTS service has shared state: avoid simultaneous transfers from
  official UNA and UNA Activity. Browser `FTSClient` still waits for timeout on
  a two-byte `0x50` LISTDIR error; native Android handles that error.
- The browser development server's diagnostic endpoint exists only during
  local development; production assets do not upload logs.

## Deferred work

- **Cloud login/API:** paused after unsuccessful account identification.
  `cloud_probe.py` is reference-only, not an Android feature. See
  [cloud research](UNA-CLOUD-RESEARCH.md); do not resume SMS experiments unless
  requested.
- **HRV:** kernel-source investigation found the bundled PixArt HRV algorithm
  and a 25 Hz optical profile. It requires firmware integration and validation,
  not merely a watch app. **The user deferred custom-kernel work.** No kernel
  was built/flashed and no HRV app installed. See [HRV research](HRV-RESEARCH.md).
- Broader BLE recovery/coexistence tests and optional automatic daily syncing
  are future work; current daily sync is manual.

Backups, installed APKs, upstream checkouts, vendor research downloads, and
session-specific phone scripts remain outside the repository.
