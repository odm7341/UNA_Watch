import { style } from './map-style.js';
import { TILE_BYTES, TILE_DIM, tileXToLon, tileYToLat } from './rawtiles.js';

function quantizeChannel(value) {
  if (value <= 42) return 0;
  if (value <= 127) return 1;
  if (value <= 212) return 2;
  return 3;
}

function quantizeCanvas(canvas) {
  const raster = document.createElement('canvas');
  raster.width = TILE_DIM;
  raster.height = TILE_DIM;
  const context = raster.getContext('2d', { willReadFrequently: true });
  context.drawImage(canvas, 0, 0, TILE_DIM, TILE_DIM);
  const rgba = context.getImageData(0, 0, TILE_DIM, TILE_DIM).data;
  const output = new Uint8Array(TILE_BYTES);
  for (let pixel = 0, source = 0; pixel < TILE_BYTES; pixel += 1, source += 4) {
    const red = quantizeChannel(rgba[source]);
    const green = quantizeChannel(rgba[source + 1]);
    const blue = quantizeChannel(rgba[source + 2]);
    output[pixel] = 0xc0 | blue << 4 | green << 2 | red;
  }
  return output;
}

function waitForIdle(map, tile) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`timed out rendering z${tile.z}/${tile.x}/${tile.y}`)), 30000);
    map.once('idle', () => { window.clearTimeout(timeout); resolve(); });
    map.once('error', event => { window.clearTimeout(timeout); reject(event.error || new Error('tile render failed')); });
  });
}

export async function renderVectorTile(tile, hiddenLayerIds) {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${TILE_DIM + 4}px;top:0;width:${TILE_DIM}px;height:${TILE_DIM}px;pointer-events:none;`;
  document.body.append(host);
  const exportStyle = structuredClone(style);
  for (const layer of exportStyle.layers) {
    if (hiddenLayerIds.includes(layer.id)) layer.layout = { ...layer.layout, visibility: 'none' };
  }
  const rendered = new maplibregl.Map({
    container: host,
    style: exportStyle,
    center: [tileXToLon(tile.x + 0.5, tile.z), tileYToLat(tile.y + 0.5, tile.z)],
    zoom: tile.z,
    minZoom: tile.z,
    maxZoom: tile.z,
    interactive: false,
    attributionControl: false,
    renderWorldCopies: false,
    fadeDuration: 0,
    preserveDrawingBuffer: true,
    pixelRatio: 1
  });
  try {
    await waitForIdle(rendered, tile);
    return quantizeCanvas(rendered.getCanvas());
  } finally {
    rendered.remove();
    host.remove();
  }
}
