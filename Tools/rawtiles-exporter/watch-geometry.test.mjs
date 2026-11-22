import assert from 'node:assert/strict';
import {test} from 'node:test';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {sample} from './watch-geometry.fixture.mjs';
import {crc32} from 'node:zlib';

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
