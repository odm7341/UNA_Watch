import {encodeGeometry} from './watch-geometry.mjs';
import {createVectorPack, addVectorTile, finishVectorPack} from './vector-pack.mjs';

// Clipped water with a polygon hole and a route drawn across it.
export async function sample() {
  const tile = {z:8, x:128, y:128};
  const ll = ([x, y]) => [x * 360 / 65536,
    Math.atan(Math.sinh(-2 * Math.PI * y / 65536)) * 180 / Math.PI];
  const ring = (l, t, r, b) =>
    [[l,t],[r,t],[r,b],[l,b],[l,t]].map(ll);
  const feature = (type, coordinates) =>
    ({type:'Feature', properties:{}, geometry:{type, coordinates}});
  const data = encodeGeometry({
    water:[feature('Polygon', [ring(-20,10,200,200), ring(50,50,100,100).reverse()])],
    road:[feature('LineString', [[0,128],[256,128]].map(ll))]
  }, tile);
  const pack = createVectorPack([{zoom:8,minX:128,maxX:128,minY:128,maxY:128}],8,8);
  addVectorTile(pack, tile, data);
  return {data, bytes:new Uint8Array(await finishVectorPack(pack).arrayBuffer())};
}
