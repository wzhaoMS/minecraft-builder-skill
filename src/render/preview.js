/**
 * Preview renderer: Structure → PNG an AI agent (or human) can look at before building.
 *
 *   renderPreview(structure, { view: 'sheet' | 'iso' | 'iso-ne' | 'iso-nw' | 'iso-sw' | 'top' |
 *                              'south' | 'north' | 'east' | 'west', maxSize, title, scale,
 *                              background, showGrid, cutaway: { y } })
 *     → { png: Buffer, width, height, view }
 *
 * iso      isometric from the SOUTH-EAST (you see the top, the south "front" face and the east face);
 *          iso-ne / iso-nw / iso-sw look from the other corners
 * top      plan view, north up, east right, lighter = higher
 * south    elevation seen from the south (front): east is to the RIGHT
 * north    elevation seen from the north: east is to the LEFT
 * east     elevation seen from the east: north is to the RIGHT
 * west     elevation seen from the west: south is to the RIGHT
 * sheet    iso + top + south + east on one image with captions, compass and size
 *
 * maxSize bounds the longest side (default 1600) unless an explicit `scale` (pixels per block) is
 * given. Axis labels are real structure coordinates. cutaway.y hides everything above that y.
 */
import { encodePng } from './png.js';
import { textBitmap } from './font.js';
import { blockColor } from './colors.js';
import { isAir } from '../core/blockstate.js';
import { transformBlock, transformPoint } from '../core/transform.js';

// ───────────────────────────── canvas ─────────────────────────────

class Canvas {
  constructor(w, h, bg = [255, 255, 255]) {
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    this.data = new Uint8ClampedArray(this.w * this.h * 4);
    this.clear(bg);
  }
  clear([r, g, b]) {
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  }
  blend(x, y, r, g, b, a = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4, d = this.data;
    if (a >= 1) { d[i] = r; d[i + 1] = g; d[i + 2] = b; return; }
    d[i] = d[i] + (r - d[i]) * a;
    d[i + 1] = d[i + 1] + (g - d[i + 1]) * a;
    d[i + 2] = d[i + 2] + (b - d[i + 2]) * a;
  }
  rect(x, y, w, h, [r, g, b], a = 1) {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.floor(x + w)), y1 = Math.min(this.h, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.blend(xx, yy, r, g, b, a);
  }
  line(x0, y0, x1, y1, c, a = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.blend(x0, y0, c[0], c[1], c[2], a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  text(str, x, y, color = [30, 30, 30], scale = 1, { align = 'left' } = {}) {
    const bm = textBitmap(String(str).toUpperCase(), { font: '5x7', proportional: true });
    const ox = align === 'center' ? Math.round(x - (bm.width * scale) / 2) : align === 'right' ? Math.round(x - bm.width * scale) : Math.round(x);
    for (const k of bm.set) {
      const [px, py] = k.split(',').map(Number);
      this.rect(ox + px * scale, Math.round(y) + py * scale, scale, scale, color);
    }
    return bm.width * scale;
  }
  textWidth(str, scale = 1) { return textBitmap(String(str).toUpperCase(), { font: '5x7', proportional: true }).width * scale; }
  paste(src, dx, dy) {
    for (let y = 0; y < src.h; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= this.h) continue;
      for (let x = 0; x < src.w; x++) {
        const tx = x + dx;
        if (tx < 0 || tx >= this.w) continue;
        const si = (y * src.w + x) * 4, ti = (ty * this.w + tx) * 4;
        this.data[ti] = src.data[si]; this.data[ti + 1] = src.data[si + 1]; this.data[ti + 2] = src.data[si + 2]; this.data[ti + 3] = 255;
      }
    }
  }
  png() { return encodePng(this.w, this.h, this.data); }
}

const shade = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

// ───────────────────────────── voxel collection ─────────────────────────────

/**
 * Non-air voxels as flat typed arrays (xs, ys, zs, palette ids) with per-palette block info and bounds,
 * or null when there are none. `cutY` drops voxels above that y; `turns` rotates clockwise by quarter
 * turns exactly like Structure#transformed (coordinates and block states), without copying the structure.
 */
function collect(structure, cutY = Infinity, turns = 0) {
  if (!structure.bounds()) return null;
  const blocks = structure.palette.map((b) => (b == null ? null : turns ? transformBlock(b, { rotate: turns }) : b));
  const skip = Uint8Array.from(blocks, (b) => (b == null || isAir(b) ? 1 : 0));
  const cap = structure.count;
  const xs = new Int32Array(cap), ys = new Int32Array(cap), zs = new Int32Array(cap), ids = new Uint16Array(cap);
  let n = 0;
  structure.forEach((x, y, z, _block, id) => {
    if (skip[id] || y > cutY) return;
    if (turns) [x, y, z] = transformPoint(x, y, z, { rotate: turns });
    xs[n] = x; ys[n] = y; zs[n] = z; ids[n] = id; n++;
  });
  if (!n) return null;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i], z = zs[i];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const info = blocks.map((b, id) => (b == null || skip[id] ? null : blockColor(b)));
  return { n, xs, ys, zs, ids, info, min: [x0, y0, z0], max: [x1, y1, z1], size: [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1] };
}

/** Stable counting sort of voxel indices by an integer key in [0, maxKey] (optionally re-sorting `input`). */
function countingOrder(n, key, maxKey, input = null) {
  const counts = new Uint32Array(maxKey + 2);
  for (let j = 0; j < n; j++) counts[key(input ? input[j] : j) + 1]++;
  for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
  const out = new Uint32Array(n);
  for (let j = 0; j < n; j++) {
    const i = input ? input[j] : j;
    out[counts[key(i)]++] = i;
  }
  return out;
}

// ───────────────────────────── shapes ─────────────────────────────

/** Sub-boxes (in 0..1 voxel units) for the isometric renderer. */
function shapeBoxes(info) {
  switch (info.shape) {
    case 'slab-bottom': return [[0, 0, 0, 1, 0.5, 1]];
    case 'slab-top': return [[0, 0.5, 0, 1, 1, 1]];
    case 'thin': return [[0, 0, 0, 1, 0.125, 1]];
    case 'slab-top-thin': return [[0, 0.8125, 0, 1, 1, 1]];
    case 'cube-thin': return [[0, 0, 0, 1, 1, 0.1875]];
    case 'post': return [[0.3125, 0, 0.3125, 0.6875, 1, 0.6875]];
    case 'small': {
      // a 4/16-wide, 10/16-tall stub; wall-mounted ones hug their wall (opposite `facing`), hanging ones the ceiling
      const p = info.props;
      const onWall = /wall_/.test(info.name) || p.face === 'wall';
      const [dx, dz] = (onWall && { north: [0, 0.3], south: [0, -0.3], east: [-0.3, 0], west: [0.3, 0] }[p.facing]) || [0, 0];
      const y0 = p.hanging === 'true' || p.face === 'ceiling' ? 0.375 : onWall ? 0.2 : 0;
      return [[0.375 + dx, y0, 0.375 + dz, 0.625 + dx, y0 + 0.625, 0.625 + dz]];
    }
    case 'cross': return [[0.25, 0, 0.25, 0.75, 0.6875, 0.75]];
    case 'door': return [[0.05, 0, 0.05, 0.95, 1, 0.95]];
    case 'stairs': {
      const top = info.props.half === 'top';
      const base = top ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
      const [ya, yb] = top ? [0, 0.5] : [0.5, 1];
      const f = info.props.facing ?? 'north';
      const step = f === 'north' ? [0, ya, 0, 1, yb, 0.5] : f === 'south' ? [0, ya, 0.5, 1, yb, 1]
        : f === 'east' ? [0.5, ya, 0, 1, yb, 1] : [0, ya, 0, 0.5, yb, 1];
      return [base, step];
    }
    default: return [[0, 0, 0, 1, 1, 1]];
  }
}

/** 4×4 coverage mask for orthographic views. view: 'top' | 'side'; axisU: world dir that +u maps to. */
function coverage(info, view, uDir) {
  const full = 0xffff;
  const rows = (r0, r1) => { let m = 0; for (let r = r0; r < r1; r++) m |= 0xf << (r * 4); return m; };
  const cols = (c0, c1, r0 = 0, r1 = 4) => { let m = 0; for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) m |= 1 << (r * 4 + c); return m; };
  if (view === 'top') {
    if (info.shape === 'post' || info.shape === 'cross' || info.shape === 'small') return cols(1, 3, 1, 3);
    return full;
  }
  switch (info.shape) {
    case 'slab-bottom': return rows(2, 4);
    case 'slab-top': return rows(0, 2);
    case 'thin': return rows(3, 4);
    case 'slab-top-thin': return rows(0, 1);
    case 'post': return cols(1, 3);
    case 'small': return cols(1, 3, 1, 4);
    case 'cross': return cols(1, 3, 1, 4);
    case 'stairs': {
      const top = info.props.half === 'top';
      const f = info.props.facing ?? 'north';
      const along = f === uDir ? 'right' : (OPP[f] === uDir ? 'left' : null);
      const base = top ? rows(0, 2) : rows(2, 4);
      if (!along) return full;
      const [r0, r1] = top ? [2, 4] : [0, 2];
      return base | (along === 'right' ? cols(2, 4, r0, r1) : cols(0, 2, r0, r1));
    }
    default: return full;
  }
}
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };

// ───────────────────────────── isometric ─────────────────────────────

/** Point-in-convex-quad test (any winding, edges inclusive) shared by the sprite and ground rasterizers. */
function quadInside(pts) {
  let area = 0;
  for (let i = 0; i < 4; i++) { const [a, b] = pts[i], [c, d] = pts[(i + 1) % 4]; area += a * d - c * b; }
  const sgn = area >= 0 ? 1 : -1;
  return (x, y) => {
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 4];
      if (sgn * ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) < -1e-9) return false;
    }
    return true;
  };
}

/**
 * Same pixel set as rasterizeQuad (pixel centres inside the quad) delivered as row spans fn(y, x0, x1),
 * inclusive — O(rows) instead of O(area) memory, for the big ground plane.
 */
function quadSpans(pts, fn) {
  const inside = quadInside(pts);
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const [u, v] of pts) { umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
  const xlo = Math.floor(umin), xhi = Math.ceil(umax) - 1;
  for (let y = Math.floor(vmin); y < Math.ceil(vmax); y++) {
    const cy = y + 0.5;
    // where the row crosses the quad's outline (convex → one contiguous span), then snap with the exact test
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 4];
      if ((cy - ay) * (cy - by) > 0 || ay === by) continue;
      const x = ax + ((cy - ay) * (bx - ax)) / (by - ay);
      lo = Math.min(lo, x); hi = Math.max(hi, x);
    }
    if (lo > hi) continue;
    let x0 = Math.max(xlo, Math.ceil(lo - 0.5) - 1), x1 = Math.min(xhi, Math.floor(hi - 0.5) + 1);
    while (x0 <= x1 && !inside(x0 + 0.5, cy)) x0++;
    while (x1 >= x0 && !inside(x1 + 0.5, cy)) x1--;
    if (x0 > x1) continue;
    while (x0 > xlo && inside(x0 - 0.5, cy)) x0--;
    while (x1 < xhi && inside(x1 + 1.5, cy)) x1++;
    fn(y, x0, x1);
  }
}

function rasterizeQuad(pts) {
  // pts: 4 [u,v] (float) convex, any winding → list of integer pixel offsets inside + edge flags
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const [u, v] of pts) { umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
  const inside = quadInside(pts);
  const px = [];
  const set = new Set();
  for (let y = Math.floor(vmin); y < Math.ceil(vmax); y++) {
    for (let x = Math.floor(umin); x < Math.ceil(umax); x++) {
      if (inside(x + 0.5, y + 0.5)) { px.push(x, y); set.add(x * 100003 + y); }
    }
  }
  const edge = [];
  for (let i = 0; i < px.length; i += 2) {
    const x = px[i], y = px[i + 1];
    edge.push(!(set.has((x + 1) * 100003 + y) && set.has((x - 1) * 100003 + y) && set.has(x * 100003 + y + 1) && set.has(x * 100003 + y - 1)));
  }
  return { px: Int32Array.from(px), edge };
}

function makeSprites(s) {
  const P = (dx, dy, dz) => [(dx - dz) * s, ((dx + dz) * s) / 2 - dy * s];
  const cache = new Map();
  return (box) => {
    const key = box.join(',');
    let sp = cache.get(key);
    if (sp) return sp;
    const [x0, y0, z0, x1, y1, z1] = box;
    sp = {
      top: rasterizeQuad([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]),
      east: rasterizeQuad([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)]),
      south: rasterizeQuad([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]),
    };
    cache.set(key, sp);
    return sp;
  };
}

/** Render the isometric view into a new canvas. `turns` = clockwise quarter turns to view from another corner. */
function renderIso(structure, { maxW, maxH, bg, scale, turns = 0, cutY = Infinity, grid = true, c: pre = null }) {
  const c = pre ?? collect(structure, cutY, turns);
  if (!c) return null;
  const [sx, sy, sz] = c.size;
  const margin = 18, top = 60; // extra headroom so the compass rose never covers the build
  let s = scale ?? Math.floor(Math.min((maxW - 2 * margin) / (sx + sz), (maxH - margin - top) / ((sx + sz) / 2 + sy)));
  s = Math.max(1, Math.min(32, s));
  if (s > 2 && s % 2) s -= 1;
  const W = (sx + sz) * s + 2 * margin, H = Math.ceil(((sx + sz) * s) / 2 + sy * s) + margin + top;
  const cv = new Canvas(W, H, bg);
  const [mx, my, mz] = c.min;
  const ox = sz * s + margin, oy = sy * s + top;
  const proj = (X, Y, Z) => [ox + (X - Z) * s, oy + ((X + Z) * s) / 2 - Y * s];

  // ground plane with a 1-block grid + compass letters
  const g0 = proj(0, 0, 0), g1 = proj(sx, 0, 0), g2 = proj(sx, 0, sz), g3 = proj(0, 0, sz);
  quadSpans([g0, g1, g2, g3], (y, x0, x1) => { for (let x = x0; x <= x1; x++) cv.blend(x, y, 0, 0, 0, 0.08); });
  if (grid && s >= 4) {
    for (let i = 0; i <= sx; i++) { const a = proj(i, 0, 0), b = proj(i, 0, sz); cv.line(a[0], a[1], b[0], b[1], [0, 0, 0], i % 10 === 0 ? 0.18 : 0.07); }
    for (let k = 0; k <= sz; k++) { const a = proj(0, 0, k), b = proj(sx, 0, k); cv.line(a[0], a[1], b[0], b[1], [0, 0, 0], k % 10 === 0 ? 0.18 : 0.07); }
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // The renderer always looks from the (rotated) south-east; map rotated directions back to real ones.
  const COMPASS = ['N', 'E', 'S', 'W'];
  const real = (d) => COMPASS[(COMPASS.indexOf(d) - turns + 4) % 4];
  const compassLabels = () => {
    const label = (x, y, t) => {
      cv.rect(x - 5, y - 2, 11, 11, [255, 255, 255], 0.7);
      cv.text(t, x, y, [40, 40, 90], 1, { align: 'center' });
    };
    // the two front edges of the ground are in front, so label them in place…
    const sMid = mid(g2, g3), eMid = mid(g1, g2);
    label(sMid[0] - 12, sMid[1] + 8, real('S'));
    label(eMid[0] + 12, eMid[1] + 8, real('E'));
    // …and draw a compass rose in the top-left corner for all four directions
    const cx = 34, cy = 30, L = 16;
    const n = Math.hypot(2, 1);
    const dirs = { N: [2 / n, -1 / n], E: [2 / n, 1 / n], S: [-2 / n, 1 / n], W: [-2 / n, -1 / n] };
    for (const [d, [dx, dy]] of Object.entries(dirs)) {
      const t = real(d);
      cv.line(cx, cy, cx + dx * L, cy + dy * L, t === 'N' ? [200, 40, 40] : [60, 60, 90], 0.9);
      label(Math.round(cx + dx * (L + 9)), Math.round(cy + dy * (L + 9)) - 3, t);
    }
  };

  const { n, xs, ys, zs, ids, info } = c;
  // occupancy (palette ids) for face culling: a dense grid when it fits, a numeric-key map otherwise
  const plane = sx * sz, vol = plane * sy;
  const dense = vol <= 64e6 ? new Uint16Array(vol) : null;
  const sparse = dense ? null : new Map();
  for (let i = 0; i < n; i++) {
    const k = ((ys[i] - my) * sz + (zs[i] - mz)) * sx + (xs[i] - mx);
    if (dense) dense[k] = ids[i]; else sparse.set(k, ids[i]);
  }
  const occ = dense ? (k) => dense[k] : (k) => sparse.get(k) ?? 0;
  const opaque = info.map((inf) => !!inf && inf.shape === 'cube' && inf.a >= 1);
  // painter's order: far → near (camera at +x,+y,+z): by x+y+z, then y, then collection order
  const byY = countingOrder(n, (i) => ys[i] - my, sy - 1);
  const order = countingOrder(n, (i) => (xs[i] - mx) + (ys[i] - my) + (zs[i] - mz), sx + sy + sz - 3, byY);
  const sprites = makeSprites(s);
  const outline = s >= 6;
  const FACES = ['south', 'east', 'top'];
  const prep = new Array(info.length);
  const prepare = (inf) => {
    const boxes = shapeBoxes(inf).sort((p, q) => (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2]));
    const faces = FACES.map((face) => {
      const base = face === 'top' ? inf.top : shade(inf.side, face === 'south' ? 0.82 : 0.64);
      return { face, base, ex: shade(base, 0.82) };
    });
    return { a: inf.a, cube: boxes.length === 1 && inf.shape === 'cube', sps: boxes.map(sprites), faces };
  };
  const d = cv.data, CW = cv.w, CH = cv.h;
  for (let j = 0; j < n; j++) {
    const i = order[j], id = ids[i];
    const p = prep[id] ?? (prep[id] = prepare(info[id]));
    const a = p.a;
    if (a <= 0) continue;
    const X = xs[i] - mx, Y = ys[i] - my, Z = zs[i] - mz;
    const ax = Math.round(ox + (X - Z) * s), ay = Math.round(oy + ((X + Z) * s) / 2 - Y * s);
    let skipS = false, skipE = false, skipT = false;
    if (p.cube) {
      const k = (Y * sz + Z) * sx + X;
      const hidden = (nid) => nid !== 0 && (opaque[nid] || (nid === id && a < 1));
      skipS = Z + 1 < sz && hidden(occ(k + sx));
      skipE = X + 1 < sx && hidden(occ(k + 1));
      skipT = Y + 1 < sy && hidden(occ(k + plane));
    }
    for (const sp of p.sps) {
      for (let f = 0; f < 3; f++) {
        if (f === 0 ? skipS : f === 1 ? skipE : skipT) continue;
        const { face, base, ex } = p.faces[f];
        const { px, edge } = sp[face];
        for (let k = 0, e = 0; k < px.length; k += 2, e++) {
          const x = ax + px[k], y = ay + px[k + 1];
          if (x < 0 || y < 0 || x >= CW || y >= CH) continue;
          const col = outline && edge[e] ? ex : base;
          const o = (y * CW + x) * 4;
          if (a >= 1) {
            d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2];
          } else {
            d[o] = d[o] + (col[0] - d[o]) * a; d[o + 1] = d[o + 1] + (col[1] - d[o + 1]) * a; d[o + 2] = d[o + 2] + (col[2] - d[o + 2]) * a;
          }
        }
      }
    }
  }
  compassLabels();
  return { canvas: cv, scale: s, size: c.size };
}

// ───────────────────────────── orthographic ─────────────────────────────

const VIEWS = {
  // u axis, v axis (down), depth (nearer = larger), uDir (world direction of +u),
  // uc/vc: real structure coordinate of column i / row j, with the direction (+1/-1) it changes in
  top: { u: (x, y, z, c) => x - c.min[0], v: (x, y, z, c) => z - c.min[2], depth: (x, y) => y, W: (c) => c.size[0], H: (c) => c.size[2], uDir: 'east', cov: 'top', uc: (c) => [c.min[0], 1], vc: (c) => [c.min[2], 1] },
  south: { u: (x, y, z, c) => x - c.min[0], v: (x, y, z, c) => c.max[1] - y, depth: (x, y, z) => z, W: (c) => c.size[0], H: (c) => c.size[1], uDir: 'east', cov: 'side', uc: (c) => [c.min[0], 1], vc: (c) => [c.max[1], -1] },
  north: { u: (x, y, z, c) => c.max[0] - x, v: (x, y, z, c) => c.max[1] - y, depth: (x, y, z) => -z, W: (c) => c.size[0], H: (c) => c.size[1], uDir: 'west', cov: 'side', uc: (c) => [c.max[0], -1], vc: (c) => [c.max[1], -1] },
  east: { u: (x, y, z, c) => c.max[2] - z, v: (x, y, z, c) => c.max[1] - y, depth: (x) => x, W: (c) => c.size[2], H: (c) => c.size[1], uDir: 'north', cov: 'side', uc: (c) => [c.max[2], -1], vc: (c) => [c.max[1], -1] },
  west: { u: (x, y, z, c) => z - c.min[2], v: (x, y, z, c) => c.max[1] - y, depth: (x) => -x, W: (c) => c.size[2], H: (c) => c.size[1], uDir: 'south', cov: 'side', uc: (c) => [c.min[2], 1], vc: (c) => [c.max[1], -1] },
};

const mod = (a, n) => ((a % n) + n) % n;
const ORTHO_MARGINS = { ml: 26, mt: 12, mr: 12, mb: 18 };

function renderOrtho(structure, view, { maxW, maxH, bg, scale, cutY = Infinity, grid = true, plotTint = true, c: pre = null }) {
  const c = pre ?? collect(structure, cutY);
  if (!c) return null;
  const V = VIEWS[view];
  const gw = V.W(c), gh = V.H(c);
  const { ml, mt, mr, mb } = ORTHO_MARGINS;
  let cell = scale ?? Math.floor(Math.min((maxW - ml - mr) / gw, (maxH - mt - mb) / gh));
  cell = Math.max(1, Math.min(24, cell));
  const sub = cell >= 8 ? 4 : 1;
  const W = gw * cell + ml + mr, H = gh * cell + mt + mb;
  const cv = new Canvas(W, H, bg);
  if (plotTint) cv.rect(ml, mt, gw * cell, gh * cell, [255, 255, 255], 0.55);
  const { n, xs, ys, zs, ids, info } = c;
  const depths = new Float64Array(n);
  let dmin = Infinity, dmax = -Infinity;
  for (let i = 0; i < n; i++) {
    const dd = V.depth(xs[i], ys[i], zs[i]);
    depths[i] = dd;
    if (dd < dmin) dmin = dd;
    if (dd > dmax) dmax = dd;
  }
  // back → front: stable counting sort by (integer) depth
  const order = countingOrder(n, (i) => depths[i] - dmin, dmax - dmin);
  const sc = cell / sub;
  const masks = new Array(info.length);
  const d = cv.data, CW = cv.w, CH = cv.h;
  for (let j = 0; j < n; j++) {
    const i = order[j], id = ids[i];
    const inf = info[id];
    const a = inf.a;
    if (a <= 0) continue;
    const t = dmax === dmin ? 1 : (depths[i] - dmin) / (dmax - dmin);
    const f = view === 'top' ? 0.45 + 0.55 * t : 0.55 + 0.45 * t;
    const src = view === 'top' ? inf.top : inf.side;
    const r = src[0] * f, g = src[1] * f, b = src[2] * f;
    const u = V.u(xs[i], ys[i], zs[i], c), v = V.v(xs[i], ys[i], zs[i], c);
    if (sub === 1) {
      // inline cv.rect(ml + u * cell, mt + v * cell, cell, cell, [r, g, b], a)
      const X0 = Math.max(0, ml + u * cell), Y0 = Math.max(0, mt + v * cell);
      const X1 = Math.min(CW, ml + u * cell + cell), Y1 = Math.min(CH, mt + v * cell + cell);
      for (let yy = Y0; yy < Y1; yy++) {
        for (let xx = X0; xx < X1; xx++) {
          const o = (yy * CW + xx) * 4;
          if (a >= 1) { d[o] = r; d[o + 1] = g; d[o + 2] = b; } else { d[o] = d[o] + (r - d[o]) * a; d[o + 1] = d[o + 1] + (g - d[o + 1]) * a; d[o + 2] = d[o + 2] + (b - d[o + 2]) * a; }
        }
      }
      continue;
    }
    const mask = masks[id] ?? (masks[id] = coverage(inf, V.cov, V.uDir));
    const col = [r, g, b];
    for (let rr = 0; rr < sub; rr++) {
      for (let q = 0; q < sub; q++) {
        if (!(mask & (1 << (rr * 4 + q)))) continue;
        cv.rect(ml + u * cell + q * sc, mt + v * cell + rr * sc, sc, sc, col, a);
      }
    }
  }
  // grid (1-block lines when big enough, stronger lines on real coordinates that are multiples of 10) + labels
  const [u0, du] = V.uc(c), [v0, dv] = V.vc(c);
  // grid line k sits on the world plane between cells k-1 and k
  const plane = (start, dir, k) => (dir > 0 ? start + k : start + 1 - k);
  const gridA = grid && cell >= 6 ? 0.1 : 0;
  for (let i = 0; i <= gw; i++) {
    const X = ml + i * cell;
    const strong = grid && mod(plane(u0, du, i), 10) === 0;
    if (gridA || strong) cv.line(X, mt, X, mt + gh * cell, [0, 0, 0], strong ? 0.25 : gridA);
  }
  for (let j = 0; j <= gh; j++) {
    const Y = mt + j * cell;
    const strong = grid && mod(plane(v0, dv, j), 10) === 0;
    if (gridA || strong) cv.line(ml, Y, ml + gw * cell, Y, [0, 0, 0], strong ? 0.25 : gridA);
  }
  // label cells whose real coordinate is a multiple of `tick` (plus the first cell if no label is near it)
  const tick = Math.max(1, Math.ceil(30 / cell / 5) * 5);
  const near = Math.max(1, Math.ceil(24 / cell));
  const labelled = (start, dir, n) => {
    const out = [];
    for (let i = 0; i < n; i++) if (mod(start + dir * i, tick) === 0) out.push(i);
    if (!out.length || out[0] >= near) out.unshift(0);
    return out;
  };
  for (const i of labelled(u0, du, gw)) cv.text(String(u0 + du * i), ml + i * cell + cell / 2, mt + gh * cell + 5, [90, 90, 100], 1, { align: 'center' });
  // vertical axis: label from the bottom row (lowest y / southern-most z) so the base is always marked
  const vb = gh - 1, vStart = v0 + dv * vb;
  for (const k of labelled(vStart, -dv, gh)) {
    const j = vb - k;
    cv.text(String(v0 + dv * j), ml - 4, mt + j * cell + cell / 2 - 3, [90, 90, 100], 1, { align: 'right' });
  }
  return { canvas: cv, cell, grid: [gw, gh], margins: { ml, mt } };
}

// ───────────────────────────── public API ─────────────────────────────

const BG_ISO = [178, 206, 234];
const BG_PANEL = [238, 240, 244];
// Clockwise quarter turns that bring the requested corner to the south-east (where the iso camera sits).
const ISO_ROT = { iso: 0, 'iso-se': 0, 'iso-ne': 1, 'iso-nw': 2, 'iso-sw': 3 };

function emptyImage(text = 'EMPTY') {
  const cv = new Canvas(160, 60, BG_PANEL);
  cv.text(text, 80, 26, [120, 120, 130], 1, { align: 'center' });
  return cv;
}

/** Area-average downscale so the longest side is ≤ maxSize (a no-op when it already fits). */
function fitCanvas(cv, maxSize) {
  const f = maxSize / Math.max(cv.w, cv.h);
  if (!(f < 1)) return cv;
  const W = Math.max(1, Math.floor(cv.w * f)), H = Math.max(1, Math.floor(cv.h * f));
  const sx = cv.w / W, sy = cv.h / H;
  const out = new Canvas(W, H);
  const src = cv.data, dst = out.data;
  // separable box filter: per-axis source spans with fractional edge weights
  const spans = (n, s, limit) => Array.from({ length: n }, (_, i) => {
    const a = i * s, b = Math.min(limit, (i + 1) * s), w = [];
    for (let k = Math.floor(a); k < Math.ceil(b); k++) w.push([k, Math.min(b, k + 1) - Math.max(a, k)]);
    return w;
  });
  const xs = spans(W, sx, cv.w), ys = spans(H, sy, cv.h);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, t = 0;
      for (const [yy, wy] of ys[y]) {
        for (const [xx, wx] of xs[x]) {
          const w = wx * wy, i = (yy * cv.w + xx) * 4;
          r += src[i] * w; g += src[i + 1] * w; b += src[i + 2] * w; t += w;
        }
      }
      const o = (y * W + x) * 4;
      dst[o] = r / t; dst[o + 1] = g / t; dst[o + 2] = b / t; dst[o + 3] = 255;
    }
  }
  return out;
}

/** `background` option → [r,g,b] (accepts [r,g,b] or "#rrggbb"). */
function parseColor(c) {
  if (Array.isArray(c) && c.length >= 3 && c.slice(0, 3).every((v) => Number.isFinite(Number(v)))) {
    return c.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))));
  }
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c).trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  throw new TypeError(`background must be [r,g,b] or "#rrggbb", got ${JSON.stringify(c)}`);
}

/**
 * @param {import('../core/structure.js').Structure} structure
 * @param {{ view?: string, maxSize?: number, title?: string, scale?: number, background?: number[]|string,
 *           showGrid?: boolean, cutaway?: { y?: number } }} [opts]
 *   background  colour behind the structure (every panel and the sheet page)
 *   showGrid    false hides the block grid / 10-block lines (default true)
 *   cutaway.y   drop everything above this structure y (floor plans, interiors)
 */
export function renderPreview(structure, opts = {}) {
  const view = (opts.view ?? 'sheet').toLowerCase();
  const maxSize = Math.max(16, Math.floor(opts.maxSize ?? 1600));
  const custom = opts.background != null ? parseColor(opts.background) : null;
  const grid = opts.showGrid !== false;
  const cutY = Number.isFinite(opts.cutaway?.y) ? Math.floor(opts.cutaway.y) : Infinity;
  let cv;
  if (view in ISO_ROT) {
    const turns = ISO_ROT[view];
    const r = renderIso(structure, { maxW: maxSize, maxH: maxSize, bg: custom ?? BG_ISO, scale: opts.scale, turns, cutY, grid });
    cv = r ? r.canvas : emptyImage();
  } else if (view in VIEWS) {
    const r = renderOrtho(structure, view, { maxW: maxSize, maxH: maxSize, bg: custom ?? BG_PANEL, scale: opts.scale, cutY, grid, plotTint: !custom });
    cv = r ? r.canvas : emptyImage();
    if (r) compass(cv, view);
  } else if (view === 'sheet') {
    cv = renderSheet(structure, { maxSize, title: opts.title ?? structure.name, custom, cutY, grid });
  } else {
    throw new Error(`Unknown view "${opts.view}" (sheet|iso|iso-ne|iso-nw|iso-sw|top|south|north|east|west)`);
  }
  // an explicit scale is honoured as asked; otherwise the longest side never exceeds maxSize
  if (opts.scale == null) cv = fitCanvas(cv, maxSize);
  return { png: cv.png(), width: cv.w, height: cv.h, view };
}

function compass(cv, view) {
  const t = { top: 'N ↑', south: 'FROM SOUTH →E', north: 'FROM NORTH →W', east: 'FROM EAST →N', west: 'FROM WEST →S' }[view];
  if (t) cv.text(t, cv.w - 4, 2, [60, 60, 120], 1, { align: 'right' });
}

function renderSheet(structure, { maxSize, title, custom = null, cutY = Infinity, grid = true }) {
  const full = collect(structure);
  if (!full) return emptyImage();
  const cut = Number.isFinite(cutY);
  const c = cut ? collect(structure, cutY) : full;
  if (!c) return emptyImage(`NOTHING AT Y<=${cutY}`);
  const header = 30;
  const totalW = Math.min(maxSize, 1600);
  const isoMax = Math.round(totalW * 0.64);
  const iso = renderIso(structure, { maxW: isoMax, maxH: isoMax, bg: custom ?? BG_ISO, cutY, grid, c });
  // TOP / SOUTH / EAST share one scale (pixels per block) sized to fill the right-hand column
  const [W0, H0, D0] = c.size;
  const { ml, mt, mr, mb } = ORTHO_MARGINS;
  const colW = Math.max(160, totalW - iso.canvas.w - 12);
  const colH = Math.max(iso.canvas.h + 10, 480);
  const cell = Math.max(1, Math.min(24, Math.floor(Math.min(
    (colH - 3 * (mt + mb + 16)) / (D0 + 2 * H0),
    (colW - ml - mr) / Math.max(W0, D0),
  ))));
  const views = [['top', 'TOP (NORTH UP)'], ['south', 'SOUTH ELEVATION (FRONT)'], ['east', 'EAST ELEVATION']];
  const panels = views.map(([v, cap]) => {
    const r = renderOrtho(structure, v, { scale: cell, bg: custom ?? BG_PANEL, cutY, grid, plotTint: !custom, c });
    if (v === 'top') compass(r.canvas, 'top');
    return { r, cap };
  });
  const rightW = Math.max(...panels.map((p) => p.r.canvas.w), 200);
  const rightH = panels.reduce((h, p) => h + p.r.canvas.h + 16, 0);
  const W = iso.canvas.w + 8 + rightW + 4;
  const H = header + Math.max(iso.canvas.h + 14, rightH + 4);
  const cv = new Canvas(Math.max(W, 520), H, custom ?? [250, 250, 252]);
  // header (size and block count describe the whole structure, even with a cutaway)
  cv.rect(0, 0, cv.w, header, [40, 46, 58]);
  const [sx, sy, sz] = full.size;
  cv.text(`${title ?? 'structure'}`, 10, 8, [255, 255, 255], 2);
  const info = `${sx}×${sy}×${sz} (W×H×D)  ${full.n} BLOCKS  FRONT = SOUTH${cut ? `  CUT ABOVE Y=${cutY}` : ''}`;
  cv.text(info, cv.w - 10, 11, cut ? [255, 205, 120] : [200, 210, 225], 1, { align: 'right' });
  // iso
  cv.text('ISO VIEW FROM SOUTH-EAST', 8, header + 4, [70, 70, 90]);
  cv.paste(iso.canvas, 0, header + 14);
  // right column
  const rx = iso.canvas.w + 8;
  let y = header + 4;
  for (const { r, cap } of panels) {
    cv.text(cap, rx + 2, y, [70, 70, 90]);
    cv.paste(r.canvas, rx, y + 10);
    y += r.canvas.h + 16;
  }
  return cv;
}

export { Canvas };
