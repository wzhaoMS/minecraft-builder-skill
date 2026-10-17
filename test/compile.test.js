import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Structure } from '../src/core/structure.js';
import { greedyBoxes, boxVolume } from '../src/compile/greedy.js';
import { planBuild, splitBox, placementState } from '../src/compile/plan.js';
import { createRng } from '../src/core/rng.js';

function rasterize(boxes, palette) {
  const s = new Structure();
  for (const b of boxes) s.fill(b.x1, b.y1, b.z1, b.x2, b.y2, b.z2, palette[b.id]);
  return s;
}

function sameVoxels(a, b) {
  if (a.count !== b.count) return false;
  let ok = true;
  a.forEach((x, y, z, blk) => { if (b.get(x, y, z) !== blk) ok = false; });
  return ok;
}

test('greedy boxes exactly cover the voxels (random structures, property test)', () => {
  const rng = createRng(1234);
  const blocks = ['stone', 'dirt', 'glass', 'oak_planks', 'air'];
  for (let trial = 0; trial < 25; trial++) {
    const s = new Structure();
    const n = rng.int(1, 30);
    for (let i = 0; i < n; i++) {
      const x = rng.int(-40, 40), y = rng.int(-10, 30), z = rng.int(-40, 40);
      s.fill(x, y, z, x + rng.int(0, 20), y + rng.int(0, 12), z + rng.int(0, 20), rng.pick(blocks));
    }
    for (let i = 0; i < 200; i++) s.set(rng.int(-50, 50), rng.int(-10, 40), rng.int(-50, 50), rng.pick(blocks));
    const boxes = greedyBoxes(s, { maxVolume: 32768 });
    const back = rasterize(boxes, s.palette);
    assert.ok(sameVoxels(s, back), `trial ${trial}: boxes must reproduce voxels`);
    // boxes never overlap
    const total = boxes.reduce((t, b) => t + boxVolume(b), 0);
    assert.equal(total, s.count, `trial ${trial}: no overlap`);
  }
});

test('greedy respects maxVolume and compresses solid regions', () => {
  const s = new Structure().fill(0, 0, 0, 63, 63, 63, 'stone');
  const boxes = greedyBoxes(s, { maxVolume: 32768 });
  assert.ok(boxes.every((b) => boxVolume(b) <= 32768));
  assert.ok(boxes.length <= 16, `expected few boxes, got ${boxes.length}`);
  const small = greedyBoxes(s, { maxVolume: 1000 });
  assert.ok(small.every((b) => boxVolume(b) <= 1000));
});

test('a 1×1 pillar and a long wall become single fills', () => {
  const s = new Structure().fill(0, 0, 0, 0, 40, 0, 'stone').fill(5, 0, 5, 60, 10, 5, 'bricks');
  const boxes = greedyBoxes(s);
  assert.equal(boxes.length, 2);
});

test('planBuild orders phases: structural before attachables before fluids, bottom-up', () => {
  const s = new Structure()
    .set(0, 5, 0, 'water')
    .set(0, 1, 0, 'torch')
    .set(0, 0, 0, 'stone')
    .set(2, 3, 0, 'oak_door[facing=south,half=upper]')
    .set(2, 2, 0, 'oak_door[facing=south,half=lower]')
    .fill(2, 0, 0, 2, 1, 0, 'stone');
  const { ops } = planBuild(s);
  const order = ops.map((o) => o.block);
  assert.ok(order.indexOf('stone') < order.indexOf('torch'));
  assert.ok(order.indexOf('torch') < order.indexOf('water'));
  assert.ok(order.indexOf('oak_door[facing=south,half=lower]') < order.indexOf('oak_door[facing=south,half=upper]'));
});

test('planBuild makes leaves persistent and emits strict suffix', () => {
  assert.equal(placementState('oak_leaves'), 'oak_leaves[persistent=true]');
  assert.equal(placementState('oak_leaves[persistent=false]'), 'oak_leaves[persistent=false]');
  const s = new Structure().fill(0, 0, 0, 3, 0, 0, 'oak_leaves').set(9, 0, 0, 'stone');
  const { ops } = planBuild(s, { strict: true });
  assert.ok(ops.some((o) => o.cmd === 'fill 0 0 0 3 0 0 oak_leaves[persistent=true] strict'));
  assert.ok(ops.some((o) => o.cmd === 'setblock 9 0 0 stone strict'));
});

test('planBuild clear box comes first and is split by tiles and volume', () => {
  const s = new Structure().set(0, 0, 0, 'stone');
  const { ops } = planBuild(s, { clearBox: [-70, 0, -70, 70, 40, 70] });
  const clear = ops.filter((o) => o.phase === -1);
  assert.ok(clear.length > 4);
  assert.equal(ops[ops.length - 1].block, 'stone');
  assert.ok(clear.every((o) => o.volume <= 32768 && o.block === 'air'));
  const covered = clear.reduce((n, o) => n + o.volume, 0);
  assert.equal(covered, 141 * 41 * 141);
});

test('splitBox covers the box exactly', () => {
  const parts = splitBox({ x1: -5, y1: 0, z1: 3, x2: 130, y2: 50, z2: 70 }, 32768, 64);
  const vol = parts.reduce((n, b) => n + (b.x2 - b.x1 + 1) * (b.y2 - b.y1 + 1) * (b.z2 - b.z1 + 1), 0);
  assert.equal(vol, 136 * 51 * 68);
});

test('planBuild rejects over-long commands', () => {
  const s = new Structure().set(0, 0, 0, `chest{CustomName:'${'x'.repeat(300)}'}`);
  assert.throws(() => planBuild(s), /Command too long/);
});
