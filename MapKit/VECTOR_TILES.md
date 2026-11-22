# VMAP offline vector packs

HikeMap and RunMap select verified `.vtiles` packs by GPS coverage. Map Manager checks the CRC in the background; a missing, stale or Bad verdict cannot authorize drawing.

## VMAP v1 wire format

All integers are little-endian, coordinates use XYZ/Web Mercator. The header
is 224 bytes:

| Offset | Type | Contents |
| --- | --- | --- |
| 0 | 4 bytes | `VMAP` |
| 4 | u8 | version = 1 |
| 5, 6 | u8 each | minimum, maximum stored zoom (maximum 17; older readers accept up to 14) |
| 7 | u8 | reserved = 0 |
| 8 | u32 | tile count, 1–1024 |
| 12–24 | four i32 | west, south, east, north in microdegrees |
| 28 | u32 | index offset = 224 |
| 32 | u32 | payload offset = 224 + 20 × tile count |
| 36 | u16 | attribution UTF-8 byte length, 1–160 |
| 38 | u16 | reserved = 0 |
| 40–199 | bytes | attribution, zero-padded |
| 200–223 | bytes | reserved = 0 |

Each 20-byte index entry contains `z:u8`, three zero bytes, `x:u32`,
`y:u32`, `offset:u32`, `length:u32`; entries strictly ascend in `(z,x,y)`.
Tile payloads are contiguous, uncompressed MVT v2 protobuf messages of
1–16384 bytes. The final four bytes contain the CRC-32/ISO-HDLC of everything
preceding them. An `*.vtiles.trust` marker must match both this file's size
and its declared CRC before any payload is rendered.

## Watch profile and RAM budget

The exporter clips and simplifies geometry, resolves polygon holes, triangulates
fills, and writes MVT v2 layers in paint order (`land`, `water`, `contour`,
`road`, `trail`, `peak`) at extent 256. Coordinates are tile-local. It packages
one z14 spatial grid. Display zooms 14–17 reuse this same geometry,
transforming vertices before scan conversion into the cached display tile.
Legacy multilevel packs retain their stored zoom range. Sources above their native maximum are clipped from the parent
at export time. The watch draws
triangles, lines and points using integer arithmetic. Labels are preview-only.
An arbitrary provider PBF is not a prepared watch tile.

A 240×240 viewport intersects at most four 256px XYZ tiles. The four slots
are keyed by the parity of X and Y, so neighbors never evict each other.
Each cached tile takes 16 KiB at two bits/pixel. Cache hits do not access the
filesystem or decode MVT. Cache and input scratch are static (64 + 16 KiB);
only damaged spans are expanded into a reusable 2 KiB LCD band. Both the
writer and reader cap pack size at 16,384 tiles. This is a practical limit
for export and verification time, not a cache requirement. VMAP v1's
32-bit offsets and reader size check impose a separate ceiling below 4 GiB.
Expensive geometry is
simplified on the desktop or rejected; it cannot grow the watch heap. The
index is checked in batches when opened, not re-scanned at each sample.

## Tests

```sh
npm --prefix Tools/rawtiles-exporter ci
npm --prefix Tools/rawtiles-exporter test
g++ -std=c++17 -Wall -Wextra -Werror -IMapKit/Header \
  MapKit/Sources/VectorTile.cpp MapKit/Tests/VectorTile_test.cpp \
  -o /tmp/mapkit-vector-test && /tmp/mapkit-vector-test
```

`VectorPack_test.cpp` runs with MapKit's kernel host suite and uses the
SDK's in-memory filesystem. Its `open()` checks structure only; background
CRC verification remains MapManager's responsibility.
