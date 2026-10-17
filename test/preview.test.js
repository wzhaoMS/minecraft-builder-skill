import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Structure } from '../src/core/structure.js';
import { renderPreview } from '../src/render/preview.js';
import { decodePng, encodePng, crc32 } from '../src/render/png.js';
import { blockColor } from '../src/render/colors.js';
import { textBitmap } from '../src/render/font.js';

const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };

test('PNG encoder output decodes and round-trips pixels', () => {
  const w = 7, h = 5, rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = i * 7; rgba[i * 4 + 1] = 255 - i; rgba[i * 4 + 2] = (i * 31) & 255; rgba[i * 4 + 3] = 255; }
  const png = encodePng(w, h, rgba);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const back = decodePng(png);
  assert.equal(back.width, w);
  assert.deepEqual([...back.data], [...rgba]);
  assert.equal(crc32(Buffer.from('IEND')), 0xae426082);
});

test('every view renders a valid PNG within maxSize', () => {
  const s = new Structure({ name: 't' }).fill(0, 0, 0, 9, 5, 7, 'bricks', { mode: 'hollow' }).set(4, 6, 3, 'oak_stairs[facing=north]').set(2, 1, 0, 'glass_pane');
  for (const view of ['sheet', 'iso', 'iso-nw', 'iso-ne', 'iso-sw', 'top', 'south', 'north', 'east', 'west']) {
    const r = renderPreview(s, { view, maxSize: 900 });
    const img = decodePng(r.png);
    assert.equal(img.width, r.width, view);
    assert.ok(r.width <= 1600 && r.height <= 1600, `${view} ${r.width}x${r.height}`);
  }
  assert.throws(() => renderPreview(s, { view: 'sideways' }), /Unknown view/);
  const empty = renderPreview(new Structure(), { view: 'sheet' });
  assert.ok(decodePng(empty.png).width > 0);
});

function findColor(img, pred) {
  const hits = [];
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (pred(px(img, x, y))) hits.push([x, y]);
  if (!hits.length) return null;
  const cx = hits.reduce((a, p) => a + p[0], 0) / hits.length, cy = hits.reduce((a, p) => a + p[1], 0) / hits.length;
  return [cx, cy];
}
const isRed = ([r, g, b]) => r > 110 && g < 60 && b < 60;
const isBlue = ([r, g, b]) => b > 110 && r < 70 && g < 70;

test('orientation: east is right in top/south views, left in the north view; south is down in the top view', () => {
  const s = new Structure().fill(0, 0, 0, 20, 0, 20, 'white_concrete').fill(19, 1, 9, 20, 3, 11, 'red_concrete').fill(9, 1, 19, 11, 3, 20, 'blue_concrete');
  const top = decodePng(renderPreview(s, { view: 'top', scale: 10 }).png);
  const red = findColor(top, isRed), blue = findColor(top, isBlue);
  assert.ok(red[0] > top.width * 0.6, 'red (east) on the right of the top view');
  assert.ok(blue[1] > top.height * 0.6, 'blue (south) at the bottom of the top view');
  const south = decodePng(renderPreview(s, { view: 'south', scale: 10 }).png);
  assert.ok(findColor(south, isRed)[0] > south.width * 0.6, 'east is right when looking from the south');
  const north = decodePng(renderPreview(s, { view: 'north', scale: 10 }).png);
  assert.ok(findColor(north, isRed)[0] < north.width * 0.45, 'east is left when looking from the north');
  const east = decodePng(renderPreview(s, { view: 'east', scale: 10 }).png);
  assert.ok(findColor(east, isBlue)[0] < east.width * 0.45, 'south is left when looking from the east');
  const iso = decodePng(renderPreview(s, { view: 'iso', scale: 8 }).png);
  const ri = findColor(iso, isRed), bi = findColor(iso, isBlue);
  assert.ok(ri[0] > bi[0], 'iso from the SE: east side appears right of the south side');
});

test('colours and shapes are sensible', () => {
  const red = blockColor('red_concrete');
  assert.ok(red.top[0] > red.top[1] * 2);
  assert.ok(blockColor('grass_block').top[1] > blockColor('grass_block').top[0]);
  assert.ok(blockColor('glass').a < 1);
  assert.equal(blockColor('stone_brick_stairs[facing=east]').shape, 'stairs');
  assert.deepEqual(blockColor('stone_brick_stairs').top, blockColor('stone_bricks').top);
  assert.equal(blockColor('oak_slab[type=top]').shape, 'slab-top');
  assert.equal(blockColor('oak_fence').shape, 'post');
  assert.equal(blockColor('poppy').shape, 'cross');
  assert.equal(blockColor('white_carpet').shape, 'thin');
  assert.ok(blockColor('some_future_block').top.length === 3);
});

test('bitmap font renders text with proportional widths and multiple lines', () => {
  const a = textBitmap('HI');
  assert.equal(a.height, 7);
  assert.equal(a.width, 11);
  assert.ok(a.pixels(0, 0) && !a.pixels(1, 0));
  const b = textBitmap('A\nB', { font: '3x5', scale: 2 });
  assert.equal(b.height, (5 * 2 + 1) * 2);
  const p = textBitmap('I1', { proportional: true });
  assert.ok(p.width < textBitmap('I1').width);
});

test('renders large structures quickly', () => {
  const s = new Structure();
  for (let i = 0; i < 30; i++) s.fill(i * 7, 0, 0, i * 7 + 5, 40 + (i % 5) * 10, 60, i % 2 ? 'white_concrete' : 'light_blue_stained_glass', { mode: 'hollow' });
  const t0 = Date.now();
  const r = renderPreview(s, { view: 'sheet' });
  const ms = Date.now() - t0;
  assert.ok(s.count > 150000);
  assert.ok(ms < 4000, `took ${ms} ms`);
  assert.ok(r.width > 400);
});
