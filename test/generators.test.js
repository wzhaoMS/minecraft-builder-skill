import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { listGenerators, runGenerator, getGenerator, resolveParams } from '../src/generators/index.js';
import { parseBlock, blockName } from '../src/core/blockstate.js';
import { validateBlockState, twoBlockInfo, isLeaves } from '../src/core/blockinfo.js';
import { lintStructure } from '../src/core/lint.js';
import { Structure } from '../src/core/structure.js';
import {
  materialFamily, blockExists, stairs, slab, door, doubleDoor, bed, plant, torch, lamp, gableRoof, hipRoof, flatRoof,
  windowRow, fixStairShapes, autoConnect, column, WOOD_TYPES,
} from '../src/generators/helpers.js';
import { textBitmap, FONTS } from '../src/generators/font.js';

const require = createRequire(import.meta.url);
const VERSION = '1.21.11';

// a tiny test image for pixelart (PNG + JPEG)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcb-gen-'));
const PNG_FILE = path.join(tmp, 'img.png');
const JPG_FILE = path.join(tmp, 'img.jpg');
{
  const { PNG } = require('pngjs');
  const png = new PNG({ width: 24, height: 16 });
  for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) {
    const i = (y * 24 + x) * 4;
    png.data[i] = x * 10; png.data[i + 1] = y * 15; png.data[i + 2] = 200 - x * 5;
    png.data[i + 3] = x < 2 ? 0 : 255; // transparent left edge
  }
  fs.writeFileSync(PNG_FILE, PNG.sync.write(png));
  const jpeg = require('jpeg-js');
  const raw = Buffer.alloc(32 * 20 * 4);
  for (let i = 0; i < 32 * 20; i++) { raw[i * 4] = 220; raw[i * 4 + 1] = (i % 32) * 7; raw[i * 4 + 2] = 40; raw[i * 4 + 3] = 255; }
  fs.writeFileSync(JPG_FILE, jpeg.encode({ data: raw, width: 32, height: 20 }, 90).data);
}

/** Parameter variants exercised for every generator (defaults are always run too). */
const VARIANTS = {
  sphere: [{ radius: 3, hollow: false }, { radius: 8, material: 'white_stained_glass', thickness: 2 }],
  dome: [{ radius: 5, floor: false, entrance: false }, { radius: 10, material: 'glass', thickness: 2 }],
  cylinder: [{ radius: 3, height: 4, hollow: false }, { radius: 7, height: 12, thickness: 2 }],
  cone: [{ radius: 3, height: 5, hollow: true }, { radius: 6, height: 10, material: 'sandstone', smooth: true }],
  box: [{ width: 3, height: 2, depth: 4, hollow: false }, { width: 12, height: 6, depth: 9 }],
  arch: [{ width: 5, height: 3, thickness: 1 }, { width: 15, height: 12, depth: 4, thickness: 3, material: 'quartz_block' }],
  pyramid: [{ height: 8, material: 'sandstone' }, { height: 14, material: 'stone_bricks', stepped: true }, { height: 5, hollow: false, smooth: false }],
  wall: [{ width: 7, height: 3, crenellations: true }, { width: 20, height: 6, thickness: 2, pillarEvery: 5, material: 'stone_bricks' }],
  house: [
    { width: 11, depth: 9, roofStyle: 'hip', wall: 'white_terracotta', roof: 'spruce_planks' },
    { width: 12, depth: 9, height: 9, wall: 'birch_planks', roof: 'dark_oak', roofStyle: 'gable', ridge: 'x' },
    { width: 9, depth: 7, roofStyle: 'flat', wall: 'bricks', roof: 'stone_bricks', interior: false, chimney: false },
    { width: 5, depth: 5, height: 4, roof: 'red_concrete', windows: false, lights: false, shutters: false },
    { width: 16, depth: 12, height: 14, roof: 'cherry', trim: 'stripped_cherry_log', door: 'cherry' },
  ],
  tower: [{ roof: 'crenellated' }, { shape: 'square', radius: 3, height: 12 }, { roof: 'flat', radius: 2, height: 6, stairs: false, windows: false, door: false }],
  castle: [{ width: 21, depth: 25, wallHeight: 5, towerRadius: 3, towerRoof: 'crenellated' }, { gate: false, material: 'deepslate_bricks', accent: 'cobbled_deepslate', weathering: 0 }],
  skyscraper: [{ style: 'setback', width: 20, depth: 20, height: 60, tiers: 5 }, { style: 'cylinder', radius: 6, height: 50 }, { width: 9, depth: 11, height: 20, spire: 0 }],
  tree: ['birch', 'spruce', 'jungle', 'acacia', 'dark_oak', 'cherry', 'pale_oak', 'mangrove', 'azalea'].map((type) => ({ type })).concat([{ type: 'oak', height: 9 }]),
  road: [{ axis: 'z', width: 8, length: 20 }, { sidewalks: false, lines: false, lamps: 0, material: 'black_concrete' }],
  bridge: [{ style: 'beam' }, { style: 'suspension', length: 40, width: 7 }, { length: 9, width: 3, railings: false }],
  text: [{ text: 'Hi!\\nmcb', font: '3x5', scale: 2 }, { text: 'TECH', facing: 'east', depth: 2, background: 'black_concrete', padding: 1 }, { plane: 'flat', facing: 'north', text: 'abc 123' }],
  pixelart: [{ image: PNG_FILE, width: 12, palette: 'full', dither: false }, { image: JPG_FILE, width: 16, height: 10, palette: 'wool', plane: 'flat', background: 'white_concrete' }, { width: 20, palette: 'terracotta' }],
  fountain: [{ radius: 2, height: 1, lights: false }, { radius: 6, material: 'quartz_block' }],
  lamppost: [{ style: 'garden' }, { style: 'double', light: 'soul_lantern' }, { style: 'bracket', height: 4 }],
  bench: [{ length: 1, armrests: false }, { length: 5, material: 'dark_oak' }],
  obelisk: [{ height: 8, width: 1, material: 'sandstone' }, { height: 30, width: 5, material: 'polished_blackstone', accent: 'gold_block' }],
  lighthouse: [{ height: 12, radius: 3, stripes: 'white_concrete' }, { height: 40, radius: 6, stripes: 'black_concrete', roof: 'deepslate_tiles' }],
  windmill: [{ height: 8, radius: 3 }, { height: 24, material: 'stone_bricks', roof: 'dark_oak', sails: 'light_gray_wool' }],
  city: [{ width: 70, depth: 90, highway: false, parks: 0.5 }, { width: 100, depth: 100, maxHeight: 40, details: false, blockSize: 16, streetWidth: 7 }],
};

const OPTIONAL_PROPS = new Set(['powered', 'waterlogged', 'occupied', 'open']);

function digest(s) {
  const rows = [];
  s.forEach((x, y, z, b) => rows.push(`${x},${y},${z}=${b}`));
  return rows.sort().join('\n');
}

/** Assertions shared by every generator run. */
function checkStructure(name, s, label) {
  const b = s.bounds();
  assert.ok(b, `${label}: produced no blocks`);
  assert.equal(b.min[0], 0, `${label}: footprint must start at x=0`);
  assert.equal(b.min[2], 0, `${label}: footprint must start at z=0`);
  // every palette entry is a valid 1.21.11 block state
  const used = new Set();
  s.forEach((x, y, z, blk) => used.add(blk));
  for (const blk of used) {
    const r = validateBlockState(parseBlock(blk), VERSION);
    assert.ok(r.ok, `${label}: invalid block "${blk}": ${r.errors.join('; ')}`);
    if (isLeaves(blk)) assert.equal(parseBlock(blk).props.persistent, 'true', `${label}: leaves must be persistent: ${blk}`);
  }
  // two-block objects have both halves with matching properties
  s.forEach((x, y, z, blk) => {
    const info = twoBlockInfo(blk);
    if (!info) return;
    const p = parseBlock(blk);
    const part = p.props[info.prop];
    assert.ok(part, `${label}: ${blk} at ${x},${y},${z} has no "${info.prop}"`);
    const same = (other, expectPart) => {
      if (!other || blockName(other) !== p.name) return false;
      const q = parseBlock(other).props;
      if (q[info.prop] !== expectPart) return false;
      for (const k of new Set([...Object.keys(p.props), ...Object.keys(q)])) {
        if (k === info.prop || OPTIONAL_PROPS.has(k)) continue;
        if (p.props[k] !== q[k]) return false;
      }
      return true;
    };
    if (info.axis === 'y') {
      if (part === info.lower) assert.ok(same(s.get(x, y + 1, z), info.upper), `${label}: ${blk} at ${x},${y},${z} lacks its upper half`);
      else assert.ok(same(s.get(x, y - 1, z), info.lower), `${label}: ${blk} at ${x},${y},${z} lacks its lower half`);
    } else {
      const d = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[p.props.facing];
      assert.ok(d, `${label}: bed without facing`);
      if (part === 'foot') assert.ok(same(s.get(x + d[0], y, z + d[1]), 'head'), `${label}: bed foot at ${x},${y},${z} lacks its head`);
      else assert.ok(same(s.get(x - d[0], y, z - d[1]), 'foot'), `${label}: bed head at ${x},${y},${z} lacks its foot`);
    }
  });
  // nothing for the linter to complain about (support, missing halves, invalid states)
  const lint = lintStructure(s.clone(), { version: VERSION, fix: false });
  assert.deepEqual(lint.errors, [], `${label}: lint errors`);
  assert.deepEqual(lint.warnings.map((w) => `${w.message} @${JSON.stringify(w.examples)}`), [], `${label}: lint warnings`);
}

describe('every registered generator', () => {
  const gens = listGenerators();

  test('the required generators are registered', () => {
    const names = gens.map((g) => g.name);
    for (const n of ['sphere', 'dome', 'cylinder', 'cone', 'box', 'arch', 'pyramid', 'wall', 'house', 'tower', 'castle', 'skyscraper', 'tree', 'road', 'bridge', 'text', 'pixelart', 'city']) {
      assert.ok(names.includes(n), `missing generator ${n}`);
    }
  });

  for (const g of gens) {
    test(`${g.name}: metadata and param specs are well-formed`, () => {
      assert.match(g.description, /\S/);
      for (const [k, spec] of Object.entries(g.params)) {
        assert.ok(['int', 'number', 'bool', 'string', 'block', 'enum', 'text', 'blocks'].includes(spec.type), `${g.name}.${k}: bad type`);
        assert.ok(spec.description, `${g.name}.${k}: missing description`);
        if (spec.type === 'enum') assert.ok(spec.values.includes(spec.default), `${g.name}.${k}: default not in values`);
        if (spec.min !== undefined && typeof spec.default === 'number') assert.ok(spec.default >= spec.min && spec.default <= (spec.max ?? Infinity), `${g.name}.${k}: default out of range`);
      }
    });

    const runs = [{}, ...(VARIANTS[g.name] ?? [])];
    runs.forEach((params, i) => {
      const label = `${g.name}${i === 0 ? ' (defaults)' : ` ${JSON.stringify(params)}`}`;
      test(`${label}: valid, deterministic, NW corner at 0,0`, () => {
        const a = runGenerator(g.name, { ...params, seed: 7 });
        checkStructure(g.name, a, label);
        const b = runGenerator(g.name, { ...params, seed: 7 });
        assert.equal(digest(a), digest(b), `${label}: same seed must give the same build`);
      });
    });
  }

  test('different seeds vary the randomised generators', () => {
    for (const name of ['tree', 'city']) {
      const params = name === 'city' ? { width: 80, depth: 80 } : {};
      assert.notEqual(digest(runGenerator(name, { ...params, seed: 1 })), digest(runGenerator(name, { ...params, seed: 2 })), name);
    }
  });
});

describe('param validation', () => {
  test('rejects bad values', () => {
    assert.throws(() => runGenerator('sphere', { radius: -1 }), /radius.*≥/);
    assert.throws(() => runGenerator('sphere', { radius: 'big' }), /integer/);
    assert.throws(() => runGenerator('tower', { shape: 'triangle' }), /one of round\|square/);
    assert.throws(() => runGenerator('house', { roofStyle: 'dome' }), /gable\|hip\|flat/);
    assert.throws(() => runGenerator('house', { windows: 'maybe' }), /true\/false/);
    assert.throws(() => runGenerator('house', { colour: 'red' }), /no param "colour"/);
    assert.throws(() => runGenerator('city', { parks: 2 }), /≤ 1/);
    assert.throws(() => runGenerator('text', { font: '8x8' }), /5x7\|3x5/);
    assert.throws(() => runGenerator('pixelart', { image: path.join(tmp, 'missing.png') }), /not found/);
  });

  test('coerces CLI strings', () => {
    const p = resolveParams(getGenerator('house'), { width: '9', windows: 'no', roofStyle: 'HIP', wall: 'minecraft:White_Terracotta' });
    assert.equal(p.width, 9);
    assert.equal(p.windows, false);
    assert.equal(p.roofStyle, 'hip');
    assert.equal(p.wall, 'white_terracotta');
  });
});

describe('v1 blueprint compatibility', () => {
  test('sphere {radius, material}: hollow shell sitting on y=0', () => {
    const s = runGenerator('sphere', { radius: 5, material: 'glass' });
    const b = s.bounds();
    assert.deepEqual(b.size, [11, 11, 11]);
    assert.equal(b.min[1], 0);
    assert.equal(s.get(5, 5, 5), null, 'hollow');
    assert.deepEqual(Object.keys(s.blockCounts()), ['glass']);
  });

  test('pyramid {height, material}', () => {
    const s = runGenerator('pyramid', { height: 10, material: 'gold_block' });
    const b = s.bounds();
    assert.equal(b.size[1], 10);
    assert.equal(b.size[0], 19);
    assert.equal(s.get(9, 9, 9), 'gold_block', 'pointed top');
    assert.deepEqual(Object.keys(s.blockCounts()), ['gold_block']);
  });

  test('wall {width, height, material}', () => {
    const s = runGenerator('wall', { width: 10, height: 5, material: 'stone' });
    assert.deepEqual(s.bounds().size, [10, 5, 1]);
    assert.equal(s.count, 50);
  });

  test('wall pillars stick out pillarDepth blocks on each side (0 = flush, so walls line up)', () => {
    assert.deepEqual(runGenerator('wall', { width: 13, height: 6, pillarEvery: 4, material: 'stone_bricks' }).bounds().size, [13, 7, 3]);
    const flush = runGenerator('wall', { width: 13, height: 6, pillarEvery: 4, pillarDepth: 0, material: 'stone_bricks' });
    assert.deepEqual(flush.bounds().size, [13, 6, 1]);
    assert.notEqual(flush.get(4, 2, 0), 'stone_bricks', 'pillar block in line with the wall');
  });

  test('arch carve=true cuts its opening (air), so it makes a gate in a wall placed before it', () => {
    const plain = runGenerator('arch', { width: 7, height: 6, depth: 1 });
    assert.equal(plain.get(3, 1, 0), null, 'opening left untouched by default');
    const carved = runGenerator('arch', { width: 7, height: 6, depth: 1, carve: true });
    assert.equal(carved.get(3, 1, 0), 'air');
    assert.deepEqual(carved.bounds().size, plain.bounds().size);
    const wall = new Structure().fill(0, 0, 0, 10, 6, 0, 'cobblestone');
    wall.place(carved, 2, 0, 0);
    assert.equal(wall.get(5, 1, 0), 'air', 'gate cut through the wall');
    assert.equal(wall.get(0, 1, 0), 'cobblestone');
  });

  test('house {width, depth, height, wall, roof, floor}', () => {
    const s = runGenerator('house', { width: 8, depth: 8, height: 5, wall: 'white_concrete', roof: 'spruce_planks', floor: 'oak_planks' });
    const counts = s.blockCounts();
    const names = new Set(Object.keys(counts).map((b) => blockName(b)));
    for (const n of ['white_concrete', 'spruce_stairs', 'oak_planks', 'spruce_door', 'glass_pane']) assert.ok(names.has(n), `house uses ${n}`);
    // the door is centred on the south wall (z = depth - 1 after the roof overhang shift)
    let doorZ = null, doorXs = [];
    s.forEach((x, y, z, b) => { if (/_door\[/.test(b) && /half=lower/.test(b)) { doorZ = z; doorXs.push(x); } });
    let maxWallZ = -Infinity;
    s.forEach((x, y, z, b) => { if (b === 'white_concrete' && z > maxWallZ) maxWallZ = z; });
    assert.equal(doorZ, maxWallZ, 'door in the south wall');
    const wallXs = [];
    s.forEach((x, y, z, b) => { if (z === maxWallZ && y === 1 && b !== 'air') wallXs.push(x); });
    const mid = (Math.min(...wallXs) + Math.max(...wallXs)) / 2;
    assert.equal((Math.min(...doorXs) + Math.max(...doorXs)) / 2, mid, 'door centred');
  });

  test('a roof material without stairs builds a stepped roof', () => {
    const s = runGenerator('house', { roof: 'red_concrete' });
    assert.ok(!Object.keys(s.blockCounts()).some((b) => /_stairs/.test(b) && /red/.test(b)));
    assert.ok(s.blockCounts().red_concrete > 30);
  });
});

describe('text generator orientation (readable from the stated side)', () => {
  const bm = textBitmap('TEXT');
  const W = bm.width, H = bm.height;
  const expectAt = {
    south: (x, y) => [x, H - 1 - y, 0],
    north: (x, y) => [W - 1 - x, H - 1 - y, 0],
    east: (x, y) => [0, H - 1 - y, W - 1 - x],
    west: (x, y) => [0, H - 1 - y, x],
  };
  for (const facing of ['south', 'north', 'east', 'west']) {
    test(`'TEXT' facing ${facing}`, () => {
      const s = runGenerator('text', { text: 'TEXT', facing });
      let n = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const [X, Y, Z] = expectAt[facing](x, y);
        assert.equal(s.get(X, Y, Z) != null, bm.pixels(x, y), `${facing}: pixel ${x},${y}`);
        if (bm.pixels(x, y)) n++;
      }
      assert.equal(s.count, n);
      // the first glyph (T) has its top bar at the reader's left end; E's spine is the 7th column
      const top = H - 1;
      const along = (i) => (facing === 'south' ? [i, top, 0] : facing === 'north' ? [W - 1 - i, top, 0] : facing === 'east' ? [0, top, W - 1 - i] : [0, top, i]);
      for (let i = 0; i < 5; i++) assert.ok(s.get(...along(i)), `${facing}: T top bar`);
      for (let y = 0; y < H; y++) {
        const [X, , Z] = along(6);
        assert.ok(s.get(X, y, Z), `${facing}: E spine at height ${y}`);
      }
      const lowEnd = facing === 'south' || facing === 'west';
      const b = s.bounds();
      const firstAxis = facing === 'south' || facing === 'north' ? 0 : 2;
      assert.equal(lowEnd ? b.min[firstAxis] : b.max[firstAxis], lowEnd ? 0 : W - 1);
    });
  }

  test("'flat' lies on the ground with the top of the letters toward the reader's far side", () => {
    const s = runGenerator('text', { text: 'TEXT', plane: 'flat' });
    assert.equal(s.bounds().size[1], 1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) assert.equal(s.get(x, 0, y) != null, bm.pixels(x, y));
    const n = runGenerator('text', { text: 'TEXT', plane: 'flat', facing: 'north' });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) assert.equal(n.get(W - 1 - x, 0, H - 1 - y) != null, bm.pixels(x, y));
  });

  test('background, padding and depth', () => {
    const s = runGenerator('text', { text: 'A', background: 'black_concrete', padding: 1, depth: 2 });
    assert.deepEqual(s.bounds().size, [7, 9, 2]);
    assert.equal(s.get(0, 0, 0), 'black_concrete');
    assert.equal(s.get(1, 1, 1), 'gold_block'); // A's left leg stands out toward the reader (south)
  });
});

describe('fonts', () => {
  test('5x7 covers letters, digits and punctuation', () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?-+=:;\'"/\\()[]&#@%*_<>~';
    for (const c of chars) assert.ok(FONTS['5x7'].glyphs[c], `5x7 lacks ${c}`);
    for (const c of chars.replace(/[a-z]/g, '')) assert.ok(FONTS['3x5'].glyphs[c], `3x5 lacks ${c}`);
    for (const [c, rows] of Object.entries(FONTS['5x7'].glyphs)) {
      assert.equal(rows.length, 7, c);
      for (const r of rows) assert.match(r, /^[#.]{5}$/, c);
    }
    for (const [c, rows] of Object.entries(FONTS['3x5'].glyphs)) {
      assert.equal(rows.length, 5, c);
      for (const r of rows) assert.match(r, /^[#.]{3}$/, c);
    }
  });

  test('textBitmap layout: y=0 is the top row, multi-line, scale, monospace', () => {
    const a = textBitmap('A');
    assert.equal(a.width, 5);
    assert.equal(a.height, 7);
    assert.equal(a.pixels(2, 0), true); // apex of the A
    assert.equal(a.pixels(0, 0), false);
    const two = textBitmap('AB\nC', { lineSpacing: 1 });
    assert.equal(two.height, 15);
    assert.equal(two.width, 11);
    const big = textBitmap('A', { scale: 3 });
    assert.equal(big.width, 15);
    assert.equal(big.pixels(6, 0), true);
    assert.equal(textBitmap('il', { monospace: true }).width, 11);
    assert.ok(textBitmap('il').width < 11, 'proportional by default');
    // 3x5 falls back to upper case
    assert.equal(textBitmap('abc', { font: '3x5' }).toString(), textBitmap('ABC', { font: '3x5' }).toString());
    assert.throws(() => textBitmap('x', { font: 'nope' }), /Unknown font/);
  });
});

describe('helpers', () => {
  test('materialFamily: every listed family resolves to real blocks', () => {
    const inputs = [
      ...WOOD_TYPES, 'oak_planks', 'dark_oak_stairs', 'stripped_spruce_log', 'stone', 'cobblestone', 'mossy_cobblestone', 'stone_bricks', 'stone_brick',
      'mossy_stone_bricks', 'bricks', 'sandstone', 'red_sandstone', 'smooth_sandstone', 'quartz', 'quartz_block', 'smooth_quartz', 'deepslate', 'cobbled_deepslate',
      'polished_deepslate', 'deepslate_bricks', 'deepslate_tiles', 'blackstone', 'polished_blackstone', 'polished_blackstone_bricks', 'polished_andesite',
      'polished_diorite', 'polished_granite', 'prismarine', 'prismarine_bricks', 'dark_prismarine', 'purpur', 'purpur_block', 'nether_bricks', 'red_nether_bricks',
      'end_stone_bricks', 'mud_bricks', 'tuff', 'polished_tuff', 'tuff_bricks', 'copper', 'cut_copper', 'exposed_cut_copper', 'waxed_oxidized_cut_copper', 'resin_bricks',
      'white_concrete', 'red_wool', 'glass', 'iron_block',
    ];
    for (const m of inputs) {
      const f = materialFamily(m);
      assert.ok(f.base && blockExists(f.base), `${m}: base`);
      for (const [k, v] of Object.entries(f)) {
        if (['kind', 'type', 'variants'].includes(k) || v == null) continue;
        assert.ok(blockExists(v), `${m}.${k} = ${v} does not exist`);
      }
      for (const v of f.variants) assert.ok(blockExists(v), `${m} variant ${v}`);
    }
    assert.deepEqual(
      [materialFamily('oak').stairs, materialFamily('stone_brick').wall, materialFamily('quartz_block').stairs, materialFamily('quartz').pillar, materialFamily('bamboo').log],
      ['oak_stairs', 'stone_brick_wall', 'quartz_stairs', 'quartz_pillar', 'bamboo_block'],
    );
    assert.equal(materialFamily('crimson').log, 'crimson_stem');
    assert.equal(materialFamily('cut_copper').door, 'copper_door');
    assert.equal(materialFamily('white_concrete').stairs, null);
    assert.equal(materialFamily('deepslate_tiles').stairs, 'deepslate_tile_stairs');
    assert.equal(materialFamily('nether_bricks').fence, 'nether_brick_fence');
  });

  test('stairs / slab strings (with full-block fallback)', () => {
    assert.equal(stairs('oak', 'north'), 'oak_stairs[facing=north,half=bottom]');
    assert.equal(stairs('stone_bricks', 'east', 'top'), 'stone_brick_stairs[facing=east,half=top]');
    assert.equal(stairs('white_concrete', 'north'), 'white_concrete');
    assert.equal(slab('quartz', 'top'), 'quartz_slab[type=top]');
  });

  test('door, double door, bed and tall plants place both halves', () => {
    const s = new Structure();
    door(s, 0, 0, 0, { facing: 'north', material: 'spruce', hinge: 'right' });
    assert.equal(s.get(0, 0, 0), 'spruce_door[facing=north,half=lower,hinge=right,open=false]');
    assert.equal(s.get(0, 1, 0), 'spruce_door[facing=north,half=upper,hinge=right,open=false]');
    doubleDoor(s, 2, 0, 0, { facing: 'south' });
    assert.match(s.get(2, 0, 0), /hinge=right/);
    assert.match(s.get(3, 0, 0), /hinge=left/);
    bed(s, 5, 0, 5, { facing: 'north', color: 'blue' });
    assert.equal(s.get(5, 0, 5), 'blue_bed[facing=north,occupied=false,part=foot]');
    assert.equal(s.get(5, 0, 4), 'blue_bed[facing=north,occupied=false,part=head]');
    plant(s, 8, 0, 8, 'rose_bush');
    assert.equal(s.get(8, 1, 8), 'rose_bush[half=upper]');
    torch(s, 9, 1, 9, { wall: 'north' });
    s.set(9, 1, 8, 'stone');
    assert.equal(s.get(9, 1, 9), 'wall_torch[facing=south]');
    lamp(s, 12, 0, 12, { style: 'post', height: 3 });
    assert.equal(s.get(12, 2, 12), 'lantern[hanging=false]');
    checkStructure('helpers', s, 'helper objects');
  });

  test('gable roof: stairs face up-slope, gables are filled', () => {
    const s = new Structure();
    gableRoof(s, { x1: 0, z1: 0, x2: 6, z2: 4, y: 4, material: 'spruce', ridge: 'x', overhang: 1 });
    assert.equal(s.get(3, 3, 5), 'spruce_stairs[facing=north,half=bottom]'); // south eave rises toward the north
    assert.equal(s.get(3, 3, -1), 'spruce_stairs[facing=south,half=bottom]');
    assert.equal(s.get(3, 6, 2), 'spruce_slab[type=bottom]'); // odd span → slab ridge
    assert.equal(s.get(0, 4, 2), 'spruce_planks'); // gable end
    assert.equal(s.get(-1, 4, 0), 'spruce_stairs[facing=south,half=bottom]'); // rake overhang
  });

  test('hip roof corners become outer-corner stairs like in game', () => {
    const s = new Structure();
    hipRoof(s, { x1: 0, z1: 0, x2: 8, z2: 6, y: 4, material: 'oak', overhang: 1 });
    const shapes = new Set();
    s.forEach((x, y, z, b) => { const sh = parseBlock(b).props.shape; if (sh) shapes.add(sh); });
    assert.ok(shapes.has('outer_left') && shapes.has('outer_right'));
    assert.ok(!shapes.has('inner_left') && !shapes.has('inner_right'));
  });

  test('flat roof with parapet; window rows; columns', () => {
    const s = new Structure();
    flatRoof(s, { x1: 0, z1: 0, x2: 5, z2: 5, y: 3, material: 'stone_bricks' });
    assert.equal(s.get(2, 3, 2), 'stone_bricks');
    assert.equal(s.get(0, 4, 0), 'stone_bricks');
    assert.equal(s.get(0, 5, 0), 'stone_brick_slab[type=bottom]');
    const w = new Structure();
    const wins = windowRow(w, { x1: 0, z1: 0, x2: 10, z2: 0, y: 1, width: 1, gap: 2, outside: 'south', sill: 'oak', shutters: 'spruce' });
    assert.equal(wins.length, 4);
    assert.match(w.get(wins[0].x, 0, 1), /oak_stairs.*half=top/);
    assert.match(w.get(wins[0].x - 1, 1, 1), /spruce_trapdoor.*open=true/);
    const c = new Structure();
    column(c, 0, 0, 0, 4, { shaft: 'quartz_pillar', base: 'smooth_quartz', capital: 'chiseled_quartz_block' });
    assert.equal(c.get(0, 1, 0), 'quartz_pillar[axis=y]');
  });

  test('stair shapes and fence/pane/wall connections are computed like the game', () => {
    const s = new Structure();
    s.set(0, 0, 0, 'oak_stairs[facing=north]');
    s.set(0, 0, -1, 'oak_stairs[facing=west]');
    fixStairShapes(s);
    assert.equal(parseBlock(s.get(0, 0, 0)).props.shape, 'outer_left');
    const f = new Structure();
    f.fill(0, 0, 0, 2, 0, 0, 'oak_fence').set(3, 0, 0, 'stone').set(0, 0, 1, 'glass_pane').set(0, 0, 2, 'cobblestone_wall');
    autoConnect(f);
    assert.equal(f.get(1, 0, 0), 'oak_fence[east=true,north=false,south=false,west=true]');
    assert.match(f.get(2, 0, 0), /east=true/);
    assert.match(f.get(0, 0, 1), /south=true/); // pane ↔ wall
    assert.match(f.get(0, 0, 2), /north=low/);
  });
});

test('timing: defaults finish quickly', () => {
  const slow = [];
  for (const g of listGenerators()) {
    const t0 = performance.now();
    runGenerator(g.name, {});
    const ms = performance.now() - t0;
    if (ms > 5000) slow.push(`${g.name} ${ms.toFixed(0)}ms`);
  }
  assert.deepEqual(slow, []);
});
