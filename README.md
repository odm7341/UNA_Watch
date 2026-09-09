# UNA Watch map projects

This repository builds an offline map browser for a UNA Watch and supplies the browser tool that creates its map packs.

- [`MapExplorer`](MapExplorer/README.md) — the watch utility that opens, pans, zooms, and switches offline maps.
- [`Tools/rawtiles-exporter`](Tools/rawtiles-exporter/README.md) — the static browser page that previews the watch style and exports `.rawtiles` packs.
- [`MapKit`](MapKit/README.md) — the shared offline-map reader used by MapExplorer. Its upstream relationship is recorded in [`MapKit/UPSTREAM.md`](MapKit/UPSTREAM.md).

## Complete guide: put a map on your own watch

This sequence starts with a clean development machine and ends with a trusted map visible in MapExplorer. It uses the supported UNA Watch USB mass-storage deployment flow and does not require modifying watch firmware.

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
export UNA_SDK="$(cd ../una-sdk && pwd)"
python3 -m pip install -r "$UNA_SDK/Utilities/Scripts/app_packer/requirements.txt"

arm-none-eabi-gcc --version
cmake --version
make --version
```

On Windows, use the SDK's PowerShell environment-export script instead of the POSIX `export` commands. The SDK setup guide has the exact Windows commands.

### 3. Build MapExplorer

From this repository's root:

```bash
cmake -G "Unix Makefiles" \
  -S MapExplorer/Software/Apps/MapExplorer-CMake \
  -B MapExplorer/Software/Apps/MapExplorer-CMake/build
cmake --build MapExplorer/Software/Apps/MapExplorer-CMake/build
```

The SDK packages a `MapExplorer_*.uapp` under `MapExplorer/Output/`. Keep the printed output path; `.uapp` files and build directories are deployment artifacts and deliberately ignored by Git.

### 4. Build the map verifier

MapExplorer will not render a pack until a verifier has marked its exact bytes as good. The verifier is [Map Manager](https://github.com/tobymurray/watch-apps/tree/c752601/MapManager), maintained upstream rather than copied into this repository.

Map Manager documents the `apps-v1.3.0` SDK requirement for its source. Build both apps with SDK revisions compatible with the same watch firmware/kernel ABI; do not mix a package built for one firmware line with another.

```bash
git clone https://github.com/tobymurray/watch-apps.git ../watch-apps
git -C ../watch-apps checkout c752601

# Point UNA_SDK at the SDK revision required by Map Manager's README.
export UNA_SDK=/absolute/path/to/una-sdk
cmake -G "Unix Makefiles" \
  -S ../watch-apps/MapManager/Software/Apps/MapManager-CMake \
  -B ../watch-apps/MapManager/Software/Apps/MapManager-CMake/build \
  -DBUILD_VERSION=0.1.0
cmake --build ../watch-apps/MapManager/Software/Apps/MapManager-CMake/build
```

Its build produces `MapManager_*.uapp` in that build directory or `MapManager/Output/`. Map Manager runs automatically after boot, calculates the trailing CRC-32 of each pack, and writes a sibling `.trust` marker. Do **not** create or copy a `.trust` file yourself; it is valid only for the exact `(size, CRC)` pair it describes.

### 5. Create a small first map pack

Serve this repository over HTTP, then open the rawtiles exporter. Do not open `index.html` with `file://`.

```bash
python3 -m http.server 8000
# Open http://localhost:8000/Tools/rawtiles-exporter/
```

1. Move the map to a place you know and click **Use current view**.
2. For a fast first test choose zoom `8` to `8`; the current view should estimate one or a few tiles.
3. Leave the desired layers enabled and click **Download rawtiles**.
4. Keep the downloaded `una-topo-z8-8.rawtiles` file. Larger regions and higher zooms work, but the page refuses exports above 1,024 tiles and uses roughly 64 KiB per tile.

See the [rawtiles exporter guide](Tools/rawtiles-exporter/README.md) for selection, layer, attribution, and hosting details.

### 6. Copy both apps and the pack to the watch

Connect the watch by USB and wait for its mass-storage volume to appear. Replace `WATCH` below with that mounted volume's path.

```bash
WATCH=/media/$USER/UNA_WATCH          # example Linux mount path; use your actual volume
mkdir -p "$WATCH/Apps/MapExplorer" "$WATCH/Apps/MapManager" "$WATCH/SharedData/maps"

cp MapExplorer/Output/MapExplorer_*.uapp "$WATCH/Apps/MapExplorer/"
cp ../watch-apps/MapManager/Output/MapManager_*.uapp "$WATCH/Apps/MapManager/"
cp ~/Downloads/una-topo-z8-8.rawtiles "$WATCH/SharedData/maps/"
```

Use the actual package locations printed by your builds if they differ. The exact shared map directory is `SharedData/maps/`; MapExplorer only scans `*.rawtiles` there. Safely eject the watch volume, unplug the cable, and power-cycle the watch. The SDK's [USB deployment guide](https://developers.unawatch.com/latest/deploy.html) requires safe ejection and a restart so the app scan runs.

USB stops running apps. Map Manager starts again after the cable is removed, so it cannot verify a pack while the volume is mounted. Leave the watch unplugged until verification completes.

### 7. Verify and use the map

1. Open **Map Manager** when its Utility-app slot is available. Its row for the pack must reach **Good**. If the Utility menu is full, the service still autostarts; its upstream README explains how to inspect `Debug/mapmanager_verify.log` over a later USB session.
2. Open **Map Explorer**. It opens an installed pack centered on the pack's bounding box. If it has not been verified, MapExplorer deliberately does not draw it yet.
3. Use L1/L2 to choose an operation, R1/R2 to adjust it, and press R2 twice consecutively to exit. In pack mode, R1/R2 switch between installed packs.

For subsequent maps, repeat only steps 5–7. Copy every new or replaced pack to `SharedData/maps/`, safely disconnect, and wait for a fresh good verdict before using it.

## Troubleshooting

| Symptom | Cause and correction |
| --- | --- |
| The rawtiles exporter opens blank or scripts fail after double-clicking the file | Serve the repository over HTTP(S), then use the `/Tools/rawtiles-exporter/` URL. |
| CMake cannot find SDK files | `UNA_SDK` must point to the SDK checkout in the shell that runs CMake. |
| Link failures mentioning newlib/syscalls | The wrong ARM compiler is first on `PATH`; use the ST toolchain from CubeIDE/CubeCLT. |
| MapExplorer has no map | Confirm the file ends in `.rawtiles`, is directly in `SharedData/maps/`, and Map Manager reported **Good** after the watch was unplugged. |
| A pack reports bad/corrupt | Copy the original downloaded pack again, safely eject, and let Map Manager rescan it. Do not reuse a `.trust` marker after replacing a pack. |
| Map Manager is not visible in the Utility menu | The launcher may have limited Utility slots. Its autostart verifier still runs; inspect its log after reconnecting the watch if needed. |

## License and provenance

The repository's original source and documentation are available under the [MIT License](LICENSE). It retains the copyright notices required for the MapKit code derived from [Toby Murray's watch-apps](https://github.com/tobymurray/watch-apps) and the UNA Watch SDK examples. The [third-party notices](THIRD_PARTY_NOTICES.md) identify separately licensed Poppins fonts and TouchGFX-generated integration; neither is relicensed under MIT.

The rawtiles exporter uses browser-loaded MapLibre and public vector-tile services. Exported packs retain attribution, but their data remains subject to the providers' terms and [OpenStreetMap attribution](https://www.openstreetmap.org/copyright).
