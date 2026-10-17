import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBlueprint } from '../src/io/blueprint.js';
import { parseBlock } from '../src/core/blockstate.js';
import { validateBlockState } from '../src/core/blockinfo.js';

const VERSION = '1.21.11';
const scene = (file) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'scenes', file);
const load = (file, params = {}) => loadBlueprint(scene(file), { params });

const CONFIGS = [
  { name: 'gt-campus', file: 'gt-campus.mjs', params: {} },
  { name: 'gt-campus city=true', file: 'gt-campus.mjs', params: { city: true } },
  { name: 'gt-campus details=false realism=false', file: 'gt-campus.mjs', params: { details: false, realism: false } },
  { name: 'tech-tower-letters', file: 'tech-tower-letters.mjs', params: {} },
  { name: 'tech-tower-letters allSides=true', file: 'tech-tower-letters.mjs', params: { allSides: true } },
];

const sizeOf = (s) => s.bounds().size.join('×');
const nonAir = (s) => s.count - (s.blockCounts().air ?? 0);

/** Order-sensitive digest of every voxel: two loads must agree on the exact layout, not only on the counts. */
function digest(s) {
  let h = 2166136261;
  s.forEach((x, y, z, b, id) => {
    for (const v of [x, y, z, id]) h = Math.imul(h ^ v, 16777619);
  });
  return `${s.palette.join('|')}#${h >>> 0}`;
}

for (const { name, file, params } of CONFIGS) {
  test(`${name}: loads, is deterministic and only uses valid ${VERSION} blocks`, async (t) => {
    const a = await load(file, params);
    assert.ok(a.count > 0, 'structure is empty');

    const b = await load(file, params);
    assert.deepEqual(a.blockCounts(), b.blockCounts(), 'block counts differ between two loads');
    assert.equal(digest(a), digest(b), 'layout differs between two loads');

    const bad = a.palette.slice(1).flatMap((blk) => {
      const r = validateBlockState(parseBlock(blk), VERSION);
      return r.ok ? [] : [`${blk}: ${r.errors.join('; ')}`];
    });
    assert.deepEqual(bad, [], `palette entries that are not valid in ${VERSION}`);

    t.diagnostic(`${a.name}: ${sizeOf(a)} (W×H×D), ${a.count} blocks, ${a.palette.length - 1} palette entries`);
  });
}

test('gt-campus defaults: a 401×401 campus of a sane size', async (t) => {
  const s = await load('gt-campus.mjs');
  const { min, size } = s.bounds();
  const counts = s.blockCounts();
  t.diagnostic(`${size.join('×')} (W×H×D) from ${min.join(',')}; ${s.count} voxels = ${nonAir(s)} blocks + ${counts.air ?? 0} air; ${Object.keys(counts).length} block types; passes: ${JSON.stringify(s.meta.features)}`);
  assert.deepEqual([min[0], min[2]], [0, 0], 'campus north-west corner is (0, 0)');
  assert.deepEqual([size[0], size[2]], [401, 401], 'footprint is the campus square');
  assert.ok(size[1] >= 45 && size[1] <= 80, `height ${size[1]}: tall enough for Tech Tower and Crosland, nothing absurd`);
  assert.ok(min[1] < 0 && min[1] >= -8, `lowest layer ${min[1]}: subway platforms just below the ground`);
  assert.ok(s.count > 200_000 && s.count < 2_000_000, `${s.count} voxels`);
  assert.ok(Object.keys(counts).length > 60, 'a rich palette');
  assert.equal(s.get(0, -1, 0), 'grass_block', 'the ground surface is y = -1');
});

test('gt-campus: city adds the surrounding Atlanta and leaves the campus identical', async (t) => {
  const campus = await load('gt-campus.mjs');
  const city = await load('gt-campus.mjs', { city: true });
  const { size } = city.bounds();
  t.diagnostic(`city=true: ${size.join('×')} (W×H×D), ${city.count} voxels (campus only: ${campus.count})`);
  assert.ok(size[0] > 650 && size[2] > 650, 'the city reaches well past the campus on every side');
  assert.ok(city.count > campus.count * 3);
  let different = 0;
  campus.forEach((x, y, z, b) => { if (city.get(x, y, z) !== b) different++; });
  assert.equal(different, 0, 'every campus block is the same with and without the city');
  let inSquare = 0;
  city.forEach((x, y, z) => { if (x >= 0 && x <= 400 && z >= 0 && z <= 400) inSquare++; });
  assert.equal(inSquare, campus.count, 'city=false is exactly the campus square of city=true');
});

test('gt-campus: details and realism add to the campus, flatten only adds air', async () => {
  const full = await load('gt-campus.mjs');
  const noDetails = await load('gt-campus.mjs', { details: false });
  const noRealism = await load('gt-campus.mjs', { realism: false });
  const bare = await load('gt-campus.mjs', { details: false, realism: false });
  assert.ok(bare.count < noDetails.count && bare.count < noRealism.count, 'each pass adds blocks');
  assert.ok(noDetails.count < full.count && noRealism.count < full.count);

  const flat = await load('gt-campus.mjs', { flatten: true });
  assert.equal(full.get(5, 55, 5), null, 'without flatten the sky is left alone');
  assert.equal(flat.get(5, 55, 5), 'air', 'flatten clears 60 layers above the ground');
  assert.equal(nonAir(flat), nonAir(full), 'flatten adds nothing but air');
  assert.ok(flat.count - full.count > 9_000_000, 'flatten covers 401×60×401');
});

/** What a viewer standing outside `face` reads: rows of '#'/'.', top row first, left to right as they see it. */
function readFace(s, face, block = 'gold_block') {
  const b = s.bounds();
  const cells = [];
  s.forEach((x, y, z, blk) => {
    if (blk !== block) return;
    if (face === 'south' && z === b.max[2]) cells.push([x, y]);
    else if (face === 'north' && z === b.min[2]) cells.push([-x, y]);
    else if (face === 'west' && x === b.min[0]) cells.push([z, y]);
    else if (face === 'east' && x === b.max[0]) cells.push([-z, y]);
  });
  if (!cells.length) return [];
  const x0 = Math.min(...cells.map((c) => c[0])), y0 = Math.min(...cells.map((c) => c[1]));
  const w = Math.max(...cells.map((c) => c[0])) - x0 + 1, h = Math.max(...cells.map((c) => c[1])) - y0 + 1;
  const rows = Array.from({ length: h }, () => Array(w).fill('.'));
  for (const [cx, cy] of cells) rows[h - 1 - (cy - y0)][cx - x0] = '#';
  return rows.map((r) => r.join(''));
}

test('tech-tower-letters: TECH reads left to right from the south, and only there', async (t) => {
  const s = await load('tech-tower-letters.mjs');
  const reading = readFace(s, 'south');
  t.diagnostic(`${sizeOf(s)} (W×H×D), ${s.count} voxels; seen from the south:\n${reading.join('\n')}`);
  assert.ok(reading.length >= 5, 'letters at least 5 rows high');
  for (const face of ['north', 'west', 'east']) assert.deepEqual(readFace(s, face), [], `no letters on the ${face} face`);
  assert.notDeepEqual(reading, reading.map((r) => [...r].reverse().join('')), 'TECH is not mirror-symmetric');
  // The first letter is a T: a bar with the stem under its middle. A mirrored text would start with the H.
  const bar = reading[0].match(/^#+/)?.[0].length ?? 0;
  assert.ok(bar >= 3, 'top row starts with the bar of the T');
  assert.equal(reading[1].indexOf('#'), (bar - 1) / 2, 'the T has its stem under the middle of the bar');
  assert.match(reading[0], /#\.+#$/, 'top row ends with the two stems of the H');
  const counts = s.blockCounts();
  for (const b of ['bricks', 'stone_bricks', 'glass', 'dark_oak_planks', 'gold_block']) assert.ok(counts[b] > 0, `${b} is part of the tower`);
});

test('tech-tower-letters allSides: every face reads the same TECH, none is mirrored', async () => {
  const s = await load('tech-tower-letters.mjs', { allSides: true });
  const single = await load('tech-tower-letters.mjs');
  const south = readFace(s, 'south');
  assert.ok(south.length >= 5);
  for (const face of ['west', 'north', 'east']) {
    assert.deepEqual(readFace(s, face), south, `the ${face} face reads exactly like the south face, from outside`);
  }
  assert.deepEqual(south, readFace(single, 'south'), 'the south face is the same with and without allSides');
  assert.equal(s.blockCounts().gold_block, 4 * single.blockCounts().gold_block, 'four faces, same letters');
  const [w, , d] = s.bounds().size;
  assert.equal(w, d, 'square footprint, so the letters fit on the short faces too');
});
