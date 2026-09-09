export const layerGroups = Object.freeze({
  landcover: ['landcover'],
  water: ['water-fill', 'waterway'],
  contours: ['contours-minor', 'contours-index'],
  roads: ['roads-casing', 'roads'],
  trails: ['trails', 'trail-labels'],
  peaks: ['peaks'],
  labels: ['place-labels', 'road-labels']
});

export const watchPalette = Object.freeze({
  paper: '#ffffaa',
  land: '#aaffaa',
  water: '#aaffff',
  waterway: '#00aaff',
  contourMinor: '#aa5500',
  contourIndex: '#550000',
  roadCasing: '#ffffff',
  road: '#ff0000',
  trail: '#000000',
  peak: '#000000',
  text: '#000000'
});

export const style = {
  version: 8,
  name: 'UNA essential topo',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    openfreemap: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenStreetMap contributors' },
    contours: { type: 'vector', url: 'https://tiles.openstreetmap.us/vector/contours-feet.json', attribution: 'Contours © OpenStreetMap US · Mapzen DEM' }
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': watchPalette.paper } },
    { id: 'landcover', type: 'fill', source: 'openfreemap', 'source-layer': 'landcover', minzoom: 8, filter: ['match', ['get', 'class'], ['wood', 'forest', 'scrub', 'grass'], true, false], paint: { 'fill-color': watchPalette.land } },
    { id: 'water-fill', type: 'fill', source: 'openfreemap', 'source-layer': 'water', paint: { 'fill-color': watchPalette.water } },
    { id: 'waterway', type: 'line', source: 'openfreemap', 'source-layer': 'waterway', minzoom: 9, paint: { 'line-color': watchPalette.waterway, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 14, 2] } },
    { id: 'contours-minor', type: 'line', source: 'contours', 'source-layer': 'contours', minzoom: 8, filter: ['!=', ['get', 'idx'], true], paint: { 'line-color': watchPalette.contourMinor, 'line-width': 0.55 } },
    { id: 'contours-index', type: 'line', source: 'contours', 'source-layer': 'contours', minzoom: 8, filter: ['==', ['get', 'idx'], true], paint: { 'line-color': watchPalette.contourIndex, 'line-width': 1.05 } },
    { id: 'roads-casing', type: 'line', source: 'openfreemap', 'source-layer': 'transportation', minzoom: 9, filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': watchPalette.roadCasing, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.8, 14, 7] } },
    { id: 'roads', type: 'line', source: 'openfreemap', 'source-layer': 'transportation', minzoom: 9, filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': watchPalette.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.9, 14, 4.2] } },
    { id: 'trails', type: 'line', source: 'openfreemap', 'source-layer': 'transportation', minzoom: 12, filter: ['match', ['get', 'class'], ['path', 'track'], true, false], layout: { 'line-cap': 'round' }, paint: { 'line-color': watchPalette.trail, 'line-dasharray': [3, 2], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 14, 1.6] } },
    { id: 'trail-labels', type: 'symbol', source: 'openfreemap', 'source-layer': 'transportation_name', minzoom: 13, filter: ['match', ['get', 'class'], ['path', 'track'], true, false], layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Italic'], 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 13, 14, 14] }, paint: { 'text-color': watchPalette.trail, 'text-halo-color': watchPalette.paper, 'text-halo-width': 1.1 } },
    { id: 'peaks', type: 'symbol', source: 'openfreemap', 'source-layer': 'mountain_peak', minzoom: 11, filter: ['match', ['get', 'class'], ['peak', 'volcano'], true, false], layout: { 'text-field': ['concat', '▲ ', ['coalesce', ['get', 'name:en'], ['get', 'name'], 'Peak'], ['case', ['has', 'ele'], ['concat', ' · ', ['get', 'ele'], ' m'], '']], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 14], 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': watchPalette.peak, 'text-halo-color': watchPalette.paper, 'text-halo-width': 1.3 } },
    { id: 'place-labels', type: 'symbol', source: 'openfreemap', 'source-layer': 'place', minzoom: 10, layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 15], 'text-max-width': 9 }, paint: { 'text-color': watchPalette.text, 'text-halo-color': watchPalette.paper, 'text-halo-width': 1.4 } },
    { id: 'road-labels', type: 'symbol', source: 'openfreemap', 'source-layer': 'transportation_name', minzoom: 12, filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], true, false], layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ['get', 'ref']], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 12, 14, 13] }, paint: { 'text-color': watchPalette.road, 'text-halo-color': watchPalette.paper, 'text-halo-width': 1.1 } }
  ]
};
