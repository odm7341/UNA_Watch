# UNA vector map exporter

Serve the repository with `python3 -m http.server 8000` and open
`http://localhost:8000/Tools/rawtiles-exporter/`. The historical URL is kept
for bookmarks. Shift-drag a rectangle or use **Use current view**. Choose a
native zoom range (8–14) and layers, then **Download .vtiles**. Start with a
small region near your GPS position. Copy the pack to `Apps/SharedData/maps/`
on USB, safely disconnect, and let the updated Map Manager verify it. See the
[watch installation guide](../../README.md#complete-guide-put-a-map-on-your-own-watch).

MapLibre handles navigation only; both the main view and the round 240 × 240
view rasterize the **same prepared vector tiles** as the export using the
watch's four-colour palette, pixel geometry rules, and square GPS-fix marker.
They do not display text labels or other desktop-only styling. The preview
shows the selected pack's tiles at the displayed integer watch zoom; areas
outside the selected pack appear as the watch's no-tile background. The watch
adds live breadcrumb points during an activity, which cannot be previewed
before a recording exists. The export contains geometry, not rendered images.
The exporter clips parent contour tiles at z13–14. Dense
tiles are simplified, and exports that still exceed the watch budget fail
with the tile address. Try fewer layers or a higher zoom. Packs are limited
to 1,024 tiles with 16 KiB of payload each.

Credits are shown beside the preview and embedded in the pack metadata; they
are not painted over the watch map.

The static page loads pinned MapLibre, Pbf, @mapbox/vector-tile, geojson-vt and
earcut modules. Network access is needed during export; no network is needed
on the watch. Geometry comes from [OpenFreeMap](https://openfreemap.org/),
[OpenMapTiles](https://openmaptiles.org/), [OpenStreetMap](https://www.openstreetmap.org/copyright)
and the [OSM US contours](https://tiles.openstreetmap.us/) (Mapzen DEM). Keep
pack attribution, and follow provider terms on bulk use and redistribution.

Run `npm ci && npm test` here for offline synthetic tests. See the
[wire format and renderer](../../MapKit/VECTOR_TILES.md) for details.
