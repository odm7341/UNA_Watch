#pragma once
#include <MapKit/VectorPack.hpp>

namespace MapKit {
// Four parity-addressed slots: adjacent tiles in a 2x2 viewport never evict
// each other. Each stores a full-resolution, four-colour tile in 16 KiB.
class TileCache {
public:
    const uint8_t* get(const VectorPack&, uint8_t z, uint32_t x, uint32_t y);
    uint32_t revision() const { return generation; }
    void clear() { ++generation; for (auto& slot : slots) slot.used = false; }
    static constexpr size_t tileBytes = 256 * 256 / 4;
private:
    uint32_t generation=0;
    struct Slot {
        uint8_t pixels[tileBytes];
        uint32_t x, y;
        uint8_t z;
        bool used = false, valid = false;
    } slots[4];
    uint8_t input[VectorPack::kMaxTileBytes];
};
}
