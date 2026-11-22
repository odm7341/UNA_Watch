#include <MapKit/VectorTile.hpp>

#include <climits>

namespace MapKit
{
namespace VectorTile
{
namespace
{
struct Reader {
    const uint8_t* pos;
    const uint8_t* end;
    bool varint(uint64_t& value)
    {
        value = 0;
        for (unsigned i = 0; i < 10; ++i) {
            if (pos == end) return false;
            const uint8_t byte = *pos++;
            if (i == 9 && byte > 1) return false;
            value |= static_cast<uint64_t>(byte & 127) << (7 * i);
            if (!(byte & 128)) return true;
        }
        return false;
    }
    bool bytes(Reader& child)
    {
        uint64_t length;
        if (!varint(length) || length > static_cast<uint64_t>(end - pos)) return false;
        child = {pos, pos + static_cast<size_t>(length)};
        pos = child.end;
        return true;
    }
    bool field(uint32_t& number, uint8_t& wire)
    {
        uint64_t tag;
        if (!varint(tag) || tag < 8 || (tag >> 3) > 0x1fffffff) return false;
        number = static_cast<uint32_t>(tag >> 3);
        wire = static_cast<uint8_t>(tag & 7);
        return wire == 0 || wire == 1 || wire == 2 || wire == 5;
    }
    bool skip(uint8_t wire)
    {
        uint64_t ignored;
        Reader child {};
        switch (wire) {
            case 0: return varint(ignored);
            case 1:
                if (end - pos < 8) return false;
                pos += 8;
                return true;
            case 2: return bytes(child);
            case 5:
                if (end - pos < 4) return false;
                pos += 4;
                return true;
            default: return false;
        }
    }
};

bool geometry(Reader commands, Geometry type, Sink& sink)
{
    int64_t x = 0, y = 0;
    bool hasMove = false;
    bool hasLine = false;
    while (commands.pos != commands.end) {
        uint64_t command;
        if (!commands.varint(command)) return false;
        const uint64_t count = command >> 3;
        const uint8_t op = static_cast<uint8_t>(command & 7);
        if (count == 0 || count > UINT32_MAX
            || (op != 1 && op != 2 && op != 7)
            || (op == 2 && (type == Geometry::Point || !hasMove))
            || (op == 7 && (type != Geometry::Polygon || count != 1 || !hasLine))) {
            return false;
        }
        if (op == 7) {
            sink.closePath();
            hasLine = false;
            continue;
        }
        if (count > static_cast<size_t>(commands.end - commands.pos) / 2) return false;
        for (uint32_t i = 0; i < count; ++i) {
            uint64_t dx, dy;
            if (!commands.varint(dx) || !commands.varint(dy)
                || dx > UINT32_MAX || dy > UINT32_MAX) return false;
            x += static_cast<int64_t>(dx >> 1) ^ -static_cast<int64_t>(dx & 1);
            y += static_cast<int64_t>(dy >> 1) ^ -static_cast<int64_t>(dy & 1);
            if (x < INT32_MIN || x > INT32_MAX || y < INT32_MIN || y > INT32_MAX) return false;
            if (op == 1) {
                sink.moveTo(static_cast<int32_t>(x), static_cast<int32_t>(y));
                hasMove = true;
                hasLine = false;
            } else {
                sink.lineTo(static_cast<int32_t>(x), static_cast<int32_t>(y));
                hasLine = true;
            }
        }
    }
    return hasMove;
}

bool feature(Reader input, Sink& sink)
{
    Geometry type = Geometry::Point;
    bool hasType = false, hasGeometry = false;
    Reader commands {};
    while (input.pos != input.end) {
        uint32_t field;
        uint8_t wire;
        if (!input.field(field, wire)) return false;
        if ((field == 3 && wire != 0) || (field == 4 && wire != 2)) return false;
        if (field == 3) {
            uint64_t value;
            if (hasType || !input.varint(value) || value < 1 || value > 3) return false;
            type = static_cast<Geometry>(value);
            hasType = true;
        } else if (field == 4) {
            if (hasGeometry || !input.bytes(commands)) return false;
            hasGeometry = true;
        } else if (!input.skip(wire)) return false;
    }
    if (!hasType || !hasGeometry) return false;
    sink.beginFeature(type);
    return geometry(commands, type, sink);
}

bool layer(Reader input, Sink& sink)
{
    Reader name {};
    uint32_t extent = 4096;
    bool hasName = false, hasVersion = false;
    Reader scan = input;
    while (scan.pos != scan.end) {
        uint32_t field;
        uint8_t wire;
        if (!scan.field(field, wire)) return false;
        if ((field == 1 && wire != 2) || (field == 2 && wire != 2)
            || (field == 5 && wire != 0) || (field == 15 && wire != 0)) return false;
        if (field == 1) {
            if (hasName || !scan.bytes(name)) return false;
            hasName = true;
        } else if (field == 5) {
            uint64_t value;
            if (!scan.varint(value) || value == 0 || value > 65536) return false;
            extent = static_cast<uint32_t>(value);
        } else if (field == 15) {
            uint64_t value;
            if (hasVersion || !scan.varint(value) || value != 2) return false;
            hasVersion = true;
        } else if (!scan.skip(wire)) return false;
    }
    if (!hasName || name.pos == name.end || !hasVersion) return false;
    sink.beginLayer(reinterpret_cast<const char*>(name.pos),
                    static_cast<size_t>(name.end - name.pos), extent);
    while (input.pos != input.end) {
        uint32_t field;
        uint8_t wire;
        if (!input.field(field, wire)) return false;
        if (field == 2) {
            Reader item {};
            if (!input.bytes(item) || !feature(item, sink)) return false;
        } else if (!input.skip(wire)) return false;
    }
    return true;
}

bool parse(const uint8_t* data, size_t length, Sink& sink)
{
    Reader input {data, data + length};
    bool seenLayer = false;
    while (input.pos != input.end) {
        uint32_t field;
        uint8_t wire;
        if (!input.field(field, wire) || (field == 3 && wire != 2)) return false;
        if (field == 3) {
            Reader item {};
            if (!input.bytes(item) || !layer(item, sink)) return false;
            seenLayer = true;
        } else if (!input.skip(wire)) return false;
    }
    return seenLayer;
}
} // namespace

bool decode(const uint8_t* data, size_t length, Sink& sink)
{
    if (!data || !length) return false;
    return parse(data, length, sink);
}
} // namespace VectorTile
} // namespace MapKit
