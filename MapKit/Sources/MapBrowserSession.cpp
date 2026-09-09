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
        mFollowing = false;
        mCenterY += positive ? -step : step;
        mSession.setViewport(mCenterX, mCenterY);
        return true;
    case Operation::EastWest:
        mFollowing = false;
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
    case Operation::Follow:
        mFollowing = positive;
        if (mFollowing && mHasLocation) {
            mCenterX = mLocationX;
            mCenterY = mLocationY;
            mSession.setViewport(mCenterX, mCenterY);
        }
        return true;
    case Operation::Exit:
        return false;
    }
    return false;
}

bool MapBrowserSession::onLocation(int64_t x, int64_t y)
{
    mLocationX = x;
    mLocationY = y;
    mHasLocation = true;
    if (!mFollowing) {
        return false;
    }
    mCenterX = x;
    mCenterY = y;
    mSession.setViewport(mCenterX, mCenterY);
    return true;
}

void MapBrowserSession::clearLocation()
{
    mHasLocation = false;
}

void MapBrowserSession::cycleOperation(int direction)
{
    constexpr int kOperationCount = 6;
    const int current = static_cast<int>(mOperation);
    mOperation = static_cast<Operation>((current + direction + kOperationCount) % kOperationCount);
}

} // namespace MapKit
