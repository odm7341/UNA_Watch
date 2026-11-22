# UNA Watch apps and browser tools

This repository contains UNA Watch applications, shared libraries, and a GitHub Pages utility site for maps and activity data.

- [`HikeMap`](HikeMap/README.md) and [`RunMap`](RunMap/README.md) — activity apps with offline map faces.
- [`MapManager`](MapManager/README.md) — background pack verifier.
- [`MapKit`](MapKit/README.md) — shared offline-map reader used by the activity apps. Its upstream relationship is recorded in [`MapKit/UPSTREAM.md`](MapKit/UPSTREAM.md).
- [`Tools/activity-dashboard`](Tools/activity-dashboard/README.md) — the browser-local FIT activity and SleepVue sleep dashboard.
- [`Tools/android-fit-sync`](Tools/android-fit-sync/README.md) — UNA Activity for Android: offline recordings, Bluetooth imports, and opt-in Health Connect sharing.
- [`Tools/rawtiles-exporter`](Tools/rawtiles-exporter/README.md) — the browser tool that previews the watch style and exports `.vtiles` packs.

For the watch-app inventory, repeatable per-app build commands, SDK update procedure and store release checklist, see [watch app development](docs/DEVELOPMENT.md) and [publishing](docs/PUBLISHING.md).

## Hosted browser tools

The combined utility site is deployed from `main` with GitHub Actions:

- [UNA browser tools](https://odm7341.github.io/UNA_Watch/)
- [FIT activity dashboard](https://odm7341.github.io/UNA_Watch/activity-dashboard/)
- [Vector exporter](https://odm7341.github.io/UNA_Watch/rawtiles-exporter/)

The activity dashboard parses completed activity FIT files in the browser, stores them in local IndexedDB, and does not upload health or route data. It can import manually or read completed recordings from a watch with Web Bluetooth. It recognizes SleepVue sleep FIT files through their `sleep_stage` developer field. The tracked SleepLab app writes CSV/JSON rather than FIT; those files are not accepted by the dashboard.

## Complete guide: put a map on your own watch

HikeMap and RunMap draw offline vector geometry on the watch. Re-export existing raster maps: renaming a `.rawtiles` file cannot convert its pixels to geometry. Use the Map Manager from this checkout to verify the new packs.

### 1. What you need

- A UNA Watch with firmware compatible with the [UNA Watch SDK](https://github.com/UNAWatch/una-sdk), a data-capable USB cable, and permission to install your own `.uapp` files.
- Git, Python 3, CMake 3.21+, and `make`.
- The **ST** ARM GCC toolchain supplied by [STM32CubeCLT](https://www.st.com/en/development-tools/stm32cubeclt.html) or [STM32CubeIDE](https://www.st.com/en/development-tools/stm32cubeide.html). Do not substitute a distro `gcc-arm-none-eabi`; the SDK documents known incompatibilities.
- A modern browser with network access to preview/export map tiles.

Follow the official [SDK setup guide](https://developers.unawatch.com/latest/sdk-setup.html) for Linux or Windows. It covers the ST toolchain, the `UNA_SDK` environment variable, and Python packaging dependencies.

### 2. Clone this project and prepare the SDK

Keep the SDK outside this repository: it is intentionally ignored here.

```bash
git clone https://github.com/odm7341/UNA_Watch.git
cd UNA_Watch

git clone https://github.com/UNAWatch/una-sdk.git ../una-sdk
git -C ../una-sdk checkout apps-v1.3.0
export UNA_SDK="$(cd ../una-sdk && pwd)"
python3 -m pip install -r "$UNA_SDK/Utilities/Scripts/app_packer/requirements.txt"

arm-none-eabi-gcc --version
cmake --version
make --version
```

On Windows, use the SDK's PowerShell environment-export script instead of the POSIX `export` commands. The SDK setup guide has the exact Windows commands.

### 3. Build HikeMap and RunMap

From this repository's root:

```bash
export UNA_SDK=/absolute/path/to/una-sdk-at-apps-v1.3.0
cmake -S HikeMap/Software/Apps/HikeMap-CMake -B HikeMap/Software/Apps/HikeMap-CMake/build -DBUILD_VERSION=0.1.0
cmake --build HikeMap/Software/Apps/HikeMap-CMake/build
cmake -S RunMap/Software/Apps/RunMap-CMake -B RunMap/Software/Apps/RunMap-CMake/build -DBUILD_VERSION=0.1.0
cmake --build RunMap/Software/Apps/RunMap-CMake/build
```

The SDK packages `.uapp` files in the CMake build directories. Keep the printed output paths; `.uapp` files and build directories are deployment artifacts and deliberately ignored by Git.

### 4. Build the map verifier

The map apps will not render a pack until Map Manager marks its exact bytes as good. The [Map Manager](MapManager/README.md) source is included here.

Map Manager documents the `apps-v1.3.0` SDK requirement for its source. Build both apps with SDK revisions compatible with the same watch firmware/kernel ABI; do not mix a package built for one firmware line with another.

```bash
cmake -G "Unix Makefiles" \
  -S MapManager/Software/Apps/MapManager-CMake \
  -B MapManager/Software/Apps/MapManager-CMake/build \
  -DBUILD_VERSION=0.1.0
cmake --build MapManager/Software/Apps/MapManager-CMake/build
```

Its build produces `Map_Manager_*.uapp` in that build directory or `MapManager/Output/`. Map Manager runs automatically after boot, calculates the trailing CRC-32 of each pack, and writes a sibling `.trust` marker. Do **not** create or copy a `.trust` file yourself; it is valid only for the exact `(size, CRC)` pair it describes.

### 5. Create a small first map pack

Open the [vector exporter](https://odm7341.github.io/UNA_Watch/rawtiles-exporter/).

1. Move to a place you know. Click **Draw polygon**, tap its corners and choose **Finish polygon**, or click **Use current view**.
2. For a fast first test select a small area covering one or a few geometry tiles.
3. Leave the desired layers enabled and click **Download .vtiles**.
4. Keep the downloaded `una-topo.vtiles` file. One geometry grid serves all watch display scales (z14–17); packs are limited to 1,024 tiles of up to 16 KiB each.

See the [vector exporter guide](Tools/rawtiles-exporter/README.md) for selection, layer, attribution, and hosting details.

### 6. Copy both apps and the pack to the watch

Connect the watch by USB and wait for its mass-storage volume to appear. Replace `WATCH` below with that mounted volume's path.

```bash
WATCH=/media/$USER/UNA_WATCH          # example Linux mount path; use your actual volume
mkdir -p "$WATCH/Apps/HikeMap" "$WATCH/Apps/RunMap" "$WATCH/Apps/MapManager" "$WATCH/Apps/SharedData/maps"

cp HikeMap/Software/Apps/HikeMap-CMake/build/Hike_Map_*.uapp "$WATCH/Apps/HikeMap/"
cp RunMap/Software/Apps/RunMap-CMake/build/Run_Map_*.uapp "$WATCH/Apps/RunMap/"
cp MapManager/Software/Apps/MapManager-CMake/build/Map_Manager_*.uapp "$WATCH/Apps/MapManager/"
cp ~/Downloads/una-topo.vtiles "$WATCH/Apps/SharedData/maps/"
```

Use the actual package locations printed by your builds if they differ. The USB path is `Apps/SharedData/maps/` (a sibling of the app directories); the current apps only scan `*.vtiles` there. Safely eject the watch volume, unplug the cable, and power-cycle the watch. The SDK's [USB deployment guide](https://developers.unawatch.com/latest/deploy.html) requires safe ejection and a restart so the app scan runs.

USB stops running apps. Map Manager starts again after the cable is removed, so it cannot verify a pack while the volume is mounted. Leave the watch unplugged until verification completes.

### 7. Verify and use the map

1. Open **Map Manager** when its Utility-app slot is available. Its row for the pack must reach **Good**. If the Utility menu is full, the service still autostarts; its upstream README explains how to inspect `Debug/mapmanager_verify.log` over a later USB session.
2. Start a hike or run in **Hike Map** or **Run Map**, then use L1/L2 to scroll to the map face. The app selects a pack covering the current GPS position. It does not draw unverified packs.

For subsequent maps, repeat only steps 5–7. Copy every new or replaced pack to `SharedData/maps/`, safely disconnect, and wait for a fresh good verdict before using it.

## Troubleshooting

| Symptom | Cause and correction |
| --- | --- |
| The vector exporter opens blank or scripts fail after double-clicking the file | Serve the repository over HTTP(S), then use the `/Tools/rawtiles-exporter/` URL. |
| CMake cannot find SDK files | `UNA_SDK` must point to the SDK checkout in the shell that runs CMake. |
| Link failures mentioning newlib/syscalls | The wrong ARM compiler is first on `PATH`; use the ST toolchain from CubeIDE/CubeCLT. |
| The activity map face has no basemap | Confirm the file ends in `.vtiles`, covers the current GPS fix, is directly in `SharedData/maps/`, and Map Manager reported **Good** after the watch was unplugged. |
| A pack reports bad/corrupt | Copy the original downloaded pack again, safely eject, and let Map Manager rescan it. Do not reuse a `.trust` marker after replacing a pack. |
| Map Manager is not visible in the Utility menu | The launcher may have limited Utility slots. Its autostart verifier still runs; inspect its log after reconnecting the watch if needed. |

## License and provenance

The repository's original source and documentation are available under the [MIT License](LICENSE). It retains the copyright notices required for the MapKit code derived from [Toby Murray's watch-apps](https://github.com/tobymurray/watch-apps) and the UNA Watch SDK examples. The [third-party notices](THIRD_PARTY_NOTICES.md) identify separately licensed Poppins fonts and TouchGFX-generated integration; neither is relicensed under MIT.

The vector exporter uses public vector-tile services. Exported packs retain attribution, but their data remains subject to the providers' terms and [OpenStreetMap attribution](https://www.openstreetmap.org/copyright).
