# MapKit upstream relationship

This directory was synchronized with [`tobymurray/watch-apps`](https://github.com/tobymurray/watch-apps) at [`d4bf4b624a1bfc4e21149086b1a053a59a693dd9`](https://github.com/tobymurray/watch-apps/commit/d4bf4b624a1bfc4e21149086b1a053a59a693dd9).
The local activity renderer, exporter and Map Manager discovery now diverge from that raster baseline; see [VMAP](VECTOR_TILES.md). The previous local
`MapBrowserSession` adapter was removed with MapExplorer.

`HikeMap/`, `RunMap/`, and `MapManager/` were imported from the same revision.
Their unused `OLDENGL.TTF` and `verdana.ttf` assets were intentionally omitted
because redistribution rights were not established. Their `Output/.gitignore`
files were likewise omitted because this repository already ignores output
directories centrally.
Any future updates should compare their versions and the shared MapKit code
against this exact upstream commit; the monorepo cannot be used as a MapKit-only
Git submodule.
