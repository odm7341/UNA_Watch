#include <MapKit/VectorPack.hpp>

#include <cstring>
#include <algorithm>
#include <limits>

namespace MapKit
{
namespace
{
uint32_t u32(const uint8_t* p)
{
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8)
         | (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}
uint16_t u16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
bool before(const VectorPack::Tile& a, const VectorPack::Tile& b)
{
    return a.z < b.z || (a.z == b.z && (a.x < b.x || (a.x == b.x && a.y < b.y)));
}
}

bool VectorPack::decodeHeader(const uint8_t* p, uint64_t size, Header& out)
{
    if (size < kHeaderBytes + 4 || size > std::numeric_limits<uint32_t>::max()
        || std::memcmp(p, "VMAP", 4) || p[4] != 1 || p[7] != 0
        || p[5] > p[6] || p[6] > 17
        || u32(p + 8) == 0 || u32(p + 8) > kMaxTiles
        || u32(p + 28) != kHeaderBytes
        || u32(p + 32) != kHeaderBytes + u32(p + 8) * kEntryBytes
        || u16(p + 36) == 0 || u16(p + 36) > kAttributionBytes
        || p[38] || p[39] || u32(p + 32) + 4 > size) return false;
    for (size_t i = 40 + u16(p + 36); i < kHeaderBytes; ++i) {
        if (p[i] != 0) return false;
    }
    for (size_t i = 40; i < static_cast<size_t>(40) + u16(p + 36); ++i) {
        if (p[i] == 0) return false;
    }
    Header result {};
    result.zoomMin = p[5];
    result.zoomMax = p[6];
    result.tileCount = u32(p + 8);
    result.minLon = static_cast<int32_t>(u32(p + 12));
    result.minLat = static_cast<int32_t>(u32(p + 16));
    result.maxLon = static_cast<int32_t>(u32(p + 20));
    result.maxLat = static_cast<int32_t>(u32(p + 24));
    if (result.minLon < -180000000 || result.maxLon > 180000000
        || result.minLat < -85051129 || result.maxLat > 85051129
        || result.minLon > result.maxLon || result.minLat > result.maxLat) return false;
    std::memcpy(result.attribution, p + 40, u16(p + 36));
    out = result;
    return true;
}

bool VectorPack::peek(SDK::Interface::IFileSystem& fs, const char* path, Header& out,
                      uint64_t* size, uint32_t* declaredCrc)
{
    auto file = fs.file(path);
    if (!file || !file->open(false, false)) return false;
    const uint64_t n = file->size();
    uint8_t header[kHeaderBytes], footer[4];
    size_t got = 0;
    bool ok = n >= kHeaderBytes + 4
        && file->read(reinterpret_cast<char*>(header), sizeof(header), got) && got == sizeof(header)
        && decodeHeader(header, n, out);
    if (ok && declaredCrc) {
        got = 0;
        ok = file->seek(static_cast<size_t>(n - 4))
            && file->read(reinterpret_cast<char*>(footer), 4, got) && got == 4;
        if (ok) *declaredCrc = u32(footer);
    }
    file->close();
    if (ok && size) *size = n;
    return ok;
}

bool VectorPack::readAt(uint32_t offset, uint8_t* bytes, size_t length) const
{
    size_t got = 0;
    return mFile && static_cast<uint64_t>(offset) + length <= mSize
        && mFile->seek(offset)
        && mFile->read(reinterpret_cast<char*>(bytes), length, got) && got == length;
}

static bool unpackEntry(const uint8_t* buf, VectorPack::Tile& out)
{
    if (buf[1] || buf[2] || buf[3]) return false;
    out.z = buf[0];
    out.x = u32(buf + 4);
    out.y = u32(buf + 8);
    out.offset = u32(buf + 12);
    out.length = u32(buf + 16);
    out.found = true;
    return true;
}

bool VectorPack::indexEntry(uint32_t i, Tile& out) const
{
    uint8_t buf[kEntryBytes];
    return i < mHeader.tileCount && readAt(kHeaderBytes + i*kEntryBytes, buf, sizeof(buf))
        && unpackEntry(buf,out);
}

bool VectorPack::open(SDK::Interface::IFileSystem& fs, const char* path)
{
    close();
    uint64_t size;
    uint32_t crc;
    Header header {};
    if (!peek(fs, path, header, &size, &crc)) return false;
    mFile = fs.file(path);
    if (!mFile || !mFile->open(false, false) || mFile->size() != size) {
        close();
        return false;
    }
    mHeader = header;
    mSize = size;
    mCrc = crc;
    uint32_t nextOffset = static_cast<uint32_t>(kHeaderBytes + header.tileCount * kEntryBytes);
    Tile previous {};
    constexpr unsigned batch = 24;
    uint8_t entries[batch*kEntryBytes];
    for (uint32_t i = 0; i < header.tileCount; ++i) {
        Tile tile {};
        if (i % batch == 0 && !readAt(kHeaderBytes+i*kEntryBytes, entries,
                std::min<uint32_t>(batch,header.tileCount-i)*kEntryBytes)) { close(); return false; }
        if (!unpackEntry(entries+(i%batch)*kEntryBytes, tile)
            || (i==0 && tile.z!=header.zoomMin) || (i+1==header.tileCount && tile.z!=header.zoomMax)
            || (i > 0 && !before(previous, tile))
            || tile.z < header.zoomMin || tile.z > header.zoomMax
            || tile.x >= (1u << tile.z) || tile.y >= (1u << tile.z)
            || tile.length == 0 || tile.length > kMaxTileBytes
            || tile.offset != nextOffset
            || static_cast<uint64_t>(tile.offset) + tile.length > size - 4) {
            close();
            return false;
        }
        nextOffset += tile.length;
        previous = tile;
    }
    if (nextOffset != size - 4) {
        close();
        return false;
    }
    return true;
}

void VectorPack::close()
{
    if (mFile) mFile->close();
    mFile.reset();
    hasLookup=false;
    mHeader = {};
    mSize = 0;
    mCrc = 0;
}

VectorPack::Tile VectorPack::findTile(uint8_t z, uint32_t x, uint32_t y) const
{
    Tile target {};
    target.z = z;
    target.x = x;
    target.y = y;
    if (hasLookup && lastLookup.z==z && lastLookup.x==x && lastLookup.y==y) return lastLookup;
    uint32_t lo = 0, hi = isOpen() ? mHeader.tileCount : 0;
    while (lo < hi) {
        const uint32_t mid = lo + (hi - lo) / 2;
        Tile entry {};
        if (!indexEntry(mid, entry)) return {};
        if (before(entry, target)) lo = mid + 1;
        else if (before(target,entry)) hi = mid;
        else { target=entry; break; }
    }
    hasLookup=true;
    return lastLookup=target;
}

bool VectorPack::readTile(const Tile& tile, uint8_t* dst, size_t capacity) const
{
    // Validate against the trusted index; don't accept caller-supplied offsets.
    if (!tile.valid() || !dst) return false;
    const Tile indexed = findTile(tile.z, tile.x, tile.y);
    return indexed.valid() && indexed.offset == tile.offset && indexed.length == tile.length
        && indexed.length <= capacity && readAt(indexed.offset, dst, indexed.length);
}

} // namespace MapKit
