import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Structure } from '../src/core/structure.js';
import { resolvePlacement, yawToDir, turnsForFacing, checkPlacementOptions } from '../src/placement.js';
import { validateBuildOptions, dimensionLabel } from '../src/build.js';

const house = () => new Structure()
  .fill(0, 0, 0, 8, 0, 4, 'stone') // 9 wide (x), 5 deep (z)
  .set(4, 1, 4, 'oak_door[facing=south,half=lower]'); // front door on the south edge

test('yawToDir follows Minecraft yaw conventions', () => {
  assert.equal(yawToDir(0), 'south');
  assert.equal(yawToDir(90), 'west');
  assert.equal(yawToDir(180), 'north');
  assert.equal(yawToDir(-180), 'north');
  assert.equal(yawToDir(-90), 'east');
  assert.equal(yawToDir(270), 'east');
  assert.equal(yawToDir(44), 'south');
  assert.equal(yawToDir(46), 'west');
});

test('turnsForFacing maps the south-facing front to the requested direction', () => {
  assert.equal(turnsForFacing('south'), 0);
  assert.equal(turnsForFacing('west'), 1);
  assert.equal(turnsForFacing('north'), 2);
  assert.equal(turnsForFacing('east'), 3);
  assert.throws(() => turnsForFacing('up'));
});

test('corner anchor puts the NW footprint corner at --at for every facing', () => {
  for (const facing of ['south', 'west', 'north', 'east']) {
    const p = resolvePlacement(house(), { at: [100, 64, 200], facing });
    assert.deepEqual([p.bbox.min[0], p.bbox.min[1], p.bbox.min[2]], [100, 64, 200], facing);
    assert.equal(p.facing, facing);
    let door = null;
    p.world.forEach((x, y, z, b) => { if (b.startsWith('oak_door')) door = { x, z, b }; });
    assert.match(door.b, new RegExp(`facing=${facing}`));
  }
});

test('center anchor centres the footprint', () => {
  const p = resolvePlacement(house(), { at: [0, 0, 0], anchor: 'center' });
  assert.deepEqual(p.bbox.min, [-4, 0, -2]);
  assert.deepEqual(p.bbox.max, [4, 1, 2]);
});

test('near a player: placed in front of them with the front facing back at them', () => {
  // player at (10, 64, 10) looking north (yaw 180)
  const p = resolvePlacement(house(), { pose: { x: 10.5, y: 64, z: 10.5, yaw: 180 }, gap: 3 });
  assert.equal(p.facing, 'south');
  assert.ok(p.bbox.max[2] < 10, 'structure is north of the player');
  assert.equal(10 - p.bbox.max[2] - 1, 3, 'gap of 3 blocks');
  assert.ok(p.bbox.min[0] <= 10 && p.bbox.max[0] >= 10, 'centred on the player');
  // player looking east
  const e = resolvePlacement(house(), { pose: { x: 0, y: 64, z: 0, yaw: -90 }, gap: 2 });
  assert.equal(e.facing, 'west');
  assert.ok(e.bbox.min[0] > 0);
  assert.equal(e.bbox.min[0] - 0 - 1, 2);
});

test('near a player on another side: --side west --gap 40 puts it 40 blocks west, facing them', () => {
  // player at (520, -60, 560) looking north, build wanted 40 blocks to the west
  const p = resolvePlacement(house(), { pose: { x: 520.5, y: -60, z: 560.5, yaw: 180 }, side: 'west', gap: 40 });
  assert.equal(p.facing, 'east', 'front faces the player');
  assert.equal(520 - p.bbox.max[0] - 1, 40, '40 blocks between them');
  assert.ok(p.bbox.min[2] <= 560 && p.bbox.max[2] >= 560, 'centred on the player along z');
  let door = null;
  p.world.forEach((x, y, z, b) => { if (b.startsWith('oak_door')) door = b; });
  assert.match(door, /facing=east/);
  assert.throws(() => resolvePlacement(house(), { pose: { x: 0, y: 0, z: 0, yaw: 0 }, side: 'up' }), /Invalid side/);
});

test('placement errors are helpful', () => {
  assert.throws(() => resolvePlacement(house(), {}), /--at x,y,z or --near/);
  assert.throws(() => resolvePlacement(new Structure(), { at: [0, 0, 0] }), /empty/);
});

test('placement options are checked before anything else (bad gap/side/mirror/anchor/rotate)', () => {
  const pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const bad = [
    [{ gap: -2 }, /Invalid gap "-2"/], [{ gap: NaN }, /Invalid gap/], [{ gap: 1.5 }, /Invalid gap/],
    [{ side: 'up' }, /Invalid side/], [{ facing: 'up' }, /Invalid facing/], [{ anchor: 'middle' }, /Invalid anchor/],
    [{ rotate: 45 }, /multiple of 90/], [{ mirror: 'y' }, /Invalid mirror/], [{ mirror: true }, /Invalid mirror/],
  ];
  for (const [o, re] of bad) {
    assert.throws(() => checkPlacementOptions(o), (e) => re.test(e.message) && e.code === 'BAD_OPTION', JSON.stringify(o));
    assert.throws(() => resolvePlacement(house(), { pose, ...o }), re);
  }
  checkPlacementOptions({ gap: 0, side: 'West', facing: 'NORTH', anchor: 'center', rotate: 270, mirror: 'x' });
  const zero = resolvePlacement(house(), { pose: { x: 0.5, y: 0, z: 0.5, yaw: 0 }, gap: 0 });
  assert.equal(zero.bbox.min[2], 1, 'gap 0: right next to the player');
});

test('validateBuildOptions: mode, dimension, bps, clear, at', () => {
  validateBuildOptions({ mode: 'layered', dimension: 'nether', bps: 5, clear: 3, at: [1, 2, 3], gap: 4 });
  validateBuildOptions({ clear: true });
  for (const [o, code, re] of [
    [{ mode: 'fast' }, 'BAD_MODE', /Unknown mode/], [{ dimension: 'mars' }, 'BAD_DIMENSION', /Unknown dimension/],
    [{ bps: 0 }, 'BAD_OPTION', /bps/], [{ bps: NaN }, 'BAD_OPTION', /bps/], [{ clear: -1 }, 'BAD_OPTION', /clear/],
    [{ clear: NaN }, 'BAD_OPTION', /clear/], [{ at: [1, 2] }, 'BAD_OPTION', /\[x, y, z\]/], [{ gap: -1 }, 'BAD_OPTION', /gap/],
  ]) {
    assert.throws(() => validateBuildOptions(o), (e) => e.code === code && re.test(e.message), JSON.stringify(o));
  }
  assert.equal(dimensionLabel('the_nether'), 'the Nether');
});
