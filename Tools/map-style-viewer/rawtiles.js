export const TILE_DIM = 256;
export const TILE_BYTES = TILE_DIM * TILE_DIM;
export const HEADER_BYTES = 292;
export const INDEX_ENTRY_BYTES = 20;
export const MAX_MERCATOR_LAT = 85.05112878;
export const ATTRIBUTION = 'OpenFreeMap © OpenStreetMap contributors | Contours © OpenStreetMap US, Mapzen DEM.';

const crcTable = buildCrcTable();

export function clampLatitude(latitude) {
  return Math.min(MAX_MERCATOR_LAT, Math.max(-MAX_MERCATOR_LAT, latitude));
}

export function lonToTileX(longitude, zoom) {
  const tilesAcross = 2 ** zoom;
  return Math.min(tilesAcross - 1, Math.max(0, Math.floor((longitude + 180) / 360 * tilesAcross)));
}

export function latToTileY(latitude, zoom) {
  const tilesAcross = 2 ** zoom;
  const radians = clampLatitude(latitude) * Math.PI / 180;
  return Math.min(tilesAcross - 1, Math.max(0, Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * tilesAcross)));
}

export function tileXToLon(x, zoom) {
  return x / (2 ** zoom) * 360 - 180;
}

export function tileYToLat(y, zoom) {
  const mercator = Math.PI * (1 - 2 * y / (2 ** zoom));
  return Math.atan(Math.sinh(mercator)) * 180 / Math.PI;
}

export function tileRanges(bounds, minZoom, maxZoom) {
  if (minZoom > maxZoom || bounds.getWest() > bounds.getEast()) return [];
  const ranges = [];
  for (let zoom = minZoom; zoom <= maxZoom; zoom += 1) {
    ranges.push({
      zoom,
      minX: lonToTileX(bounds.getWest(), zoom),
      maxX: lonToTileX(bounds.getEast(), zoom),
      minY: latToTileY(bounds.getNorth(), zoom),
      maxY: latToTileY(bounds.getSouth(), zoom)
    });
  }
  return ranges;
}

export function countTiles(ranges) {
  return ranges.reduce((count, range) => count + (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1), 0);
}

export function enumerateTiles(ranges) {
  const tiles = [];
  for (const range of ranges) {
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) tiles.push({ z: range.zoom, x, y });
    }
  }
  return tiles;
}

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function attributeExtension() {
  const payload = new TextEncoder().encode(ATTRIBUTION);
  const padding = (4 - payload.length % 4) % 4;
  const extension = new Uint8Array(8 + payload.length + padding);
  extension.set([0x41, 0x54, 0x54, 0x52]);
  new DataView(extension.buffer).setUint32(4, payload.length, true);
  extension.set(payload, 8);
  return extension;
}

export function estimatedPackBytes(tileCount) {
  return HEADER_BYTES + tileCount * (INDEX_ENTRY_BYTES + TILE_BYTES) + attributeExtension().byteLength + 4;
}

function coverageBbox(ranges) {
  let west = 180, south = 90, east = -180, north = -90;
  for (const range of ranges) {
    west = Math.min(west, tileXToLon(range.minX, range.zoom));
    east = Math.max(east, tileXToLon(range.maxX + 1, range.zoom));
    north = Math.max(north, tileYToLat(range.minY, range.zoom));
    south = Math.min(south, tileYToLat(range.maxY + 1, range.zoom));
  }
  return [west, south, east, north].map(value => Math.round(value * 1_000_000));
}

function header(tiles, ranges, minZoom, maxZoom, extensionOffset) {
  const result = new Uint8Array(HEADER_BYTES);
  const view = new DataView(result.buffer);
  result.set([0x52, 0x41, 0x57, 0x54], 0);
  view.setUint8(4, 1);
  crypto.getRandomValues(result.subarray(8, 24));
  view.setUint8(56, 1);
  view.setUint8(57, 1);
  view.setUint8(58, 1);
  view.setUint8(59, 1);
  view.setUint16(60, TILE_DIM, true);
  view.setUint8(62, minZoom);
  view.setUint8(63, maxZoom);
  coverageBbox(ranges).forEach((value, index) => view.setInt32(64 + index * 4, value, true));
  view.setBigUint64(80, BigInt(Math.floor(Date.now() / 1000)), true);
  view.setUint32(88, tiles.length, true);
  view.setUint32(92, HEADER_BYTES, true);
  let start = 0;
  for (const range of ranges) {
    const count = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
    view.setUint32(96 + range.zoom * 8, HEADER_BYTES + start * INDEX_ENTRY_BYTES, true);
    view.setUint32(100 + range.zoom * 8, count, true);
    start += count;
  }
  view.setUint32(288, extensionOffset, true);
  return result;
}

function index(tiles) {
  const result = new Uint8Array(tiles.length * INDEX_ENTRY_BYTES);
  const view = new DataView(result.buffer);
  const tileDataOffset = HEADER_BYTES + result.byteLength;
  for (let number = 0; number < tiles.length; number += 1) {
    const tile = tiles[number];
    const offset = number * INDEX_ENTRY_BYTES;
    view.setUint8(offset, tile.z);
    view.setUint32(offset + 4, tile.x, true);
    view.setUint32(offset + 8, tile.y, true);
    view.setUint32(offset + 12, tileDataOffset + number * TILE_BYTES, true);
    view.setUint32(offset + 16, TILE_BYTES, true);
  }
  return result;
}

export function startPack(ranges, minZoom, maxZoom) {
  const tiles = enumerateTiles(ranges);
  const extension = attributeExtension();
  const extensionOffset = HEADER_BYTES + tiles.length * INDEX_ENTRY_BYTES + tiles.length * TILE_BYTES;
  const packHeader = header(tiles, ranges, minZoom, maxZoom, extensionOffset);
  const packIndex = index(tiles);
  return { tiles, extension, chunks: [packHeader, packIndex], crc: crc32(packIndex, crc32(packHeader)) };
}

export function appendTile(pack, tilePixels) {
  if (tilePixels.byteLength !== TILE_BYTES) throw new Error('Rendered tile has an invalid ABGR2222 size.');
  pack.chunks.push(tilePixels);
  pack.crc = crc32(tilePixels, pack.crc);
}

export function finishPack(pack) {
  pack.chunks.push(pack.extension);
  const footer = new Uint8Array(4);
  new DataView(footer.buffer).setUint32(0, crc32(pack.extension, pack.crc), true);
  pack.chunks.push(footer);
  return new Blob(pack.chunks, { type: 'application/octet-stream' });
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
}

function crc32(bytes, crc = 0) {
  let value = (crc ^ 0xffffffff) >>> 0;
  for (const byte of bytes) value = (crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)) >>> 0;
  return (value ^ 0xffffffff) >>> 0;
}
