import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fromJson, loadBlueprint } from '../src/io/blueprint.js';
import { lintStructure } from '../src/core/lint.js';
import { Structure } from '../src/core/structure.js';

test('layers: rows go north→south (z), chars west→east (x), layers bottom→top (y)', async () => {
  const s = await fromJson({
    palette: { '#': 'stone', G: 'glass', _: 'air' },
    layers: [
      ['#G', '##'],
      ['_.', '.#'],
    ],
  });
  assert.equal(s.get(0, 0, 0), 'stone');
  assert.equal(s.get(1, 0, 0), 'glass');
  assert.equal(s.get(1, 0, 1), 'stone');
  assert.equal(s.get(0, 1, 0), 'air');
  assert.equal(s.get(1, 1, 0), null);
  assert.equal(s.get(1, 1, 1), 'stone');
  assert.equal(s.count, 6);
});

test('layers accept a newline-joined string per layer and a layerOrigin', async () => {
  const s = await fromJson({ palette: { X: 'stone' }, layerOrigin: [10, 2, -3], layers: ['X.\n.X'] });
  assert.equal(s.get(10, 2, -3), 'stone');
  assert.equal(s.get(11, 2, -2), 'stone');
});

test('unknown layer character gives a precise error', async () => {
  await assert.rejects(() => fromJson({ palette: { X: 'stone' }, layers: [['XQ']] }, { file: 'b.json' }), /layers\[0\] row 0 col 1: character "Q"/);
});

test('fills, blocks (object/array forms) and palette keys', async () => {
  const s = await fromJson({
    palette: { W: 'white_concrete' },
    fills: [{ from: [0, 0, 0], to: [4, 3, 4], block: 'W', mode: 'hollow' }],
    blocks: [{ x: 2, y: 1, z: 0, b: 'glass' }, [2, 2, 0, 'minecraft:oak_stairs[facing=north]'], { x: 9, y: 0, z: 0, name: 'W' }],
  });
  assert.equal(s.get(0, 0, 0), 'white_concrete');
  assert.equal(s.get(2, 2, 2), 'air');
  assert.equal(s.get(2, 1, 0), 'glass');
  assert.equal(s.get(2, 2, 0), 'oak_stairs[facing=north]');
  assert.equal(s.get(9, 0, 0), 'white_concrete');
});

test('v1 blueprint format (blocks with name / palette+b) still loads', async () => {
  const s = await fromJson({
    name: 'old',
    palette: { R: 'red_concrete' },
    blocks: [{ x: 0, y: 0, z: 0, name: 'stone' }, { x: 1, y: 0, z: 0, b: 'R' }],
  });
  assert.equal(s.get(0, 0, 0), 'stone');
  assert.equal(s.get(1, 0, 0), 'red_concrete');
  assert.equal(s.name, 'old');
});

test('parts compose inline sub-blueprints with rotation', async () => {
  const s = await fromJson({
    palette: { S: 'oak_stairs[facing=east]' },
    parts: [{ layers: [['S']], at: [5, 0, 5], rotate: 90 }],
  });
  assert.equal(s.get(5, 0, 5), 'oak_stairs[facing=south]');
});

test('loadBlueprint reads files, JS modules and reports missing files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcb-bp-'));
  const jf = path.join(dir, 'a.json');
  fs.writeFileSync(jf, JSON.stringify({ palette: { X: 'stone' }, layers: [['XX']] }));
  const a = await loadBlueprint(jf);
  assert.equal(a.count, 2);
  assert.equal(a.name, 'a');
  const mf = path.join(dir, 'b.mjs');
  fs.writeFileSync(mf, `export default { name: 'tower', params: { h: { type: 'int', default: 3 } }, build(s, p) { s.fill(0, 0, 0, 0, p.h - 1, 0, 'stone'); } };`);
  const b = await loadBlueprint(mf, { params: { h: '5' } });
  assert.equal(b.count, 5);
  assert.equal(b.name, 'tower');
  const ff = path.join(dir, 'c.mjs');
  fs.writeFileSync(ff, 'export default function (s, p, ctx) { s.set(0, 0, 0, "glass"); s.set(1, 0, 0, ctx.rng.pick(["stone"])); }');
  const c = await loadBlueprint(ff);
  assert.equal(c.count, 2);
  await assert.rejects(() => loadBlueprint(path.join(dir, 'nope.json')), /not found/);
  await assert.rejects(() => fromJson({ blocks: [{ x: 0, y: 0, z: 0 }] }), /missing block/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lint: unknown blocks get suggestions; bad properties are reported', () => {
  const s = new Structure().set(0, 0, 0, 'oak_plank').set(1, 0, 0, 'oak_stairs[facing=up]').set(2, 0, 0, 'stone[foo=bar]').set(3, 0, 0, 'redstone');
  const r = lintStructure(s, { version: '1.21.11' });
  assert.equal(r.ok, false);
  const msgs = r.errors.flatMap((e) => e.errors).join('\n');
  assert.match(msgs, /Unknown block "oak_plank".*oak_planks/);
  assert.match(msgs, /cannot be "up"/);
  assert.match(msgs, /has no property "foo"/);
  assert.match(msgs, /"redstone".*redstone_wire/);
});

test('lint auto-completes doors and beds', () => {
  const s = new Structure().set(0, 0, 0, 'oak_door[facing=south]').set(5, 0, 5, 'red_bed[facing=east]');
  const r = lintStructure(s, { version: '1.21.11' });
  assert.ok(r.ok);
  assert.equal(s.get(0, 0, 0), 'oak_door[facing=south,half=lower]');
  assert.equal(s.get(0, 1, 0), 'oak_door[facing=south,half=upper]');
  assert.equal(s.get(5, 0, 5), 'red_bed[facing=east,part=foot]');
  assert.equal(s.get(6, 0, 5), 'red_bed[facing=east,part=head]');
  assert.equal(r.fixes.length, 2);
});

test('lint warns about unsupported torches and floating sand', () => {
  const s = new Structure().fill(0, 0, 0, 4, 0, 4, 'stone').set(2, 3, 2, 'torch').set(0, 5, 0, 'sand').set(1, 1, 0, 'torch');
  const r = lintStructure(s, { version: '1.21.11' });
  const w = r.warnings.map((x) => x.message).join('\n');
  assert.match(w, /torch needs a supporting block below/);
  assert.match(w, /Gravity block \(sand\)/);
  const torchWarn = r.warnings.find((x) => /torch/.test(x.message));
  assert.equal(torchWarn.count, 1, 'the supported torch must not warn');
});
