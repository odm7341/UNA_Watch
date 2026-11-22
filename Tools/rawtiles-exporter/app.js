import {style} from './map-style.js';
import { MAX_MERCATOR_LAT, countTiles, formatBytes, tileRanges } from './tile-math.js';
import {prepareSources} from './watch-geometry.mjs';
import {createVectorPack, addVectorTile, finishVectorPack} from './vector-pack.mjs';
import {rasterizeTile, renderWatch} from './watch-preview.mjs';

const MAX_EXPORT_TILES = 1024;
const status = document.querySelector('#status');
const centerReadout = document.querySelector('#center');
const zoomReadout = document.querySelector('#zoom');
const estimate = document.querySelector('#estimate');
const zoomMinInput = document.querySelector('#zoom-min');
const zoomMaxInput = document.querySelector('#zoom-max');
const exportButton = document.querySelector('#export-pack');
const selectViewButton = document.querySelector('#select-view');
const watchPreview = document.querySelector('#watch-preview');
const watchPreviewToggle = document.querySelector('#watch-preview-toggle');
const watchPreviewClose = document.querySelector('#watch-preview-close');
const mainPreview = document.querySelector('#map-preview');
const watchCanvas = document.querySelector('#watch-map');
const selectionOutline = document.querySelector('#selection-outline');

let selectedBounds;
let selecting = false;
let selectionStart;
let exportInProgress = false;
let previewVersion = 0;
let previewTiles = new Map();
let sourcePromise;

const map = new maplibregl.Map({
  container: 'map',
  // MapLibre handles gestures and projection only. It must never contribute
  // desktop-style pixels, labels, or a separately styled watch mockup.
  style: {version:8, sources:{}, layers:[{id:'background', type:'background',
    paint:{'background-color':'#e0dcd4'}}]},
  center: [-70.7746224, 43.4387179],
  zoom: 12,
  minZoom: 8,
  maxZoom: 14,
  attributionControl: false
});
map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'imperial' }), 'bottom-left');

for (let zoom = 8; zoom <= 14; zoom += 1) {
  for (const input of [zoomMinInput, zoomMaxInput]) {
    const option = document.createElement('option');
    option.value = String(zoom);
    option.textContent = String(zoom);
    input.append(option);
  }
}
zoomMinInput.value = '11';
zoomMaxInput.value = '13';

function updateReadout() {
  const center = map.getCenter();
  centerReadout.textContent = `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;
  zoomReadout.textContent = `z${previewZoom()} (watch tile zoom)`;
}

function previewZoom() {
  return Math.max(Number(zoomMinInput.value),
    Math.min(Number(zoomMaxInput.value), Math.round(map.getZoom())));
}

function enabledLayers() {
  const names = {landcover:'land', water:'water', contours:'contour', roads:'road',
    trails:'trail', peaks:'peak'};
  return new Set(Array.from(document.querySelectorAll('[data-layer]:checked'),
    el => names[el.dataset.layer]));
}

function resizeMainPreview() {
  const ratio = window.devicePixelRatio || 1;
  // 1 canvas pixel = 1 watch pixel, even on high-DPI desktop screens.
  mainPreview.width = Math.ceil(mainPreview.clientWidth);
  mainPreview.height = Math.ceil(mainPreview.clientHeight);
  mainPreview.style.imageRendering = ratio > 1 ? 'pixelated' : 'auto';
  schedulePreview();
}

function schedulePreview(reloadSources = false) {
  if (reloadSources) { sourcePromise = undefined; previewTiles = new Map(); }
  mainPreview.style.opacity = '0';
  if (!exportInProgress) setStatus('Preparing watch-style tiles…');
  const version = ++previewVersion;
  const cache = previewTiles;
  void (async () => {
    try {
      sourcePromise ??= prepareSources(style, enabledLayers());
      const fetchTile = await sourcePromise;
      const zoom = previewZoom();
      const range = selectedRanges().find(r => r.zoom === zoom);
      const getTile = async tile => {
        if (!range || tile.x < range.minX || tile.x > range.maxX ||
            tile.y < range.minY || tile.y > range.maxY) return null;
        const key = `${tile.z}/${tile.x}/${tile.y}`;
        if (!cache.has(key)) {
          const bytes = await fetchTile(tile);
          cache.set(key, rasterizeTile(bytes));
          if (cache.size > 96) cache.delete(cache.keys().next().value);
        }
        return cache.get(key);
      };
      if (version !== previewVersion) return;
      const center = map.getCenter();
      await renderWatch(mainPreview, center, zoom, getTile, () => version === previewVersion);
      if (!watchPreview.hidden && version === previewVersion)
        await renderWatch(watchCanvas, center, zoom, getTile, () => version === previewVersion);
      if (version === previewVersion) {
        mainPreview.style.opacity = '1';
        if (!exportInProgress)
          setStatus('Watch-style preview ready. Shift-drag to select export coverage.');
      }
    } catch (error) {
      if (version === previewVersion) {
        sourcePromise = undefined;
        setStatus(error.message || 'Watch preview failed.', true);
      }
    }
  })();
}

function showWatchPreview() {
  watchPreview.hidden = false;
  watchPreviewToggle.setAttribute('aria-expanded', 'true');
  schedulePreview();
}

function hideWatchPreview() {
  watchPreview.hidden = true;
  watchPreviewToggle.setAttribute('aria-expanded', 'false');
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function selectedRanges() {
  if (!selectedBounds) return [];
  return tileRanges(selectedBounds, Number(zoomMinInput.value), Number(zoomMaxInput.value));
}

function updateEstimate() {
  const ranges = selectedRanges();
  const count = countTiles(ranges);
  const minZoom = Number(zoomMinInput.value);
  const maxZoom = Number(zoomMaxInput.value);
  if (!selectedBounds) {
    estimate.textContent = 'Choose a coverage area.';
    exportButton.disabled = true;
    return;
  }
  if (minZoom > maxZoom || count === 0) {
    estimate.textContent = 'Choose a valid zoom range.';
    exportButton.disabled = true;
    return;
  }
  const coverage = `${selectedBounds.getSouth().toFixed(4)}, ${selectedBounds.getWest().toFixed(4)} → ${selectedBounds.getNorth().toFixed(4)}, ${selectedBounds.getEast().toFixed(4)}`;
  estimate.textContent = `${count.toLocaleString()} tiles · up to ${formatBytes(228+count*(16384+20))}\nz${minZoom}–${maxZoom} · ${coverage}${count > MAX_EXPORT_TILES ? `\nLimit: ${MAX_EXPORT_TILES.toLocaleString()} tiles per browser export.` : ''}`;
  exportButton.disabled = count > MAX_EXPORT_TILES || exportInProgress;
}

function setSelectedBounds(bounds) {
  selectedBounds = new maplibregl.LngLatBounds(bounds.getSouthWest(), bounds.getNorthEast());
  updateEstimate();
  if (!selecting) schedulePreview();
}

function beginSelection(event) {
  if (!event.originalEvent.shiftKey || exportInProgress) return;
  selecting = true;
  selectionStart = event.lngLat;
  map.dragPan.disable();
  map.getCanvas().style.cursor = 'crosshair';
  selectionOutline.hidden = false;
}

function moveSelection(event) {
  if (!selecting) return;
  setSelectedBounds(new maplibregl.LngLatBounds(selectionStart, event.lngLat));
  const start = map.project(selectionStart);
  selectionOutline.style.left = `${Math.min(start.x, event.point.x)}px`;
  selectionOutline.style.top = `${Math.min(start.y, event.point.y)}px`;
  selectionOutline.style.width = `${Math.abs(start.x - event.point.x)}px`;
  selectionOutline.style.height = `${Math.abs(start.y - event.point.y)}px`;
}

function endSelection() {
  if (!selecting) return;
  selecting = false;
  map.dragPan.enable();
  map.getCanvas().style.cursor = '';
  selectionOutline.hidden = true;
  schedulePreview();
}

function selectionCoversMercator() {
  return selectedBounds && selectedBounds.getNorth() <= MAX_MERCATOR_LAT && selectedBounds.getSouth() >= -MAX_MERCATOR_LAT;
}

async function exportVectorPack() {
  const ranges = selectedRanges();
  const count = countTiles(ranges);
  if (!selectionCoversMercator() || !count || count > MAX_EXPORT_TILES) return;
  exportInProgress = true;
  exportButton.disabled = true;
  selectViewButton.disabled = true;
  zoomMinInput.disabled = true;
  zoomMaxInput.disabled = true;
  try {
    const pack = createVectorPack(ranges, Number(zoomMinInput.value), Number(zoomMaxInput.value));
    const fetchTile = await prepareSources(style, enabledLayers());
    for (let number = 0; number < pack.tiles.length; number += 1) {
      const tile = pack.tiles[number];
      setStatus(`Packing ${number + 1}/${pack.tiles.length}: z${tile.z}/${tile.x}/${tile.y}`);
      addVectorTile(pack, tile, await fetchTile(tile));
    }
    const file = finishVectorPack(pack);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = `una-topo-z${zoomMinInput.value}-${zoomMaxInput.value}.vtiles`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    setStatus(`Downloaded ${link.download} (${formatBytes(file.size)}).`);
  } catch (error) {
    setStatus(error.message || 'Vector export failed.', true);
  } finally {
    exportInProgress = false;
    selectViewButton.disabled = false;
    zoomMinInput.disabled = false;
    zoomMaxInput.disabled = false;
    updateEstimate();
  }
}

map.on('move', updateReadout);
map.on('movestart', () => { mainPreview.style.opacity = '0'; });
map.on('moveend', () => schedulePreview());
map.on('mousedown', beginSelection);
map.on('mousemove', moveSelection);
map.on('mouseup', endSelection);
map.on('load', () => {
  updateReadout();
  resizeMainPreview();
  setSelectedBounds(map.getBounds());
  setStatus('Watch-style preview loading — shift-drag to select export coverage.');
});
map.on('error', event => {
  const message = event.error?.message || 'Map tile request failed.';
  if (!message.includes('Source') && !message.includes('style')) setStatus(message, true);
});
document.querySelectorAll('[data-layer]').forEach(input =>
  input.addEventListener('change', () => schedulePreview(true)));
selectViewButton.addEventListener('click', () => setSelectedBounds(map.getBounds()));
for (const input of [zoomMinInput, zoomMaxInput]) input.addEventListener('change', () => {
  updateEstimate(); updateReadout(); schedulePreview();
});
exportButton.addEventListener('click', exportVectorPack);
watchPreviewToggle.addEventListener('click', showWatchPreview);
watchPreviewClose.addEventListener('click', hideWatchPreview);
window.addEventListener('resize', resizeMainPreview);
