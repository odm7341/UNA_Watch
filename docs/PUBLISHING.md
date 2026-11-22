# Preparing a UNA watch app release

Source of truth: [UNA's current deployment instructions](https://www.developers.unawatch.com/latest/deploy.html) and [app manifest reference](https://www.developers.unawatch.com/latest/app-config-json.html). Recheck them before uploading; the portal and manifest schema can change.

## App inventory and gaps

Run `python3 Tools/watch-apps.py list` to read identity, display name and type **from CMake**, rather than maintaining duplicate app IDs here. `HikeMap`, `RunMap`, `MapManager` and `HRClock` have icon resources; `BatteryTracker` currently sets `APP_USE_ICONS Off` and has no icon resources. No store `app-manifest.json` or release previews are included here. Treat the hard-coded CMake `APP_ID` values as development IDs until their ownership is confirmed with the portal; **do not submit a build using an ID different from the portal-issued ID**.

## Closed-source portal flow

The official [apps.unawatch.com](https://apps.unawatch.com) portal instructions describe the closed-source route. This repository is public; decide how you want to license/distribute a specific app before choosing that route.

1. Create the app in the portal and copy its **portal-issued App ID** into that app's CMake `APP_ID`. Do not change the ID on later versions: the store uses it to recognize updates even if the filename changes.
2. Build with a deliberate version, e.g. `cmake -S HikeMap/Software/Apps/HikeMap-CMake -B HikeMap/Software/Apps/HikeMap-CMake/build -DBUILD_VERSION=1.0.0 && cmake --build HikeMap/Software/Apps/HikeMap-CMake/build`. Reconfigure after changing the ID; verify the ID reported by SDK `app_merging.py` in the build output. Verify the `.uapp` name and embedded version.
3. Make a strict JSON `app-manifest.json` for this **specific app**. Set `manifest_version` to `1`; match `id`, `binary`, `appVersion`, name, type, icon path and truthful supported features to the build. See the [official manifest example](https://www.developers.unawatch.com/latest/app-config-json.html) rather than copying activity metrics into a clockface or utility. `app-manifest.json` is phone/store metadata, not a file to install onto the watch.
4. Run `python3 "$UNA_SDK/Utilities/Scripts/app_packer/min_kernel_version.py" --stamp path/to/app-manifest.json` and then `--check` on the same file. `minKernelVersion` is the SDK ABI-derived minimum **kernel firmware** version; never guess or lower it. Raise it only when your app requires a later firmware fix.
5. Prepare a store `icon.png` and previews as requested by the current portal. The embedded 30×30 and 60×60 app icons alone are not a substitute for checking store image requirements; BatteryTracker needs store artwork before submission.
6. Create a ZIP with the built `.uapp`, `app-manifest.json`, `icon.png`, and any referenced previews/assets, preserving the manifest's relative paths. Inspect the ZIP contents and JSON before uploading. Do not include SDK source, build directories, private FIT files, or other watch data.
7. Install/test the same `.uapp` on a watch with the target firmware, record the exact SDK commit, firmware, version and App ID, then upload the ZIP in the portal's **Version → Upload New** flow. Use **Release → Confirm and Publish** only after checking the portal's preview and metadata.

Do not automate store publication or invent manifests before the portal IDs, target firmware, supported features, artwork, and versioning policy are settled.

## Open-source route

UNA also documents a [PR to `UNAWatch/una-sdk`](https://www.developers.unawatch.com/latest/deploy.html#via-pr-to-https-github-com-unawatch-una-sdk-for-open-source-apps) with app source under `Examples/Apps/`. Keep this repository's independent project as the development source and prepare the PR in an **external SDK fork/checkout**; do not vendor or reparent the upstream SDK here. Confirm upstream contribution requirements and licensing for each app before proposing it.
