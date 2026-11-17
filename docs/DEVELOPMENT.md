# Watch app development

## What lives where

| Path | Ownership |
| --- | --- |
| `BatteryTracker/`, `HRClock/`, `MapExplorer/` | Independent UNA watch projects; CMake, service/GUI, resources and app-specific README stay together. |
| `MapKit/` | Shared code used by MapExplorer; upstream provenance is in `MapKit/UPSTREAM.md`. |
| `Tools/` | Browser tools and the watch-app build helper. Browser tools are **not** watch-store apps. |
| `una-sdk/` or `../una-sdk/` | External, ignored UNA SDK checkout, selected with `UNA_SDK`. Never copy its contents into this repository. |
| `*/Output/`, `*/build/` | Generated binaries and build trees, not source or store releases. |

This layout follows the SDK's `Software/Apps/<Name>-CMake` convention. Moving or renaming a project changes TouchGFX and CMake relative paths, so do it only as a dedicated, build-tested migration.

## Build one app

Use the [UNA SDK setup guide](https://www.developers.unawatch.com/latest/sdk-setup.html) to install the required ST ARM toolchain and Python packages. Select an SDK checkout explicitly:

```bash
git clone https://github.com/UNAWatch/una-sdk.git ../una-sdk
git -C ../una-sdk checkout b9869927e8688db001ec544dffde9c729ffa06c1
export UNA_SDK="$(realpath ../una-sdk)"
python3 Tools/watch-apps.py list
python3 Tools/watch-apps.py doctor
bash MapExplorer/build.sh
```

Use `bash BatteryTracker/build.sh`, `bash HRClock/build.sh`, or `bash MapExplorer/build.sh`. Each script pins a full SDK commit and refuses a different SDK checkout; it never changes the checkout automatically. Set `UNA_SDK` to the desired checkout (if unset, the helper looks for `../una-sdk` and then the ignored `./una-sdk`). To switch revisions intentionally, update the script's pinned SHA after testing the app against the new SDK.

The helper uses each app's ignored `Software/Apps/<Name>-CMake/build/pinned/` for CMake state, so stale absolute paths in older build caches are not reused. The SDK still writes ELF/map/package outputs under that app's existing `build/` and `Output/`; older artifacts **may be replaced**. `bash MapExplorer/build.sh --version 1.2.3` passes `BUILD_VERSION` to CMake for a deliberate release build. The existing CMake project remains the source of truth for `APP_ID`, name, type and resources. The scripts do **not** generate a manifest or publish anything.

## Updating the SDK safely

The current scripts pin `b9869927e8688db001ec544dffde9c729ffa06c1`, the revision used for successful local cross-builds of all three apps. The helper also refuses tracked changes in that SDK checkout. This is a build baseline, **not** proof that all three apps work on a watch or that arbitrary SDK `main` revisions are compatible. The local `una-sdk/` checkout is ignored; it may differ from the sibling checkout described above. `doctor` shows the exact one selected for this shell. Do not mix SDK builds with a different watch firmware/kernel ABI.

1. Before updating, record `git -C "$UNA_SDK" rev-parse HEAD`, the watch firmware version and working app build results in the change/release notes.
2. Read the upstream SDK release notes and choose an `sdk-v*` tag or commit compatible with the target firmware. Check the app-specific constraints (for example, Map Manager's separate `apps-v1.3.0` requirement in the root README).
3. Update **only the external SDK checkout** using your usual Git workflow. Do not modify SDK code inside this repo to make a build pass.
4. Reconfigure and build each affected app, run its tests/simulator if available, install on a watch, and check the important user flows. Also run `npm test` and `npm run build` in `Tools/activity-dashboard` when changing its code.
5. Record the new exact SDK commit and firmware tested alongside the app release. If an update breaks an app, keep the last working checkout available and address the incompatibility in a separate change.

The repository has no watch cross-compiler CI or watch-verified SDK compatibility matrix. A successful cross-build alone does not prove on-device compatibility.

## Generated files and Git noise

MapExplorer tracks TouchGFX-generated source because `touchgfx.cmake` compiles it directly; HRClock also compiles generated GUI code, but its 77 generated files are currently **ignored and untracked**. Its local build succeeds only because those files already exist in this checkout; a fresh clone will need TouchGFX Designer regeneration first. Do not delete or re-ignore MapExplorer's generated code without first proving a deterministic regeneration workflow. `.gitattributes` marks those tracked files as generated for GitHub's diff display, while leaving them available to builds. Commit regenerated outputs only with their corresponding `.touchgfx`, text or asset changes and inspect `git diff -- MapExplorer/Software/Apps/TouchGFX-GUI/generated/`. Decide separately whether to commit HRClock's necessary generated sources (after reviewing their provenance) or add a documented, reproducible generation step; the pinned SDK alone cannot solve that gap.

On this checkout many tracked files are marked executable on disk despite having `100644` in Git. Repository-local `core.filemode=false` suppresses that mode-only noise; it does not change tracked contents or permissions. On another machine, use `git diff --summary` to diagnose the same symptom before changing the local setting. Do not use that setting when intentional executable-bit changes need to be tracked.

For store preparation, see [PUBLISHING.md](PUBLISHING.md).
