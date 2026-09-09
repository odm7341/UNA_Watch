import { layerGroups, style } from './map-style.js';
import { MAX_MERCATOR_LAT, appendTile, countTiles, estimatedPackBytes, finishPack, formatBytes, startPack, tileRanges } from './rawtiles.js';
import { renderVectorTile } from './vector-renderer.js';

const MAX_EXPORT_TILES = 1024;
const status = document.querySelector('#status');
const centerReadout = document.querySelector('#center');
const zoomReadout = document.querySelector('#zoom');
const estimate = document.querySelector('#estimate');
const zoomMinInput = document.querySelector('#zoom-min');
const zoomMaxInput = document.querySelector('#zoom-max');
const exportButton = document.querySelector('#export-pack');
const selectViewButton = document.querySelector('#select-view');

let selectedBounds;
let selecting = false;
let selectionStart;
let exportInProgress = false;

const map = new maplibregl.Map({
  container: 'map',
  style,
  center: [-70.7746224, 43.4387179],
  zoom: 12,
  minZoom: 2,
  maxZoom: 14,
  attributionControl: true,
  preserveDrawingBuffer: true
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
  zoomReadout.textContent = map.getZoom().toFixed(2);
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
  estimate.textContent = `${count.toLocaleString()} tiles · ${formatBytes(estimatedPackBytes(count))}\nz${minZoom}–${maxZoom} · ${coverage}${count > MAX_EXPORT_TILES ? `\nLimit: ${MAX_EXPORT_TILES.toLocaleString()} tiles per browser export.` : ''}`;
  exportButton.disabled = count > MAX_EXPORT_TILES || exportInProgress;
}

function selectionFeature() {
  const west = selectedBounds.getWest();
  const east = selectedBounds.getEast();
  const south = selectedBounds.getSouth();
  const north = selectedBounds.getNorth();
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] } };
}

function setSelectedBounds(bounds) {
  selectedBounds = new maplibregl.LngLatBounds(bounds.getSouthWest(), bounds.getNorthEast());
  if (!map.getSource('export-area')) {
    map.addSource('export-area', { type: 'geojson', data: selectionFeature() });
    map.addLayer({ id: 'export-area-fill', type: 'fill', source: 'export-area', paint: { 'fill-color': '#55aaff', 'fill-opacity': 0.16 } });
    map.addLayer({ id: 'export-area-line', type: 'line', source: 'export-area', paint: { 'line-color': '#0055ff', 'line-width': 2 } });
  } else {
    map.getSource('export-area').setData(selectionFeature());
  }
  updateEstimate();
}

function beginSelection(event) {
  if (!event.originalEvent.shiftKey || exportInProgress) return;
  selecting = true;
  selectionStart = event.lngLat;
  map.dragPan.disable();
  map.getCanvas().style.cursor = 'crosshair';
}

function moveSelection(event) {
  if (selecting) setSelectedBounds(new maplibregl.LngLatBounds(selectionStart, event.lngLat));
}

function endSelection() {
  if (!selecting) return;
  selecting = false;
  map.dragPan.enable();
  map.getCanvas().style.cursor = '';
}

function selectionCoversMercator() {
  return selectedBounds && selectedBounds.getNorth() <= MAX_MERCATOR_LAT && selectedBounds.getSouth() >= -MAX_MERCATOR_LAT;
}

async function exportRawtiles() {
  const ranges = selectedRanges();
  const count = countTiles(ranges);
  if (!selectionCoversMercator() || !count || count > MAX_EXPORT_TILES) return;
  exportInProgress = true;
  exportButton.disabled = true;
  selectViewButton.disabled = true;
  zoomMinInput.disabled = true;
  zoomMaxInput.disabled = true;
  try {
    const pack = startPack(ranges, Number(zoomMinInput.value), Number(zoomMaxInput.value));
    const hiddenLayerIds = Array.from(document.querySelectorAll('[data-layer]'))
      .filter(input => !input.checked)
      .flatMap(input => layerGroups[input.dataset.layer]);
    for (let number = 0; number < pack.tiles.length; number += 1) {
      const tile = pack.tiles[number];
      setStatus(`Rendering ${number + 1}/${pack.tiles.length}: z${tile.z}/${tile.x}/${tile.y}`);
      appendTile(pack, await renderVectorTile(tile, hiddenLayerIds));
    }
    const file = finishPack(pack);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = `una-topo-z${zoomMinInput.value}-${zoomMaxInput.value}.rawtiles`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    setStatus(`Downloaded ${link.download} (${formatBytes(file.size)}).`);
  } catch (error) {
    setStatus(error.message || 'Rawtiles export failed.', true);
  } finally {
    exportInProgress = false;
    selectViewButton.disabled = false;
    zoomMinInput.disabled = false;
    zoomMaxInput.disabled = false;
    updateEstimate();
  }
}

map.on('move', updateReadout);
map.on('mousedown', beginSelection);
map.on('mousemove', moveSelection);
map.on('mouseup', endSelection);
map.on('load', () => {
  updateReadout();
  setSelectedBounds(map.getBounds());
  setStatus('PBF sources loaded — shift-drag to select export coverage.');
});
map.on('error', event => {
  const message = event.error?.message || 'Map tile request failed.';
  if (!message.includes('Source') && !message.includes('style')) setStatus(message, true);
});
document.querySelectorAll('[data-layer]').forEach(input => input.addEventListener('change', () => {
  for (const id of layerGroups[input.dataset.layer]) map.setLayoutProperty(id, 'visibility', input.checked ? 'visible' : 'none');
}));
selectViewButton.addEventListener('click', () => setSelectedBounds(map.getBounds()));
zoomMinInput.addEventListener('change', updateEstimate);
zoomMaxInput.addEventListener('change', updateEstimate);
exportButton.addEventListener('click', exportRawtiles);
