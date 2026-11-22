import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {style} from './map-style.js';
import {formatBytes} from './tile-math.js';
import {polygonTiles} from './polygon.mjs';
import {prepareSources} from './watch-geometry.mjs';
import {
  packFromTiles,addVectorTile,finishVectorPack,MAX_PACK_ZOOM,
  HEADER_BYTES,ENTRY_BYTES,MAX_TILE_BYTES
} from './vector-pack.mjs';
import {rasterizeTile,paintTile,renderWatch} from './watch-preview.mjs';

const $=id=>document.getElementById(id);
const layers=[...document.querySelectorAll('[data-layer]')];
const names={landcover:'land',water:'water',contours:'contour',roads:'road',trails:'trail',peaks:'peak'};
const map=L.map('map',{minZoom:8,maxZoom:MAX_PACK_ZOOM,zoomControl:false,attributionControl:false,
  maxBounds:[[-85.05112878,-180],[85.05112878,180]],maxBoundsViscosity:1
}).setView([43.4387179,-70.7746224],13);
L.control.zoom({position:'bottomright'}).addTo(map);
const overlay=L.layerGroup().addTo(map);
const key=t=>`${t.z}/${t.x}/${t.y}`;
let polygon=[],draft=null, tiles=[],included=new Set(),busy=false,watchVersion=0;
const storageGrid=14;
function sourceCache() {
  const enabled=new Set(layers.filter(el=>el.checked).map(el=>names[el.dataset.layer]));
  let source; const cache=new Map();
  return async t=>{
    const k=key(t);
    if(!cache.has(k)) {
      source??=prepareSources(style,enabled).catch(e=>{source=null;throw e;});
      const promise=source.then(get=>get(t)).then(bytes=>({bytes,pixels:rasterizeTile(bytes)}));
      cache.set(k,promise);
      if(cache.size>128) cache.delete(cache.keys().next().value);
      promise.catch(()=>{if(cache.get(k)===promise) cache.delete(k);});
    }
    return cache.get(k);
  };
}
let loadTile=sourceCache();
async function displayPixels(t,selected=false) {
  const scale=2**Math.max(0,t.z-storageGrid);
  const parent={z:Math.min(t.z,storageGrid),x:Math.floor(t.x/scale),y:Math.floor(t.y/scale)};
  if(selected && !included.has(key(parent))) return null;
  const {bytes,pixels}=await loadTile(parent);
  return scale===1?pixels:rasterizeTile(bytes,scale,256*(t.x%scale),256*(t.y%scale));
}
const grid=L.gridLayer({tileSize:256,noWrap:true,updateWhenIdle:true});
grid.createTile=function(coords,done) {
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=256;
  displayPixels(coords).then(pixels=>{paintTile(canvas,pixels);done(null,canvas);},
    error=>{done(error,canvas);if(!busy) $('status').textContent=error.message;});
  return canvas;
};
grid.addTo(map);

async function watch() {
  const v=++watchVersion;
  if($('watch-preview').hidden) return;
  const zoom=Math.max(storageGrid,map.getZoom());
  const canvas=$('watch-map'), state=$('watch-state');
  state.textContent=`Loading watch tiles at z${zoom}…`;
  let hits=0;
  try {
    await renderWatch(canvas,map.getCenter(),zoom,async t=>{
      const pixels=await displayPixels(t,true); if(pixels) hits++; return pixels;
    },()=>v===watchVersion);
    if(v===watchVersion) state.textContent=hits?`Pack preview · z${zoom}`:
      'No selected tiles here. Pan inside the polygon or choose Use current view.';
  } catch(e) { if(v===watchVersion) state.textContent=`Preview unavailable: ${e.message}`; }
}
function outline() {
  overlay.clearLayers();
  const points=draft??polygon, options={interactive:false,color:'#245cc9',weight:2,fill:false};
  if(points.length>=2) (points.length>=3?L.polygon:L.polyline)(points,options).addTo(overlay);
  if(draft) for(const p of draft) L.circleMarker(p,{...options,radius:3,fill:true}).addTo(overlay);
}
function controls() {
  for(const id of ['undo','finish','cancel']) $(id).hidden=!draft;
  $('undo').disabled=!draft?.length;
  $('finish').disabled=!(draft?.length>=3);
  $('draw').hidden=!!draft;
  $('export-pack').disabled=busy || !!draft || !tiles.length;
  for(const el of [ $('draw'),$('select-view'),...layers]) el.disabled=busy;
}
function update() {
  try {
    tiles=polygonTiles(polygon,storageGrid,storageGrid);
    const maxBytes=HEADER_BYTES+4+tiles.length*(ENTRY_BYTES+MAX_TILE_BYTES);
    $('estimate').textContent=`${tiles.length.toLocaleString()} geometry tiles · up to ${formatBytes(maxBytes)}`+
      (tiles.length>1024?' · Requires updated HikeMap/RunMap. Allow extra time for download and verification.':'');
  } catch(e) {tiles=[];$('estimate').textContent=e.message;}
  included=new Set(tiles.map(key));
  controls();outline();watch();
}
function useView() {
  const b=map.getBounds();
  polygon=[b.getNorthWest(),b.getNorthEast(),b.getSouthEast(),b.getSouthWest()];
  draft=null;update();
}
function edit() {
  controls();outline();
  $('status').textContent=draft?`${draft.length} corners. Tap the map to add another corner.`:'';
}
$('draw').onclick=()=>{draft=[];edit();};
$('undo').onclick=()=>{draft.pop();edit();};
$('cancel').onclick=()=>{draft=null;edit();};
$('finish').onclick=()=>{
  try { polygonTiles(draft,storageGrid,storageGrid); }
  catch(e) { $('status').textContent=e.message;return; }
  polygon=draft;draft=null;edit();update();
};
map.on('click',e=>{if(draft && draft.length<256){draft.push(e.latlng);edit();}});
$('select-view').onclick=()=>{useView();$('status').textContent='Current view selected.';};
function readout() {
  const c=map.getCenter();$('center').textContent=`${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
  $('zoom').textContent=map.getZoom();
}
map.on('moveend',()=>{readout();watch();});
function refresh() {loadTile=sourceCache();grid.redraw();watch();}
for(const el of layers) el.onchange=refresh;
$('retry').onclick=refresh;
$('watch-preview-toggle').onclick=()=>{
  $('watch-preview').hidden=false;$('watch-preview-toggle').setAttribute('aria-expanded','true');watch();
};
$('watch-preview-close').onclick=()=>{
  $('watch-preview').hidden=true;$('watch-preview-toggle').setAttribute('aria-expanded','false');watchVersion++;
};
$('export-pack').onclick=async()=>{
  if(busy || draft || !tiles.length) return;
  busy=true;controls();
  try {
    const pack=packFromTiles(tiles,storageGrid,storageGrid);
    for(const [i,t] of tiles.entries()) {
      $('status').textContent=`Packing ${i+1}/${tiles.length}: ${key(t)}`;
      addVectorTile(pack,t,(await loadTile(t)).bytes);
    }
    const file=finishVectorPack(pack),link=document.createElement('a');
    link.href=URL.createObjectURL(file);link.download='una-topo.vtiles';
    link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
    $('status').textContent=`Downloaded ${formatBytes(file.size)}.`;
  } catch(e) { $('status').textContent=`Export failed: ${e.message}`; }
  finally {busy=false;controls();}
};
readout();useView();
$('status').textContent='Pan to explore, then choose your export area.';
