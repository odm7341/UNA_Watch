import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import geojsonvt from 'geojson-vt';
import earcut from 'earcut';
import {MAX_TILE_BYTES} from './vector-pack.mjs';

const order = ['land', 'water', 'contour', 'road', 'trail', 'peak'];
function category(name, fields) {
  if (name === 'landcover') return 'land';
  if (name === 'water' || name === 'waterway') return 'water';
  if (name === 'contours') return 'contour';
  if (name === 'mountain_peak') return 'peak';
  if (name === 'transportation') return ['path', 'track'].includes(fields.class) ? 'trail' : 'road';
}

// Only simple, quantized geometry goes on the watch. Resolve polygon holes
// and clip buffered geometries (including overzoomed parents) on the desktop.
function triangles(rings) {
  const result = [];
  let flat = [], holes = [], winding = 0;
  function flush() {
    const ids = earcut(flat, holes);
    for (let i = 0; i < ids.length; i += 3) {
      result.push(ids.slice(i,i+3).map(j => [flat[2*j], flat[2*j+1]]));
    }
    flat = []; holes = [];
  }
  for (const ring of rings) {
    let area = 0;
    for (let i=1; i<ring.length; ++i) area += ring[i-1][0]*ring[i][1] - ring[i][0]*ring[i-1][1];
    if (!area) continue;
    if (!winding) winding = Math.sign(area);
    if (Math.sign(area) === winding) flush(); else holes.push(flat.length/2);
    for (const p of ring.slice(0,-1)) flat.push(...p);
  }
  flush();
  return result;
}
class TileTooComplex extends Error {}
function writeFeature({geometry, type}, pbf, budget) {
  const paths = type === 3 ? triangles(geometry) : type === 1 ? [geometry] : geometry;
  const cmds = [];
  let x=0, y=0;
  const vertex = ([nx,ny]) => {
    const dx=nx-x, dy=ny-y;
    cmds.push((dx<<1)^(dx>>31), (dy<<1)^(dy>>31)); x=nx; y=ny;
  };
  for (const path of paths) {
    if (path.length < type) continue;
    // Conservative upper bound for the watch's row-fill/Bresenham budget.
    if (type === 3) {
      const xs=path.map(p=>p[0]), ys=path.map(p=>p[1]);
      budget.left -= (Math.max(...ys)-Math.min(...ys)) * (4+Math.ceil((Math.max(...xs)-Math.min(...xs))/4));
    } else if (type === 2) {
      for(let i=1;i<path.length;i++) budget.left -= 1+Math.max(Math.abs(path[i][0]-path[i-1][0]),Math.abs(path[i][1]-path[i-1][1]));
    }
    if (budget.left<0) throw new TileTooComplex();
    cmds.push(type === 1 ? path.length*8+1 : 9); vertex(path[0]);
    if (type !== 1) cmds.push((path.length-1)*8+2);
    path.slice(1).forEach(vertex);
    if (type === 3) cmds.push(15);
  }
  if (!cmds.length) return;
  pbf.writeVarintField(3,type); pbf.writePackedVarint(4,cmds);
}

export function encodeGeometry(groups, {z,x,y}, tolerance=1) {
  const out = new Pbf();
  const budget = {left:500000};
  for (const name of order) {
    const features = groups[name] || [];
    const tile = features.length && geojsonvt({type:'FeatureCollection',features}, {
      extent:256, buffer:0, tolerance, maxZoom:z+1, indexMaxZoom:0
    }).getTile(z,x,y);
    if (!tile && name !== 'land') continue; // empty sea/no-data tiles remain legal MVTs
    out.writeMessage(3, (_, layer) => {
      layer.writeStringField(1,name); layer.writeVarintField(5,256); layer.writeVarintField(15,2);
      for (const f of tile?.features || []) {
        const payload = new Pbf(); writeFeature(f,payload,budget);
        const data=payload.finish(); if(data.length) layer.writeBytesField(2,data);
      }
    },null);
  }
  return out.finish();
}

export async function prepareSources(style, enabled) {
  const sources=[];
  for (const [id,source] of Object.entries(style.sources)) {
    if (id==='contours' && !enabled.has('contour')) continue;
    const response=await fetch(source.url);
    if(!response.ok) throw new Error(`Cannot load ${id} TileJSON: ${response.status}`);
    const meta=await response.json();
    sources.push({meta, cache:new Map()});
  }
  return async tile => {
    const groups={};
    for (const {meta,cache} of sources) {
      const z=Math.min(tile.z,meta.maxzoom), x=tile.x>>(tile.z-z), y=tile.y>>(tile.z-z);
      if(z<meta.minzoom) continue;
      const url=meta.tiles[0].replace('{z}',z).replace('{x}',x).replace('{y}',y);
      if(!cache.has(url)) {
        const res=await fetch(url);
        if (!res.ok && res.status!==404) throw new Error(`Tile ${z}/${x}/${y}: HTTP ${res.status}`);
        const bytes=res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
        cache.set(url,bytes?.length ? new VectorTile(new Pbf(bytes)) : null);
        if(cache.size>8) cache.delete(cache.keys().next().value);
      }
      for(const [name,layer] of Object.entries(cache.get(url)?.layers || {})) {
        if(!category(name,{})) continue;
        for(let i=0;i<layer.length;++i){
          const f=layer.feature(i), key=category(name,f.properties);
          if(!enabled.has(key)) continue;
          (groups[key] ||= []).push(f.toGeoJSON(x,y,z));
        }
      }
    }
    for(const tolerance of [1,2,4]) {
      try {
        const bytes=encodeGeometry(groups,tile,tolerance);
        if(bytes.length<=MAX_TILE_BYTES) return bytes;
      } catch (err) { if (!(err instanceof TileTooComplex)) throw err; }
    }
    throw new Error(`Tile ${tile.z}/${tile.x}/${tile.y} is too dense; disable layers or choose a higher zoom.`);
  };
}
