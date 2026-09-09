#include <MapKit/MapBrowserSession.hpp>

namespace MapKit {

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
    switch (mOperation) {
    case Operation::NorthSouth:
        mCenterY += positive ? -kPanPixels : kPanPixels;
        mSession.setViewport(mCenterX, mCenterY);
        return true;
    case Operation::EastWest:
        mCenterX += positive ? kPanPixels : -kPanPixels;
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
