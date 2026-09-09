# UNA Map Style Lab

UNA Map Style Lab is a static, browser-only tool for previewing the UNA Watch topographic style and exporting the selected area as a `.rawtiles` pack. It renders vector sources in [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/), then converts every export tile to the watch's 256 × 256 `ABGR2222` pixel format.

No server, build step, API key, or source tiles are stored in this project. It must be opened over HTTP(S), not as a `file://` URL, because it uses JavaScript modules and remote vector-tile services.

## Run locally

From the repository root, serve the files with any static web server:

```bash
python3 -m http.server 8000
```

Open [http://localhost:8000/Tools/map-style-viewer/](http://localhost:8000/Tools/map-style-viewer/). `index.html` is the complete entry point, so the same directory can be hosted unchanged by GitHub Pages, a static object host, or any normal web server.

## Export a pack

1. Move and zoom the map to the area you want.
2. Click **Use current view**, or hold Shift and drag a rectangle on the map.
3. Select a zoom range between 8 and 14. Keep the selection below the visible 1,024-tile browser-export limit.
4. Choose which style layers to include.
5. Click **Download rawtiles**. The browser renders each tile locally and downloads `una-topo-z<min>-<max>.rawtiles`.

A pack declares Web Mercator/XYZ addressing, 256 px tiles, one byte per `ABGR2222` pixel, geographic coverage, a CRC-32 footer, and an `ATTR` attribution extension. It is intended for [`MapExplorer`](../../MapExplorer/README.md) and the shared [`MapKit`](../../MapKit/README.md), which implement the [rawtiles specification](https://github.com/tobymurray/rawtiles). Export size is approximately 64 KiB per tile plus index and metadata, so smaller selections are substantially faster and lighter.

## Data and JavaScript dependencies

The page downloads these upstream resources at runtime. Their availability, attribution, licenses, and usage terms govern use of exported packs.

- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) 5.3.0 from unpkg — map rendering and symbol placement.
- [OpenFreeMap](https://openfreemap.org/) — base vector topology and glyphs, with [OpenStreetMap](https://www.openstreetmap.org/copyright) attribution.
- [OpenStreetMap US vector tiles](https://tiles.openstreetmap.us/) — contour source, using Mapzen DEM-derived contours.
- [rawtiles](https://github.com/tobymurray/rawtiles) — pack format used by the watch reader.

The exporter's `ATTR` extension names OpenFreeMap, OpenStreetMap contributors, OpenStreetMap US, and Mapzen DEM. Keep that attribution intact and consult the providers before bulk exporting or redistributing tiles.

## Project contents

- `index.html` — page shell and CDN references.
- `app.js` — map controls, selection, export sequencing, and download.
- `map-style.js` — source definitions, layer groups, and watch palette.
- `vector-renderer.js` — one-tile offscreen renderer and color quantizer.
- `rawtiles.js` — tile range math and rawtiles pack writer.
- `style.css` — responsive map-control layout.

Only these first-party static files belong in commits. Downloaded `.rawtiles` packs, browser caches, tile source data, and Python bytecode do not.
