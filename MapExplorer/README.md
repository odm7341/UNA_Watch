# MapExplorer

MapExplorer is a UNA Watch utility application for browsing offline `.rawtiles` topographic packs on the watch. It is a pack browser rather than a recorder: it opens an installed pack, renders the map through the shared [`MapKit`](../MapKit/README.md) layer, and lets the wearer pan, zoom, and choose another pack.

## Layout

- `Software/Apps/MapExplorer-CMake/` — CMake entry point and packaging metadata.
- `Software/Apps/TouchGFX-GUI/` — MapExplorer's TouchGFX UI, assets, and generated sources needed by the build.
- `Software/Libs/` — the minimal application service.
- `Resources/` — application icons.
- `Output/` and `build-app/` — ignored build and deployment outputs.

The shared [`MapKit`](../MapKit/README.md) directory is a sibling dependency, not a copied application library. It reads the [rawtiles format](https://github.com/tobymurray/rawtiles), selects available packs, and draws the viewport. MapExplorer's CMake file includes it from the repository root.

## Build

### Requirements

- [UNA Watch SDK](https://github.com/UNAWatch/una-sdk), installed separately and referenced by `UNA_SDK`.
- The SDK's documented [toolchain setup](https://developers.unawatch.com/latest/sdk-setup.html), including the ARM toolchain and CMake 3.21+.
- [TouchGFX](https://support.touchgfx.com/docs/development/touchgfx-hal-development/touchgfx-generator) when changing the UI project or regenerating its sources.

From the repository root:

```bash
cmake -S MapExplorer/Software/Apps/MapExplorer-CMake \
  -B MapExplorer/Software/Apps/MapExplorer-CMake/build
cmake --build MapExplorer/Software/Apps/MapExplorer-CMake/build
```

The SDK packages the application as a `.uapp` below `MapExplorer/Output/`. Generated binaries, CMake output, object files, and dependency files are ignored; commit the inputs above, not those outputs.

## Watch controls

The active operation appears in the bottom overlay.

| Button | Action |
| --- | --- |
| L1 | Previous operation: pan north/south, pan east/west, zoom, or choose pack |
| L2 | Next operation |
| R1 | Negative adjustment for the active operation |
| R2 | Positive adjustment for the active operation |
| R2 twice consecutively | Exit to the watch launcher |

On launch, MapExplorer opens the first available map pack. In pack mode, R1/R2 cycle available packs. In zoom mode, the app cycles through zoom levels present in the selected pack.

## Create map packs

Use the [map-style viewer](../Tools/map-style-viewer/README.md) to make a compatible 256 px, Web Mercator, `ABGR2222` `.rawtiles` pack. Deploy packs through the map-management workflow used by MapKit; the library validates the format and uses its trust marker before rendering. The viewer embeds source attribution in exported packs; preserve the data providers' attribution and usage terms.

## Dependencies and ownership

MapExplorer is app-specific source. The UNA SDK is excluded by the root `.gitignore`; do not add a local SDK checkout or toolchain to this repository. MapKit has one explicitly marked vendored rawtiles reader—its source comment records the upstream branch and revision. See [MapKit's README](../MapKit/README.md) for the shared library's behavior and tests.

The repository's original code is MIT-licensed; see the root [LICENSE](../LICENSE). Poppins font files retain their [SIL Open Font License 1.1](Software/Apps/TouchGFX-GUI/assets/fonts/OFL.txt), and TouchGFX-generated integration remains subject to STMicroelectronics' [SLA0048](https://www.st.com/resource/en/license_agreement/dm00107782.pdf). Full provenance and scope are in the root [third-party notices](../THIRD_PARTY_NOTICES.md).
