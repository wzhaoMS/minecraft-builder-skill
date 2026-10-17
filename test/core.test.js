import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlock, formatBlock, canonical, blockName, isAir } from '../src/core/blockstate.js';
import { Structure } from '../src/core/structure.js';
import { transformBlock, transformPoint, toQuarterTurns, transformDir } from '../src/core/transform.js';

test('parseBlock handles namespace, props, spacing, nbt', () => {
  assert.deepEqual(parseBlock('minecraft:Oak_Stairs[half=top, facing=east]'), { name: 'oak_stairs', props: { half: 'top', facing: 'east' }, nbt: null });
  assert.equal(canonical('minecraft:oak_stairs[half=top,facing=east]'), 'oak_stairs[facing=east,half=top]');
  assert.equal(canonical('chest[facing=north]{Items:[{Slot:0b,id:"minecraft:apple",count:1}]}'), 'chest[facing=north]{Items:[{Slot:0b,id:"minecraft:apple",count:1}]}');
  assert.equal(canonical('stone'), 'stone');
  assert.equal(canonical('  Stone Bricks '), 'stone_bricks');
  assert.equal(blockName('oak_door[half=upper]'), 'oak_door');
  assert.equal(formatBlock({ name: 'stone', props: {}, nbt: null }, { namespace: true }), 'minecraft:stone');
  assert.ok(isAir('air') && isAir('minecraft:cave_air') && !isAir('stone'));
  assert.throws(() => parseBlock('oak_stairs[facing]'), /key=value/);
  assert.throws(() => parseBlock('oak_stairs[facing=east'), /Unclosed/);
  assert.throws(() => parseBlock(''), /Empty/);
});

test('Structure set/get/count/bounds across negative coordinates and sections', () => {
  const s = new Structure();
  s.set(0, 0, 0, 'stone').set(-1, -20, 17, 'minecraft:dirt').set(100, 5, -100, 'glass');
  assert.equal(s.count, 3);
  assert.equal(s.get(-1, -20, 17), 'dirt');
  assert.equal(s.get(5, 5, 5), null);
  assert.deepEqual(s.bounds(), { min: [-1, -20, -100], max: [100, 5, 17], size: [102, 26, 118] });
  s.set(0, 0, 0, null);
  assert.equal(s.count, 2);
  const seen = [];
  s.forEach((x, y, z, b) => seen.push(`${x},${y},${z}=${b}`));
  assert.deepEqual(seen.sort(), ['-1,-20,17=dirt', '100,5,-100=glass']);
});

test('fill modes', () => {
  const s = new Structure();
  s.fill(0, 0, 0, 4, 4, 4, 'stone', { mode: 'hollow' });
  assert.equal(s.count, 125);
  assert.equal(s.get(2, 2, 2), 'air');
  assert.equal(s.get(0, 2, 2), 'stone');
  const o = new Structure().fill(0, 0, 0, 4, 4, 4, 'stone', 'outline');
  assert.equal(o.count, 125 - 27);
  const w = new Structure().walls(0, 0, 0, 4, 2, 4, 'stone');
  assert.equal(w.count, 3 * 16);
  const k = new Structure().set(1, 0, 0, 'glass').fill(0, 0, 0, 2, 0, 0, 'stone', 'keep');
  assert.equal(k.get(1, 0, 0), 'glass');
  assert.equal(k.get(2, 0, 0), 'stone');
});

test('sphere/cylinder/line produce sensible voxel counts', () => {
  const sp = new Structure().sphere(0, 0, 0, 5, 'glass', { hollow: true });
  const solid = new Structure().sphere(0, 0, 0, 5, 'glass');
  assert.ok(sp.count > 200 && sp.count < solid.count);
  const cyl = new Structure().cylinder(0, 0, 0, 3, 4, 'stone');
  assert.equal(cyl.bounds().size[1], 4);
  const ln = new Structure().line(0, 0, 0, 10, 5, 0, 'stone');
  assert.equal(ln.count, 11);
});

test('rotation of points is clockwise viewed from above', () => {
  assert.deepEqual(transformPoint(0, 0, -1, { rotate: 90 }), [1, 0, 0]); // north → east
  assert.deepEqual(transformPoint(1, 0, 0, { rotate: 90 }), [0, 0, 1]); // east → south
  assert.equal(toQuarterTurns(270), 3);
  assert.equal(toQuarterTurns(-90), 3);
  assert.equal(toQuarterTurns(1), 1);
  assert.throws(() => toQuarterTurns(45));
  assert.equal(transformDir('south', { rotate: 90 }), 'west');
  assert.equal(transformDir('east', { mirror: 'x' }), 'west');
});

test('block state transforms', () => {
  assert.equal(transformBlock('oak_stairs[facing=north,half=top,shape=inner_left]', { rotate: 90 }), 'oak_stairs[facing=east,half=top,shape=inner_left]');
  assert.equal(transformBlock('oak_stairs[facing=east,shape=inner_left]', { mirror: 'x' }), 'oak_stairs[facing=west,shape=inner_right]');
  assert.equal(transformBlock('oak_log[axis=x]', { rotate: 90 }), 'oak_log[axis=z]');
  assert.equal(transformBlock('oak_log[axis=y]', { rotate: 90 }), 'oak_log[axis=y]');
  assert.equal(transformBlock('oak_sign[rotation=0]', { rotate: 90 }), 'oak_sign[rotation=4]');
  assert.equal(transformBlock('oak_sign[rotation=4]', { mirror: 'x' }), 'oak_sign[rotation=12]');
  assert.equal(transformBlock('oak_sign[rotation=0]', { mirror: 'z' }), 'oak_sign[rotation=8]');
  assert.equal(transformBlock('oak_fence[east=false,north=true,south=false,west=true]', { rotate: 90 }), 'oak_fence[east=true,north=true,south=false,west=false]');
  assert.equal(transformBlock('rail[shape=north_south]', { rotate: 90 }), 'rail[shape=east_west]');
  assert.equal(transformBlock('rail[shape=south_east]', { rotate: 90 }), 'rail[shape=south_west]');
  assert.equal(transformBlock('rail[shape=ascending_north]', { rotate: 180 }), 'rail[shape=ascending_south]');
  assert.equal(transformBlock('oak_door[facing=south,half=lower,hinge=left]', { mirror: 'x' }), 'oak_door[facing=south,half=lower,hinge=right]');
  assert.equal(transformBlock('chest[facing=north,type=left]', { mirror: 'z' }), 'chest[facing=south,type=right]');
  assert.equal(transformBlock('stone_slab[type=top]', { mirror: 'z' }), 'stone_slab[type=top]');
  assert.equal(transformBlock('hopper[facing=down]', { rotate: 90 }), 'hopper[facing=down]');
  assert.equal(transformBlock('jigsaw[orientation=north_up]', { rotate: 90 }), 'jigsaw[orientation=east_up]');
});

test('Structure.transformed rotates coordinates and states together', () => {
  const s = new Structure().set(0, 0, 0, 'stone').set(2, 0, 0, 'oak_stairs[facing=east]');
  const r = s.transformed({ rotate: 90 });
  assert.equal(r.get(0, 0, 2), 'oak_stairs[facing=south]');
  assert.equal(r.get(0, 0, 0), 'stone');
  const n = r.normalized();
  assert.deepEqual(n.bounds().min, [0, 0, 0]);
});

test('replace / mapBlocks / paste / compact', () => {
  const s = new Structure().fill(0, 0, 0, 1, 0, 1, 'oak_planks').set(0, 1, 0, 'oak_stairs[facing=east]');
  s.mapBlocks((b) => b.replace(/^oak_/, 'spruce_'));
  assert.equal(s.get(0, 0, 0), 'spruce_planks');
  assert.equal(s.get(0, 1, 0), 'spruce_stairs[facing=east]');
  s.replace('spruce_planks', null);
  assert.equal(s.count, 1);
  const t = new Structure().paste(s, 10, 0, 0);
  assert.equal(t.get(10, 1, 0), 'spruce_stairs[facing=east]');
  s.compact();
  assert.deepEqual(s.palette, [null, 'spruce_stairs[facing=east]']);
});
