import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { Structure } from '../src/core/structure.js';
import { renderPreview } from '../src/render/preview.js';
import { encodePng, decodePng, crc32 } from '../src/render/png.js';
import { blockColor } from '../src/render/colors.js';

const VIEWS = ['sheet', 'iso', 'iso-ne', 'iso-nw', 'iso-sw', 'top', 'south', 'north', 'east', 'west'];

/** Hollow 10×10×10 house: cobble floor, brick walls, glass windows, door, oak-stair gable roof. */
function house() {
  const s = new Structure({ name: 'house' });
  s.fill(0, 0, 0, 9, 0, 9, 'cobblestone');
  s.fill(0, 1, 0, 9, 5, 9, 'bricks', { mode: 'walls' });
  s.fill(1, 1, 1, 8, 5, 8, 'air');
  for (let i = 0; i < 5; i++) {
    s.fill(0, 6 + i, i, 9, 6 + i, i, 'oak_stairs[facing=south]');
    s.fill(0, 6 + i, 9 - i, 9, 6 + i, 9 - i, 'oak_stairs[facing=north]');
  }
  s.set(4, 1, 9, 'oak_door[facing=south,half=lower]').set(4, 2, 9, 'oak_door[facing=south,half=upper]');
  s.fill(2, 2, 9, 2, 3, 9, 'glass_pane').fill(7, 2, 9, 7, 3, 9, 'glass_pane');
  s.set(3, 3, 10, 'wall_torch[facing=south]');
  return s;
}

/** Centroid (fractions of width/height) of the pixels that differ between two same-size PNGs. */
function diffCentroid(a, b) {
  const A = decodePng(a), B = decodePng(b);
  assert.equal(A.width, B.width);
  assert.equal(A.height, B.height);
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) {
      const p = i / 4;
      sx += p % A.width; sy += Math.floor(p / A.width); n++;
    }
  }
  assert.ok(n > 0, 'the marker block must be visible');
  return { x: sx / n / A.width, y: sy / n / A.height };
}

test('encodePng writes a valid RGBA PNG (signature, IHDR, chunk CRCs) that pngjs decodes', () => {
  const w = 5, h = 3, rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([i * 17, 255 - i * 9, (i * 53) & 255, i % 2 ? 255 : 128], i * 4);
  const png = encodePng(w, h, rgba);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), w);
  assert.equal(png.readUInt32BE(20), h);
  assert.equal(png[24], 8, 'bit depth');
  assert.equal(png[25], 6, 'colour type RGBA');
  const types = [];
  for (let p = 8; p < png.length;) {
    const len = png.readUInt32BE(p), type = png.toString('ascii', p + 4, p + 8);
    assert.equal(png.readUInt32BE(p + 8 + len), crc32(png.subarray(p + 4, p + 8 + len)), `${type} CRC`);
    if (type === 'IDAT') assert.equal(zlib.inflateSync(png.subarray(p + 8, p + 8 + len)).length, (w * 4 + 1) * h);
    types.push(type);
    p += 12 + len;
  }
  assert.deepEqual([types[0], types.at(-1)], ['IHDR', 'IEND']);
  const back = decodePng(png);
  assert.deepEqual([back.width, back.height], [w, h]);
  assert.deepEqual([...back.data], [...rgba]);
});

test('every view returns a decodable PNG whose longest side respects maxSize', () => {
  const s = house();
  for (const maxSize of [200, 640]) {
    for (const view of VIEWS) {
      const r = renderPreview(s, { view, maxSize });
      const img = decodePng(r.png);
      assert.deepEqual([img.width, img.height], [r.width, r.height], view);
      assert.ok(Math.max(r.width, r.height) <= maxSize, `${view} @${maxSize}: ${r.width}×${r.height}`);
      assert.equal(r.view, view);
    }
  }
  // very long / very tall structures are scaled down instead of overflowing
  const wide = new Structure().fill(0, 0, 0, 2999, 0, 3, 'stone');
  for (const view of ['sheet', 'iso', 'top']) assert.ok(renderPreview(wide, { view }).width <= 1600, view);
  const tall = new Structure().fill(0, 0, 0, 3, 399, 3, 'stone');
  for (const view of ['sheet', 'iso', 'south']) assert.ok(renderPreview(tall, { view }).height <= 1600, view);
});

test('all views differ from each other and output is deterministic', () => {
  const s = house();
  const pngs = VIEWS.map((view) => renderPreview(s, { view, title: 'house' }).png.toString('base64'));
  assert.equal(new Set(pngs).size, VIEWS.length);
  assert.ok(renderPreview(s, { view: 'sheet', title: 'house' }).png.equals(Buffer.from(pngs[0], 'base64')));
});

test('empty structures render a small placeholder; unknown views throw', () => {
  for (const s of [new Structure(), new Structure().fill(0, 0, 0, 2, 2, 2, 'air')]) {
    const r = renderPreview(s, { view: 'sheet' });
    assert.ok(r.width > 0 && r.width <= 400 && r.height <= 200);
    assert.ok(decodePng(r.png).width === r.width);
  }
  assert.throws(() => renderPreview(house(), { view: 'diagonal' }), /Unknown view/);
});

test('block colours come from the texture table and fall back sensibly', () => {
  const red = blockColor('red_concrete');
  assert.ok(red.top[0] > 2 * red.top[1] && red.top[0] > 2 * red.top[2], 'red concrete is red');
  const grass = blockColor('grass_block');
  assert.ok(grass.top[1] > grass.top[0] && grass.top[1] > grass.top[2], 'grass top is green');
  assert.ok(grass.side[0] > grass.side[2], 'grass side is dirt-brown');
  assert.ok(blockColor('glass').a < 0.5);
  assert.ok(blockColor('water').a < 1 && blockColor('water').top[2] > blockColor('water').top[0]);
  const stone = blockColor('stone').top;
  assert.ok(Math.max(...stone) - Math.min(...stone) < 8, 'stone is grey');
  assert.deepEqual(blockColor('brick_stairs[facing=east]').side, blockColor('bricks').side);
  assert.deepEqual(blockColor('waxed_cut_copper_slab').top, blockColor('cut_copper').top);
  assert.equal(blockColor('stone_brick_slab[type=top]').shape, 'slab-top');
  assert.equal(blockColor('oak_slab[type=double]').shape, 'cube');
  assert.equal(blockColor('wall_torch[facing=north]').shape, 'small');
  assert.equal(blockColor('sea_lantern').shape, 'cube');
  assert.equal(blockColor('oak_fence').shape, 'post');
  const unknown = blockColor('mymod:shiny_block');
  assert.equal(unknown.top.length, 3);
  assert.deepEqual(blockColor('mymod:shiny_block').top, unknown.top, 'fallback colour is deterministic');
});

test('orientation: east/south land where the view promises (top, elevations, all four iso corners)', () => {
  // floor 0..20 plus a fixed outlier so adding a marker never changes the image size
  const base = () => new Structure().fill(0, 0, 0, 20, 0, 20, 'white_concrete').set(-5, 1, -5, 'stone');
  const opts = (view) => ({ view, maxSize: 360 });
  const baseline = new Map();
  const at = (view, x, z) => {
    if (!baseline.has(view)) baseline.set(view, renderPreview(base(), opts(view)).png);
    return diffCentroid(baseline.get(view), renderPreview(base().set(x, 1, z, 'red_concrete'), opts(view)).png);
  };
  const E = [20, 10], S = [10, 20], N = [10, 0], W = [0, 10];

  const top = { e: at('top', ...E), s: at('top', ...S), n: at('top', ...N), w: at('top', ...W) };
  assert.ok(top.e.x > top.w.x + 0.3, 'top: east is right');
  assert.ok(top.s.y > top.n.y + 0.3, 'top: south is down (north up)');
  assert.ok(at('south', ...E).x > at('south', ...W).x + 0.3, 'south elevation: east on the right');
  assert.ok(at('north', ...E).x < at('north', ...W).x - 0.3, 'north elevation: east on the left');
  assert.ok(at('east', ...N).x > at('east', ...S).x + 0.3, 'east elevation (looking west): north on the right');
  assert.ok(at('west', ...S).x > at('west', ...N).x + 0.3, 'west elevation (looking east): south on the right');

  // iso-XY: the X and Y sides are nearest the camera → lowest on screen; the opposite sides are far → highest
  for (const [view, near, far] of [['iso', [E, S], [W, N]], ['iso-ne', [N, E], [S, W]], ['iso-nw', [N, W], [S, E]], ['iso-sw', [S, W], [N, E]]]) {
    const nearY = Math.min(...near.map((p) => at(view, ...p).y));
    const farY = Math.max(...far.map((p) => at(view, ...p).y));
    assert.ok(nearY > farY + 0.15, `${view}: near sides below far sides`);
  }
  // from the south-east the east side is on the right, the south side on the left
  assert.ok(at('iso', ...E).x > at('iso', ...S).x + 0.2);
});

test('a 10×10×10 house sheet renders quickly with a sensible size', () => {
  const t0 = performance.now();
  const r = renderPreview(house(), { view: 'sheet', title: 'house' });
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `sheet took ${ms.toFixed(0)} ms`);
  assert.ok(r.width >= 400 && r.height >= 300 && Math.max(r.width, r.height) <= 1600, `${r.width}×${r.height}`);
});

test('options: background colour, showGrid:false, cutaway.y', () => {
  const s = house();
  for (const view of ['iso', 'top', 'sheet']) {
    for (const background of [[10, 200, 30], '#0ac81e']) {
      const img = decodePng(renderPreview(s, { view, background }).png);
      const i = ((img.height - 1) * img.width) * 4; // bottom-left pixel is always background
      assert.deepEqual([...img.data.subarray(i, i + 3)], [10, 200, 30], `${view} ${background}`);
    }
  }
  assert.throws(() => renderPreview(s, { background: 'greenish' }), /background/);

  // grid lines: a flat floor seen from the top is one colour without the grid, several with it
  const floor = new Structure().fill(0, 0, 0, 19, 0, 19, 'white_concrete');
  const rowColours = (opts) => {
    const img = decodePng(renderPreview(floor, { view: 'top', scale: 10, ...opts }).png);
    const y = 12 + 105, seen = new Set();
    for (let x = 30; x < 220; x++) { const i = (y * img.width + x) * 4; seen.add(img.data.subarray(i, i + 3).join()); }
    return seen.size;
  };
  assert.ok(rowColours({}) >= 2, 'grid lines visible by default');
  assert.equal(rowColours({ showGrid: false }), 1, 'no grid lines with showGrid:false');

  // cutaway: a red roof hides the blue floor from above until everything above y=4 is cut away
  const box = new Structure().fill(0, 0, 0, 9, 0, 9, 'blue_concrete').fill(0, 5, 0, 9, 5, 9, 'red_concrete');
  const count = (opts, pred) => {
    const img = decodePng(renderPreview(box, { view: 'top', scale: 10, ...opts }).png);
    let n = 0;
    for (let i = 0; i < img.data.length; i += 4) if (pred(img.data[i], img.data[i + 1], img.data[i + 2])) n++;
    return n;
  };
  const isRed = (r, g, b) => r > 100 && g < 60 && b < 60, isBlue = (r, g, b) => b > 100 && r < 70 && g < 70;
  assert.ok(count({}, isRed) > 2000 && count({}, isBlue) < 300);
  assert.ok(count({ cutaway: { y: 4 } }, isBlue) > 2000 && count({ cutaway: { y: 4 } }, isRed) === 0);
  const cutSheet = renderPreview(box, { view: 'sheet', cutaway: { y: 4 } });
  assert.ok(!cutSheet.png.equals(renderPreview(box, { view: 'sheet' }).png));
  assert.ok(renderPreview(box, { view: 'sheet', cutaway: { y: -1 } }).width <= 400, 'everything cut away → placeholder');
});

test('performance: ~150k-voxel city renders (sheet) in well under 3 s', () => {
  const s = new Structure({ name: 'city' });
  s.fill(0, 0, 0, 119, 0, 119, 'gray_concrete');
  const mats = ['white_concrete', 'stone_bricks', 'bricks', 'glass', 'quartz_block', 'blue_stained_glass'];
  let k = 0;
  for (let bx = 1; bx + 7 < 120; bx += 10) {
    for (let bz = 1; bz + 7 < 120; bz += 10) {
      const h = 6 + ((bx * 7 + bz * 13) % 30);
      s.fill(bx, 1, bz, bx + 7, h, bz + 7, mats[k++ % mats.length], { mode: 'hollow' });
    }
  }
  assert.ok(s.count > 150000, `count ${s.count}`);
  const t0 = performance.now();
  const r = renderPreview(s, { view: 'sheet', title: 'city' });
  const ms = performance.now() - t0;
  assert.ok(ms < 3000, `sheet took ${ms.toFixed(0)} ms`);
  assert.ok(decodePng(r.png).width === r.width);
});

test('scale: a ~1M-voxel 400×150×400 city and a sparse 3000-block-wide layout both render quickly', () => {
  const city = new Structure({ name: 'big' });
  city.fill(0, 0, 0, 399, 0, 399, 'gray_concrete');
  let k = 0;
  for (let bx = 2; bx + 9 < 400; bx += 16) {
    for (let bz = 2; bz + 9 < 400; bz += 16) {
      city.fill(bx, 1, bz, bx + 9, 10 + ((bx * 3 + bz * 5) % 139), bz + 9, k++ % 3 ? 'stone_bricks' : 'glass', { mode: 'walls' });
    }
  }
  assert.ok(city.count > 900000, `count ${city.count}`);
  let t0 = performance.now();
  const r = renderPreview(city, { view: 'sheet' });
  const ms = performance.now() - t0;
  assert.ok(ms < 10000, `1M-voxel sheet took ${ms.toFixed(0)} ms`);
  assert.ok(Math.max(r.width, r.height) <= 1600);

  // bounding volume > 64M cells → sparse occupancy; the ground plane spans ~6000×3000 px before downscaling
  const sparse = new Structure();
  for (const [ox, oz] of [[0, 0], [3000, 3000], [3000, 0]]) sparse.fill(ox, 0, oz, ox + 20, 3, oz + 20, 'bricks', { mode: 'walls' });
  t0 = performance.now();
  for (const view of ['iso', 'iso-sw', 'top']) assert.ok(renderPreview(sparse, { view }).width <= 1600, view);
  assert.ok(performance.now() - t0 < 15000, 'sparse renders');
});
