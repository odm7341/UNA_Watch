export const MAX_MERCATOR_LAT = 85.05112878;
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
