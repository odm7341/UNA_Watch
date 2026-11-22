import {test} from 'node:test';
import assert from 'node:assert/strict';
import {polygonTiles} from './polygon.mjs';
import {tileXToLon,tileYToLat} from './tile-math.js';
import {packFromTiles} from './vector-pack.mjs';

const point=([x,y])=>({lng:tileXToLon(128+x,8),lat:tileYToLat(128+y,8)});
test('concave L includes both arms but skips the notch in the VMAP index',()=>{
  const ring=[[.1,.1],[2.9,.1],[2.9,.9],[.9,.9],[.9,2.9],[.1,2.9]].map(point);
  const tiles=polygonTiles(ring,8,8);
  assert.deepEqual(tiles.map(t=>[t.x-128,t.y-128]),[[0,0],[0,1],[0,2],[1,0],[2,0]]);
  assert.deepEqual(polygonTiles(ring.reverse(),8,8),tiles);
  assert.equal(new DataView(packFromTiles(tiles,8,8).header.buffer).getUint32(8,true),5);
  assert.throws(()=>polygonTiles(ring,8,10,10),/Limit/);
});
test('rejects unfinished, self-crossing and zero-area polygons',()=>{
  for(const ring of [[[0,0],[1,1]],[[0,0],[1,1],[0,1],[1,0]],[[0,0],[1,0],[2,0]]])
    assert.throws(()=>polygonTiles(ring.map(point),8,8));
});
