import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sample} from './watch-geometry.fixture.mjs';
import {rasterizeTile, watchCenter, WATCH_COLORS} from './watch-preview.mjs';

test('preview paints exported triangles, holes and routes as watch pixels', async () => {
  const {data} = await sample();
  const pixels = rasterizeTile(data);
  const at = (x, y) => pixels[256 * y + x];
  assert.equal(at(5, 40), 2);   // clipped water at the west edge
  assert.equal(at(75, 75), 0);  // unpainted polygon hole
  assert.equal(at(75, 128), 3); // black road on top of water
  assert.equal(at(245, 200), 0);
  assert.deepEqual(WATCH_COLORS, ['#ffffaa', '#55aa55', '#55aaff', '#000000']);
  const counts = [0, 0, 0, 0];
  for (const pixel of pixels) counts[pixel]++;
  // Counts from MapKit's host rasterizer using the same synthetic VMAP pack.
  assert.deepEqual(counts, [29980, 0, 35300, 256]);
});

test('preview center snaps to the watch microdegree and integer-pixel grid', () => {
  const center = watchCenter({lat:43.4387179, lng:-70.7746224}, 13);
  assert.deepEqual(center, {x:636284, y:767090});
});
