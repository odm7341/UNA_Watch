# UNA vector map exporter

Open the [hosted exporter](https://odm7341.github.io/UNA_Watch/rawtiles-exporter/)
or run `npm ci && npm run dev` in this directory. Select **Draw polygon**,
click or tap the corners, then **Finish polygon**. **Undo corner** and
**Cancel** are available while drawing. Only whole tiles intersecting the
polygon are included. Alternatively select **Use current view**. Choose your
layers, then **Download .vtiles**. The pack stores geometry once on a z14
spatial grid. Updated HikeMap and RunMap redraw it at z14 through z17;
older versions can display these packs at z14. Start with a
small region near your GPS position. Copy the pack to `Apps/SharedData/maps/`
on USB, safely disconnect, and let the updated Map Manager verify it. See the
[watch installation guide](../../README.md#complete-guide-put-a-map-on-your-own-watch).

Leaflet handles navigation; both the main view and the round 240 × 240
view rasterize the **same prepared vector tiles** as the export using the
watch's four-colour palette, pixel geometry rules, and square GPS-fix marker.
The main map allows exploration outside the selected area. The round preview
shows the selected pack's tiles at the displayed integer watch zoom; areas
outside the selected pack appear as the watch's no-tile background. The watch
adds live breadcrumb points during an activity, which cannot be previewed
before a recording exists. The export contains geometry, not rendered images.
Above a provider's maximum source zoom, the exporter clips and scales its
parent geometry. This magnifies existing detail; it doesn't create new data. Dense
tiles are simplified, and exports that still exceed the watch budget fail
with the tile address. Try fewer layers. Packs are limited
to 1,024 tiles with 16 KiB of payload each.

Credits are shown beside the preview and embedded in the pack metadata; they
are not painted over the watch map.

The Pages build bundles its JavaScript dependencies locally. Network access
to the tile providers is needed during export; no network is needed
on the watch. Geometry comes from [OpenFreeMap](https://openfreemap.org/),
[OpenMapTiles](https://openmaptiles.org/), [OpenStreetMap](https://www.openstreetmap.org/copyright)
and the [OSM US contours](https://tiles.openstreetmap.us/) (Mapzen DEM). Keep
pack attribution, and follow provider terms on bulk use and redistribution.

Run `npm ci && npm test` here for offline synthetic tests. See the
[wire format and renderer](../../MapKit/VECTOR_TILES.md) for details.
