import assert from 'node:assert/strict';
import {test} from 'node:test';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {encodeGeometry} from './watch-geometry.mjs';
import {createVectorPack,addVectorTile,finishVectorPack} from './vector-pack.mjs';
import {crc32} from 'node:zlib';

// Deliberately clipped across the west edge. The hole must remain empty
// when the triangles are rasterized and the road must cross the water.
export async function sample() {
  const tile={z:8,x:128,y:128};
  const ll=([x,y])=>[x*360/65536, Math.atan(Math.sinh(-2*Math.PI*y/65536))*180/Math.PI];
  const ring=(l,t,r,b)=>[[l,t],[r,t],[r,b],[l,b],[l,t]].map(ll);
  const feature=(type,coordinates)=>({type:'Feature',properties:{},geometry:{type,coordinates}});
  const data=encodeGeometry({water:[feature('Polygon',[ring(-20,10,200,200),ring(50,50,100,100).reverse()])],road:[feature('LineString',[[0,128],[256,128]].map(ll))]},tile);
  const pack=createVectorPack([{zoom:8,minX:128,maxX:128,minY:128,maxY:128}],8,8);
  addVectorTile(pack,tile,data);
  return {data, bytes:new Uint8Array(await finishVectorPack(pack).arrayBuffer())};
}
test('encodes clipped watch triangles, route geometry, and a Map Manager CRC',async()=>{
  const {data,bytes}=await sample();
  const {layers}=new VectorTile(new Pbf(data));
  assert.equal(layers.road.feature(0).type,2);
  for(const ring of layers.water.feature(0).loadGeometry()) {
    assert.equal(ring.length,4); // triangle, then ClosePath
    assert(ring.every(p=>p.x>=0 && p.x<=256 && p.y>=0 && p.y<=256));
  }
  assert.equal(new DataView(bytes.buffer).getUint32(bytes.length-4,true),crc32(bytes.subarray(0,-4)));
  if(process.env.VMAP_FIXTURE) (await import('node:fs')).writeFileSync(process.env.VMAP_FIXTURE,bytes);
});
