#include <MapKit/MapSession.hpp>

#include <MapKit/PackTrustReader.hpp>

#include <cmath>
#include <cstdio>
#include <cstring>

#define LOG_MODULE_PRX      "MapKit"
#define LOG_MODULE_LEVEL    LOG_LEVEL_INFO
#include "SDK/UnaLogger/Logger.h"

namespace MapKit
{

void MapSession::onPosition(float latitude, float longitude, bool fix, bool recording)
{
    mFix = fix;
    if (fix) {
        mHadFix  = true;
        mLatUDeg = static_cast<int32_t>(std::lround(static_cast<double>(latitude) * 1e6));
        mLonUDeg = static_cast<int32_t>(std::lround(static_cast<double>(longitude) * 1e6));
        mCenterX = MapMath::lonToWorldX(mLonUDeg, MapMath::TRACE_ZOOM);
        mCenterY = MapMath::latToWorldY(mLatUDeg, MapMath::TRACE_ZOOM);
        if (recording) {
            mTrace.append(static_cast<int32_t>(mCenterX), static_cast<int32_t>(mCenterY));
        }
    }

    if (!mHadFix) {
        return;     // nothing to select against yet
    }

    // No scan here. It ran once in the constructor -- see the note there for
    // why it moved off the first fix.
    //
    // Re-selection, by contrast, is pure: it runs against the catalog already
    // in memory and costs nothing worth throttling. It has to keep running,
    // because walking into a pack's coverage is exactly how a wearer who
    // started outside every pack gets a map. Keeping these two apart is what
    // fixed the defect the simulator found: when no pack covers the wearer,
    // `mSelected` stays kNoPack forever, so anything keyed on that runs on
    // every GPS sample -- and a rescan there meant a directory walk plus a
    // read per pack, once a second, for a whole activity, on the GUI thread,
    // to re-learn what it already knew.
    if (mSelected == kNoPack || !coversCurrentFix()) {
        chooseAndOpen();
    }

    pollTrust();

    // A Bad verdict may have just landed on the pack we are holding. Fall back
    // to another covering pack in this same sample rather than the next one --
    // a verdict arriving mid-activity should not cost the wearer a map they
    // could otherwise have had, and should not show a stale screen for a
    // second while it sorts itself out.
    //
    // Only when there is somewhere to fall back to, though. Reselecting into
    // nothing would replace the specific "map pack corrupt" with the vaguer
    // "no map for here" -- true, but it tells whoever has to fix it less. The
    // loop terminates because pollTrust() marked the pack corrupt in the
    // catalog, so it can never be chosen again.
    if (mCorrupt && selectPack(mCatalog.facts(), mCatalog.count(), mLatUDeg, mLonUDeg) != kNoPack) {
        chooseAndOpen();
        pollTrust();
    }

    // Somewhere with no tiles. Write it down so somebody can build a pack for
    // next time -- the watch is the only thing that knows, and until this it
    // threw the knowledge away. Quantised and de-duplicated by TileRequestLog,
    // so this is a file write on entering a new region, not once a second.
    //
    // Only the two states that mean *this place has no map*. A corrupt or
    // unopenable pack also leaves the screen blank, but the answer there is to
    // re-copy a pack that already exists, not to make a new one.
    const MapStatus now = status();
    if (now == MapStatus::NoPack || now == MapStatus::OffCoverage) {
        mRequests.note(mLatUDeg, mLonUDeg);
    }
}

bool MapSession::coversCurrentFix() const
{
    return mSelected != kNoPack && mSelected < mCatalog.count()
        && mCatalog.at(mSelected).contains(mLatUDeg, mLonUDeg);
}

void MapSession::closePack()
{
    mContainer.close();
    // Slots are keyed on (z, x, y) alone, so tiles from the outgoing pack
    // would otherwise be served as if they belonged to the incoming one.
    mCache.clear();
    mSelected     = kNoPack;
    mPackPath[0]  = '\0';
    mOpenResult   = SDK::RawTiles::OpenResult::FileNotFound;
    mTrusted      = false;
    mCorrupt      = false;
    mZoom         = 0;
}

bool MapSession::openPack(size_t choice)
{
    if (choice >= mCatalog.count() || mCatalog.at(choice).knownCorrupt) {
        return false;
    }
    closePack();
    if (!PackCatalog::fullPathFor(mCatalog.at(choice).name, mPackPath, sizeof(mPackPath))) {
        return false;
    }
    mOpenResult = mContainer.openFromFile(mKernel.fs, mPackPath, /*skipCrcVerify=*/true);
    mSelected = choice;
    if (mOpenResult != SDK::RawTiles::OpenResult::Ok) {
        LOG_INFO("map: %s failed to open: %s\n", mPackPath,
                 SDK::RawTiles::Container::describeResult(mOpenResult));
        return false;
    }
    mZoom = mContainer.header().zoomMax;
    for (uint8_t z = mContainer.header().zoomMax; ; --z) {
        if (mContainer.tileCountAtZoom(z) != 0) {
            mZoom = z;
            break;
        }
        if (z == mContainer.header().zoomMin) {
            break;
        }
    }
    const PackFacts& pack = mCatalog.at(choice);
    const int32_t lat = pack.bboxMinLatUDeg + (pack.bboxMaxLatUDeg - pack.bboxMinLatUDeg) / 2;
    const int32_t lon = pack.bboxMinLonUDeg + (pack.bboxMaxLonUDeg - pack.bboxMinLonUDeg) / 2;
    setViewport(MapMath::lonToWorldX(lon, MapMath::TRACE_ZOOM),
                MapMath::latToWorldY(lat, MapMath::TRACE_ZOOM));
    mHadFix = true;
    mFix = false;
    LOG_INFO("map: opened %s, z%u..z%u, %lu tiles\n", mPackPath,
             mContainer.header().zoomMin, mContainer.header().zoomMax,
             static_cast<unsigned long>(mContainer.header().tileCount));
    return true;
}

bool MapSession::cyclePack(int direction)
{
    const size_t count = mCatalog.count();
    if (count == 0 || direction == 0) {
        return false;
    }
    if (mSelected == kNoPack) {
        return openPack(0);
    }
    size_t next = mSelected;
    for (size_t tried = 0; tried < count; ++tried) {
        next = direction > 0 ? (next + 1) % count : (next + count - 1) % count;
        if (openPack(next)) {
            return true;
        }
    }
    return false;
}

void MapSession::setViewport(int64_t centerX, int64_t centerY)
{
    mCenterX = centerX;
    mCenterY = centerY;
}

void MapSession::chooseAndOpen()
{
    const size_t choice = selectPack(mCatalog.facts(), mCatalog.count(), mLatUDeg, mLonUDeg);
    if (choice == kNoPack) {
        closePack();
        if (!mReportedNoPack) {
            mReportedNoPack = true;
            LOG_INFO("map: no pack covers this position (%zu candidate(s))\n", mCatalog.count());
        }
        return;
    }
    mReportedNoPack = false;
    openPack(choice);
}

void MapSession::pollTrust()
{
    if (mOpenResult != SDK::RawTiles::OpenResult::Ok || mTrusted || mCorrupt) {
        return;     // nothing to open, or already decided -- either way, final
    }

    uint32_t declared = 0;
    if (!mContainer.declaredCrc32(declared)) {
        return;
    }

    char markerPath[SDK::Interface::IFileSystem::skMaxPathLen];
    if (!PackTrustReader::markerPathFor(mPackPath, markerPath, sizeof(markerPath))) {
        return;
    }

    const PackTrustReader marker(mKernel, markerPath);
    switch (marker.verdictFor(mContainer.packSize(), declared)) {
        case PackTrustReader::Trust::Good:
            mTrusted = true;
            LOG_INFO("map: %s trusted via Map Manager's marker\n", mPackPath);
            break;
        case PackTrustReader::Trust::Bad:
            mCorrupt = true;
            // Take it out of the running so the selection rule stops offering
            // it. Acting on that is onPosition()'s job, not this function's --
            // falling back from in here would mean pollTrust() calling
            // chooseAndOpen() calling pollTrust(), once per corrupt pack.
            mCatalog.markCorrupt(mSelected);
            LOG_ERROR("map: %s confirmed corrupt by Map Manager\n", mPackPath);
            break;
        case PackTrustReader::Trust::Absent:
            // No verdict about these bytes yet. Normal for the first minutes
            // after a pack is deployed; resolves on its own. Keep polling.
            break;
    }
}

bool MapSession::cycleZoom()
{
    if (!renderable()) {
        // Nothing to zoom. Say so rather than silently absorbing the press:
        // the caller owns a button that means something else everywhere else,
        // and a dead button is worse than a button that does the ordinary
        // thing.
        return false;
    }
    const SDK::RawTiles::Header& h = mContainer.header();
    mZoom = (mZoom >= h.zoomMax) ? h.zoomMin : static_cast<uint8_t>(mZoom + 1);
    return true;
}

MapStatus MapSession::status() const
{
    if (!mHadFix) {
        return MapStatus::NoFix;
    }
    if (mSelected == kNoPack) {
        return MapStatus::NoPack;
    }
    if (mOpenResult != SDK::RawTiles::OpenResult::Ok) {
        return MapStatus::PackError;
    }
    if (mCorrupt) {
        return MapStatus::Corrupt;
    }
    if (!mTrusted) {
        return MapStatus::Verifying;
    }
    // A pack was chosen because its bbox contains us, but a bbox is a
    // rectangle around a set of tiles, not the set itself -- and it only
    // promises coverage somewhere in [zoomMin, zoomMax], not at every zoom.
    // So the honest test is whether the tile under the crosshair exists.
    const SDK::RawTiles::TileInfo here = mContainer.findTile(
        mZoom,
        MapMath::tileCoord(MapMath::rescale(mCenterX, MapMath::TRACE_ZOOM, mZoom)),
        MapMath::tileCoord(MapMath::rescale(mCenterY, MapMath::TRACE_ZOOM, mZoom)));
    return here.valid() ? MapStatus::Live : MapStatus::OffCoverage;
}

const char* MapSession::packErrorText() const
{
    if (mSelected == kNoPack || mOpenResult == SDK::RawTiles::OpenResult::Ok) {
        return nullptr;
    }
    return SDK::RawTiles::Container::describeResult(mOpenResult);
}

const char* MapSession::packName() const
{
    if (mSelected == kNoPack || mSelected >= mCatalog.count()) {
        return nullptr;
    }
    return mCatalog.at(mSelected).name;
}

} // namespace MapKit
