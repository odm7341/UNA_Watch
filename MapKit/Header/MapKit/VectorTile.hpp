/**
 * Allocation-free reader for uncompressed Mapbox Vector Tile v2 geometry.
 * Coordinates are in the layer's extent; callers decide how to render them.
 * Streaming: discard the destination on failure; never draw directly to LCD.
 */
#ifndef MAPKIT_VECTORTILE_HPP
#define MAPKIT_VECTORTILE_HPP

#include <cstddef>
#include <cstdint>

namespace MapKit
{
namespace VectorTile
{
enum class Geometry : uint8_t { Point = 1, Line = 2, Polygon = 3 };

class Sink
{
public:
    virtual ~Sink() = default;
    virtual void beginLayer(const char* name, size_t length, uint32_t extent) = 0;
    virtual void beginFeature(Geometry type) = 0;
    virtual void moveTo(int32_t x, int32_t y) = 0;
    virtual void lineTo(int32_t x, int32_t y) = 0;
    virtual void closePath() = 0;
};

/// Rejects malformed framing/commands. Never allocates.
bool decode(const uint8_t* data, size_t length, Sink& sink);
} // namespace VectorTile
} // namespace MapKit
#endif
