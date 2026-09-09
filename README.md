# UNA Watch map projects

Two maintained projects live in this repository:

- [`MapExplorer`](MapExplorer/README.md) — an offline topographic-map browser for the UNA Watch.
- [`Tools/map-style-viewer`](Tools/map-style-viewer/README.md) — a static browser app that previews the watch palette and exports compatible `.rawtiles` packs.

## Project boundaries

`MapExplorer` is application source, resources, and the TouchGFX-generated code required to build it. Its build products stay ignored. The shared [`MapKit`](MapKit/README.md) source is a repository dependency; its documented vendored rawtiles reader remains identified in source. The local UNA SDK checkout, device toolchains, generated object/dependency files, packages, and Python bytecode are ignored and are not commit candidates.

The untracked `Tools/build_usgs_topo_rawtiles.py` is intentionally outside the map-style-viewer project. It is neither documented here nor included in this commit.

## Build MapExplorer

1. Install the [UNA Watch SDK](https://github.com/UNAWatch/una-sdk) and follow its [SDK setup guide](https://developers.unawatch.com/latest/sdk-setup.html). Set `UNA_SDK` to that checkout; this repository deliberately does not vendor the SDK.
2. Install the toolchain required by the SDK, plus CMake 3.21 or newer.
3. Configure and build from the repository root:

   ```bash
   cmake -S MapExplorer/Software/Apps/MapExplorer-CMake \
     -B MapExplorer/Software/Apps/MapExplorer-CMake/build
   cmake --build MapExplorer/Software/Apps/MapExplorer-CMake/build
   ```

The generated `.uapp` is written below `MapExplorer/Output/`; it is an ignored deployment artifact, not source control content. See the [MapExplorer guide](MapExplorer/README.md) for watch controls and map-pack workflow.

## Use the map-style viewer

Serve the repository through any static HTTP server, then open [`Tools/map-style-viewer/`](Tools/map-style-viewer/) in a browser. For local development:

```bash
python3 -m http.server 8000
# Open http://localhost:8000/Tools/map-style-viewer/
```

The page uses browser-loaded MapLibre and public vector-tile services. It needs network access while previewing and exporting. Its dedicated README documents sources, attribution, limits, and publishing options.

## External projects

- [UNA Watch developer documentation](https://developers.unawatch.com/latest/) and [UNA Watch SDK](https://github.com/UNAWatch/una-sdk)
- [MapKit](MapKit/README.md), this repository's shared offline-map layer
- [rawtiles specification](https://github.com/tobymurray/rawtiles), the map-pack wire format
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/), [OpenFreeMap](https://openfreemap.org/), and [OpenStreetMap US vector tiles](https://tiles.openstreetmap.us/), used by the browser exporter
