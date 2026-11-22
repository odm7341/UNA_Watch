#ifndef MAPKIT_VECTORPACK_HPP
#define MAPKIT_VECTORPACK_HPP

#include "SDK/Interfaces/IFileSystem.hpp"

#include <cstddef>
#include <cstdint>
#include <memory>

namespace MapKit
{

/// VMAP v1: 224-byte header, 20-byte XYZ index entries sorted by (z,x,y),
/// uncompressed MVT v2 payloads up to 16 KiB each, and a trailing CRC-32.
/// The CRC is verified by MapManager, never on the GUI thread.
class VectorPack
{
public:
    static constexpr size_t kHeaderBytes = 224;
    static constexpr size_t kEntryBytes = 20;
    static constexpr size_t kMaxTileBytes = 16384;
    static constexpr uint32_t kMaxTiles = 1024;
    static constexpr size_t kAttributionBytes = 160;

    struct Header {
        uint8_t zoomMin = 0, zoomMax = 0;
        uint32_t tileCount = 0;
        int32_t minLon = 0, minLat = 0, maxLon = 0, maxLat = 0;
        char attribution[kAttributionBytes + 1] {};
    };
    struct Tile {
        uint8_t z = 0;
        uint32_t x = 0, y = 0, offset = 0, length = 0;
        bool found = false;
        bool valid() const { return found; }
    };

    /// Cheap screen suitable for a catalog scan. The selected pack alone must
    /// undergo open(), which checks the entire index without scanning payloads.
    ~VectorPack() { close(); }
    static bool peek(SDK::Interface::IFileSystem& fs, const char* path, Header& out,
                     uint64_t* size = nullptr, uint32_t* declaredCrc = nullptr);
    bool open(SDK::Interface::IFileSystem& fs, const char* path);
    void close();
    bool isOpen() const { return mFile != nullptr; }
    const Header& header() const { return mHeader; }
    // Single-grid packs can be magnified up to 8x without another index.
    uint8_t displayMax() const {
        return mHeader.zoomMin == mHeader.zoomMax && mHeader.zoomMax >= 14
            ? 17 : mHeader.zoomMax;
    }
    unsigned displayShift(uint8_t z) const {
        return z > mHeader.zoomMax && z <= displayMax() ? z - mHeader.zoomMax : 0;
    }
    uint64_t packSize() const { return mSize; }
    bool declaredCrc32(uint32_t& out) const { if (!isOpen()) return false; out = mCrc; return true; }
    Tile findTile(uint8_t z, uint32_t x, uint32_t y) const;
    bool readTile(const Tile& tile, uint8_t* dst, size_t capacity) const;


private:
    static bool decodeHeader(const uint8_t* bytes, uint64_t size, Header& out);
    bool readAt(uint32_t offset, uint8_t* bytes, size_t length) const;
    bool indexEntry(uint32_t i, Tile& out) const;

    mutable Tile lastLookup{};
    mutable bool hasLookup = false;
    mutable std::unique_ptr<SDK::Interface::IFile> mFile;
    Header mHeader {};
    uint64_t mSize = 0;
    uint32_t mCrc = 0;
};

} // namespace MapKit
#endif
