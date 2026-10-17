/**
 * Shared helpers for the structure file formats: NBT parse/write (gzip handled here), SNBT
 * conversion (NBT tag ⇄ text used in block strings like `chest[facing=north]{Items:[…]}`),
 * Minecraft DataVersion lookup and block-entity helpers.
 *
 * Tags use prismarine-nbt's representation: `{ type, value }`, longs as `[hi, lo]` int32 pairs,
 * lists as `{ type: 'list', value: { type: elemType, value: [rawValues…] } }`.
 */
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { canonical, blockName, isAir } from '../../core/blockstate.js';
import { DEFAULT_MC_VERSION } from '../../core/blockinfo.js';

const require = createRequire(import.meta.url);
export const nbt = require('prismarine-nbt');

/** Longest block-entity SNBT kept on imported blocks (keeps /setblock commands under 256 chars). */
export const MAX_IMPORTED_SNBT = 180;

// ───────────────────────── NBT I/O ─────────────────────────

export const isGzip = (buf) => buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;

/** Decompress gzip / zlib data; returns raw bytes unchanged. */
export function inflate(buf) {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (isGzip(data)) return zlib.gunzipSync(data);
  if (data.length > 2 && data[0] === 0x78 && (data[0] * 256 + data[1]) % 31 === 0) {
    try { return zlib.inflateSync(data); } catch { /* not zlib after all */ }
  }
  return data;
}

/**
 * Parse big-endian Java NBT (gzip, zlib or uncompressed).
 * @returns {{ type: 'compound', name: string, value: Record<string, any> }}
 */
export function parseNbt(buf) {
  const data = inflate(buf);
  if (!data.length || data[0] !== 10) throw new Error('Not an NBT file (expected a root compound tag)');
  try {
    return nbt.parseUncompressed(data, 'big');
  } catch (e) {
    throw new Error(`Corrupt or unsupported NBT data: ${e.message}`);
  }
}

/** Serialize a root compound value and gzip it (Minecraft's on-disk format). */
export function writeNbt(value, name = '', { gzip = true } = {}) {
  const raw = nbt.writeUncompressed({ type: 'compound', name, value });
  return gzip ? zlib.gzipSync(raw) : raw;
}

// Small tag builders.
export const T = {
  byte: (v) => ({ type: 'byte', value: v }),
  short: (v) => ({ type: 'short', value: v > 32767 ? v - 65536 : v }),
  int: (v) => ({ type: 'int', value: v }),
  long: (v) => ({ type: 'long', value: bigToLong(BigInt(v)) }),
  string: (v) => ({ type: 'string', value: String(v) }),
  intArray: (v) => ({ type: 'intArray', value: v }),
  byteArray: (v) => ({ type: 'byteArray', value: v }),
  longArray: (v) => ({ type: 'longArray', value: v }),
  comp: (value) => ({ type: 'compound', value }),
  /** list of raw values of one element type (compound values are plain `{key: tag}` objects) */
  list: (type, values) => ({ type: 'list', value: { type: values.length ? type : 'end', value: values } }),
};

export function longToBig([hi, lo]) {
  return (BigInt(hi) << 32n) | BigInt(lo >>> 0);
}
export function bigToLong(b) {
  return [Number(BigInt.asIntN(32, b >> 32n)), Number(BigInt.asIntN(32, b))];
}

/** Numeric value of an int/short/byte/long tag (sizes stored in shorts/bytes can be unsigned). */
export function num(tag, { unsigned = false } = {}) {
  if (!tag) return undefined;
  if (tag.type === 'long') return Number(longToBig(tag.value));
  if (typeof tag.value !== 'number') return undefined;
  if (unsigned && tag.type === 'short') return tag.value & 0xffff;
  if (unsigned && tag.type === 'byte') return tag.value & 0xff;
  return tag.value;
}

export const str = (tag) => (tag && tag.type === 'string' ? tag.value : undefined);

// ───────────────────────── DataVersion ─────────────────────────

const dvCache = new Map();
/** Minecraft DataVersion of a release ("1.21.11" → 4671), from minecraft-data; null if unknown. */
export function dataVersionFor(version = DEFAULT_MC_VERSION) {
  if (dvCache.has(version)) return dvCache.get(version);
  let dv = null;
  try {
    dv = require('minecraft-data').versionsByMinecraftVersion?.pc?.[version]?.dataVersion ?? null;
  } catch { dv = null; }
  if (dv == null && version === '1.21.11') dv = 4671;
  dvCache.set(version, dv);
  return dv;
}
export const defaultDataVersion = () => dataVersionFor(DEFAULT_MC_VERSION) ?? 4671;

// ───────────────────────── block states ─────────────────────────

/** Canonical block string from a palette entry (`Name` + `Properties` compound or plain object). */
export function stateFromNbt(name, props) {
  const keys = props ? Object.keys(props) : [];
  if (!keys.length) return canonical(String(name));
  const parts = keys.map((k) => {
    const v = props[k];
    return `${k}=${v && typeof v === 'object' && 'value' in v ? v.value : v}`;
  });
  return canonical(`${name}[${parts.join(',')}]`);
}

/** `{ Name, Properties? }` compound value for a canonical block (any SNBT suffix is ignored). */
export function paletteCompound(block) {
  const i = block.search(/[[{]/);
  const name = i < 0 ? block : block.slice(0, i);
  const out = { Name: T.string(name.includes(':') ? name : `minecraft:${name}`) };
  if (block[i] === '[') {
    const end = block.indexOf(']', i);
    const props = {};
    for (const part of block.slice(i + 1, end).split(',')) {
      const eq = part.indexOf('=');
      if (eq > 0) props[part.slice(0, eq)] = T.string(part.slice(eq + 1));
    }
    if (Object.keys(props).length) out.Properties = T.comp(props);
  }
  return out;
}

/** Split a canonical block into its state (no SNBT) and its SNBT suffix (or null). */
export function splitNbt(block) {
  const b = block.indexOf('[');
  const c = block.indexOf('{');
  if (c < 0) return { state: block, snbt: null };
  if (b >= 0 && b < c) {
    const at = block.indexOf('{', block.indexOf(']', b));
    return at < 0 ? { state: block, snbt: null } : { state: block.slice(0, at), snbt: block.slice(at) };
  }
  return { state: block.slice(0, c), snbt: block.slice(c) };
}

/** Is this block "nothing" for import purposes (air variants, structure_void)? */
export function isVoidOrAir(block) {
  return isAir(block) || blockName(block) === 'structure_void';
}

// ───────────────────────── old block names ─────────────────────────

/** DataVersions of the releases that renamed blocks. */
const DV = { v1_13: 1519, v1_14: 1952, v1_16: 2566, v1_17: 2724, v1_20_3: 3698, v1_21_9: 4554 };
const RENAMES = [
  // [new name exists since, old name, new name, only when the file predates this DataVersion]
  [DV.v1_14, 'sign', 'oak_sign'],
  [DV.v1_14, 'wall_sign', 'oak_wall_sign'],
  [DV.v1_14, 'stone_slab', 'smooth_stone_slab', DV.v1_14], // "stone_slab" still exists, with another texture
  [DV.v1_17, 'grass_path', 'dirt_path'],
  [DV.v1_20_3, 'grass', 'short_grass'],
  [DV.v1_21_9, 'chain', 'iron_chain'],
];

/**
 * Update a block state written by an older Minecraft version (renamed blocks / property values) so
 * it is valid for the target version. Block-entity SNBT is kept as-is.
 * @param {string} block canonical block string
 * @param {{ from?: number|null, to?: number }} [dv] source / target DataVersion
 */
export function upgradeBlockState(block, { from = null, to = defaultDataVersion() } = {}) {
  const src = from ?? DV.v1_13;
  if (src >= to) return block;
  const { state, snbt } = splitNbt(block);
  const i = state.indexOf('[');
  let name = i < 0 ? state : state.slice(0, i);
  const props = {};
  if (i >= 0) {
    for (const part of state.slice(i + 1, -1).split(',')) {
      const eq = part.indexOf('=');
      if (eq > 0) props[part.slice(0, eq)] = part.slice(eq + 1);
    }
  }
  let changed = false;
  for (const [since, oldName, newName, onlyBefore] of RENAMES) {
    if (name === oldName && to >= since && src < since && (onlyBefore === undefined || src < onlyBefore)) {
      name = newName;
      changed = true;
    }
  }
  if (name === 'cauldron' && 'level' in props && to >= DV.v1_17) {
    // 1.17 split cauldrons: filled ones are water_cauldron with level 1–3
    if (Number(props.level) > 0) name = 'water_cauldron';
    else delete props.level;
    changed = true;
  }
  if (/_wall$/.test(name) && to >= DV.v1_16) {
    // 1.16 walls: north/east/south/west became none|low|tall
    for (const d of ['north', 'east', 'south', 'west']) {
      if (props[d] === 'true') { props[d] = 'low'; changed = true; }
      else if (props[d] === 'false') { props[d] = 'none'; changed = true; }
    }
  }
  if (!changed) return block;
  const keys = Object.keys(props);
  return canonical((keys.length ? `${name}[${keys.map((k) => `${k}=${props[k]}`).join(',')}]` : name) + (snbt ?? ''));
}

/** Block-entity type id for a block (used when writing block entities). */
export function blockEntityIdFor(block) {
  const n = blockName(block);
  if (n.includes(':')) return n;
  let id = n;
  if (/hanging_sign$/.test(n)) id = 'hanging_sign';
  else if (/_sign$/.test(n)) id = 'sign';
  else if (/_banner$/.test(n)) id = 'banner';
  else if (/(_skull|_head)$/.test(n) && n !== 'piston_head') id = 'skull';
  else if (/_bed$/.test(n)) id = 'bed';
  else if (/shulker_box$/.test(n)) id = 'shulker_box';
  else if (/command_block$/.test(n)) id = 'command_block';
  else if (/campfire$/.test(n)) id = 'campfire';
  else if (n === 'spawner') id = 'mob_spawner';
  else if (n === 'bee_nest') id = 'beehive';
  else if (n === 'moving_piston') id = 'piston';
  else if (/^suspicious_(sand|gravel)$/.test(n)) id = 'brushable_block';
  return `minecraft:${id}`;
}

// ───────────────────────── NBT → SNBT ─────────────────────────

const SIMPLE_KEY = /^[A-Za-z0-9._+-]+$/;

function snbtString(s) {
  // Control characters can't be written portably (pre-1.21.5 SNBT has no \n escape and a raw
  // newline would break the mcfunction line) — callers treat this as "can't represent".
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new Error('string contains control characters');
  const q = s.includes('"') && !s.includes("'") ? "'" : '"';
  return q + s.replace(/\\/g, '\\\\').replace(q === '"' ? /"/g : /'/g, '\\' + q) + q;
}

function fmtFloat(v) {
  if (!Number.isFinite(v)) throw new Error('non-finite float');
  for (let p = 1; p <= 9; p++) {
    const s = Number(v.toPrecision(p));
    if (Math.fround(s) === v) return String(s);
  }
  return String(v);
}

function fmtDouble(v) {
  if (!Number.isFinite(v)) throw new Error('non-finite double');
  return String(v);
}

/** SNBT text for a tag. Throws when the value can't be represented safely. */
export function tagToSnbt(tag) {
  switch (tag.type) {
    case 'byte': return `${tag.value}b`;
    case 'short': return `${tag.value}s`;
    case 'int': return String(tag.value);
    case 'long': return `${longToBig(tag.value)}L`;
    case 'float': return `${fmtFloat(tag.value)}f`;
    case 'double': return `${fmtDouble(tag.value)}d`;
    case 'string': return snbtString(tag.value);
    case 'byteArray': return `[B;${Array.from(tag.value, (v) => `${v}b`).join(',')}]`;
    case 'intArray': return `[I;${Array.from(tag.value).join(',')}]`;
    case 'longArray': return `[L;${tag.value.map((v) => `${longToBig(v)}L`).join(',')}]`;
    case 'list': {
      const t = tag.value.type;
      return `[${tag.value.value.map((v) => tagToSnbt({ type: t, value: v })).join(',')}]`;
    }
    case 'compound':
      return `{${Object.entries(tag.value).map(([k, v]) => `${SIMPLE_KEY.test(k) ? k : snbtString(k)}:${tagToSnbt(v)}`).join(',')}}`;
    default:
      throw new Error(`unsupported NBT tag type ${tag.type}`);
  }
}

const BE_DROP = new Set(['x', 'y', 'z', 'id', 'Id', 'Pos', 'ContentVersion', 'keepPacked']);

function isEmptyTag(t) {
  if (t.type === 'compound') return Object.keys(t.value).length === 0;
  if (t.type === 'list') return t.value.value.length === 0;
  return false;
}

const EMPTY_TEXT = new Set(['', '""', "''", '{"text":""}']);
function isEmptyText(t) {
  if (t.type === 'string') return EMPTY_TEXT.has(String(t.value).trim());
  if (t.type === 'compound') {
    const keys = Object.keys(t.value);
    return !keys.length || (keys.length === 1 && t.value.text?.type === 'string' && t.value.text.value === '');
  }
  return false;
}

/** Leave out what a sign has by default (black, unlit, unwaxed, blank sides) — shorter restore commands. */
function compactSign(kept) {
  for (const side of ['front_text', 'back_text']) {
    const s = kept[side];
    if (!s || s.type !== 'compound') continue;
    const v = { ...s.value };
    if (v.color?.type === 'string' && v.color.value === 'black') delete v.color;
    if (v.has_glowing_text && Number(v.has_glowing_text.value) === 0) delete v.has_glowing_text;
    // filtered text that equals the text is the same as none (the game falls back to the text);
    // blank text is the default only when nothing filtered is kept apart from it
    if (v.filtered_messages && v.messages && tagToSnbt(v.filtered_messages) === tagToSnbt(v.messages)) delete v.filtered_messages;
    const blank = (m) => m?.type === 'list' && m.value.value.every((e) => isEmptyText({ type: m.value.type, value: e }));
    if (blank(v.messages) && !v.filtered_messages) delete v.messages;
    if (Object.keys(v).length) kept[side] = { type: 'compound', value: v };
    else delete kept[side];
  }
  if (kept.is_waxed && Number(kept.is_waxed.value) === 0) delete kept.is_waxed;
}

/**
 * SNBT for a block entity's data (position / id fields and empty lists / compounds dropped;
 * `compact` also drops sign defaults).
 * @returns {{ snbt: string|null, reason?: 'empty'|'too-long'|'unrepresentable' }}
 */
export function blockEntitySnbt(compoundValue, { maxLength = MAX_IMPORTED_SNBT, compact = false } = {}) {
  const kept = {};
  for (const [k, v] of Object.entries(compoundValue || {})) {
    if (BE_DROP.has(k) || !v || isEmptyTag(v)) continue;
    kept[k] = v;
  }
  if (compact && (kept.front_text || kept.back_text)) compactSign(kept);
  if (!Object.keys(kept).length) return { snbt: null, reason: 'empty' };
  let s;
  try {
    s = tagToSnbt({ type: 'compound', value: kept });
  } catch {
    return { snbt: null, reason: 'unrepresentable' };
  }
  if (s.length > maxLength) return { snbt: null, reason: 'too-long' };
  return { snbt: s };
}

/**
 * Attach block-entity data to the block at (x, y, z) of a Structure, best-effort.
 * Updates `stats` ({ kept, skipped }) and returns true when attached.
 */
export function attachBlockEntity(s, x, y, z, data, stats, maxLength = MAX_IMPORTED_SNBT) {
  const cur = s.get(x, y, z);
  if (cur == null || isAir(cur) || cur.includes('{')) return false;
  const r = blockEntitySnbt(data, { maxLength });
  if (!r.snbt) {
    if (r.reason !== 'empty') stats.skipped++;
    return false;
  }
  s.set(x, y, z, cur + r.snbt);
  stats.kept++;
  return true;
}

// ───────────────────────── SNBT → NBT ─────────────────────────

const UNQUOTED = /[A-Za-z0-9._+-]+/y;
const INT_RE = /^([-+]?\d+)([bslBSL]?)$/;
const FLOAT_RE = /^([-+]?(?:\d+\.?|\d*\.\d+)(?:e[-+]?\d+)?)([fdFD])$/i;
const DOUBLE_RE = /^[-+]?(?:\d+\.|\d*\.\d+)(?:e[-+]?\d+)?$/i;

function scalar(tok) {
  if (tok === 'true') return { type: 'byte', value: 1 };
  if (tok === 'false') return { type: 'byte', value: 0 };
  let m = INT_RE.exec(tok);
  if (m) {
    const suf = m[2].toLowerCase();
    const big = BigInt(m[1]);
    const fits = (bits) => big >= -(2n ** BigInt(bits - 1)) && big < 2n ** BigInt(bits - 1);
    if (suf === 'b' && fits(8)) return { type: 'byte', value: Number(big) };
    if (suf === 's' && fits(16)) return { type: 'short', value: Number(big) };
    if (suf === 'l' && fits(64)) return { type: 'long', value: bigToLong(big) };
    if (!suf && fits(32)) return { type: 'int', value: Number(big) };
    return { type: 'string', value: tok };
  }
  m = FLOAT_RE.exec(tok);
  if (m) return { type: m[2].toLowerCase() === 'f' ? 'float' : 'double', value: Number(m[1]) };
  if (DOUBLE_RE.test(tok)) return { type: 'double', value: Number(tok) };
  return { type: 'string', value: tok };
}

class SnbtParser {
  constructor(text) { this.s = text; this.i = 0; }
  err(msg) { return new Error(`Invalid SNBT (${msg}) at position ${this.i}: ${this.s.length > 80 ? this.s.slice(0, 80) + '…' : this.s}`); }
  ws() { while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++; }
  peek() { return this.s[this.i]; }
  expect(c) {
    this.ws();
    if (this.s[this.i] !== c) throw this.err(`expected "${c}"`);
    this.i++;
  }
  unquoted() {
    UNQUOTED.lastIndex = this.i;
    const m = UNQUOTED.exec(this.s);
    if (!m) return null;
    this.i += m[0].length;
    return m[0];
  }
  quoted() {
    const q = this.s[this.i++];
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === q) return out;
      if (c !== '\\') { out += c; continue; }
      const e = this.s[this.i++];
      const hex = (n) => { const v = parseInt(this.s.slice(this.i, this.i + n), 16); this.i += n; return v; };
      switch (e) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 's': out += ' '; break;
        case 'x': out += String.fromCharCode(hex(2)); break;
        case 'u': out += String.fromCharCode(hex(4)); break;
        case 'U': out += String.fromCodePoint(hex(8)); break;
        default: out += e;
      }
    }
    throw this.err('unterminated string');
  }
  key() {
    this.ws();
    const c = this.peek();
    if (c === '"' || c === "'") return this.quoted();
    const k = this.unquoted();
    if (k == null) throw this.err('expected a key');
    return k;
  }
  value() {
    this.ws();
    const c = this.peek();
    if (c === '{') return this.compound();
    if (c === '[') return this.list();
    if (c === '"' || c === "'") return { type: 'string', value: this.quoted() };
    const tok = this.unquoted();
    if (tok == null) throw this.err('expected a value');
    return scalar(tok);
  }
  compound() {
    this.i++;
    const value = {};
    this.ws();
    if (this.peek() === '}') { this.i++; return { type: 'compound', value }; }
    for (;;) {
      const k = this.key();
      this.expect(':');
      value[k] = this.value();
      this.ws();
      const c = this.s[this.i++];
      if (c === ',') continue;
      if (c === '}') return { type: 'compound', value };
      this.i--;
      throw this.err('expected "," or "}"');
    }
  }
  list() {
    this.i++;
    this.ws();
    const arr = /^([BIL])\s*;/.exec(this.s.slice(this.i, this.i + 3));
    if (arr) {
      this.i += arr[0].length;
      return this.typedArray(arr[1]);
    }
    const items = [];
    if (this.peek() === ']') { this.i++; return { type: 'list', value: { type: 'end', value: [] } }; }
    for (;;) {
      items.push(this.value());
      this.ws();
      const c = this.s[this.i++];
      if (c === ',') continue;
      if (c === ']') break;
      this.i--;
      throw this.err('expected "," or "]"');
    }
    const type = items[0].type;
    if (items.some((t) => t.type !== type)) throw this.err('mixed element types in a list');
    return { type: 'list', value: { type, value: items.map((t) => t.value) } };
  }
  typedArray(kind) {
    const values = [];
    this.ws();
    if (this.peek() === ']') {
      this.i++;
    } else {
      for (;;) {
        this.ws();
        const tok = this.unquoted();
        const t = tok == null ? null : scalar(tok);
        if (!t || !['byte', 'short', 'int', 'long'].includes(t.type)) throw this.err('expected an integer in a typed array');
        const n = t.type === 'long' ? longToBig(t.value) : BigInt(t.value);
        values.push(kind === 'L' ? bigToLong(n) : Number(n));
        this.ws();
        const c = this.s[this.i++];
        if (c === ',') continue;
        if (c === ']') break;
        this.i--;
        throw this.err('expected "," or "]"');
      }
    }
    return { type: kind === 'B' ? 'byteArray' : kind === 'I' ? 'intArray' : 'longArray', value: values };
  }
}

/** Parse SNBT text into a tag (`{ type, value }`). */
export function parseSnbt(text) {
  const p = new SnbtParser(String(text));
  const v = p.value();
  p.ws();
  if (p.i < p.s.length) throw p.err('unexpected trailing text');
  return v;
}

/** Parse a block's SNBT suffix for writing: `{ id, data }` (position / id fields removed from data). */
export function blockEntityFromSnbt(state, snbt) {
  const tag = parseSnbt(snbt);
  if (tag.type !== 'compound') throw new Error('block NBT must be a compound');
  const data = { ...tag.value };
  const id = str(data.id) ?? str(data.Id) ?? blockEntityIdFor(state);
  for (const k of ['x', 'y', 'z', 'id', 'Id', 'Pos']) delete data[k];
  return { id: id.includes(':') ? id : `minecraft:${id}`, data };
}

/**
 * Collect the voxels of a structure in dense x-fastest order (index = x + z*W + y*W*L, the order
 * used by Sponge, Litematica and MCEdit) relative to its bounds' minimum corner.
 * @returns {{ ids: Uint16Array, size: [number,number,number], min: [number,number,number], used: Uint8Array }|null}
 */
export function denseVoxels(structure) {
  const b = structure.bounds();
  if (!b) return null;
  const [W, H, L] = b.size;
  const [mx, my, mz] = b.min;
  const n = W * H * L;
  if (n > 2 ** 31 - 1) throw new Error(`Structure too large to export (${W}×${H}×${L})`);
  const ids = new Uint16Array(n);
  const used = new Uint8Array(structure.palette.length);
  const WL = W * L;
  structure.forEach((x, y, z, block, id) => {
    ids[(x - mx) + (z - mz) * W + (y - my) * WL] = id;
    used[id] = 1;
  });
  return { ids, size: [W, H, L], min: [mx, my, mz], used };
}
