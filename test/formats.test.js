import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { Structure } from '../src/core/structure.js';
import { isAir } from '../src/core/blockstate.js';
import { fromJson } from '../src/io/blueprint.js';
import {
  readSponge, writeSponge, readStructureNbt, writeStructureNbt, readLitematic, writeLitematic,
  readStructureFile, writeStructureFile, formatForPath, structureToJson, structureToJsonText, jsonToStructure,
  paletteKey, readLegacySchematic,
} from '../src/io/formats/index.js';
import { parseSnbt, tagToSnbt, parseNbt, dataVersionFor, upgradeBlockState } from '../src/io/formats/nbt-util.js';
import { unpackSpanning, packSpanning, litematicBits } from '../src/io/formats/litematic.js';
import { buildDatapack, writeDatapack, writeMcfunction, splitIntoParts, PACK_FORMAT, MAX_PACK_FORMAT } from '../src/io/datapack.js';

const require = createRequire(import.meta.url);
const nbt = require('prismarine-nbt');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mcb-formats-'));

/** A small structure exercising states, explicit air, untouched gaps and block entities. */
function sample() {
  const s = new Structure({ name: 'sample' });
  s.fill(-3, 2, 5, 3, 2, 9, 'stone_bricks'); // floor, min corner not at the origin
  s.fill(-3, 3, 5, 3, 6, 9, 'bricks', { mode: 'walls' });
  s.fill(-2, 3, 6, 2, 5, 8, 'air'); // explicit air inside
  s.set(0, 3, 5, 'oak_door[facing=north,half=lower,hinge=left]').set(0, 4, 5, 'oak_door[facing=north,half=upper,hinge=left]');
  s.set(-3, 4, 7, 'glass_pane[east=true,west=true]');
  s.set(1, 3, 8, 'oak_stairs[facing=east,half=top,shape=straight]');
  s.set(-1, 3, 8, 'chest[facing=south,type=single]{Items:[{Slot:0b,count:3,id:"minecraft:stone"}]}');
  s.set(2, 5, 6, 'oak_wall_sign[facing=south]{front_text:{messages:[\'"hi"\',"","",""]}}');
  s.set(0, 7, 7, 'lantern[hanging=false]');
  s.set(5, 2, 7, 'oak_log[axis=x]'); // detached, leaves untouched voxels in between
  return s;
}

function voxels(s) {
  const out = new Map();
  s.forEach((x, y, z, b) => out.set(`${x},${y},${z}`, b));
  return out;
}

/** Expected structure after a round trip through a format with/without explicit air. */
function expectSame(actual, expected, { airAsUntouched = false, untouchedAsAir = false, msg = '' } = {}) {
  const e = expected.normalized();
  const b = e.bounds();
  for (let y = 0; y < b.size[1]; y++) {
    for (let z = 0; z < b.size[2]; z++) {
      for (let x = 0; x < b.size[0]; x++) {
        let want = e.get(x, y, z);
        if (want != null && airAsUntouched && isAir(want)) want = null;
        if (want == null && untouchedAsAir) want = 'air';
        assert.equal(actual.get(x, y, z), want, `${msg} voxel ${x},${y},${z}`);
      }
    }
  }
  const extra = [...voxels(actual).keys()].filter((k) => { const [x, y, z] = k.split(',').map(Number); return x < 0 || y < 0 || z < 0 || x >= b.size[0] || y >= b.size[1] || z >= b.size[2]; });
  assert.deepEqual(extra, [], `${msg} no voxels outside the bounds`);
}

// ───────────────────────── SNBT ─────────────────────────

test('SNBT parse/print round-trips typed values, arrays, nested lists and quoting', () => {
  const src = '{a:1b,b:2s,c:3,d:4L,e:1.5f,f:-2.25d,g:"x\\"y",h:\'it\\\'s\',"odd key":[I;1,-2],l:[L;5L,-6L],k:[B;1b,2b],n:[[1,2],[3]],o:[{p:true}],q:[]}';
  const tag = parseSnbt(src);
  assert.equal(tag.value.a.type, 'byte');
  assert.equal(tag.value.d.type, 'long');
  assert.equal(tag.value.e.type, 'float');
  assert.equal(tag.value.g.value, 'x"y');
  assert.equal(tag.value.h.value, "it's");
  assert.equal(tag.value.o.value.value[0].p.value, 1);
  const text = tagToSnbt(tag);
  assert.deepEqual(parseSnbt(text), tag);
  assert.match(text, /"odd key":\[I;1,-2\]/);
  assert.equal(tagToSnbt({ type: 'float', value: Math.fround(0.1) }), '0.1f');
  assert.throws(() => parseSnbt('{a:[1,2b]}'), /mixed/);
  assert.throws(() => parseSnbt('{a:1'), /Invalid SNBT/);
});

// ───────────────────────── Sponge ─────────────────────────

for (const version of [2, 3]) {
  test(`Sponge v${version}: write → read keeps every block state, block entities and metadata`, () => {
    const s = sample();
    const buf = writeSponge(s, { version, author: 'tester', date: 1700000000000 });
    assert.equal(buf[0], 0x1f, 'gzipped');
    const root = parseNbt(buf);
    if (version === 3) {
      assert.equal(root.name, '');
      assert.equal(root.value.Schematic.value.Version.value, 3);
      assert.ok(root.value.Schematic.value.Blocks.value.Palette);
    } else {
      assert.equal(root.name, 'Schematic');
      assert.equal(root.value.Version.value, 2);
      assert.deepEqual(root.value.Offset.value, [0, 0, 0]);
      assert.equal(root.value.Metadata.value.WEOffsetX.value, 0);
    }
    // default: air (explicit and untouched) → untouched
    const r = readSponge(buf);
    expectSame(r, s, { airAsUntouched: true, msg: `v${version}` });
    assert.equal(r.name, 'sample');
    assert.equal(r.meta.author, 'tester');
    assert.equal(r.meta.dataVersion, 4671);
    assert.deepEqual(r.meta.size, s.bounds().size);
    assert.equal(r.meta.blockEntities.kept, 2);
    // keepAir: explicit air survives; untouched voxels inside the box come back as air (Sponge has no "void")
    const ra = readSponge(buf, { keepAir: true });
    expectSame(ra, s, { untouchedAsAir: true, msg: `v${version} keepAir` });
  });
}

test('Sponge: >127 palette entries use multi-byte varints; v1 / nested-root files are read', () => {
  const s = new Structure({ name: 'many' });
  for (let i = 0; i < 300; i++) s.set(i % 20, Math.floor(i / 400), Math.floor(i / 20), `stone[v=${i}]`);
  for (const version of [2, 3]) expectSame(readSponge(writeSponge(s, { version })), s, { msg: `v${version}` });

  // Hand-made v1 file: TileEntities, x + z*W + y*W*L ordering, raw (not gzipped) NBT
  const v1 = nbt.writeUncompressed({
    type: 'compound', name: 'Schematic', value: {
      Version: nbt.int(1), Width: nbt.short(2), Height: nbt.short(2), Length: nbt.short(1),
      Palette: nbt.comp({ 'minecraft:air': nbt.int(0), 'minecraft:stone': nbt.int(1), 'minecraft:chest[facing=west]': nbt.int(2) }),
      BlockData: nbt.byteArray([1, 0, 2, 1]),
      TileEntities: { type: 'list', value: { type: 'compound', value: [{ Pos: nbt.intArray([0, 1, 0]), Id: nbt.string('minecraft:chest'), CustomName: nbt.string('Box') }] } },
    },
  });
  const r1 = readSponge(v1);
  assert.equal(r1.get(0, 0, 0), 'stone');
  assert.equal(r1.get(1, 0, 0), null);
  assert.equal(r1.get(0, 1, 0), 'chest[facing=west]{CustomName:"Box"}');
  assert.equal(r1.get(1, 1, 0), 'stone');
  assert.equal(r1.meta.formatVersion, 1);

  // v3 written by tools that name the root "Schematic" and nest another "Schematic" inside
  const inner = parseNbt(writeSponge(s, { version: 3 })).value.Schematic;
  const nested = zlib.gzipSync(nbt.writeUncompressed({ type: 'compound', name: 'Schematic', value: { Schematic: inner } }));
  expectSame(readSponge(nested), s, { msg: 'nested' });
});

test('Sponge: blocks renamed since the file was made are upgraded (grass, chain, cauldron, sign)', () => {
  const raw = nbt.writeUncompressed({
    type: 'compound', name: 'Schematic', value: {
      Version: nbt.int(2), DataVersion: nbt.int(2584), Width: nbt.short(5), Height: nbt.short(1), Length: nbt.short(1),
      Palette: nbt.comp({
        'minecraft:grass': nbt.int(0), 'minecraft:chain[axis=y,waterlogged=false]': nbt.int(1), 'minecraft:cauldron[level=2]': nbt.int(2),
        'minecraft:cauldron[level=0]': nbt.int(3), 'minecraft:stone_slab[type=top]': nbt.int(4),
      }),
      BlockData: nbt.byteArray([0, 1, 2, 3, 4]),
    },
  });
  const s = readSponge(raw);
  assert.deepEqual([0, 1, 2, 3, 4].map((x) => s.get(x, 0, 0)), [
    'short_grass', 'iron_chain[axis=y,waterlogged=false]', 'water_cauldron[level=2]', 'cauldron', 'stone_slab[type=top]',
  ]);
  // targeting an older version keeps names that version still has
  assert.equal(readSponge(raw, { targetDataVersion: 3955 }).get(1, 0, 0), 'chain[axis=y,waterlogged=false]');
  assert.equal(upgradeBlockState('sign[rotation=4]{Text1:"x"}', { from: 1631 }), 'oak_sign[rotation=4]{Text1:"x"}');
  assert.equal(upgradeBlockState('stone_slab[type=top]', { from: 1631 }), 'smooth_stone_slab[type=top]');
  assert.equal(upgradeBlockState('cobblestone_wall[north=true,up=true]', { from: 1631 }), 'cobblestone_wall[north=low,up=true]');
  assert.equal(upgradeBlockState('grass', { from: 4671 }), 'grass', 'already current');
});

test('Sponge: block entity data longer than 180 chars is dropped (block kept)', () => {
  const s = new Structure().set(0, 0, 0, `chest[facing=north]{CustomName:"${'x'.repeat(200)}"}`);
  const r = readSponge(writeSponge(s));
  assert.equal(r.get(0, 0, 0), 'chest[facing=north]');
  assert.deepEqual(r.meta.blockEntities, { total: 1, kept: 0, skipped: 1 });
});

// ───────────────────────── structure .nbt ─────────────────────────

test('structure .nbt: exact round trip incl. explicit air; untouched voxels are not written', () => {
  const s = sample();
  const buf = writeStructureNbt(s, { dataVersion: 3955 });
  const root = parseNbt(buf);
  assert.equal(root.value.DataVersion.value, 3955);
  assert.deepEqual(root.value.size.value.value, s.bounds().size);
  assert.equal(root.value.blocks.value.value.length, s.count, 'one entry per non-untouched voxel');
  assert.equal(root.value.entities.value.value.length, 0);
  const chest = root.value.blocks.value.value.find((b) => b.nbt);
  assert.ok(chest, 'block entity written as nbt');
  expectSame(readStructureNbt(buf, { keepAir: true }), s, { msg: 'keepAir' });
  expectSame(readStructureNbt(buf), s, { airAsUntouched: true, msg: 'default' });
});

test('structure .nbt: structure_void is untouched, palettes[] files use the first palette', () => {
  const raw = nbt.writeUncompressed({
    type: 'compound', name: '', value: {
      DataVersion: nbt.int(4671),
      size: { type: 'list', value: { type: 'int', value: [2, 1, 1] } },
      palettes: { type: 'list', value: { type: 'list', value: [
        { type: 'compound', value: [{ Name: nbt.string('minecraft:structure_void') }, { Name: nbt.string('minecraft:oak_stairs'), Properties: nbt.comp({ facing: nbt.string('west'), half: nbt.string('bottom') }) }] },
        { type: 'compound', value: [{ Name: nbt.string('minecraft:stone') }, { Name: nbt.string('minecraft:dirt') }] },
      ] } },
      blocks: { type: 'list', value: { type: 'compound', value: [
        { pos: { type: 'list', value: { type: 'int', value: [0, 0, 0] } }, state: nbt.int(0) },
        { pos: { type: 'list', value: { type: 'int', value: [1, 0, 0] } }, state: nbt.int(1) },
      ] } },
    },
  });
  const r = readStructureNbt(raw);
  assert.equal(r.get(0, 0, 0), null);
  assert.equal(r.get(1, 0, 0), 'oak_stairs[facing=west,half=bottom]');
  assert.equal(r.count, 1);
});

// ───────────────────────── Litematica ─────────────────────────

/** Independent (BigInt) implementation of Litematica's spanning bit packing, for the test file. */
function packBig(values, bits) {
  let big = 0n;
  values.forEach((v, i) => { big |= BigInt(v) << BigInt(i * bits); });
  const n = Math.ceil((values.length * bits) / 64);
  const longs = [];
  for (let i = 0; i < n; i++) {
    const l = (big >> BigInt(64 * i)) & 0xffffffffffffffffn;
    longs.push([Number(BigInt.asIntN(32, l >> 32n)), Number(BigInt.asIntN(32, l))]);
  }
  return longs;
}

const xyz = (x, y, z) => nbt.comp({ x: nbt.int(x), y: nbt.int(y), z: nbt.int(z) });
const pal = (names) => ({ type: 'list', value: { type: 'compound', value: names.map((n) => {
  const m = /^([^[]+)(?:\[(.*)\])?$/.exec(n);
  const e = { Name: nbt.string(m[1]) };
  if (m[2]) e.Properties = nbt.comp(Object.fromEntries(m[2].split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, nbt.string(v)])));
  return e;
}) } });

test('litematic: hand-made file with spanning entries, 6-entry palette and a negative-size region', () => {
  // Region A: 4×2×3 at (0,0,0), palette of 6 → 3 bits/entry, 72 bits → 2 longs; entry 21 spans both longs.
  const palA = ['minecraft:air', 'minecraft:stone', 'minecraft:oak_planks', 'minecraft:glass', 'minecraft:oak_stairs[facing=east,half=bottom]', 'minecraft:bricks'];
  const valsA = Array.from({ length: 24 }, (_, i) => (i * 5 + 1) % 6);
  valsA[21] = 5; // bits 63..65 → crosses the long boundary
  const longsA = packBig(valsA, 3);
  assert.equal(longsA.length, 2);
  // Region B: Position (10,0,5), Size (-3,1,-2) → occupies x 8..10, z 4..5; 2-entry palette → 2 bits
  const valsB = [1, 0, 1, 1, 1, 0];
  const root = nbt.writeUncompressed({
    type: 'compound', name: '', value: {
      MinecraftDataVersion: nbt.int(4671), Version: nbt.int(6),
      Metadata: nbt.comp({ Name: nbt.string('Test Build'), Author: nbt.string('someone'), Description: nbt.string('desc'), EnclosingSize: xyz(11, 2, 6) }),
      Regions: nbt.comp({
        A: nbt.comp({
          Position: xyz(0, 0, 0), Size: xyz(4, 2, 3), BlockStatePalette: pal(palA), BlockStates: nbt.longArray(longsA),
          TileEntities: { type: 'list', value: { type: 'compound', value: [] } },
        }),
        B: nbt.comp({
          Position: xyz(10, 0, 5), Size: xyz(-3, 1, -2), BlockStatePalette: pal(['minecraft:air', 'minecraft:gold_block']),
          BlockStates: nbt.longArray(packBig(valsB, 2)),
          TileEntities: { type: 'list', value: { type: 'compound', value: [{ x: nbt.int(0), y: nbt.int(0), z: nbt.int(0), id: nbt.string('minecraft:sign'), Color: nbt.string('red') }] } },
        }),
      }),
    },
  });
  const s = readLitematic(zlib.gzipSync(root));
  assert.equal(s.name, 'Test Build');
  assert.equal(s.description, 'desc');
  assert.equal(s.meta.author, 'someone');
  for (let i = 0; i < 24; i++) {
    const x = i % 4, z = Math.floor(i / 4) % 3, y = Math.floor(i / 12);
    const want = palA[valsA[i]].replace('minecraft:', '');
    assert.equal(s.get(x, y, z), want === 'air' ? null : want, `A ${x},${y},${z}`);
  }
  for (let i = 0; i < 6; i++) {
    const x = 8 + (i % 3), z = 4 + Math.floor(i / 3);
    const want = valsB[i] ? 'gold_block' : null;
    assert.equal(s.get(x, 0, z), i === 0 ? 'gold_block{Color:"red"}' : want, `B ${x},0,${z}`);
  }
  assert.deepEqual(s.meta.size, [11, 2, 6]);
  assert.equal(s.count, valsA.filter((v) => v).length + valsB.filter((v) => v).length);
});

test('litematic: bit packing matches an independent implementation; writer round-trips', () => {
  for (const bits of [2, 3, 5, 7, 12, 13]) {
    const vals = Array.from({ length: 101 }, (_, i) => (i * 2654435761) % 2 ** bits);
    const longs = packSpanning(Uint32Array.from(vals), bits);
    assert.deepEqual(longs, packBig(vals, bits), `pack ${bits}`);
    assert.deepEqual(Array.from(unpackSpanning(longs, bits, vals.length)), vals, `unpack ${bits}`);
  }
  assert.equal(litematicBits(1), 2);
  assert.equal(litematicBits(4), 2);
  assert.equal(litematicBits(5), 3);
  assert.equal(litematicBits(300), 9);
  const s = sample();
  const r = readLitematic(writeLitematic(s));
  expectSame(r, s, { airAsUntouched: true, msg: 'litematic' });
});

// ───────────────────────── MCEdit ─────────────────────────

test('legacy MCEdit .schematic: numeric ids → modern block states', async () => {
  const raw = nbt.writeUncompressed({
    type: 'compound', name: 'Schematic', value: {
      Width: nbt.short(3), Height: nbt.short(2), Length: nbt.short(1), Materials: nbt.string('Alpha'),
      Blocks: nbt.byteArray([1, 31, 2, 139, 0, 63].map((v) => (v << 24) >> 24)),
      Data: nbt.byteArray([0, 1, 0, 0, 0, 4]),
      Entities: { type: 'list', value: { type: 'end', value: [] } },
      TileEntities: { type: 'list', value: { type: 'end', value: [] } },
    },
  });
  const s = await readLegacySchematic(zlib.gzipSync(raw));
  assert.equal(s.get(0, 0, 0), 'stone');
  assert.equal(s.get(1, 0, 0), 'short_grass');
  assert.match(s.get(2, 0, 0), /^grass_block/);
  assert.match(s.get(0, 1, 0), /^cobblestone_wall\[.*north=none/);
  assert.equal(s.get(1, 1, 0), null);
  assert.match(s.get(2, 1, 0), /^oak_sign\[.*rotation=4/);
  assert.equal(s.meta.format, 'mcedit');
});

// ───────────────────────── files + JSON ─────────────────────────

test('readStructureFile / writeStructureFile dispatch by extension and sniff content', async () => {
  const dir = tmp();
  try {
    const s = sample();
    assert.equal(formatForPath('a/b.SCHEM'), 'schem');
    assert.equal(formatForPath('x.litematic'), 'litematic');
    assert.equal(formatForPath('x.txt'), null);
    for (const ext of ['.schem', '.nbt', '.litematic', '.json']) {
      const file = path.join(dir, `t${ext}`);
      const info = await writeStructureFile(s, file);
      assert.ok(fs.existsSync(file) && info.bytes > 0);
      const r = await readStructureFile(file, { keepAir: true });
      if (ext === '.json') assert.deepEqual(voxels(r), voxels(s), 'json keeps coordinates as-is');
      else if (ext === '.nbt') expectSame(r, s, { msg: ext });
      else expectSame(r, s, { untouchedAsAir: true, msg: ext });
    }
    // a Sponge file saved as .schematic is still read as Sponge
    fs.copyFileSync(path.join(dir, 't.schem'), path.join(dir, 'u.schematic'));
    expectSame(await readStructureFile(path.join(dir, 'u.schematic')), s, { airAsUntouched: true, msg: '.schematic' });
    await assert.rejects(writeStructureFile(s, path.join(dir, 'x.schematic')), /not supported/);
    await assert.rejects(readStructureFile(path.join(dir, 'x.txt')), /supported/);
    const mcf = path.join(dir, 'f.mcfunction');
    await writeStructureFile(new Structure({ name: 'f' }).fill(0, 0, 0, 6, 0, 4, 'stone_bricks'), mcf);
    assert.match(fs.readFileSync(mcf, 'utf8'), /^fill ~0 ~0 ~0 ~6 ~0 ~4 stone_bricks$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mcb-blueprint JSON: compact, short palette keys, loads back through the blueprint loader', async () => {
  assert.deepEqual([0, 25, 26, 51, 52, 61, 62, 63, 62 + 62 * 62].map(paletteKey), ['A', 'Z', 'a', 'z', '0', '9', 'AA', 'AB', 'AAA']);
  const s = sample();
  const j = structureToJson(s);
  assert.equal(j.format, 'mcb-blueprint');
  assert.equal(j.version, 2);
  assert.equal(j.palette.A, 'bricks', 'most used block first');
  assert.equal(j.blocks.length, s.count);
  assert.deepEqual(j.blocks[0], [-3, 2, 5, j.blocks[0][3]]);
  const text = structureToJsonText(s);
  assert.equal(text.split('\n').filter((l) => /^ {4}\[/.test(l)).length, s.count, 'one block per line');
  assert.deepEqual(JSON.parse(text), j);
  const back = await fromJson(JSON.parse(text));
  assert.deepEqual(voxels(back), voxels(s));
  assert.deepEqual(voxels(jsonToStructure(j)), voxels(s));
});

// ───────────────────────── data pack ─────────────────────────

const readFiles = (dp) => Object.fromEntries(dp.files.map((f) => [f.path, f.content]));

test('datapack: file tree, pack.mcmeta formats, relative ~ coordinates, marker/schedule chain', () => {
  const s = new Structure({ name: 'Stone Box!' }).fill(0, 0, 0, 4, 3, 4, 'stone');
  const dp = buildDatapack(s, {});
  assert.equal(dp.name, 'stone_box');
  assert.equal(dp.functionId, 'mcb:stone_box');
  const f = readFiles(dp);
  const fdir = 'data/mcb/function/stone_box';
  assert.deepEqual(Object.keys(f).sort(), [
    'README.txt', 'data/mcb/function/stone_box.mcfunction',
    ...['boot', 'cancel', 'finish', 'part_000', 'part_000_body', 'part_000_release', 'part_000_wait', 'release_here', 'release_orphan', 'timeout'].map((n) => `${fdir}/${n}.mcfunction`),
    'pack.mcmeta',
  ]);
  const meta = JSON.parse(f['pack.mcmeta']).pack;
  assert.equal(meta.pack_format, PACK_FORMAT);
  assert.equal(PACK_FORMAT, 48);
  assert.equal(MAX_PACK_FORMAT, 94);
  assert.deepEqual(meta.supported_formats, [48, 94]);
  assert.equal(meta.min_format, 48);
  assert.equal(meta.max_format, 94);
  assert.equal(typeof meta.description, 'string');

  const main = f['data/mcb/function/stone_box.mcfunction'];
  assert.match(main, /^function mcb:stone_box\/cancel$/m, 'a re-run first stops a running build');
  assert.match(main, /^execute store success storage mcb:stone_box f\.o byte 1 run forceload query ~ ~$/m);
  assert.match(main, /^forceload add ~ ~$/m);
  assert.match(main, /^summon marker ~ ~ ~ \{Tags:\["mcb_origin_stone_box"\]\}$/m);
  assert.match(main, /^function mcb:stone_box\/boot$/m);
  assert.match(f[`${fdir}/boot.mcfunction`], /^execute if entity @e\[type=marker,tag=mcb_origin_stone_box,limit=1\] run function mcb:stone_box\/part_000$/m);

  const M = '@e\\[type=marker,tag=mcb_origin_stone_box,limit=1\\]';
  const entry = f[`${fdir}/part_000.mcfunction`];
  assert.match(entry, new RegExp(`^execute at ${M} store success storage mcb:stone_box f\\.c0 byte 1 run forceload query ~0 ~0$`, 'm'));
  assert.match(entry, new RegExp(`^execute at ${M} run forceload add ~0 ~0 ~4 ~4$`, 'm'));
  const wait = f[`${fdir}/part_000_wait.mcfunction`];
  assert.match(wait, /^schedule function mcb:stone_box\/part_000_wait 1t$/m);
  assert.match(wait, new RegExp(`^execute at ${M} if loaded ~0 ~0 ~0 if loaded ~4 ~0 ~0 if loaded ~0 ~0 ~4 if loaded ~4 ~0 ~4 run function mcb:stone_box/part_000_body$`, 'm'));
  const body = f[`${fdir}/part_000_body.mcfunction`];
  assert.match(body, /^fill ~0 ~0 ~0 ~4 ~3 ~4 stone$/m);
  assert.match(body, /^schedule clear mcb:stone_box\/part_000_wait$/m);
  assert.match(body, /^function mcb:stone_box\/part_000_release$/m);
  assert.match(body, /^function mcb:stone_box\/finish$/m, 'last step finishes');
  assert.match(f[`${fdir}/part_000_release.mcfunction`], /^execute unless data storage mcb:stone_box \{f:\{c3:1b\}\} run forceload remove ~4 ~4$/m);
  const finish = f[`${fdir}/finish.mcfunction`];
  assert.match(finish, /^kill @e\[type=marker,tag=mcb_origin_stone_box\]$/m);
  assert.match(finish, /unless data storage mcb:stone_box \{f:\{o:1b\}\} run forceload remove ~ ~$/m);
  // without the marker (e.g. after /kill @e) cancel releases the force-loads from the saved start position
  assert.match(f[`${fdir}/boot.mcfunction`], /store result storage mcb:stone_box f\.x int 1 run data get entity @e\[type=marker,tag=mcb_origin_stone_box,limit=1\] Pos\[0\]$/m);
  assert.match(f[`${fdir}/release_orphan.mcfunction`], /^\$execute in \$\(dim\) positioned \$\(x\) \$\(y\) \$\(z\) run function mcb:stone_box\/release_here$/m);
  assert.match(f[`${fdir}/cancel.mcfunction`], /^execute unless entity .* if data storage mcb:stone_box f\.x run function mcb:stone_box\/release_orphan with storage mcb:stone_box f$/m);
  assert.match(f[`${fdir}/release_here.mcfunction`], /^execute if data storage mcb:stone_box \{f:\{step:0\}\} run function mcb:stone_box\/part_000_release$/m);
  // no line may start with "/" (invalid in functions) and every non-comment line is a known command
  for (const [p, content] of Object.entries(f)) {
    if (!p.endsWith('.mcfunction')) continue;
    for (const line of content.split('\n').filter(Boolean)) {
      assert.match(line, /^(#|\$execute |fill |setblock |execute |schedule |function |summon |forceload |tellraw |title |tag |kill |data )/, `${p}: ${line}`);
    }
  }
});

test('datapack: steps are split by command count and chunk footprint, chained in order', () => {
  const s = new Structure({ name: 'wall' });
  for (let x = 0; x < 300; x += 2) s.set(x, 0, 0, 'stone').set(x + 1, 0, 0, 'glass');
  const dp = buildDatapack(s, { maxCommands: 40, name: 'wall' });
  const f = readFiles(dp);
  assert.ok(dp.parts >= 8, `expected ≥ 8 steps, got ${dp.parts}`);
  let cmds = 0;
  for (let i = 0; i < dp.parts; i++) {
    const id = String(i).padStart(3, '0');
    const body = f[`data/mcb/function/wall/part_${id}_body.mcfunction`];
    const n = body.split('\n').filter((l) => /^(fill|setblock) /.test(l)).length;
    assert.ok(n > 0 && n <= 40, `step ${i} has ${n} commands`);
    cmds += n;
    if (i < dp.parts - 1) assert.match(body, new RegExp(`^schedule function mcb:wall/part_${String(i + 1).padStart(3, '0')} 1t$`, 'm'));
    else assert.match(body, /^function mcb:wall\/finish$/m);
    assert.match(f[`data/mcb/function/wall/part_${id}.mcfunction`], new RegExp(`^data modify storage mcb:wall f\\.step set value ${i}$`, 'm'));
    assert.match(f[`data/mcb/function/wall/part_${id}_wait.mcfunction`], new RegExp(`run function mcb:wall/part_${id}_body$`, 'm'));
  }
  assert.equal(cmds, dp.commands);
  assert.equal(cmds, 300);
  const cancel = f['data/mcb/function/wall/cancel.mcfunction'];
  assert.equal(cancel.split('\n').filter((l) => /^schedule clear mcb:wall\/part_\d+_wait$/.test(l)).length, dp.parts);
  assert.match(f['data/mcb/function/wall/release_here.mcfunction'], new RegExp(`if data storage mcb:wall \\{f:\\{step:${dp.parts - 1}\\}\\} run function mcb:wall/part_${String(dp.parts - 1).padStart(3, '0')}_release$`, 'm'));
  // a step spanning more than 240 blocks force-loads several ≤ 240-block rectangles (≤ 256 chunks each)
  const long = buildDatapack(new Structure({ name: 'long' }).fill(0, 0, 0, 299, 0, 0, 'stone'), {});
  assert.match(readFiles(long)['data/mcb/function/long/part_000.mcfunction'], /forceload add ~0 ~0 ~239 ~0\n.*forceload add ~240 ~0 ~299 ~0$/m);

  // chunk budget: two far-apart blocks never share a step
  const op = (x, z) => ({ x1: x, y1: 0, z1: z, x2: x, y2: 0, z2: z, volume: 1 });
  assert.equal(splitIntoParts([op(0, 0), op(1000, 1000)], { maxChunks: 144 }).length, 2);
  assert.equal(splitIntoParts([op(0, 0), op(100, 100)], { maxChunks: 144 }).length, 1);
});

test('datapack: absolute mode, strict min format, writeDatapack on disk replaces stale steps', () => {
  const s = new Structure({ name: 'abs' }).fill(0, 0, 0, 2, 0, 2, 'stone').set(1, 1, 1, 'torch');
  const dp = buildDatapack(s, { mode: 'absolute', at: [100, -60, -200], name: 'abs' });
  const body = readFiles(dp)['data/mcb/function/abs/part_000_body.mcfunction'];
  assert.match(body, /^fill 100 -60 -200 102 -60 -198 stone$/m);
  assert.match(body, /^setblock 101 -59 -199 torch$/m);
  assert.match(readFiles(dp)['data/mcb/function/abs/part_000.mcfunction'], /forceload add 100 -200 102 -198$/m);

  const strict = buildDatapack(s, { strict: true });
  const meta = JSON.parse(readFiles(strict)['pack.mcmeta']).pack;
  assert.equal(meta.min_format, 71, 'strict needs 1.21.5+');
  assert.match(readFiles(strict)['data/mcb/function/abs/part_000_body.mcfunction'], / strict$/m);
  assert.throws(() => buildDatapack(new Structure()), /empty/);

  const dir = tmp();
  try {
    const big = new Structure({ name: 'big' });
    for (let x = 0; x < 50; x++) big.set(x * 2, 0, 0, 'stone');
    const r1 = writeDatapack(big, { outDir: dir, maxCommands: 10 });
    assert.equal(r1.parts, 5);
    assert.ok(r1.files.every((p) => fs.existsSync(p)));
    assert.match(r1.instructions, /\/function mcb:big/);
    const fnDir = path.join(dir, 'big', 'data', 'mcb', 'function', 'big');
    assert.ok(fs.existsSync(path.join(fnDir, 'part_004_body.mcfunction')));
    const r2 = writeDatapack(big, { outDir: dir, maxCommands: 100 });
    assert.equal(r2.parts, 1);
    assert.ok(!fs.existsSync(path.join(fnDir, 'part_004_body.mcfunction')), 'stale steps removed');
    assert.ok(fs.existsSync(path.join(dir, 'big', 'pack.mcmeta')));
    assert.ok(fs.existsSync(path.join(dir, 'big', 'README.txt')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeMcfunction: single function, relative or absolute', () => {
  const s = new Structure({ name: 'f' }).fill(0, 0, 0, 4, 3, 4, 'stone');
  assert.match(writeMcfunction(s), /^fill ~0 ~0 ~0 ~4 ~3 ~4 stone$/m);
  assert.match(writeMcfunction(s, { mode: 'absolute', at: [10, 64, 10] }), /^fill 10 64 10 14 67 14 stone$/m);
  assert.throws(() => writeMcfunction(s, { maxCommands: 0 }), /data pack/);
});

test('dataVersionFor knows 1.21.11 and 1.21.1', () => {
  assert.equal(dataVersionFor('1.21.11'), 4671);
  assert.equal(dataVersionFor('1.21.1'), 3955);
});
