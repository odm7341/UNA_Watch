#include <MapKit/MapBrowserSession.hpp>

namespace MapKit {
namespace {
int64_t panStep(uint8_t zoom)
{
    if (zoom >= MapMath::TRACE_ZOOM) {
        const uint8_t shift = zoom - MapMath::TRACE_ZOOM;
        return shift >= 6 ? 1 : MapBrowserSession::kPanScreenPixels >> shift;
    }
    return MapBrowserSession::kPanScreenPixels << (MapMath::TRACE_ZOOM - zoom);
}
} // namespace


bool MapBrowserSession::openInitialPack()
{
    if (!mSession.cyclePack(1)) {
        return false;
    }
    mCenterX = mSession.centerX();
    mCenterY = mSession.centerY();
    mZoom = mSession.zoom();
    mSession.poll();
    return true;
}

bool MapBrowserSession::adjust(bool positive)
{
    const int64_t step = panStep(mZoom);
    switch (mOperation) {
    case Operation::NorthSouth:
        mCenterY += positive ? -step : step;
        mSession.setViewport(mCenterX, mCenterY);
        return true;
    case Operation::EastWest:
        mCenterX += positive ? step : -step;
        mSession.setViewport(mCenterX, mCenterY);
        return true;
    case Operation::Zoom:
        if (!mSession.cycleZoom()) return false;
        mZoom = mSession.zoom();
        return true;
    case Operation::Pack:
        if (!mSession.cyclePack(positive ? 1 : -1)) return false;
        mCenterX = mSession.centerX();
        mCenterY = mSession.centerY();
        mZoom = mSession.zoom();
        mSession.poll();
        return true;
    case Operation::Exit:
        return false;
    }
    return false;
}

void MapBrowserSession::cycleOperation(int direction)
{
    constexpr int kOperationCount = 5;
    const int current = static_cast<int>(mOperation);
    mOperation = static_cast<Operation>((current + direction + kOperationCount) % kOperationCount);
}

} // namespace MapKit
