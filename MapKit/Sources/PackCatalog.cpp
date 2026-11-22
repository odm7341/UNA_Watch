#include <MapKit/PackCatalog.hpp>

#define LOG_MODULE_PRX      "MapKit"
#define LOG_MODULE_LEVEL    LOG_LEVEL_INFO
#include "SDK/UnaLogger/Logger.h"

#include <MapKit/MapMath.hpp>
#include <MapKit/PackDepth.hpp>
#include <MapKit/PackTrustReader.hpp>
#include <MapKit/VectorPack.hpp>

#include <cstdio>
#include <cstring>
#include <memory>

namespace MapKit
{
namespace
{

bool hasExtension(const char* name, const char* ext)
{
    const size_t nameLen = std::strlen(name);
    const size_t extLen  = std::strlen(ext);
    return nameLen > extLen && std::strcmp(name + (nameLen - extLen), ext) == 0;
}

} // namespace

bool PackCatalog::fullPathFor(const char* name, char* out, size_t outSize)
{
    const int n = std::snprintf(out, outSize, "%s/%s", kMapsDir, name);
    return n > 0 && static_cast<size_t>(n) < outSize;
}

void PackCatalog::collectAttribution(const char* attr)
{
    if (std::strlen(attr) >= kMaxAttrLen) { ++mUnattributed; return; }
    for (size_t i = 0; i < mAttrCount; ++i) {
        if (std::strcmp(mAttributions[i], attr) == 0) {
            return;     // already crediting this source
        }
    }
    if (mAttrCount >= kMaxAttributions) {
        ++mUnattributed;
        return;
    }
    std::memcpy(mAttributions[mAttrCount], attr, std::strlen(attr) + 1);
    ++mAttrCount;
}

size_t PackCatalog::rescan()
{
    mCount        = 0;
    mScanned      = true;
    mAttrCount    = 0;
    mUnattributed = 0;

    std::unique_ptr<SDK::Interface::IDirectory> dir = mKernel.fs.dir(kMapsDir);
    if (!dir || !dir->open()) {
        // Normal, not an error: SharedData/maps does not exist until someone
        // deploys a pack there.
        return 0;
    }

    SDK::Interface::IFileSystem::ObjectInfo item {};
    while (mCount < kMaxPacks && dir->readNext(item)) {
        if (item.isDir || !hasExtension(item.name, kPackExtension)) {
            continue;   // skips subdirectories and Map Manager's own .trust files
        }
        const size_t nameLen = std::strlen(item.name);
        if (nameLen >= kMaxNameLen) {
            continue;   // cannot store the name, so cannot name the pack later
        }

        char fullPath[SDK::Interface::IFileSystem::skMaxPathLen];
        if (!fullPathFor(item.name, fullPath, sizeof(fullPath))) {
            continue;
        }

        PackFacts facts {};
        VectorPack::Header h;
        uint64_t sizeNow;
        uint32_t crcDeclared;
        if (!VectorPack::peek(mKernel.fs, fullPath, h, &sizeNow, &crcDeclared)) continue;
        facts.zoomMax = h.zoomMax;
        facts.bboxMinLonUDeg = h.minLon;
        facts.bboxMinLatUDeg = h.minLat;
        facts.bboxMaxLonUDeg = h.maxLon;
        facts.bboxMaxLatUDeg = h.maxLat;
        char markerPath[SDK::Interface::IFileSystem::skMaxPathLen];
        if (PackTrustReader::markerPathFor(fullPath, markerPath, sizeof(markerPath))) {
            const PackTrustReader marker(mKernel, markerPath);
            facts.knownCorrupt =
                marker.verdictFor(sizeNow, crcDeclared) == PackTrustReader::Trust::Bad;
        }

        // memcpy, not snprintf: nameLen was bounded above, and snprintf here
        // draws a -Wformat-truncation warning for a truncation that cannot
        // happen -- which is worse than useless, because a real one would then
        // be lost in the noise.
        std::memcpy(mNames[mCount], item.name, nameLen + 1);
        facts.name      = mNames[mCount];
        mFacts[mCount]  = facts;
        ++mCount;

        // After the pack is accepted, so nothing that failed the peek can
        // contribute a credit — a pack this app will never draw owes none.
        collectAttribution(h.attribution);
    }

    dir->close();
    LOG_INFO("catalog: %zu pack(s), %zu attribution(s), %zu unattributed\n",
             mCount, mAttrCount, mUnattributed);
    return mCount;
}

} // namespace MapKit
