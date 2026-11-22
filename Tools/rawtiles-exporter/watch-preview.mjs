import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';

// Match MapKit/Sources/TileCache.cpp and MapTileView.cpp. Values are the
// ABGR2222 palette expanded to RGB; 0 is the paper inside a present tile.
export const WATCH_COLORS = ['#ffffaa', '#55aa55', '#55aaff', '#000000'];
export const NO_TILE_COLOR = '#e0dcd4';
const SIDE = 256;

export function rasterizeTile(bytes) {
  const pixels = new Uint8Array(SIDE * SIDE);
  const layers = new VectorTile(new Pbf(bytes)).layers;
  let budget = 500000;
  const dot = (x, y, color) => {
    if (x >= 0 && x < SIDE && y >= 0 && y < SIDE) pixels[y * SIDE + x] = color;
  };
  for (const [name, layer] of Object.entries(layers)) {
    if (layer.extent !== SIDE) throw new Error('Unexpected watch tile extent');
    const color = name === 'land' ? 1 : name === 'water' ? 2 :
      ['contour', 'road', 'trail', 'peak'].includes(name) ? 3 : 0;
    if (!color) continue;
    for (let featureIndex = 0; featureIndex < layer.length; featureIndex++) {
      const feature = layer.feature(featureIndex);
      for (const path of feature.loadGeometry()) {
        if (!path.length) continue;
        if (path.some(({x, y}) => x < -8 || x > 264 || y < -8 || y > 264))
          throw new Error('Watch tile coordinates out of range');
        if (feature.type === 1) {
          for (const p of path) dot(p.x, p.y, color);
        } else if (feature.type === 2) {
          let last = path[0];
          for (const end of path.slice(1)) {
            let x = last.x, y = last.y;
            const dx = Math.abs(end.x - x), dy = -Math.abs(end.y - y);
            budget -= 1 + Math.max(dx, -dy);
            if (budget < 0) throw new Error('Watch tile drawing budget exceeded');
            const sx = x < end.x ? 1 : -1, sy = y < end.y ? 1 : -1;
            let err = dx + dy;
            for (let i = 0; ; i++) {
              if ((name !== 'trail' || i % 6 < 4) &&
                  (name !== 'contour' || ((x + y) & 3) === 0)) dot(x, y, color);
              if (x === end.x && y === end.y) break;
              const e = 2 * err;
              if (e >= dy) { err += dy; x += sx; }
              if (e <= dx) { err += dx; y += sy; }
            }
            last = end;
          }
        } else if (feature.type === 3) {
          // The exporter triangulates holes before writing the MVT. MVT's
          // loadGeometry repeats the first vertex for ClosePath.
          if (path.length !== 4) throw new Error('Watch fill is not a triangle');
          const [a, b, c] = path.slice(0, 3).sort((p, q) => p.y - q.y);
          const cross = (p, q, y) => p.x + Math.trunc((q.x - p.x) * (y - p.y) / (q.y - p.y));
          for (let y = Math.max(a.y, 0); y < Math.min(c.y, SIDE); y++) {
            let left = cross(a, c, y), right = y < b.y ? cross(a, b, y) : cross(b, c, y);
            if (left > right) [left, right] = [right, left];
            left = Math.max(0, left); right = Math.min(SIDE, right);
            budget -= 4 + Math.trunc(Math.max(0, right - left) / 4);
            if (budget < 0) throw new Error('Watch tile drawing budget exceeded');
            for (let x = left; x < right; x++) dot(x, y, color);
          }
        }
      }
    }
  }
  return pixels;
}

export function watchCenter({lat, lng}, zoom) {
  const lon = Math.round(lng * 1e6) / 1e6;
  const latitude = Math.max(-85.051129, Math.min(85.051129, Math.round(lat * 1e6) / 1e6));
  const size = SIDE * 2 ** zoom;
  const x = Math.round((lon + 180) / 360 * size);
  const y = Math.max(0, Math.min(size - 1,
    Math.round((1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * size)));
  return {x, y};
}

export async function renderWatch(canvas, center, zoom, getTile, isCurrent = () => true) {
  const {width, height} = canvas;
  const ctx = canvas.getContext('2d', {alpha:false});
  ctx.fillStyle = NO_TILE_COLOR;
  ctx.fillRect(0, 0, width, height);
  const {x, y} = watchCenter(center, zoom);
  const left = x - Math.floor(width / 2), top = y - Math.floor(height / 2);
  const tileLeft = Math.max(0, Math.floor(left / SIDE));
  const tileRight = Math.min(2 ** zoom - 1, Math.floor((left + width - 1) / SIDE));
  const tileTop = Math.max(0, Math.floor(top / SIDE));
  const tileBottom = Math.min(2 ** zoom - 1, Math.floor((top + height - 1) / SIDE));
  for (let ty = tileTop; ty <= tileBottom; ty++) {
    for (let tx = tileLeft; tx <= tileRight; tx++) {
      const pixels = await getTile({z:zoom, x:tx, y:ty});
      if (!isCurrent()) return;
      if (!pixels) continue;
      const image = ctx.createImageData(SIDE, SIDE);
      for (let i = 0; i < pixels.length; i++) {
        const color = pixels[i];
        const offset = 4 * i;
        image.data[offset] = [255, 85, 85, 0][color];
        image.data[offset + 1] = [255, 170, 170, 0][color];
        image.data[offset + 2] = [170, 85, 255, 0][color];
        image.data[offset + 3] = 255;
      }
      // Clipping is delegated to the canvas exactly as MapTileView clips its
      // 256px tile blits against the screen.
      const buffer = typeof OffscreenCanvas === 'undefined'
        ? document.createElement('canvas') : new OffscreenCanvas(SIDE, SIDE);
      buffer.width = buffer.height = SIDE;
      buffer.getContext('2d').putImageData(image, 0, 0);
      ctx.drawImage(buffer, tx * SIDE - left, ty * SIDE - top);
    }
  }
  // Live breadcrumb points cannot be known by an exporter. The center fix
  // marker matches MapTileView::drawMarker() in its fixed state.
  const cx = Math.floor(width / 2), cy = Math.floor(height / 2);
  ctx.fillStyle = '#000000'; ctx.fillRect(cx - 6, cy - 6, 13, 13);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 4, cy - 4, 9, 9);
  ctx.fillStyle = '#000000'; ctx.fillRect(cx - 1, cy - 1, 3, 3);
}
