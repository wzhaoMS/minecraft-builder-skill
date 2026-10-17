/**
 * Natural-looking trees: organic multi-lobed canopies (no cubes), branches with correctly oriented
 * logs, persistent leaves. Deterministic for a given seed.
 */
const TYPES = ['oak', 'birch', 'spruce', 'jungle', 'acacia', 'dark_oak', 'cherry', 'pale_oak', 'mangrove', 'azalea'];

export default {
  name: 'tree',
  description: 'Natural tree: oak, birch, spruce, jungle, acacia, dark_oak, cherry, pale_oak, mangrove, azalea',
  params: {
    type: { type: 'enum', values: TYPES, default: 'oak', description: 'species' },
    height: { type: 'int', default: 0, min: 0, max: 48, description: 'trunk height (0 = natural for the species, randomised by seed)' },
  },
  build(s, p, ctx) {
    buildTree(s, 0, 0, 0, { type: p.type, height: p.height }, ctx.rng);
  },
};

/** Log block for a species with an axis. */
function logOf(type, axis = 'y') {
  const n = type === 'azalea' ? 'oak_log' : `${type}_log`;
  return `${n}[axis=${axis}]`;
}
function leavesOf(type) {
  if (type === 'azalea') return 'azalea_leaves[persistent=true]';
  return `${type}_leaves[persistent=true]`;
}

/**
 * Grow a tree with its trunk base at (x, y, z).
 * @param {import('../core/structure.js').Structure} s
 * @param {{ type?: string, height?: number }} opts
 * @param {(() => number) & { int: Function, pick: Function, chance: Function, range: Function }} rng
 */
export function buildTree(s, x, y, z, { type = 'oak', height = 0 } = {}, rng) {
  const T = new TreeBuilder(s, x, y, z, type, rng);
  switch (type) {
    case 'birch': T.birch(height); break;
    case 'spruce': T.spruce(height); break;
    case 'jungle': T.jungle(height); break;
    case 'acacia': T.acacia(height); break;
    case 'dark_oak': T.darkOak(height, 'dark_oak'); break;
    case 'pale_oak': T.darkOak(height, 'pale_oak'); break;
    case 'cherry': T.cherry(height); break;
    case 'mangrove': T.mangrove(height); break;
    case 'azalea': T.azalea(height); break;
    default: T.oak(height);
  }
  return s;
}

class TreeBuilder {
  constructor(s, x, y, z, type, rng) {
    this.s = s; this.x = x; this.y = y; this.z = z; this.type = type; this.rng = rng;
    this.leaf = leavesOf(type);
  }

  log(dx, dy, dz, axis = 'y', type = this.type) { this.s.set(this.x + dx, this.y + dy, this.z + dz, logOf(type, axis)); }

  /** Leaves only where nothing else is (never replaces logs). */
  leafAt(dx, dy, dz, block = this.leaf) {
    const X = this.x + dx, Y = this.y + dy, Z = this.z + dz;
    if (this.s.get(X, Y, Z) == null) this.s.set(X, Y, Z, block);
  }

  /** Face-connected log path from a to b; each segment's axis follows its direction. */
  branch(a, b, type = this.type) {
    let [x, y, z] = a;
    const [tx, ty, tz] = b;
    const n = Math.max(Math.abs(tx - x), Math.abs(ty - y), Math.abs(tz - z));
    let px = x, py = y, pz = z;
    this.log(x, y, z, 'y', type);
    for (let i = 1; i <= n; i++) {
      const nx = Math.round(a[0] + ((tx - a[0]) * i) / n), ny = Math.round(a[1] + ((ty - a[1]) * i) / n), nz = Math.round(a[2] + ((tz - a[2]) * i) / n);
      // step one axis at a time so logs touch face-to-face
      const steps = [['x', nx - px], ['y', ny - py], ['z', nz - pz]].filter(([, d]) => d !== 0);
      for (const [ax, d] of steps) {
        if (ax === 'x') px += d; else if (ax === 'y') py += d; else pz += d;
        this.log(px, py, pz, ax, type);
      }
    }
    return [px, py, pz];
  }

  /** Noisy ellipsoid of leaves (centre may be fractional, e.g. 0.5 over a 2×2 trunk). */
  blob(cx, cy, cz, rx, ry, rz, { density = 1, flatBottom = false } = {}) {
    for (let Y = Math.floor(cy - ry - 1); Y <= Math.ceil(cy + ry + 1); Y++) {
      if (flatBottom && Y < cy - 1) continue;
      for (let Z = Math.floor(cz - rz - 1); Z <= Math.ceil(cz + rz + 1); Z++) {
        for (let X = Math.floor(cx - rx - 1); X <= Math.ceil(cx + rx + 1); X++) {
          const dx = X - cx, dy = Y - cy, dz = Z - cz;
          const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rz * rz);
          if (d > 1.15) continue;
          // ragged edges: the outer shell is randomly thinned
          if (d > 0.55 && this.rng() > density * (1.25 - d)) continue;
          this.leafAt(X, Y, Z);
        }
      }
    }
  }

  /** Flat disc of leaves (acacia, spruce layers) with clipped corners. */
  disc(cx, cy, cz, r, { ragged = 0.25 } = {}) {
    const R = Math.ceil(r);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > r + 0.3) continue;
      if (d > r - 0.7 && this.rng() < ragged) continue;
      this.leafAt(cx + dx, cy, cz + dz);
    }
  }

  trunk(h, { thick = false } = {}) {
    for (let i = 0; i < h; i++) {
      this.log(0, i, 0);
      if (thick) { this.log(1, i, 0); this.log(0, i, 1); this.log(1, i, 1); }
    }
  }

  angles(n) {
    const base = this.rng() * Math.PI * 2;
    return Array.from({ length: n }, (_, i) => base + (i * Math.PI * 2) / n + (this.rng() - 0.5) * 0.9);
  }

  oak(height) {
    const h = height || this.rng.int(5, 7);
    this.trunk(h);
    const nb = this.rng.int(2, 4);
    for (const a of this.angles(nb)) {
      const sy = this.rng.int(Math.max(2, h - 3), h - 1);
      const len = this.rng.int(2, 3);
      const end = this.branch([0, sy, 0], [Math.round(Math.cos(a) * len), sy + this.rng.int(1, 2), Math.round(Math.sin(a) * len)]);
      this.blob(end[0], end[1] + 1, end[2], this.rng.range(2.4, 3.0), this.rng.range(1.8, 2.2), this.rng.range(2.4, 3.0));
    }
    this.blob(0, h + 1, 0, this.rng.range(2.8, 3.3), 2.5, this.rng.range(2.8, 3.3));
    this.log(0, h, 0);
  }

  birch(height) {
    const h = height || this.rng.int(6, 9);
    this.trunk(h);
    this.blob(0, h - 1, 0, 2.1, 3.0, 2.1, { density: 1.1 });
    this.blob(0, h + 1, 0, 1.4, 1.4, 1.4);
    // a couple of small side tufts
    for (const a of this.angles(2)) {
      const yy = h - this.rng.int(2, 3);
      this.blob(Math.round(Math.cos(a) * 2), yy, Math.round(Math.sin(a) * 2), 1.4, 1.2, 1.4);
    }
  }

  spruce(height) {
    const h = height || this.rng.int(10, 15);
    this.trunk(h);
    const start = this.rng.int(2, 3);
    const maxR = Math.min(4.2, 1.6 + h * 0.2);
    // layered cone: alternating wide and narrow whorls
    for (let yy = start; yy <= h; yy++) {
      const t = (yy - start) / Math.max(1, h - start);
      let r = maxR * (1 - t) + 0.6;
      if ((h - yy) % 2 === 1) r *= 0.62;
      this.disc(0, yy, 0, r, { ragged: 0.18 });
    }
    this.leafAt(0, h + 1, 0);
    this.leafAt(0, h + 2, 0);
  }

  jungle(height) {
    const h = height || this.rng.int(14, 20);
    this.trunk(h, { thick: true });
    // buttress roots
    for (const [dx, dz] of [[-1, 0], [2, 1], [0, 2], [1, -1]]) if (this.rng.chance(0.75)) this.log(dx, 0, dz);
    // side branches with their own crowns
    for (const a of this.angles(3)) {
      const sy = this.rng.int(Math.floor(h * 0.55), h - 3);
      const ox = Math.cos(a) > 0 ? 1 : 0, oz = Math.sin(a) > 0 ? 1 : 0;
      const len = this.rng.int(3, 4);
      const end = this.branch([ox, sy, oz], [ox + Math.round(Math.cos(a) * len), sy + 2, oz + Math.round(Math.sin(a) * len)]);
      this.blob(end[0], end[1] + 1, end[2], 2.6, 1.6, 2.6);
    }
    this.blob(0.5, h + 1, 0.5, 4.6, 2.4, 4.6, { flatBottom: true });
    // vines down the trunk and cocoa pods
    for (let i = 2; i < h - 2; i++) {
      if (this.rng.chance(0.35)) this.leafAt(-1, i, 0, 'vine[east=true]');
      if (this.rng.chance(0.35)) this.leafAt(2, i, 1, 'vine[west=true]');
      if (this.rng.chance(0.3)) this.leafAt(0, i, 2, 'vine[north=true]');
    }
    if (this.rng.chance(0.8)) this.leafAt(1, this.rng.int(3, 6), -1, 'cocoa[age=2,facing=south]');
  }

  acacia(height) {
    const h = height || this.rng.int(5, 7);
    const lean = this.rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    const bend = this.rng.int(2, 3);
    this.trunk(bend);
    // main leaning stem
    let top = [0, bend - 1, 0];
    for (let i = 0; i < h - bend; i++) {
      const diag = i < 3;
      const next = [top[0] + (diag ? lean[0] : 0), top[1] + 1, top[2] + (diag ? lean[1] : 0)];
      top = this.branch(top, next);
    }
    this.disc(top[0], top[1] + 1, top[2], 3.2, { ragged: 0.2 });
    this.disc(top[0], top[1] + 2, top[2], 1.8, { ragged: 0.15 });
    // fork in the other direction
    const other = [-lean[0] || this.rng.pick([-1, 1]), -lean[1] || this.rng.pick([-1, 1])];
    const fy = bend + this.rng.int(0, 1);
    const fend = this.branch([0, fy - 1, 0], [other[0] * 3, fy + 2, other[1] * 3]);
    this.disc(fend[0], fend[1] + 1, fend[2], 2.6, { ragged: 0.2 });
    this.disc(fend[0], fend[1] + 2, fend[2], 1.4, { ragged: 0.1 });
  }

  darkOak(height, type) {
    const h = height || this.rng.int(6, 8);
    this.type = type;
    this.leaf = leavesOf(type);
    this.trunk(h, { thick: true });
    for (const a of this.angles(4)) {
      const ox = Math.cos(a) > 0 ? 1 : 0, oz = Math.sin(a) > 0 ? 1 : 0;
      const sy = this.rng.int(h - 3, h - 1);
      const end = this.branch([ox, sy, oz], [ox + Math.round(Math.cos(a) * 3), sy + 1, oz + Math.round(Math.sin(a) * 3)]);
      this.blob(end[0], end[1] + 1, end[2], 2.4, 1.6, 2.4);
    }
    this.blob(0.5, h + 1, 0.5, 4.2, 2.3, 4.2, { flatBottom: true });
    if (type === 'pale_oak') {
      // pale moss hanging below the canopy
      for (let dx = -7; dx <= 8; dx++) for (let dz = -7; dz <= 8; dz++) {
        for (let dy = h + 4; dy >= 3; dy--) {
          const X = this.x + dx, Y = this.y + dy, Z = this.z + dz;
          if (this.s.get(X, Y, Z) !== this.leaf || this.s.get(X, Y - 1, Z) != null) continue;
          if (!this.rng.chance(0.18)) continue;
          const len = this.rng.int(1, 3);
          for (let i = 1; i <= len; i++) {
            if (Y - i <= this.y + 1) break;
            const last = i === len || this.s.get(X, Y - i - 1, Z) != null;
            this.s.set(X, Y - i, Z, `pale_hanging_moss[tip=${last ? 'true' : 'false'}]`);
            if (last) break;
          }
        }
      }
    }
  }

  cherry(height) {
    const h = height || this.rng.int(4, 5);
    this.trunk(h);
    for (const a of this.angles(this.rng.int(2, 3))) {
      const len = this.rng.int(3, 4);
      const end = this.branch([0, h - 1, 0], [Math.round(Math.cos(a) * len), h + this.rng.int(1, 3), Math.round(Math.sin(a) * len)]);
      this.blob(end[0], end[1] + 1, end[2], 3.0, 1.8, 3.0, { density: 1.05 });
      // drooping fringe
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 2.2 && d < 3.2 && this.rng.chance(0.35)) this.leafAt(end[0] + dx, end[1], end[2] + dz);
      }
    }
    this.blob(0, h + 2, 0, 2.4, 1.6, 2.4);
  }

  mangrove(height) {
    const lift = 3;
    const h = height || this.rng.int(6, 8);
    for (let i = lift; i < lift + h; i++) this.log(0, i, 0);
    // arching prop roots from the trunk base down to the ground
    for (const a of this.angles(this.rng.int(4, 6))) {
      const dx = Math.round(Math.cos(a) * 2.6), dz = Math.round(Math.sin(a) * 2.6);
      const mx = Math.round(dx / 2), mz = Math.round(dz / 2);
      for (const [px, py, pz] of [[0, lift - 1, 0], [mx, lift - 1, mz], [mx, lift - 2, mz], [dx, lift - 2, dz], [dx, 1, dz], [dx, 0, dz]]) {
        const X = this.x + px, Y = this.y + py, Z = this.z + pz;
        if (this.s.get(X, Y, Z) == null) this.s.set(X, Y, Z, 'mangrove_roots');
      }
      for (let yy = 0; yy < lift - 2; yy++) this.leafAt(dx, yy, dz, 'mangrove_roots');
    }
    const top = lift + h;
    for (const a of this.angles(2)) {
      const end = this.branch([0, top - 2, 0], [Math.round(Math.cos(a) * 2), top, Math.round(Math.sin(a) * 2)]);
      this.blob(end[0], end[1] + 1, end[2], 2.4, 1.7, 2.4);
    }
    this.blob(0, top + 1, 0, 3.0, 2.0, 3.0);
  }

  azalea(height) {
    const h = height || this.rng.int(3, 4);
    this.trunk(h);
    this.s.set(this.x, this.y - 1, this.z, 'rooted_dirt');
    const flowering = 'flowering_azalea_leaves[persistent=true]';
    const R = 2.6;
    for (let dy = -1; dy <= 1; dy++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const d = (dx * dx + dz * dz) / (R * R) + (dy * dy) / 2.2;
      if (d > 1 || (d > 0.6 && this.rng.chance(0.35))) continue;
      this.leafAt(dx, h + dy, dz, this.rng.chance(0.35) ? flowering : this.leaf);
    }
    this.leafAt(0, h + 2, 0);
  }
}
