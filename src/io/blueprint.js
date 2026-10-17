/**
 * Blueprint loading. Supported inputs:
 *   - JSON blueprints (v1 and v2, see docs/blueprint-format.md)
 *   - JS/MJS modules: `export default function build(s, params, ctx) {}` or
 *                     `export default { name, description, params, build(s, p, ctx) {} }`
 *   - Structure files: .schem (Sponge v1–3), .schematic (MCEdit), .nbt (structure block), .litematic
 *   - Generators: "gen:<name>" (params from opts.params)
 *
 * JSON v2 (all sections optional, applied in this order — later wins):
 * {
 *   "name": "Cottage", "description": "...",
 *   "generator": "house", "params": { ... },                   // start from a generator
 *   "parts": [ { "generator": "tree", "params": {}, "at": [x,y,z], "rotate": 90, "mirror": "x" },
 *              { "file": "other.json", "at": [x,y,z] } ],      // composition
 *   "palette": { "#": "cobblestone", "P": "oak_planks", ".": null },
 *   "fills":  [ { "from": [0,0,0], "to": [6,0,6], "block": "#", "mode": "hollow" } ],
 *   "layers": [ ["#####", "#...#", "#####"], ... ],            // layers[y][z] = row string, char i = x
 *   "layerOrigin": [0,0,0],
 *   "blocks": [ { "x":0, "y":1, "z":0, "b": "P" }, [1,1,0,"glass"] ]
 * }
 * Layer grids are drawn like a map: each layer (bottom → top) is a list of rows from NORTH (z=0)
 * to SOUTH, and each row's characters go WEST → EAST (x=0…). ' ' and '.' are empty unless the
 * palette defines them; map a char to "air" to carve.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Structure } from '../core/structure.js';
import { canonical } from '../core/blockstate.js';

let generatorsMod = null;
async function gens() {
  if (!generatorsMod) {
    // index.js registers every built-in generator into the registry
    await import('../generators/index.js').catch((e) => {
      if (e.code !== 'ERR_MODULE_NOT_FOUND' || !String(e.message).includes('generators')) throw e;
    });
    generatorsMod = await import('../generators/registry.js');
  }
  return generatorsMod;
}

let formatsMod = null;
async function formats() {
  if (!formatsMod) formatsMod = await import('./formats/index.js');
  return formatsMod;
}

export class BlueprintError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

const STRUCTURE_EXT = new Set(['.schem', '.schematic', '.nbt', '.litematic']);

/**
 * @param {string} source path or "gen:<name>"
 * @param {{ params?: object, depth?: number }} [opts]
 * @returns {Promise<Structure>}
 */
export async function loadBlueprint(source, opts = {}) {
  const depth = opts.depth ?? 0;
  if (depth > 8) throw new BlueprintError('Blueprint parts nested too deeply (cycle?)');
  const params = opts.params ?? {};
  if (/^gen:/i.test(source)) {
    const { runGenerator } = await gens();
    return runGenerator(source.slice(4), params);
  }
  if (!fs.existsSync(source)) {
    // Allow bare generator names when no such file exists ("mcb preview house").
    const { listGenerators, runGenerator } = await gens();
    if (listGenerators().some((g) => g.name === source)) return runGenerator(source, params);
    throw new BlueprintError(`Blueprint not found: ${source}`, 'Give a path to a .json/.js/.schem/.nbt/.litematic file, or a generator name like gen:house (see `mcb generators`).');
  }
  const ext = path.extname(source).toLowerCase();
  if (ext === '.json') {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(source, 'utf8'));
    } catch (e) {
      throw new BlueprintError(`Invalid JSON in ${source}: ${e.message}`);
    }
    return fromJson(data, { baseDir: path.dirname(source), params, depth, file: source });
  }
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return fromModule(path.resolve(source), params);
  if (STRUCTURE_EXT.has(ext)) {
    const { readStructureFile } = await formats();
    const s = await readStructureFile(source);
    if (!s.name || s.name === 'structure') s.name = path.basename(source, ext);
    return s;
  }
  throw new BlueprintError(`Unsupported blueprint type "${ext}"`, 'Supported: .json, .js/.mjs, .schem, .schematic, .nbt, .litematic');
}

async function fromModule(file, params) {
  let mod;
  try {
    mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
  } catch (e) {
    throw new BlueprintError(`Failed to load JS blueprint ${file}: ${e.message}`);
  }
  const def = mod.default ?? mod.build;
  if (!def) throw new BlueprintError(`${file} has no default export`, 'Export `default function build(s, params, ctx) {}` or `default { name, params, build }`.');
  const g = await gens();
  if (typeof def === 'function') {
    const s = new Structure({ name: path.basename(file).replace(/\.[cm]?js$/, '') });
    const ctx = g.makeContext(params.seed ?? 1);
    const out = await def(s, params, ctx);
    return out instanceof Structure ? out : s;
  }
  if (typeof def.build !== 'function') throw new BlueprintError(`${file}: default export needs a build(s, params, ctx) function`);
  const p = def.params ? g.resolveParams({ name: def.name ?? file, params: def.params }, params) : { ...params };
  const s = new Structure({ name: def.name ?? path.basename(file).replace(/\.[cm]?js$/, ''), description: def.description ?? '' });
  const out = await def.build(s, p, g.makeContext(p.seed ?? 1));
  return out instanceof Structure ? out : s;
}

function vec3(v, what) {
  if (Array.isArray(v) && v.length === 3 && v.every(Number.isInteger)) return v;
  if (v && typeof v === 'object' && ['x', 'y', 'z'].every((k) => Number.isInteger(v[k]))) return [v.x, v.y, v.z];
  throw new BlueprintError(`${what} must be [x, y, z] integers, got ${JSON.stringify(v)}`);
}

/**
 * Build a Structure from a parsed JSON blueprint.
 */
export async function fromJson(data, { baseDir = '.', params = {}, depth = 0, file = '<json>' } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BlueprintError(`${file}: blueprint must be a JSON object`);
  let s = new Structure({ name: data.name ?? path.basename(file, '.json'), description: data.description ?? '' });
  const palette = { ...(data.palette || {}) };
  const resolve = (key, where) => {
    if (key === null) return null;
    if (typeof key !== 'string') throw new BlueprintError(`${file}: ${where}: block must be a string, got ${JSON.stringify(key)}`);
    if (Object.prototype.hasOwnProperty.call(palette, key)) {
      const v = palette[key];
      return v === null ? null : canonical(v);
    }
    try {
      return canonical(key);
    } catch (e) {
      throw new BlueprintError(`${file}: ${where}: ${e.message}`);
    }
  };

  // 1. generator
  if (data.generator) {
    const { runGenerator } = await gens();
    s = runGenerator(data.generator, { ...(data.params || {}), ...params });
    s.name = data.name ?? s.name;
  }

  // 2. parts
  for (const [i, part] of (data.parts || []).entries()) {
    const where = `parts[${i}]`;
    const at = part.at ? vec3(part.at, `${where}.at`) : [0, 0, 0];
    let sub;
    if (part.generator) {
      const { runGenerator } = await gens();
      sub = runGenerator(part.generator, part.params || {});
    } else if (part.file) {
      sub = await loadBlueprint(path.resolve(baseDir, part.file), { params: part.params || {}, depth: depth + 1 });
    } else if (part.layers || part.blocks || part.fills) {
      sub = await fromJson({ palette, ...part }, { baseDir, depth: depth + 1, file: `${file}:${where}` });
    } else {
      throw new BlueprintError(`${file}: ${where} needs "generator", "file", or inline layers/blocks/fills`);
    }
    s.paste(sub, at[0], at[1], at[2], { rotate: part.rotate, mirror: part.mirror, skipAir: part.skipAir });
  }

  // 3. fills
  for (const [i, f] of (data.fills || []).entries()) {
    const where = `fills[${i}]`;
    const a = vec3(f.from, `${where}.from`), b = vec3(f.to, `${where}.to`);
    const block = resolve(f.block ?? f.b ?? f.name, where);
    s.fill(a[0], a[1], a[2], b[0], b[1], b[2], block, { mode: f.mode ?? 'replace' });
  }

  // 4. layers
  if (data.layers) {
    const [ox, oy, oz] = data.layerOrigin ? vec3(data.layerOrigin, 'layerOrigin') : [0, 0, 0];
    if (!Array.isArray(data.layers)) throw new BlueprintError(`${file}: "layers" must be an array (bottom layer first)`);
    const ids = new Map();
    data.layers.forEach((layer, y) => {
      const rows = typeof layer === 'string' ? layer.split(/\r?\n/) : layer;
      if (!Array.isArray(rows)) throw new BlueprintError(`${file}: layers[${y}] must be an array of row strings`);
      rows.forEach((row, z) => {
        if (typeof row !== 'string') throw new BlueprintError(`${file}: layers[${y}][${z}] must be a string`);
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          let id = ids.get(ch);
          if (id === undefined) {
            if (Object.prototype.hasOwnProperty.call(palette, ch)) id = palette[ch] === null ? 0 : s.idOf(canonical(palette[ch]));
            else if (ch === ' ' || ch === '.') id = 0;
            else {
              throw new BlueprintError(
                `${file}: layers[${y}] row ${z} col ${x}: character "${ch}" is not in the palette`,
                `Add "${ch}": "<block>" to "palette" (or use "." for empty).`,
              );
            }
            ids.set(ch, id);
          }
          if (id) s.setId(ox + x, oy + y, oz + z, id);
        }
      });
    });
  }

  // 5. blocks
  for (const [i, b] of (data.blocks || []).entries()) {
    const where = `blocks[${i}]`;
    let x, y, z, key;
    if (Array.isArray(b)) [x, y, z, key] = b;
    else ({ x, y, z } = b), (key = b.b ?? b.block ?? b.name ?? b.state);
    if (![x, y, z].every(Number.isInteger)) throw new BlueprintError(`${file}: ${where}: x, y, z must be integers`);
    if (key === undefined) throw new BlueprintError(`${file}: ${where}: missing block ("b", "block" or "name")`);
    s.set(x, y, z, resolve(key, where));
  }

  if (data.seed !== undefined) s.meta.seed = data.seed;
  return s;
}
