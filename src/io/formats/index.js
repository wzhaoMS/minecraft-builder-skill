/**
 * Structure files: read / write by extension (with content sniffing for the NBT formats).
 *
 *   .schem       Sponge schematic v1–v3 (WorldEdit / FAWE)        read + write (v3 default, v2 via {version: 2})
 *   .schematic   MCEdit (pre-1.13) — or Sponge content            read
 *   .nbt         vanilla structure-block / `/place template`      read + write
 *   .litematic   Litematica (all regions merged)                  read + write (single region)
 *   .json        mcb-blueprint JSON (below)                       read + write
 *   .mcfunction  a single function of /fill + /setblock commands  write (see ../datapack.js)
 *
 * mcb-blueprint JSON (lossless and round-trippable; also a valid v2 JSON blueprint, so
 * `loadBlueprint('x.json')` reads it back):
 *   {
 *     "format": "mcb-blueprint", "version": 2,
 *     "name": "tower", "description": "…",            // description only when set
 *     "size": [w, h, l],                               // informational (bounds size)
 *     "palette": { "A": "stone_bricks", "B": "oak_stairs[facing=east,half=bottom]", "C": "air" },
 *     "blocks": [[x, y, z, "A"], …]                    // sorted by y, then z, then x
 *   }
 * Palette keys: A–Z, a–z, 0–9, then two characters (AA, AB, …); the most used block gets "A".
 * "air" entries are explicit air (they clear the world); voxels not listed are left untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Structure } from '../../core/structure.js';
import { parseNbt } from './nbt-util.js';
import { readSponge, writeSponge, isSpongeNbt, spongeFromNbt } from './sponge.js';
import { readStructureNbt, writeStructureNbt, isStructureNbt, structureFromNbt } from './structure-nbt.js';
import { readLitematic, writeLitematic, isLitematicNbt, litematicFromNbt } from './litematic.js';
import { readLegacySchematic } from './legacy.js';

export { readSponge, writeSponge, readStructureNbt, writeStructureNbt, readLitematic, writeLitematic, readLegacySchematic };

/** Supported formats by key. */
export const FORMATS = {
  schem: { ext: '.schem', name: 'Sponge schematic (WorldEdit/FAWE)', read: true, write: true },
  schematic: { ext: '.schematic', name: 'MCEdit schematic (pre-1.13)', read: true, write: false },
  nbt: { ext: '.nbt', name: 'Vanilla structure file', read: true, write: true },
  litematic: { ext: '.litematic', name: 'Litematica schematic', read: true, write: true },
  json: { ext: '.json', name: 'mcb-blueprint JSON', read: true, write: true },
  mcfunction: { ext: '.mcfunction', name: 'Minecraft function (commands)', read: false, write: true },
};

const BY_EXT = new Map(Object.entries(FORMATS).map(([k, f]) => [f.ext, k]));

/** Format key for a file path from its extension ('schem', 'nbt', …) or null when unsupported. */
export function formatForPath(file) {
  return BY_EXT.get(path.extname(String(file)).toLowerCase()) ?? null;
}

/** Detect the format of an NBT structure file from its content: 'sponge'|'litematic'|'structure'|'mcedit'|null. */
export function detectNbtFormat(root) {
  if (isLitematicNbt(root)) return 'litematic';
  if (isSpongeNbt(root)) return 'sponge';
  if (isStructureNbt(root)) return 'structure';
  if (root.value.Blocks?.type === 'byteArray' && root.value.Data?.type === 'byteArray') return 'mcedit';
  return null;
}

/**
 * Read any supported structure file from memory. `hint` is the expected format key.
 * @param {Buffer} buf
 * @param {{ hint?: string, keepAir?: boolean }} [opts]
 * @returns {Promise<Structure>}
 */
export async function readStructureBuffer(buf, { hint = null, ...opts } = {}) {
  if (hint === 'json') return jsonToStructure(JSON.parse(Buffer.from(buf).toString('utf8')));
  const root = parseNbt(buf);
  const kind = detectNbtFormat(root);
  switch (kind) {
    case 'sponge': return spongeFromNbt(root, opts);
    // Structure files mark untouched cells with structure_void, so their air is deliberate (the
    // game places it too) — keep it unless asked otherwise.
    case 'structure': return structureFromNbt(root, { keepAir: true, ...opts });
    case 'litematic': return litematicFromNbt(root, opts);
    case 'mcedit': return readLegacySchematic(buf, opts);
    default: {
      const keys = Object.keys(root.value).slice(0, 8).join(', ');
      throw new Error(`Unrecognised structure file${hint ? ` (expected ${FORMATS[hint]?.name ?? hint})` : ''}: top-level tags are [${keys}]`);
    }
  }
}

/**
 * Read a structure file (.schem, .schematic, .nbt, .litematic, .json).
 * Air in schematics becomes "untouched" unless `{ keepAir: true }`.
 * @param {string} file
 * @param {{ keepAir?: boolean }} [opts]
 * @returns {Promise<Structure>}
 */
export async function readStructureFile(file, opts = {}) {
  const fmt = formatForPath(file);
  if (!fmt || !FORMATS[fmt].read) {
    throw new Error(`Can't read "${path.extname(file) || file}" files — supported: .schem, .schematic, .nbt, .litematic, .json`);
  }
  const buf = await fs.promises.readFile(file);
  let s;
  if (fmt === 'json') {
    const { fromJson } = await import('../blueprint.js');
    let data;
    try {
      data = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      throw new Error(`Invalid JSON in ${file}: ${e.message}`);
    }
    s = await fromJson(data, { baseDir: path.dirname(file), file });
  } else {
    try {
      s = await readStructureBuffer(buf, { ...opts, hint: fmt });
    } catch (e) {
      throw new Error(`${file}: ${e.message}`);
    }
  }
  const base = path.basename(file, path.extname(file));
  if (!s.name || ['structure', 'schematic', 'litematic'].includes(s.name)) s.name = base;
  return s;
}

/**
 * Write a structure file; the format follows the extension (.schem, .nbt, .litematic, .json, .mcfunction).
 * opts are passed to the writer (e.g. { version: 2 } for .schem, { dataVersion }, { mode, at } for .mcfunction).
 * @returns {Promise<{ file: string, format: string, bytes: number }>}
 */
export async function writeStructureFile(structure, file, opts = {}) {
  const fmt = formatForPath(file);
  let data;
  switch (fmt) {
    case 'schem': data = writeSponge(structure, opts); break;
    case 'nbt': data = writeStructureNbt(structure, opts); break;
    case 'litematic': data = writeLitematic(structure, opts); break;
    case 'json': data = structureToJsonText(structure); break;
    case 'mcfunction': {
      const { writeMcfunction } = await import('../datapack.js');
      data = writeMcfunction(structure, opts);
      break;
    }
    case 'schematic':
      throw new Error('Writing MCEdit .schematic (pre-1.13 numeric ids) is not supported — use .schem (WorldEdit/FAWE), .nbt (structure blocks) or .litematic');
    default:
      throw new Error(`Can't write "${path.extname(file) || file}" files — use .schem, .nbt, .litematic, .json or .mcfunction`);
  }
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, data);
  return { file: path.resolve(file), format: fmt, bytes: Buffer.byteLength(data) };
}

// ───────────────────────── JSON ─────────────────────────

const KEY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Short palette key for the i-th entry: A…Z, a…z, 0…9, then AA, AB, … (then three chars). */
export function paletteKey(i) {
  const n = KEY_CHARS.length;
  let len = 1, span = n;
  while (i >= span) { i -= span; len++; span *= n; }
  let out = '';
  for (let k = 0; k < len; k++) { out = KEY_CHARS[i % n] + out; i = Math.floor(i / n); }
  return out;
}

/**
 * Structure → mcb-blueprint JSON object (see the format description at the top of this file).
 * @returns {{ format: 'mcb-blueprint', version: 2, name: string, description?: string, size: number[],
 *             palette: Record<string,string>, blocks: [number,number,number,string][] }}
 */
export function structureToJson(structure) {
  const counts = structure.blockCounts();
  const keyOf = new Map();
  const palette = {};
  const blocks = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0));
  blocks.forEach((b, i) => {
    const k = paletteKey(i);
    keyOf.set(b, k);
    palette[k] = b;
  });
  const list = [];
  structure.forEach((x, y, z, block) => list.push([x, y, z, keyOf.get(block)]));
  list.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
  const out = { format: 'mcb-blueprint', version: 2, name: structure.name ?? 'structure' };
  if (structure.description) out.description = structure.description;
  if (structure.meta?.seed !== undefined) out.seed = structure.meta.seed;
  out.size = structure.bounds()?.size ?? [0, 0, 0];
  out.palette = palette;
  out.blocks = list;
  return out;
}

/** Compact JSON text for structureToJson(): header fields pretty, one block per line. */
export function structureToJsonText(structure) {
  const j = structureToJson(structure);
  const lines = ['{'];
  for (const [k, v] of Object.entries(j)) {
    if (k === 'palette' || k === 'blocks') continue;
    lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  }
  const pal = Object.entries(j.palette).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  lines.push(pal.length ? `  "palette": {\n${pal.join(',\n')}\n  },` : '  "palette": {},');
  const blocks = j.blocks.map((b) => `    ${JSON.stringify(b)}`);
  lines.push(blocks.length ? `  "blocks": [\n${blocks.join(',\n')}\n  ]` : '  "blocks": []');
  lines.push('}');
  return lines.join('\n') + '\n';
}

/** mcb-blueprint JSON object → Structure (synchronous; palette + blocks only). */
export function jsonToStructure(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.blocks)) throw new Error('Not an mcb-blueprint JSON object (missing "blocks")');
  const s = new Structure({ name: data.name ?? 'structure', description: data.description ?? '' });
  if (data.seed !== undefined) s.meta.seed = data.seed;
  const palette = data.palette ?? {};
  for (const b of data.blocks) {
    const [x, y, z, key] = Array.isArray(b) ? b : [b.x, b.y, b.z, b.b ?? b.block];
    const block = Object.prototype.hasOwnProperty.call(palette, key) ? palette[key] : key;
    s.set(x, y, z, block);
  }
  return s;
}
