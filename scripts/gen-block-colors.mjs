#!/usr/bin/env node
/**
 * Dev-only: derive average per-block colours from the official Minecraft client textures and write
 * src/render/block-colors.json (used by the preview renderer).
 *
 *   node scripts/gen-block-colors.mjs [--version 1.21.11] [--out src/render/block-colors.json]
 *                                     [--jar path/to/client.jar] [--keep-jar] [--report]
 *
 * - Downloads the client jar listed in Mojang's version manifest into os.tmpdir() (sha1-verified)
 *   and reads assets/minecraft/textures/{block,entity}/*.png straight out of the zip (no extraction).
 * - Decodes PNGs with pngjs and averages the FIRST animation frame (animated textures are vertical
 *   strips of square frames), alpha-weighted over pixels with alpha > 0.
 * - Grayscale biome-tinted textures get plains tints (grass #91BD59, foliage #77AB2F, water #3F76E4,
 *   spruce #619961, birch #80A755, mangrove #92C648, lily pad #208030).
 * - `a` is the opacity a renderer should use: 1 for opaque and cut-out blocks (plants, rails, doors…),
 *   the average texture alpha for genuinely see-through blocks (glass, ice, water, slime, leaves…).
 * - Only derived average colours are written — no texture images are stored or committed. The
 *   downloaded jar is deleted afterwards unless --keep-jar is given.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ───────────────────────────── args ─────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
if (flag('help') || flag('h')) {
  console.log('usage: node scripts/gen-block-colors.mjs [--version 1.21.11] [--out src/render/block-colors.json] [--jar client.jar] [--keep-jar] [--report]');
  process.exit(0);
}
const VERSION = opt('version', '1.21.11');
const OUT = path.resolve(ROOT, opt('out', 'src/render/block-colors.json'));
const REPORT = flag('report');

// ───────────────────────────── download ─────────────────────────────

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} → HTTP ${r.status}`);
  return r.json();
}

async function obtainJar() {
  const given = opt('jar', null);
  if (given) return { file: path.resolve(given), temp: false };
  const manifest = await getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const entry = manifest.versions.find((v) => v.id === VERSION);
  if (!entry) throw new Error(`Minecraft version ${VERSION} not found in the version manifest`);
  const client = (await getJson(entry.url)).downloads?.client;
  if (!client?.url) throw new Error(`No client download for ${VERSION}`);
  const file = path.join(os.tmpdir(), `mcb-gen-colors-${VERSION}-client.jar`);
  const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
  if (fs.existsSync(file) && sha1(fs.readFileSync(file)) === client.sha1) return { file, temp: true };
  console.error(`downloading ${client.url} (${(client.size / 1e6).toFixed(1)} MB)…`);
  const r = await fetch(client.url);
  if (!r.ok) throw new Error(`GET ${client.url} → HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (sha1(buf) !== client.sha1) throw new Error('client.jar sha1 mismatch');
  fs.writeFileSync(file, buf);
  return { file, temp: true };
}

// ───────────────────────────── minimal zip reader ─────────────────────────────

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end of central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    entries.set(buf.toString('utf8', p + 46, p + 46 + nameLen), { method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: (name) => entries.has(name),
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const data = buf.subarray(start, start + e.csize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return zlib.inflateRawSync(data);
      throw new Error(`Unsupported zip compression method ${e.method} for ${name}`);
    },
  };
}

// ───────────────────────────── textures ─────────────────────────────

const GRASS = [0x91, 0xbd, 0x59];
const FOLIAGE = [0x77, 0xab, 0x2f];
const SPRUCE = [0x61, 0x99, 0x61];
const BIRCH = [0x80, 0xa7, 0x55];
const MANGROVE = [0x92, 0xc6, 0x48];
const WATER = [0x3f, 0x76, 0xe4];
const LILY = [0x20, 0x80, 0x30];
const STEM = [0xe0, 0xc7, 0x1c]; // fully grown melon/pumpkin stem
const REDSTONE = [0xb4, 0x10, 0x05]; // mid-power redstone dust

let zip = null;
const texCache = new Map();

/** First animation frame of a texture as { w, h, px: Float32Array RGBA (0..255) } or null. */
function frame(texPath) {
  if (texCache.has(texPath)) return texCache.get(texPath);
  const raw = zip.read(`assets/minecraft/textures/${texPath.includes('/') ? texPath : `block/${texPath}`}.png`);
  let f = null;
  if (raw) {
    const img = PNG.sync.read(raw);
    const w = img.width, h = Math.min(img.height, img.width);
    const px = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h * 4; i++) px[i] = img.data[i];
    f = { w, h, px };
  }
  texCache.set(texPath, f);
  return f;
}
const exists = (t) => frame(t) != null;

/** Texture spec → frame. Forms: 'name' | 'entity/…' | { t, tint } | { over: [base, overlay] }. */
function realize(spec) {
  if (typeof spec === 'string') return frame(spec);
  if (spec.tint) {
    const f = realize(spec.t);
    if (!f) return null;
    const px = f.px.slice();
    for (let i = 0; i < px.length; i += 4) {
      px[i] = (px[i] * spec.tint[0]) / 255;
      px[i + 1] = (px[i + 1] * spec.tint[1]) / 255;
      px[i + 2] = (px[i + 2] * spec.tint[2]) / 255;
    }
    return { ...f, px };
  }
  if (spec.over) {
    const base = realize(spec.over[0]), top = realize(spec.over[1]);
    if (!base || !top || base.w !== top.w || base.h !== top.h) return base;
    const px = base.px.slice();
    for (let i = 0; i < px.length; i += 4) {
      const a = top.px[i + 3] / 255;
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) px[i + c] = px[i + c] * (1 - a) + top.px[i + c] * a;
      px[i + 3] = Math.max(px[i + 3], top.px[i + 3]);
    }
    return { ...base, px };
  }
  throw new Error(`Bad texture spec ${JSON.stringify(spec)}`);
}

/** Average colour (alpha-weighted over alpha > 0 pixels) + alpha coverage + "grayscale" flag. */
function stats(spec) {
  if (Array.isArray(spec)) return { rgb: spec, cov: 1, gray: false };
  if (spec && spec.avg) {
    const parts = spec.avg.map(stats).filter(Boolean);
    if (!parts.length) return null;
    const rgb = [0, 1, 2].map((c) => parts.reduce((s, p) => s + p.rgb[c], 0) / parts.length);
    return { rgb, cov: parts.reduce((s, p) => s + p.cov, 0) / parts.length, gray: parts.every((p) => p.gray) };
  }
  const f = realize(spec);
  if (!f) return null;
  let r = 0, g = 0, b = 0, wa = 0, aSum = 0, n = 0, colourful = 0;
  for (let i = 0; i < f.px.length; i += 4) {
    const a = f.px[i + 3];
    aSum += a;
    if (a <= 0) continue;
    n++;
    r += f.px[i] * a; g += f.px[i + 1] * a; b += f.px[i + 2] * a; wa += a;
    if (Math.max(Math.abs(f.px[i] - f.px[i + 1]), Math.abs(f.px[i + 1] - f.px[i + 2]), Math.abs(f.px[i] - f.px[i + 2])) > 6) colourful++;
  }
  if (!n) return null;
  return { rgb: [r / wa, g / wa, b / wa], cov: aSum / (255 * (f.px.length / 4)), gray: colourful / n < 0.03 };
}

// ───────────────────────────── block → textures ─────────────────────────────

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped'];
const WOOD_RE = new RegExp(`^(${WOODS.join('|')})_`);

/** Blocks the renderer never draws (no entry in the table). */
const INVISIBLE = new Set(['air', 'cave_air', 'void_air', 'barrier', 'light', 'structure_void', 'moving_piston']);

/** Genuinely see-through blocks: `a` = average texture alpha (everything else gets a = 1). */
const TRANSLUCENT_RE = /(^glass$|^glass_pane$|stained_glass|^tinted_glass$|^ice$|^frosted_ice$|^water$|^bubble_column$|^slime_block$|^honey_block$|_leaves$|^nether_portal$|^beacon$)/;

const all = (t) => ({ top: t, side: t });
const tinted = (t, tint) => ({ t, tint });

/** Explicit block → { top, side } texture specs (texture name, tinted spec, {avg:[…]}, {over:[…]} or literal [r,g,b]). */
const OVERRIDES = {
  grass_block: { top: tinted('grass_block_top', GRASS), side: { over: ['grass_block_side', tinted('grass_block_side_overlay', GRASS)] } },
  water: all(tinted('water_still', WATER)),
  bubble_column: all(tinted('water_still', WATER)),
  lava: all('lava_still'),
  short_grass: all(tinted('short_grass', GRASS)),
  tall_grass: all({ avg: [tinted('tall_grass_top', GRASS), tinted('tall_grass_bottom', GRASS)] }),
  fern: all(tinted('fern', GRASS)),
  large_fern: all({ avg: [tinted('large_fern_top', GRASS), tinted('large_fern_bottom', GRASS)] }),
  potted_fern: { top: tinted('fern', GRASS), side: { avg: ['flower_pot', tinted('fern', GRASS)] } },
  bush: all(tinted('bush', GRASS)),
  sugar_cane: all(tinted('sugar_cane', GRASS)),
  vine: all(tinted('vine', FOLIAGE)),
  lily_pad: all(tinted('lily_pad', LILY)),
  oak_leaves: all(tinted('oak_leaves', FOLIAGE)),
  jungle_leaves: all(tinted('jungle_leaves', FOLIAGE)),
  acacia_leaves: all(tinted('acacia_leaves', FOLIAGE)),
  dark_oak_leaves: all(tinted('dark_oak_leaves', FOLIAGE)),
  spruce_leaves: all(tinted('spruce_leaves', SPRUCE)),
  birch_leaves: all(tinted('birch_leaves', BIRCH)),
  mangrove_leaves: all(tinted('mangrove_leaves', MANGROVE)),
  melon_stem: all(tinted('melon_stem', STEM)),
  pumpkin_stem: all(tinted('pumpkin_stem', STEM)),
  attached_melon_stem: all(tinted('attached_melon_stem', STEM)),
  attached_pumpkin_stem: all(tinted('attached_pumpkin_stem', STEM)),
  redstone_wire: all(tinted('redstone_dust_line0', REDSTONE)),
  snow_block: all('snow'),
  smooth_stone_slab: { top: 'smooth_stone', side: 'smooth_stone_slab_side' },
  smooth_quartz: all('quartz_block_bottom'),
  smooth_sandstone: all('sandstone_top'),
  smooth_red_sandstone: all('red_sandstone_top'),
  cut_sandstone: { top: 'sandstone_top', side: 'cut_sandstone' },
  cut_red_sandstone: { top: 'red_sandstone_top', side: 'cut_red_sandstone' },
  chiseled_sandstone: { top: 'sandstone_top', side: 'chiseled_sandstone' },
  chiseled_red_sandstone: { top: 'red_sandstone_top', side: 'chiseled_red_sandstone' },
  bookshelf: { top: 'oak_planks', side: 'bookshelf' },
  carved_pumpkin: { top: 'pumpkin_top', side: 'pumpkin_side' },
  jack_o_lantern: { top: 'pumpkin_top', side: { avg: ['pumpkin_side', 'jack_o_lantern'] } },
  dispenser: { top: 'furnace_top', side: 'furnace_side' },
  dropper: { top: 'furnace_top', side: 'furnace_side' },
  farmland: { top: 'farmland_moist', side: 'dirt' },
  beehive: { top: 'beehive_end', side: 'beehive_side' },
  dried_kelp_block: { top: 'dried_kelp_top', side: 'dried_kelp_side' },
  lectern: { top: 'lectern_top', side: 'lectern_sides' },
  cartography_table: { top: 'cartography_table_top', side: 'cartography_table_side1' },
  respawn_anchor: { top: 'respawn_anchor_top_off', side: 'respawn_anchor_side0' },
  hopper: { top: 'hopper_top', side: 'hopper_outside' },
  grindstone: all('grindstone_side'),
  campfire: { top: { avg: ['campfire_log_lit', 'campfire_fire'] }, side: 'campfire_log_lit' },
  soul_campfire: { top: { avg: ['soul_campfire_log_lit', 'soul_campfire_fire'] }, side: 'soul_campfire_log_lit' },
  cauldron: { top: 'cauldron_top', side: 'cauldron_side' },
  water_cauldron: { top: { avg: ['cauldron_top', tinted('water_still', WATER)] }, side: 'cauldron_side' },
  lava_cauldron: { top: { avg: ['cauldron_top', 'lava_still'] }, side: 'cauldron_side' },
  powder_snow_cauldron: { top: { avg: ['cauldron_top', 'powder_snow'] }, side: 'cauldron_side' },
  chipped_anvil: { top: 'chipped_anvil_top', side: 'anvil' },
  damaged_anvil: { top: 'damaged_anvil_top', side: 'anvil' },
  piston_head: { top: 'piston_top', side: 'piston_side' },
  sticky_piston: { top: 'piston_top_sticky', side: 'piston_side' },
  frosted_ice: all('frosted_ice_0'),
  fire: all('fire_0'),
  soul_fire: all('soul_fire_0'),
  suspicious_sand: all('suspicious_sand_0'),
  suspicious_gravel: all('suspicious_gravel_0'),
  bamboo: all('bamboo_stalk'),
  bamboo_sapling: all('bamboo_stage0'),
  wheat: all('wheat_stage7'),
  carrots: all('carrots_stage3'),
  potatoes: all('potatoes_stage3'),
  beetroots: all('beetroots_stage3'),
  nether_wart: all('nether_wart_stage2'),
  sweet_berry_bush: all('sweet_berry_bush_stage3'),
  cocoa: all('cocoa_stage2'),
  torchflower_crop: all('torchflower_crop_stage1'),
  pitcher_crop: all({ avg: ['pitcher_crop_top_stage_4', 'pitcher_crop_bottom_stage_4'] }),
  pitcher_plant: all({ avg: ['pitcher_crop_top_stage_4', 'pitcher_crop_bottom_stage_4'] }),
  sunflower: { top: 'sunflower_front', side: { avg: ['sunflower_front', 'sunflower_bottom'] } },
  lilac: all({ avg: ['lilac_top', 'lilac_bottom'] }),
  rose_bush: all({ avg: ['rose_bush_top', 'rose_bush_bottom'] }),
  peony: all({ avg: ['peony_top', 'peony_bottom'] }),
  tall_seagrass: all({ avg: ['tall_seagrass_top', 'tall_seagrass_bottom'] }),
  big_dripleaf: { top: 'big_dripleaf_top', side: 'big_dripleaf_stem' },
  small_dripleaf: { top: 'small_dripleaf_top', side: 'small_dripleaf_stem_bottom' },
  pointed_dripstone: all('pointed_dripstone_up_middle'),
  sniffer_egg: { top: 'sniffer_egg_not_cracked_top', side: 'sniffer_egg_not_cracked_north' },
  cake: { top: 'cake_top', side: 'cake_side' },
  end_portal: all([16, 22, 34]),
  end_gateway: all([16, 22, 34]),
  chest: all('entity/chest/normal'),
  trapped_chest: all('entity/chest/trapped'),
  ender_chest: all('entity/chest/ender'),
  bell: all('entity/bell/bell_body'),
  decorated_pot: all('entity/decorated_pot/decorated_pot_side'),
  skeleton_skull: all('entity/skeleton/skeleton'),
  wither_skeleton_skull: all('entity/skeleton/wither_skeleton'),
  zombie_head: all('entity/zombie/zombie'),
  creeper_head: all('entity/creeper/creeper'),
  dragon_head: all('entity/enderdragon/dragon'),
  piglin_head: all('entity/piglin/piglin'),
  player_head: all('entity/player/wide/steve'),
  trial_spawner: { top: 'trial_spawner_top_inactive', side: 'trial_spawner_side_inactive' },
  vault: { top: 'vault_top', side: 'vault_side_off' },
  crafter: { top: 'crafter_top', side: 'crafter_east' },
  chiseled_bookshelf: { top: 'chiseled_bookshelf_top', side: 'chiseled_bookshelf_occupied' },
  light_weighted_pressure_plate: all('gold_block'),
  heavy_weighted_pressure_plate: all('iron_block'),
};

/** Material stem (from `<stem>_stairs` etc.) → block whose textures to use. */
const MATERIAL = {
  petrified_oak: 'oak_planks', quartz: 'quartz_block', purpur: 'purpur_block',
  light_weighted: 'light_weighted_pressure_plate', heavy_weighted: 'heavy_weighted_pressure_plate',
};

const SHAPE_SUFFIX_RE = /^(.+?)_(stairs|slab|wall|fence_gate|fence|pressure_plate|button)$/;

/** Default face lookup by texture naming conventions. */
function direct(n) {
  const first = (...c) => c.find(exists) ?? null;
  const top = first(`${n}_top`, n, `${n}_side`, `${n}_front`, `${n}_end`, `${n}_still`, `${n}_sides`, `${n}_side0`, `${n}_side1`);
  const side = first(`${n}_side`, n, `${n}_front`, `${n}_sides`, `${n}_side0`, `${n}_side1`, `${n}_top`, `${n}_still`, `${n}_bottom`);
  if (!top && !side) return null;
  return { top: top ?? side, side: side ?? top };
}

const resolving = new Set();
/** Block name → { top, side } texture specs, or null. */
function resolve(name) {
  if (OVERRIDES[name]) return OVERRIDES[name];
  if (resolving.has(name)) return null;
  resolving.add(name);
  try {
    return resolveInner(name);
  } finally {
    resolving.delete(name);
  }
}

function resolveInner(n) {
  let m;
  if ((m = /^waxed_(.+)$/.exec(n))) return resolve(m[1]);
  if ((m = /^infested_(.+)$/.exec(n))) return resolve(m[1]);
  if ((m = /^(.+)_wood$/.exec(n))) return all(`${m[1]}_log`);
  if ((m = /^(.+)_hyphae$/.exec(n))) return all(`${m[1]}_stem`);
  if ((m = /^(.+)_wall_(torch|fan|banner|sign|hanging_sign|head|skull)$/.exec(n))) return resolve(`${m[1]}_${m[2]}`);
  if (/_door$/.test(n) && exists(`${n}_top`)) return all({ avg: [`${n}_top`, `${n}_bottom`] });
  if ((m = /^(.+)_(sign|hanging_sign)$/.exec(n)) && WOOD_RE.test(n)) return resolve(`${m[1]}_planks`);
  if ((m = /^(.+)_bed$/.exec(n))) return all(`entity/bed/${m[1]}`);
  if ((m = /^(.+)_banner$/.exec(n))) return resolve(`${m[1]}_wool`);
  if ((m = /^(.+)_carpet$/.exec(n))) return (m[1] === 'moss' ? resolve('moss_block') : resolve(`${m[1]}_wool`)) ?? direct(n);
  if ((m = /^(.+)_stained_glass_pane$/.exec(n))) return resolve(`${m[1]}_stained_glass`);
  if (n === 'glass_pane') return resolve('glass');
  if (/candle_cake$/.test(n)) return resolve('cake');
  if (/cauldron$/.test(n)) return resolve('cauldron');
  if ((m = /^potted_(.+)$/.exec(n))) {
    const plant = resolve(m[1]);
    if (!plant) return null;
    return { top: plant.side, side: { avg: ['flower_pot', plant.side] } };
  }
  if ((m = /^(.+)_chest$/.exec(n)) && exists(`entity/chest/${m[1]}`)) return all(`entity/chest/${m[1]}`);
  if ((m = /^(.+)_shulker_box$/.exec(n)) && !exists(n)) return all(`entity/shulker/shulker_${m[1]}`);
  if ((m = SHAPE_SUFFIX_RE.exec(n))) {
    const stem = m[1];
    for (const cand of [MATERIAL[stem], stem, `${stem}s`, `${stem}_planks`, `${stem}_block`]) {
      if (!cand || cand === n) continue;
      const r = resolve(cand);
      if (r) return r;
    }
  }
  return direct(n);
}

// ───────────────────────────── main ─────────────────────────────

const round = (v) => Math.max(0, Math.min(255, Math.round(v)));

async function main() {
  const t0 = Date.now();
  const { file, temp } = await obtainJar();
  try {
    zip = readZip(fs.readFileSync(file));
    const mcData = require('minecraft-data')(VERSION);
    if (!mcData) throw new Error(`minecraft-data has no data for ${VERSION}`);
    const out = {};
    const unresolved = [], grayUntinted = [], notes = [];
    for (const b of mcData.blocksArray) {
      const n = b.name;
      if (INVISIBLE.has(n)) continue;
      const r = resolve(n);
      const top = r && stats(r.top), side = r && stats(r.side);
      if (!top && !side) { unresolved.push(n); continue; }
      const T = top ?? side, S = side ?? top;
      let a = 1;
      if (TRANSLUCENT_RE.test(n)) a = Math.min(1, Math.max(0.15, Math.round(((T.cov + S.cov) / 2) * 100) / 100));
      out[n] = { top: T.rgb.map(round), side: S.rgb.map(round), a };
      const specs = [r.top, r.side].map((s) => (typeof s === 'string' ? s : JSON.stringify(s)));
      if ((T.gray && typeof r.top === 'string') || (S.gray && typeof r.side === 'string')) grayUntinted.push(`${n} (${specs.join(' | ')})`);
      if (REPORT) notes.push(`${n.padEnd(40)} top=${specs[0]} side=${specs[1]} a=${a} → ${out[n].top} / ${out[n].side}`);
    }
    const names = Object.keys(out).sort();
    const lines = names.map((n) => `${JSON.stringify(n)}:${JSON.stringify(out[n])}`);
    const json = `{"version":${JSON.stringify(VERSION)},` +
      `"source":"average colours of the Minecraft ${VERSION} client block textures (first frame, alpha>0 pixels, plains biome tints) - scripts/gen-block-colors.mjs",` +
      `"colors":{\n${lines.join(',\n')}\n}}\n`;
    JSON.parse(json);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, json);
    if (REPORT) console.log(notes.join('\n'));
    if (grayUntinted.length) console.error(`grayscale textures used untinted (check they are not biome-tinted):\n  ${grayUntinted.join('\n  ')}`);
    if (unresolved.length) console.error(`no texture found for ${unresolved.length} blocks (renderer falls back to name heuristics):\n  ${unresolved.join(' ')}`);
    console.error(`wrote ${path.relative(ROOT, OUT)}: ${names.length} blocks (${mcData.blocksArray.length} in minecraft-data ${VERSION}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } finally {
    if (temp && !flag('keep-jar')) fs.rmSync(file, { force: true });
  }
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(1);
});
