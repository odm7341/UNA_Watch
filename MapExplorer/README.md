# MapExplorer

MapExplorer is a UNA Watch utility application for browsing offline `.rawtiles` topographic packs on the watch. It is a pack browser rather than a recorder: it opens an installed pack, renders it through the shared [`MapKit`](../MapKit/README.md) layer, and lets the wearer pan, zoom, and choose another pack.

For the complete clone-to-watch procedure—including the SDK toolchain, Map Manager verifier, USB paths, and recovery steps—start with the [root watch guide](../README.md#complete-guide-put-a-map-on-your-own-watch). This README focuses on this application’s build, install, and controls.

## What MapExplorer needs on the watch

MapExplorer needs all three of these before it can draw a map:

1. A MapExplorer `.uapp` installed at `Apps/MapExplorer/` on the watch USB volume.
2. One or more `.rawtiles` files directly in `SharedData/maps/`.
3. A **Good** verdict for each pack from upstream [Map Manager](https://github.com/tobymurray/watch-apps/tree/c752601/MapManager). MapExplorer checks Map Manager's marker for the pack's exact size and declared CRC; it intentionally does not render an unverified or corrupt pack.

Create packs with the [rawtiles exporter](../Tools/rawtiles-exporter/README.md). Do not manually create `<pack>.rawtiles.trust`: Map Manager owns it and regenerates it after the watch is unplugged.

## Build from a fresh checkout

### Requirements

- A UNA Watch, a data USB cable, and a watch firmware line compatible with the [UNA Watch SDK](https://github.com/UNAWatch/una-sdk).
- Git, Python 3, CMake 3.21+, and `make`.
- The **ST** ARM GCC toolchain from [STM32CubeCLT](https://www.st.com/en/development-tools/stm32cubeclt.html) or [STM32CubeIDE](https://www.st.com/en/development-tools/stm32cubeide.html), not a distro `gcc-arm-none-eabi`.
- An SDK checkout outside this repository, configured as described in the official [SDK setup guide](https://developers.unawatch.com/latest/sdk-setup.html).

Set the environment in the terminal that will build the app:

```bash
export UNA_SDK=/absolute/path/to/una-sdk
python3 -m pip install -r "$UNA_SDK/Utilities/Scripts/app_packer/requirements.txt"
arm-none-eabi-gcc --version
```

Then configure and build from the repository root:

```bash
cmake -G "Unix Makefiles" \
  -S MapExplorer/Software/Apps/MapExplorer-CMake \
  -B MapExplorer/Software/Apps/MapExplorer-CMake/build
cmake --build MapExplorer/Software/Apps/MapExplorer-CMake/build
```

The package is written as `MapExplorer_*.uapp` under `Output/`. Build output, packaged apps, objects, and dependency files are ignored by Git; only source and generated TouchGFX input belong in commits.

## Install on the watch

1. Build [Map Manager](https://github.com/tobymurray/watch-apps/tree/c752601/MapManager) with the SDK revision it documents. It autostarts and verifies packs in the shared maps directory.
2. Connect the watch by USB and wait for its mass-storage volume. Apps stop while the cable is connected.
3. Create these directories if absent:

   ```text
   Apps/MapExplorer/
   Apps/MapManager/
   SharedData/maps/
   ```

4. Copy this project's `MapExplorer_*.uapp` into `Apps/MapExplorer/`, the verifier's `MapManager_*.uapp` into `Apps/MapManager/`, and the downloaded packs into `SharedData/maps/`.
5. Safely eject the volume, unplug the watch, and power-cycle it. The [UNA SDK deployment guide](https://developers.unawatch.com/latest/deploy.html) requires this for the watch to rescan installed apps.
6. Leave the watch unplugged until Map Manager reports the new pack **Good**. The verifier cannot scan while USB mass storage is active.

A valid pack must be rawtiles v1 with 256 px `ABGR2222` tiles, Web Mercator, and XYZ/Quadtree addressing. MapKit rejects incompatible headers before rendering; the rawtiles exporter generates the required format.

## Watch controls

MapExplorer opens an installed pack at the pack's geographic center. The active operation appears in the bottom overlay.

| Button | Action |
| --- | --- |
| L1 | Previous operation: pan north/south, pan east/west, zoom, or choose pack |
| L2 | Next operation |
| R1 | Negative adjustment for the active operation |
| R2 | Positive adjustment for the active operation |
| R2 twice consecutively | Exit to the watch launcher |

In **PAN N/S** and **PAN E/W** modes, R1/R2 move the viewport. In **ZOOM** mode, they cycle through zoom levels present in the pack. In **PACK** mode, they switch among installed non-corrupt packs. MapExplorer opens the first available pack even without a GPS fix, which makes it usable as a manual map browser.

## If the map does not appear

- Check that the pack filename ends in `.rawtiles` and sits directly in `SharedData/maps/`, not in an app-specific directory or nested folder.
- Open Map Manager and wait for its **Good** state. A new copy or a changed file invalidates any old trust marker by design.
- If Map Manager says corrupt, re-copy the original exported pack, safely eject, disconnect USB, and let it rescan. Do not copy a marker from another file.
- If Map Manager is not visible in the Utility menu, its autostart service can still verify packs; inspect its upstream-documented `Debug/mapmanager_verify.log` after a later USB connection.
- If the app does not appear after copying the `.uapp`, confirm the SDK/firmware compatibility, safely eject, disconnect, and power-cycle the watch.

## Layout and dependencies

- `Software/Apps/MapExplorer-CMake/` — CMake entry point and package metadata.
- `Software/Apps/TouchGFX-GUI/` — MapExplorer's UI assets and generated sources required for the build.
- `Software/Libs/` — the small application service.
- `Resources/` — application icons.
- `Output/` and `build-app/` — ignored build/deployment outputs.

The shared [`MapKit`](../MapKit/README.md) directory is a sibling dependency, not a copied application library. It reads the [rawtiles format](https://github.com/tobymurray/rawtiles), selects packs, and draws the viewport. Its upstream baseline and local browser-specific changes are recorded in [`MapKit/UPSTREAM.md`](../MapKit/UPSTREAM.md).

## License and ownership

The repository's original code is MIT-licensed; see the root [LICENSE](../LICENSE). Poppins font files retain their [SIL Open Font License 1.1](Software/Apps/TouchGFX-GUI/assets/fonts/OFL.txt), and TouchGFX-generated integration remains subject to STMicroelectronics' [SLA0048](https://www.st.com/resource/en/license_agreement/dm00107782.pdf). Full provenance and scope are in the root [third-party notices](../THIRD_PARTY_NOTICES.md).
