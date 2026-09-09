# MapKit upstream relationship

This directory is maintained as a local derivative of [`MapKit` in Toby Murray's `watch-apps` repository](https://github.com/tobymurray/watch-apps/tree/c752601/MapKit), baseline commit [`c752601`](https://github.com/tobymurray/watch-apps/commit/c752601). The upstream project is a monorepo: `MapKit` is a normal directory, not its own Git repository, and upstream contains no `.gitmodules`. Git therefore cannot represent only `watch-apps/MapKit` as a submodule.

The root [MIT License](../LICENSE) retains the upstream copyright notices, and [third-party notices](../THIRD_PARTY_NOTICES.md) describe the SDK and font boundaries.

## Intentional local divergence

MapExplorer is a manual map browser, so this copy adds browser-facing behavior that upstream activity-map faces do not need:

- `MapSession` exposes manual pack opening/cycling, a manual viewport setter, and marker polling.
- `MapBrowserSession` is a local adapter for pan, zoom, and installed-pack selection.
- `mapkit.cmake` builds `MapBrowserSession` and omits upstream's `AttributionFace` and `TrackFaceMap`, which MapExplorer does not use.

These are the only source-level differences from the recorded upstream baseline. Do not overwrite them during an upstream sync without porting their behavior or changing MapExplorer first.

## Sync procedure

1. Clone or fetch [`tobymurray/watch-apps`](https://github.com/tobymurray/watch-apps) outside this repository and choose the upstream commit to adopt.
2. Compare its `MapKit/` directory with this one. Preserve the local changes above or deliberately migrate MapExplorer to the upstream API.
3. Run MapKit's host tests and build MapExplorer against the updated directory.
4. Update the baseline commit link in this file and commit the source change, tests, and this provenance record together.

A Git subtree is possible if retaining upstream history becomes worth the migration cost. Until then, this file is the explicit, reviewable upstream link without turning the entire upstream monorepo into a nested checkout.
