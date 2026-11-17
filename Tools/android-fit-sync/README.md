# UNA FIT Sync — Android BLE probe

This is the first, native-BLE stage of the Android companion app. It selects an
**already-bonded** watch without scanning or re-pairing, connects to the UNA
File Transfer Service, and searches the SleepVue folder tree (at most five
levels below `/Apps/SleepVue`) for FIT and CSV filenames. It does **not**
download files or embed the dashboard yet. The purpose is to check native BLE
access on a Pixel 11 / Android 17. Coexistence with the UNA phone app remains
unverified.

Only the Android `BLUETOOTH_CONNECT` (Nearby devices) permission is requested.
No network, location, or storage permissions are needed. Diagnostics stay on
the device and are visible in the app. The watch filesystem is read-only.

## Build

Install JDK 21 and Android SDK platform 37.0. The Gradle wrapper downloads
Gradle 9.6 (with a pinned SHA-256) on first use. The Android Gradle plugin
selects its compatible build-tools package.
Run from this directory:

```sh
ANDROID_HOME=/path/to/android-sdk JAVA_HOME=/path/to/jdk \
  GRADLE_USER_HOME=/path/to/gradle-cache ./gradlew assembleDebug
```

The APK is `app/build/outputs/apk/debug/app-debug.apk`. Install it on the phone,
grant Nearby devices, choose the already-paired UNA watch, tap **Connect**, and
then **Inspect SleepVue folders**. The log records the exact GATT operation and
status if a step fails. Missing directories report the watch's error status
immediately instead of scanning every installed app.

This project is intentionally separate from the browser dashboard. A later
stage can add verified CSV downloads and a bundled, offline WebView dashboard
once the SleepVue CSV schema and transfer behavior are confirmed.

The watch kernel uses a single FTS service instance for the BLE link. Android
may allow two GATT clients on the same phone, but simultaneous FTS commands
from this app and the UNA app should be avoided until tested on hardware.
