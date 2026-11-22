// VMAP v1: little-endian, uncompressed MVT payloads, XYZ addressing.
// Header (224 bytes): "VMAP", version, zoom range, tile count, bbox in
// microdegrees, index/data offsets, UTF-8 attribution (<=160 bytes).
// Index (20 bytes/entry): z, 3 reserved bytes, x, y, offset, length.
// Entries sorted by z/x/y, payloads contiguous; trailing CRC-32 of all
// preceding bytes, compatible with Map Manager's (size, CRC) trust marker.
export const HEADER_BYTES = 224;
export const ENTRY_BYTES = 20;
export const MAX_TILE_BYTES = 16384;
export const ATTRIBUTION = 'OpenFreeMap | © OpenMapTiles | © OpenStreetMap contributors | Contours © OpenStreetMap US, Mapzen DEM.';

function crc32(bytes, previous = 0) {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function lon(x, z) { return x * 360 / (2 ** z) - 180; }
function lat(y, z) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / (2 ** z)))) * 180 / Math.PI; }

export function createVectorPack(ranges, minZoom, maxZoom) {
  if (!ranges.length || minZoom < 0 || maxZoom > 14 || minZoom > maxZoom) throw new Error('Unsupported vector zoom range (0–14).');
  const tiles = [];
  if (ranges.length !== maxZoom-minZoom+1) throw new Error('Missing zoom levels.');
  for (const [i,range] of ranges.entries()) {
    if (range.zoom !== minZoom+i || ![range.minX,range.minY,range.maxX,range.maxY].every(v=>Number.isInteger(v)&&v>=0&&v<2**range.zoom)
      || range.minX>range.maxX || range.minY>range.maxY) throw new Error('Invalid XYZ range.');
    if ((range.maxX-range.minX+1)*(range.maxY-range.minY+1)>1024-tiles.length) throw new Error('Limit: 1024 tiles.');
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) tiles.push({ z: range.zoom, x, y });
    }
  }
  return packFromTiles(tiles,minZoom,maxZoom);
}

export function packFromTiles(tiles,minZoom,maxZoom) {
  if (!tiles.length || tiles.length > 1024) throw new Error('Pack must contain 1–1024 tiles.');
  let west=180,south=90,east=-180,north=-90;
  for(const {z,x,y} of tiles) {
    west=Math.min(west,lon(x,z)); east=Math.max(east,lon(x+1,z));
    north=Math.max(north,lat(y,z)); south=Math.min(south,lat(y+1,z));
  }
  const attribution = new TextEncoder().encode(ATTRIBUTION);
  if (attribution.length > 160) throw new Error('Attribution does not fit VMAP header.');
  const header = new Uint8Array(HEADER_BYTES);
  const view = new DataView(header.buffer);
  header.set([0x56, 0x4d, 0x41, 0x50, 1, minZoom, maxZoom]);
  view.setUint32(8, tiles.length, true);
  [west, south, east, north].forEach((value, index) => view.setInt32(12 + index * 4, Math.round(value * 1e6), true));
  view.setUint32(28, HEADER_BYTES, true);
  view.setUint32(32, HEADER_BYTES + tiles.length * ENTRY_BYTES, true);
  view.setUint16(36, attribution.length, true);
  header.set(attribution, 40);
  return { tiles, header, payloads: [] };
}

export function addVectorTile(pack, tile, pbf) {
  if (pack.payloads.length >= pack.tiles.length) throw new Error('Too many tiles.');
  const expected = pack.tiles[pack.payloads.length];
  if (tile.z !== expected.z || tile.x !== expected.x || tile.y !== expected.y) throw new Error('Tile order does not match index.');
  if (!(pbf instanceof Uint8Array) || pbf.length === 0 || pbf.length > MAX_TILE_BYTES) {
    throw new Error(`Tile ${tile.z}/${tile.x}/${tile.y} exceeds the watch's 16 KiB buffer or is empty.`);
  }
  pack.payloads.push(pbf);
}

export function finishVectorPack(pack) {
  if (pack.payloads.length !== pack.tiles.length) throw new Error('Missing vector tiles.');
  const index = new Uint8Array(pack.tiles.length * ENTRY_BYTES);
  const view = new DataView(index.buffer);
  let offset = HEADER_BYTES + index.length;
  for (let i = 0; i < pack.tiles.length; i += 1) {
    const tile = pack.tiles[i];
    const entry = i * ENTRY_BYTES;
    view.setUint8(entry, tile.z);
    view.setUint32(entry + 4, tile.x, true);
    view.setUint32(entry + 8, tile.y, true);
    view.setUint32(entry + 12, offset, true);
    view.setUint32(entry + 16, pack.payloads[i].length, true);
    offset += pack.payloads[i].length;
  }
  if (offset > 0xffffffff - 4) throw new Error('Pack exceeds 4 GiB.');
  let crc = crc32(pack.header);
  crc = crc32(index, crc);
  for (const payload of pack.payloads) crc = crc32(payload, crc);
  const footer = new Uint8Array(4);
  new DataView(footer.buffer).setUint32(0, crc, true);
  return new Blob([pack.header, index, ...pack.payloads, footer], { type: 'application/octet-stream' });
}
