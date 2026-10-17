/**
 * Structure — a sparse 3D block model with a palette.
 *
 * Storage: 16×16×16 sections of Uint16 palette ids (like Minecraft chunks). Id 0 means
 * "untouched" (the world block is left as-is); explicit `air` is a real palette entry that
 * clears the world block. Coordinates are integers, relative to the structure origin.
 *
 * The builder API (all methods return `this` for chaining):
 *   s.set(x, y, z, 'oak_planks')
 *   s.fill(x1, y1, z1, x2, y2, z2, 'stone_bricks', { mode: 'hollow' })   // replace|hollow|outline|keep|walls
 *   s.walls(...), s.floor(...), s.line(...), s.sphere(...), s.cylinder(...), s.paste(other, dx, dy, dz)
 */
import { canonical, blockName, isAir } from './blockstate.js';
import { transformBlock, transformPoint, toQuarterTurns } from './transform.js';

/** Clockwise quarter turns that make a south-facing front face each direction. */
const FACING_TURNS = { south: 0, west: 1, north: 2, east: 3 };

// Section keys pack (sx, sy, sz) into one exact integer (< 2^53):
//   sx, sz: 22 bits each → ±2^21 sections = ±33,554,432 blocks (covers the ±30M world border)
//   sy:      8 bits      → ±128 sections   = ±2048 blocks
const SX = 2 ** 21;
const SXR = 2 ** 22;
const SY = 128;
export const MAX_XZ = SX * 16 - 1;
export const MIN_Y = -SY * 16;
export const MAX_Y = SY * 16 - 1;

function sectionKey(sx, sy, sz) {
  return ((sx + SX) * SXR + (sz + SX)) * 256 + (sy + SY);
}
/** Section key → [sx, sy, sz]. */
export function unpackSectionKey(key) {
  const sy = (key % 256) - SY;
  const rest = Math.floor(key / 256);
  const sz = (rest % SXR) - SX;
  const sx = Math.floor(rest / SXR) - SX;
  return [sx, sy, sz];
}
const unpackKey = unpackSectionKey;

function assertInt(v, name) {
  if (!Number.isInteger(v)) throw new TypeError(`${name} must be an integer, got ${v}`);
}

function assertRange(x, y, z) {
  if (x < -MAX_XZ - 1 || x > MAX_XZ || z < -MAX_XZ - 1 || z > MAX_XZ || y < MIN_Y || y > MAX_Y) {
    throw new RangeError(`Coordinates ${x},${y},${z} are outside the supported range (|x|,|z| ≤ ${MAX_XZ}, ${MIN_Y} ≤ y ≤ ${MAX_Y})`);
  }
}

export class Structure {
  /**
   * @param {{ name?: string, description?: string, meta?: object }} [opts]
   */
  constructor(opts = {}) {
    this.name = opts.name ?? 'structure';
    this.description = opts.description ?? '';
    this.meta = { ...(opts.meta || {}) };
    /** @type {(string|null)[]} */
    this.palette = [null];
    /** @type {Map<string, number>} */
    this._ids = new Map();
    /** @type {Map<number, Uint16Array>} */
    this._sections = new Map();
    this._count = 0;
    this._boundsCache = null;
  }

  // ───────────────────────── palette ─────────────────────────

  /** Palette id for a block (adds it if new). `null` → 0 (untouched). */
  idOf(block) {
    if (block == null) return 0;
    let id = this._ids.get(block);
    if (id !== undefined) return id;
    const c = canonical(block);
    id = this._ids.get(c);
    if (id === undefined) {
      if (this.palette.length >= 65535) throw new Error('Palette overflow (>65534 distinct block states)');
      id = this.palette.length;
      this.palette.push(c);
      this._ids.set(c, id);
    }
    if (block !== c) this._ids.set(block, id);
    return id;
  }

  // ───────────────────────── voxels ─────────────────────────

  _section(x, y, z, create) {
    if (x < -MAX_XZ - 1 || x > MAX_XZ || z < -MAX_XZ - 1 || z > MAX_XZ || y < MIN_Y || y > MAX_Y) {
      // never let an out-of-range coordinate alias into another section
      if (create) assertRange(x, y, z);
      return undefined;
    }
    const key = sectionKey(x >> 4, y >> 4, z >> 4);
    let sec = this._sections.get(key);
    if (!sec && create) {
      sec = new Uint16Array(4096);
      this._sections.set(key, sec);
    }
    return sec;
  }

  /** Set by palette id (fast path). */
  setId(x, y, z, id) {
    const sec = this._section(x, y, z, id !== 0);
    if (!sec) return this;
    const i = ((y & 15) << 8) | ((z & 15) << 4) | (x & 15);
    const prev = sec[i];
    if (prev === id) return this;
    if (prev === 0) this._count++;
    else if (id === 0) this._count--;
    sec[i] = id;
    this._boundsCache = null;
    return this;
  }

  getId(x, y, z) {
    const sec = this._section(x, y, z, false);
    return sec ? sec[((y & 15) << 8) | ((z & 15) << 4) | (x & 15)] : 0;
  }

  /** Set a block. `null` unsets (untouched). */
  set(x, y, z, block) {
    assertInt(x, 'x'); assertInt(y, 'y'); assertInt(z, 'z');
    return this.setId(x, y, z, this.idOf(block));
  }

  /** @returns {string|null} canonical block or null when untouched */
  get(x, y, z) {
    return this.palette[this.getId(x, y, z)];
  }

  has(x, y, z) { return this.getId(x, y, z) !== 0; }

  delete(x, y, z) { return this.setId(x, y, z, 0); }

  /** Number of non-untouched voxels. */
  get count() { return this._count; }

  /** Iterate voxels: cb(x, y, z, block, id). Order: section by section. */
  forEach(cb) {
    for (const [key, sec] of this._sections) {
      const [sx, sy, sz] = unpackKey(key);
      const bx = sx << 4, by = sy << 4, bz = sz << 4;
      for (let i = 0; i < 4096; i++) {
        const id = sec[i];
        if (id === 0) continue;
        cb(bx + (i & 15), by + (i >> 8), bz + ((i >> 4) & 15), this.palette[id], id);
      }
    }
  }

  /** @returns {{min:[number,number,number], max:[number,number,number], size:[number,number,number]}|null} */
  bounds() {
    if (this._boundsCache) return this._boundsCache;
    if (this._count === 0) return null;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    this.forEach((x, y, z) => {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    });
    this._boundsCache = { min: [x0, y0, z0], max: [x1, y1, z1], size: [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1] };
    return this._boundsCache;
  }

  /** Count of voxels per canonical block state, sorted desc. */
  blockCounts() {
    const counts = new Array(this.palette.length).fill(0);
    for (const sec of this._sections.values()) for (let i = 0; i < 4096; i++) if (sec[i]) counts[sec[i]]++;
    const out = {};
    counts.forEach((c, id) => { if (id && c) out[this.palette[id]] = c; });
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
  }

  /** Remove palette entries that are no longer used (renumbers ids). */
  compact() {
    const used = new Uint8Array(this.palette.length);
    for (const sec of this._sections.values()) for (let i = 0; i < 4096; i++) used[sec[i]] = 1;
    const remap = new Uint16Array(this.palette.length);
    const palette = [null];
    for (let id = 1; id < this.palette.length; id++) {
      if (used[id]) { remap[id] = palette.length; palette.push(this.palette[id]); }
    }
    for (const [key, sec] of this._sections) {
      let any = false;
      for (let i = 0; i < 4096; i++) { sec[i] = remap[sec[i]]; if (sec[i]) any = true; }
      if (!any) this._sections.delete(key);
    }
    this.palette = palette;
    this._ids = new Map(palette.slice(1).map((b, i) => [b, i + 1]));
    return this;
  }

  // ───────────────────────── shapes ─────────────────────────

  /**
   * Fill a box (inclusive corners, any order).
   * modes: replace (default) · hollow (shell + air inside, like /fill hollow) · outline (shell only)
   *        keep (only untouched or air voxels) · walls (4 vertical sides, no floor/ceiling)
   */
  fill(x1, y1, z1, x2, y2, z2, block, opts = {}) {
    const mode = typeof opts === 'string' ? opts : (opts.mode ?? 'replace');
    const [ax, bx] = x1 <= x2 ? [x1, x2] : [x2, x1];
    const [ay, by] = y1 <= y2 ? [y1, y2] : [y2, y1];
    const [az, bz] = z1 <= z2 ? [z1, z2] : [z2, z1];
    for (const v of [ax, bx, ay, by, az, bz]) assertInt(v, 'fill coordinate');
    const id = this.idOf(block);
    const airId = mode === 'hollow' ? this.idOf('air') : 0;
    for (let y = ay; y <= by; y++) {
      for (let z = az; z <= bz; z++) {
        for (let x = ax; x <= bx; x++) {
          const edge = x === ax || x === bx || y === ay || y === by || z === az || z === bz;
          switch (mode) {
            case 'replace': this.setId(x, y, z, id); break;
            case 'hollow': this.setId(x, y, z, edge ? id : airId); break;
            case 'outline': if (edge) this.setId(x, y, z, id); break;
            case 'walls': if (x === ax || x === bx || z === az || z === bz) this.setId(x, y, z, id); break;
            case 'keep': {
              const cur = this.getId(x, y, z);
              if (cur === 0 || isAir(this.palette[cur])) this.setId(x, y, z, id);
              break;
            }
            default: throw new Error(`Unknown fill mode "${mode}" (replace|hollow|outline|keep|walls)`);
          }
        }
      }
    }
    return this;
  }

  /** Four vertical walls of a box (no floor/ceiling). */
  walls(x1, y1, z1, x2, y2, z2, block) { return this.fill(x1, y1, z1, x2, y2, z2, block, { mode: 'walls' }); }

  /** Horizontal rectangle at height y. */
  floor(x1, z1, x2, z2, y, block) { return this.fill(x1, y, z1, x2, y, z2, block); }

  /** Clear (set explicit air) in a box. */
  clear(x1, y1, z1, x2, y2, z2) { return this.fill(x1, y1, z1, x2, y2, z2, 'air'); }

  /** 3D line (Bresenham-style, inclusive). */
  line(x1, y1, z1, x2, y2, z2, block) {
    const id = this.idOf(block);
    const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), Math.abs(z2 - z1));
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n;
      this.setId(Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t), Math.round(z1 + (z2 - z1) * t), id);
    }
    return this;
  }

  /**
   * Sphere / ellipsoid centred at (cx, cy, cz).
   * opts: { hollow?: boolean, thickness?: number, half?: 'top'|'bottom', ry?: number, rz?: number }
   */
  sphere(cx, cy, cz, r, block, opts = {}) {
    const rx = r, ry = opts.ry ?? r, rz = opts.rz ?? r;
    const th = opts.thickness ?? 1;
    const id = this.idOf(block);
    const inside = (x, y, z, sx, sy, sz) => (x * x) / (sx * sx) + (y * y) / (sy * sy) + (z * z) / (sz * sz) <= 1;
    const R = (v) => v + 0.5;
    for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
      if (opts.half === 'top' && y < 0) continue;
      if (opts.half === 'bottom' && y > 0) continue;
      for (let z = -Math.ceil(rz); z <= Math.ceil(rz); z++) {
        for (let x = -Math.ceil(rx); x <= Math.ceil(rx); x++) {
          if (!inside(x, y, z, R(rx), R(ry), R(rz))) continue;
          if (opts.hollow) {
            const ix = Math.max(R(rx) - th, 0.01), iy = Math.max(R(ry) - th, 0.01), iz = Math.max(R(rz) - th, 0.01);
            if (inside(x, y, z, ix, iy, iz)) continue;
          }
          this.setId(cx + x, cy + y, cz + z, id);
        }
      }
    }
    return this;
  }

  /**
   * Vertical cylinder with its base centre at (cx, y, cz) and the given height.
   * opts: { hollow?: boolean, thickness?: number, rz?: number, taper?: number (radius change per block) }
   */
  cylinder(cx, y, cz, r, height, block, opts = {}) {
    const id = this.idOf(block);
    const th = opts.thickness ?? 1;
    for (let dy = 0; dy < height; dy++) {
      const rr = Math.max(0, r + (opts.taper ?? 0) * dy);
      const rx = rr + 0.5, rz = (opts.rz ?? rr) + 0.5;
      const ext = Math.ceil(Math.max(rx, rz));
      for (let z = -ext; z <= ext; z++) {
        for (let x = -ext; x <= ext; x++) {
          if ((x * x) / (rx * rx) + (z * z) / (rz * rz) > 1) continue;
          if (opts.hollow) {
            const ix = rx - th, iz = rz - th;
            if (ix > 0 && iz > 0 && (x * x) / (ix * ix) + (z * z) / (iz * iz) <= 1) continue;
          }
          this.setId(cx + x, y + dy, cz + z, id);
        }
      }
    }
    return this;
  }

  /** Replace blocks by name or predicate. `to` may be a function (block) => newBlock|null. */
  replace(from, to) {
    const match = typeof from === 'function' ? from : (b) => b === canonical(from) || blockName(b) === blockName(from);
    const remap = new Map();
    const n = this.palette.length;
    for (let id = 1; id < n; id++) {
      const b = this.palette[id];
      if (b != null && match(b)) {
        const nb = typeof to === 'function' ? to(b) : to;
        remap.set(id, this.idOf(nb));
      }
    }
    if (!remap.size) return this;
    for (const sec of this._sections.values()) {
      for (let i = 0; i < 4096; i++) {
        const nid = remap.get(sec[i]);
        if (nid !== undefined) {
          if (nid === 0) this._count--;
          sec[i] = nid;
        }
      }
    }
    this._boundsCache = null;
    return this;
  }

  /** Map every palette entry through fn(block) → block. Cheap (palette-level). */
  mapBlocks(fn) { return this.replace(() => true, fn); }

  /**
   * Paste another structure at an offset.
   * opts: { skipAir?: boolean, keep?: boolean (don't overwrite existing voxels), rotate?, mirror? }
   */
  paste(other, dx = 0, dy = 0, dz = 0, opts = {}) {
    const src = opts.rotate || opts.mirror ? other.transformed({ rotate: opts.rotate, mirror: opts.mirror }) : other;
    const remap = src.palette.map((b) => this.idOf(b));
    src.forEach((x, y, z, b, id) => {
      if (opts.skipAir && isAir(b)) return;
      if (opts.keep && this.getId(x + dx, y + dy, z + dz) !== 0) return;
      this.setId(x + dx, y + dy, z + dz, remap[id]);
    });
    return this;
  }

  /**
   * Paste `other` turned to face a direction (or rotated/mirrored) with its north-west footprint
   * corner at (x, y, z) — the way builds are placed. Unlike paste(), which turns around (0,0,0) and
   * can move the part into negative coordinates.
   * opts: { facing?: 'south'|'west'|'north'|'east' (where its front, built facing south, should face),
   *         rotate?: degrees clockwise seen from above, mirror?: 'x'|'z', skipAir?, keep? }
   */
  place(other, x = 0, y = 0, z = 0, opts = {}) {
    let turns = toQuarterTurns(opts.rotate ?? 0);
    if (opts.facing != null) {
      const f = FACING_TURNS[String(opts.facing).toLowerCase()];
      if (f === undefined) throw new Error(`facing must be south, west, north or east, got "${opts.facing}"`);
      turns = (turns + f) % 4;
    }
    const src = turns || opts.mirror ? other.transformed({ rotate: turns, mirror: opts.mirror }) : other;
    const ob = other.bounds(), sb = src.bounds();
    if (!sb) return this;
    // keep the footprint's minimum corner where it was before turning (normally 0,0)
    const dx = x + (ob.min[0] - sb.min[0]), dz = z + (ob.min[2] - sb.min[2]);
    return this.paste(src, dx, y, dz, { skipAir: opts.skipAir, keep: opts.keep });
  }

  // ───────────────────────── transforms ─────────────────────────

  clone() {
    const s = new Structure({ name: this.name, description: this.description, meta: this.meta });
    s.palette = this.palette.slice();
    s._ids = new Map(this._ids);
    for (const [k, sec] of this._sections) s._sections.set(k, sec.slice());
    s._count = this._count;
    return s;
  }

  /** New structure shifted by (dx, dy, dz). */
  translated(dx, dy, dz) {
    const s = new Structure({ name: this.name, description: this.description, meta: this.meta });
    s.paste(this, dx, dy, dz);
    return s;
  }

  /** New structure with the minimum corner moved to (0,0,0). */
  normalized() {
    const b = this.bounds();
    if (!b) return this.clone();
    return this.translated(-b.min[0], -b.min[1], -b.min[2]);
  }

  /** New structure rotated (clockwise quarter turns or degrees) and/or mirrored around the origin. */
  transformed({ rotate = 0, mirror = null } = {}) {
    const turns = toQuarterTurns(rotate);
    if (!turns && !mirror) return this.clone();
    const s = new Structure({ name: this.name, description: this.description, meta: this.meta });
    const remap = this.palette.map((b) => (b == null ? 0 : s.idOf(transformBlock(b, { rotate: turns, mirror }))));
    this.forEach((x, y, z, b, id) => {
      const [nx, ny, nz] = transformPoint(x, y, z, { rotate: turns, mirror });
      s.setId(nx, ny, nz, remap[id]);
    });
    return s;
  }
}
