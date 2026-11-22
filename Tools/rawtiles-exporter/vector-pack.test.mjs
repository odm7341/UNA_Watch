import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addVectorTile, createVectorPack, finishVectorPack } from './vector-pack.mjs';

test('writes sorted indexed MVT payloads and a CRC footer', async () => {
  const range = [{ zoom: 8, minX: 128, maxX: 128, minY: 90, maxY: 91 }];
  const pack = createVectorPack(range, 8, 8);
  assert.equal(pack.tiles.length, 2);
  addVectorTile(pack, pack.tiles[0], Uint8Array.of(0x1a, 0x01, 0x00));
  addVectorTile(pack, pack.tiles[1], Uint8Array.of(0x1a, 0x02, 0x00, 0x01));
  const data = new Uint8Array(await finishVectorPack(pack).arrayBuffer());
  const view = new DataView(data.buffer);
  assert.equal(new TextDecoder().decode(data.subarray(0, 4)), 'VMAP');
  assert.equal(view.getUint32(8, true), 2);
  assert.equal(view.getUint32(224 + 12, true), 264);
  assert.equal(view.getUint32(244 + 12, true), 267);
  assert.deepEqual([...data.subarray(264, 271)], [0x1a, 0x01, 0, 0x1a, 0x02, 0, 1]);
  assert.equal(view.getUint16(36, true) > 0, true);
  assert.throws(() => addVectorTile(pack, pack.tiles[0], Uint8Array.of(1)), /Too many/);
});

test('bounds tile sizes and zoom range', () => {
  assert.throws(() => createVectorPack([{ zoom: 15, minX: 0, maxX: 0, minY: 0, maxY: 0 }], 15, 15), /Unsupported/);
  const pack = createVectorPack([{ zoom: 8, minX: 0, maxX: 0, minY: 0, maxY: 0 }], 8, 8);
  assert.throws(() => addVectorTile(pack, pack.tiles[0], new Uint8Array(16385)), /16 KiB/);
  assert.throws(() => finishVectorPack(pack), /Missing/);
});
