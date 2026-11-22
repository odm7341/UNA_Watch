# UNA vector map exporter

Serve the repository with `python3 -m http.server 8000` and open
`http://localhost:8000/Tools/rawtiles-exporter/`. The historical URL is kept
for bookmarks. Shift-drag a rectangle or use **Use current view**. Choose a
native zoom range (8–14) and layers, then **Download .vtiles**. Start with a
small region near your GPS position. Copy the pack to `Apps/SharedData/maps/`
on USB, safely disconnect, and let the updated Map Manager verify it. See the
[watch installation guide](../../README.md#complete-guide-put-a-map-on-your-own-watch).

MapLibre supplies a desktop preview; the round mockup shows the preview at
watch size, not a simulation of the watch renderer. The export contains
geometry, not rendered images. The four-colour watch map draws land, water,
contours, roads, trails and peak markers beneath the breadcrumb; text labels
are preview-only. The exporter clips parent contour tiles at z13–14. Dense
tiles are simplified, and exports that still exceed the watch budget fail
with the tile address. Try fewer layers or a higher zoom. Packs are limited
to 1,024 tiles with 16 KiB of payload each.

The static page loads pinned MapLibre, Pbf, @mapbox/vector-tile, geojson-vt and
earcut modules. Network access is needed during export; no network is needed
on the watch. Geometry comes from [OpenFreeMap](https://openfreemap.org/),
[OpenMapTiles](https://openmaptiles.org/), [OpenStreetMap](https://www.openstreetmap.org/copyright)
and the [OSM US contours](https://tiles.openstreetmap.us/) (Mapzen DEM). Keep
pack attribution, and follow provider terms on bulk use and redistribution.

Run `npm ci && npm test` here for offline synthetic tests. See the
[wire format and renderer](../../MapKit/VECTOR_TILES.md) for details.
