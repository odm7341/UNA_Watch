#pragma once

#include <cstdint>

#include "MapKit/MapSession.hpp"

namespace MapKit {

/**
 * Manual-map policy layered over MapSession's trusted-pack and tile lifecycle.
 * It deliberately never submits TileRequestLog entries and never recentres from
 * GPS once the wearer begins browsing.
 */
class MapBrowserSession {
public:
    enum class Operation : uint8_t { NorthSouth, EastWest, Zoom, Pack };

    static constexpr int64_t kPanPixels = 96;

    explicit MapBrowserSession(MapSession& session) : mSession(session) {}

    /// Select the first usable pack and initialise the viewport at its centre.
    bool openInitialPack();
    /// Apply the active operation; false means the requested change is invalid.
    bool adjust(bool positive);
    void cycleOperation(int direction);

    Operation operation() const { return mOperation; }
    int64_t centerX() const { return mCenterX; }
    int64_t centerY() const { return mCenterY; }
    uint8_t zoom() const { return mZoom; }
    bool renderable() const { return mSession.renderable(); }
    const SDK::RawTiles::Container& container() const { return mSession.container(); }
    TileCache& cache() const { return mSession.cache(); }

private:
    MapSession& mSession;
    Operation mOperation = Operation::NorthSouth;
    int64_t mCenterX = 0;
    int64_t mCenterY = 0;
    uint8_t mZoom = 0;
};

} // namespace MapKit
