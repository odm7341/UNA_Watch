# UNA Rawtiles Exporter

UNA Rawtiles Exporter is a static browser tool for previewing the UNA Watch topographic style and exporting the selected area as a `.rawtiles` pack. It renders vector sources in [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/), then converts every export tile to the watch's 256 × 256 `ABGR2222` pixel format.

It is the pack-creation step in the [complete own-watch guide](../../README.md#complete-guide-put-a-map-on-your-own-watch). That guide also explains building the watch app, installing upstream Map Manager, copying packs to the right USB directory, and waiting for verification.

## Requirements

- A modern desktop browser with JavaScript and downloads enabled.
- Network access while previewing and exporting: the page loads MapLibre, glyphs, and public vector-tile sources at runtime.
- Any static HTTP(S) server. There is no application server, build step, API key, or tile data stored in this project.

Do not double-click `index.html` as a `file://` URL. Browser module and remote-resource rules make HTTP(S) the reliable supported mode.

## Open the page

From the repository root:

```bash
python3 -m http.server 8000
```

Open [http://localhost:8000/Tools/rawtiles-exporter/](http://localhost:8000/Tools/rawtiles-exporter/). `index.html` is the complete entry point, so this directory can also be hosted unchanged on a static object host or normal web server.

### GitHub Pages

The repository deploys this directory on every push to `main` that changes the exporter. After the first successful deployment, open [https://odm7341.github.io/UNA_Watch/rawtiles-exporter/](https://odm7341.github.io/UNA_Watch/rawtiles-exporter/). Before the first deployment, set the repository's **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The Pages artifact contains only this exporter and a root redirect; no watch sources, SDK checkout, or local tooling are published.

## Create your first watch map

1. Pan and zoom to an area you know. The readout shows the map center and viewport zoom.
2. Click **Use current view** to select the visible bounds. To choose a smaller custom area, hold Shift and drag a rectangle on the map.
3. For a quick first test, choose **Min zoom 8** and **Max zoom 8**. The estimate should be one or a few tiles; a 256 × 256 export is roughly 64 KiB per tile.
4. Leave the desired layers enabled. The toggles control both the preview and the exported pixels: land cover, water, contours, roads, labels, trails, and peaks.
5. Click **Download rawtiles**. The status updates once per rendered tile, then the browser downloads `una-topo-z<min>-<max>.rawtiles`.
6. Keep that file unchanged. Do not unzip it, rename it to a different extension, edit it, or copy a `.trust` marker beside it.

The zoom controls and exported packs support z8 through z19. At z15–19, MapLibre overzooms the highest available vector detail from the upstream sources; use tight selections because each zoom step quadruples the tile count. The exporter renders a buffered 512px MapLibre metatile for every 256px rawtiles tile, so line work and labels have rendering context beyond each tile edge before the tile core is reduced and quantized.

For more detail, increase the zoom range gradually and use a tight selection. The page enforces a 1,024-tile browser-export limit because every tile is rendered and quantized locally. A large high-zoom region may be many megabytes and take substantial time.

## Put the pack on a watch

The rawtiles exporter produces the file but does not communicate with a watch. Follow the root guide's [USB-copy and verification step](../../README.md#6-copy-both-apps-and-the-pack-to-the-watch):

1. Copy the downloaded `.rawtiles` file directly into `SharedData/maps/` on the watch USB volume.
2. Safely eject and disconnect the watch. USB stops apps, including Map Manager's verifier.
3. Let upstream [Map Manager](https://github.com/tobymurray/watch-apps/tree/c752601/MapManager) mark the pack **Good** after the watch restarts.
4. Open MapExplorer and use **PACK** mode to choose the installed pack.

MapExplorer only accepts rawtiles v1 packs with 256 px `ABGR2222` tiles, Web Mercator projection, and XYZ/Quadtree addressing. This exporter writes those values, the geographic bounding box, a CRC-32 footer, and an `ATTR` attribution extension.

## Data, attribution, and responsible use

The page downloads these upstream resources at runtime. Their availability, attribution, licenses, and usage terms govern previewing, bulk exports, and any redistribution of output.

- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) 5.3.0 from unpkg — map rendering and symbol placement.
- [OpenFreeMap](https://openfreemap.org/) — base vector topology and glyphs, with [OpenStreetMap](https://www.openstreetmap.org/copyright) attribution.
- [OpenStreetMap US vector tiles](https://tiles.openstreetmap.us/) — contour source, using Mapzen DEM-derived contours.
- [rawtiles](https://github.com/tobymurray/rawtiles) — pack format implemented by MapKit.

Every exported pack writes an `ATTR` extension naming OpenFreeMap, OpenStreetMap contributors, OpenStreetMap US, and Mapzen DEM. Preserve that attribution. Consult the providers before automated, repeated, large-area, or redistributed exports; the download button is not a grant to bulk-copy their services.

## Troubleshooting

| Symptom | Cause and correction |
| --- | --- |
| Page loads as blank or controls do nothing | Run it through HTTP(S) using the command above; do not use `file://`. |
| Map tile or glyph errors | Check network access and retry. The page depends on the listed public providers. |
| Download button is disabled | Select an area, use a valid min/max order, and reduce coverage below 1,024 tiles. |
| MapExplorer does not draw the downloaded pack | Ensure it is directly in `SharedData/maps/`, then wait for Map Manager's **Good** verdict after disconnecting USB. |
| Pack is too large | Reduce the rectangle or maximum zoom; export nearby regions as separate packs and switch them with MapExplorer's **PACK** mode. |

## Project contents

- `index.html` — page shell and CDN references.
- `app.js` — map controls, selection, export sequencing, and download.
- `map-style.js` — source definitions, layer groups, and watch palette.
- `vector-renderer.js` — buffered MapLibre metatile renderer and ABGR2222 color quantizer.
- `rawtiles.js` — tile range math and rawtiles pack writer.
- `style.css` — responsive map-control layout.

Only these first-party static files belong in commits. Downloaded `.rawtiles` packs, browser caches, tile source data, and Python bytecode do not.

## License

The exporter's first-party static files are covered by the repository [MIT License](../../LICENSE). It does not relicense MapLibre, public map data, or exported tiles; see the root [third-party notices](../../THIRD_PARTY_NOTICES.md) and the providers' terms above.
