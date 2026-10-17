import { materialFamily, stairs, slab, finish } from './helpers.js';

/** Bridge spanning along X; its deck ends meet the ground at y = 0 (stairs ramp onto the deck). */
export default {
  name: 'bridge',
  description: 'Bridge along X: stone arch, beam with piers, or suspension with towers and cables; railings and lanterns. The deck is at y=0 (bank level) and the structure reaches `clearance` blocks below it — place it across a river or gap',
  params: {
    length: { type: 'int', default: 24, min: 6, max: 256, description: 'span along X' },
    width: { type: 'int', default: 5, min: 3, max: 24, description: 'deck width incl. railings' },
    material: { type: 'block', default: 'stone_bricks', description: 'structure (arch ring, piers, towers)' },
    deck: { type: 'block', default: 'spruce_planks', description: 'walking surface' },
    style: { type: 'enum', values: ['arch', 'beam', 'suspension'], default: 'arch', description: 'structural type' },
    clearance: { type: 'int', default: 0, min: 0, max: 64, description: 'depth below the deck (0 = auto)' },
    railings: { type: 'bool', default: true, description: 'railings on both edges' },
    lights: { type: 'bool', default: true, description: 'lanterns along the railings' },
  },
  build(s, p) {
    const L = p.length, W = p.width;
    const mat = p.material, fam = materialFamily(mat);
    const deckFam = materialFamily(p.deck);
    // deck surface
    s.fill(0, 0, 0, L - 1, 0, W - 1, mat);
    if (W > 2) s.fill(0, 0, 1, L - 1, 0, W - 2, p.deck);
    // ramps at both ends so you can walk on from the ground
    for (let z = W > 2 ? 1 : 0; z <= (W > 2 ? W - 2 : W - 1); z++) {
      s.set(0, 0, z, deckFam.stairs ? stairs(p.deck, 'east') : slab(p.deck));
      s.set(L - 1, 0, z, deckFam.stairs ? stairs(p.deck, 'west') : slab(p.deck));
    }

    if (p.style === 'arch') archUnder(s, p, fam);
    else if (p.style === 'beam') beamUnder(s, p);
    else suspension(s, p);

    // railings + lanterns
    if (p.railings) {
      const rail = p.style === 'suspension' ? 'iron_bars' : p.style === 'beam' ? deckFam.fence ?? 'spruce_fence' : fam.wall ?? deckFam.fence ?? 'spruce_fence';
      for (const z of [0, W - 1]) {
        for (let x = 1; x < L - 1; x++) if (s.get(x, 1, z) == null) s.set(x, 1, z, rail);
      }
      if (p.lights) {
        const step = Math.max(4, Math.round(L / Math.max(2, Math.round(L / 8))));
        for (let x = Math.floor(step / 2); x < L - 1; x += step) {
          for (const z of [0, W - 1]) {
            if (/_wall$|_fence$/.test(s.get(x, 1, z) ?? '')) s.set(x, 2, z, 'lantern[hanging=false]');
          }
        }
      }
    }
    finish(s);
  },
};

function archUnder(s, p, fam) {
  const L = p.length, W = p.width, mat = p.material;
  const rise = p.clearance || Math.max(3, Math.min(12, Math.floor(L / 2) - 2));
  const abut = Math.max(1, Math.min(3, Math.floor(L / 10)));
  const xc = L / 2, ax = L / 2 - abut, ay = rise - 1;
  const opening = (x, y) => {
    if (x < abut || x > L - 1 - abut || y < -rise) return false;
    const u = (x + 0.5 - xc) / ax, v = (y + 0.5 + rise) / ay;
    return u * u + v * v < 1;
  };
  const solid = (x, y) => x >= 0 && x < L && y >= -rise && y <= -1 && !opening(x, y);
  const st = fam.stairs ? mat : null;
  for (let x = 0; x < L; x++) {
    for (let y = -rise; y <= -1; y++) {
      let b = null;
      if (solid(x, y)) b = mat;
      else if (st && opening(x, y) && solid(x, y + 1)) {
        const out = x + 0.5 < xc ? -1 : 1;
        if (solid(x + out, y) && !solid(x - out, y)) b = stairs(st, out < 0 ? 'west' : 'east', 'top');
      }
      if (b) s.fill(x, y, 0, x, y, p.width - 1, b);
    }
  }
  // voussoir ring + keystone on both faces
  const ch = fam.chiseled;
  for (const z of [0, W - 1]) {
    for (let x = 0; x < L; x++) for (let y = -rise; y <= -1; y++) {
      if (!solid(x, y)) continue;
      const nearOpening = opening(x - 1, y) || opening(x + 1, y) || opening(x, y - 1);
      if (nearOpening && y > -rise + 1 && fam.variants.length) s.set(x, y, z, fam.variants[0]);
    }
    if (ch) s.set(Math.floor((L - 1) / 2), -1, z, ch);
    if (ch && L % 2 === 0) s.set(L / 2, -1, z, ch);
  }
}

function beamUnder(s, p) {
  const L = p.length, W = p.width, mat = p.material;
  const depth = p.clearance || 5;
  s.fill(0, -1, 0, L - 1, -1, 0, mat);
  s.fill(0, -1, W - 1, L - 1, -1, W - 1, mat);
  const n = Math.max(1, Math.round((L - 1) / 8));
  for (let i = 0; i <= n; i++) {
    const x = Math.round((i * (L - 1)) / n);
    s.fill(x, -1, 0, x, -1, W - 1, mat); // cross beam
    for (const z of [0, W - 1]) s.fill(x, -depth, z, x, -2, z, materialFamily(mat).pillar ? `${materialFamily(mat).pillar}[axis=y]` : mat);
    if (i > 0 && i < n) {
      // diagonal braces from the pier to the girder
      for (const z of [0, W - 1]) {
        for (const dir of [-1, 1]) {
          const fam = materialFamily(mat);
          if (fam.stairs) s.set(x + dir, -2, z, stairs(mat, dir < 0 ? 'east' : 'west', 'top'));
        }
      }
    }
  }
}

function suspension(s, p) {
  const L = p.length, W = p.width, mat = p.material;
  const depth = p.clearance || 6;
  const t1 = Math.max(2, Math.round(L * 0.18)), t2 = L - 1 - t1;
  const TH = Math.max(8, Math.round(L / 3));
  const zs = [-1, W];
  // deck girders and the towers
  s.fill(0, -1, 0, L - 1, -1, W - 1, mat);
  for (const tx of [t1, t2]) {
    for (const z of zs) s.fill(tx, -depth, z, tx, TH, z, mat);
    s.fill(tx, TH, -1, tx, TH, W, mat);
    s.fill(tx, TH - 3, -1, tx, TH - 3, W, mat);
    s.fill(tx, -1, -1, tx, -1, W, mat);
    for (const z of zs) s.set(tx, TH + 1, z, 'lantern[hanging=false]');
  }
  // main cables: parabola between the towers, straight backstays to the deck ends
  const xm = (t1 + t2) / 2, half = (t2 - t1) / 2;
  const cableY = (x) => {
    if (x < t1) return 1 + ((TH - 1) * x) / t1;
    if (x > t2) return 1 + ((TH - 1) * (L - 1 - x)) / (L - 1 - t2);
    const u = (x - xm) / half;
    return 2 + (TH - 2) * u * u;
  };
  for (const z of zs) {
    for (let x = 0; x < L; x++) {
      if (x === t1 || x === t2) continue;
      const y0 = Math.round(cableY(x));
      const y1 = Math.round(cableY(x + (x < xm ? 1 : -1)));
      const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
      const top = hi > lo ? hi - 1 : lo;
      for (let y = Math.min(lo, y0); y <= Math.max(top, y0); y++) s.set(x, y, z, hi - lo > 1 ? 'iron_chain[axis=y]' : 'iron_chain[axis=x]');
      // vertical hangers every 2 blocks between the towers
      if (x > t1 && x < t2 && x % 2 === 0) for (let y = 1; y < Math.min(lo, y0); y++) s.set(x, y, z, 'iron_chain[axis=y]');
    }
  }
}
