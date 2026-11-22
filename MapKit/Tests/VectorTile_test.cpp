#include <MapKit/VectorTile.hpp>

#include <cassert>
#include <cstdint>
#include <string>
#include <vector>

using Bytes = std::vector<uint8_t>;

static void varint(Bytes& out, uint64_t n)
{
    while (n > 127) {
        out.push_back(static_cast<uint8_t>(n) | 128);
        n >>= 7;
    }
    out.push_back(static_cast<uint8_t>(n));
}

static void bytes(Bytes& out, uint8_t tag, const Bytes& payload)
{
    varint(out, (tag << 3) | 2);
    varint(out, payload.size());
    out.insert(out.end(), payload.begin(), payload.end());
}

static void number(Bytes& out, uint8_t tag, uint32_t value)
{
    varint(out, tag << 3);
    varint(out, value);
}

static Bytes tile(const Bytes& commands)
{
    Bytes feature;
    bytes(feature, 4, commands);
    number(feature, 3, 2); // line
    Bytes layer;
    bytes(layer, 2, feature); // deliberately before metadata
    number(layer, 5, 4096);
    bytes(layer, 1, {'r', 'o', 'a', 'd'});
    number(layer, 15, 2);
    Bytes result;
    bytes(result, 3, layer);
    return result;
}

struct Sink : MapKit::VectorTile::Sink {
    std::vector<std::string> events;
    void beginLayer(const char* name, size_t length, uint32_t extent) override
    {
        events.push_back(std::string(name, length) + ":" + std::to_string(extent));
    }
    void beginFeature(MapKit::VectorTile::Geometry type) override
    {
        events.push_back("type:" + std::to_string(static_cast<int>(type)));
    }
    void moveTo(int32_t x, int32_t y) override
    {
        events.push_back("move:" + std::to_string(x) + "," + std::to_string(y));
    }
    void lineTo(int32_t x, int32_t y) override
    {
        events.push_back("line:" + std::to_string(x) + "," + std::to_string(y));
    }
    void closePath() override { events.push_back("close"); }
};

int main()
{
    const Bytes valid = tile({9, 20, 40, 18, 10, 5, 2, 0});
    Sink sink;
    assert(MapKit::VectorTile::decode(valid.data(), valid.size(), sink));
    assert((sink.events == std::vector<std::string>{
        "road:4096", "type:2", "move:10,20", "line:15,17", "line:16,17"}));
    for (const Bytes& commands : {
             Bytes{9, 20},                  // missing Y
             Bytes{0},                      // zero repetitions
             Bytes{18, 0, 0},               // line before move
             Bytes{0xff, 0xff, 0xff, 0xff, 0x0f}, // giant count
             Bytes{9, 0, 0, 18, 0, 0, 15},  // close path on line
         }) {
        const Bytes invalid = tile(commands);
        Sink rejected;
        assert(!MapKit::VectorTile::decode(invalid.data(), invalid.size(), rejected));
    }
    for (size_t n = 0; n < valid.size(); ++n) {
        Sink rejected;
        assert(!MapKit::VectorTile::decode(valid.data(), n, rejected));
    }
    return 0;
}
