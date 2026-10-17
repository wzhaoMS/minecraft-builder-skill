import { materialFamily, stairs, slab, withAxis, finish } from './helpers.js';

/** Obelisk / monument: stepped plinth, tall square shaft with bands, pyramidion and a capstone. */
export default {
  name: 'obelisk',
  description: 'Obelisk monument: stepped plinth, tapering square shaft with bands, pyramidion top',
  params: {
    height: { type: 'int', default: 18, min: 6, max: 128, description: 'total height' },
    width: { type: 'int', default: 3, min: 1, max: 9, description: 'shaft width (odd numbers look best)' },
    material: { type: 'block', default: 'quartz_block', description: 'stone (quartz_block, sandstone, polished_blackstone, …)' },
    accent: { type: 'block', default: 'gold_block', description: 'capstone' },
  },
  build(s, p) {
    const w = p.width, H = p.height, fam = materialFamily(p.material);
    const pw = w + 4; // plinth
    const c = Math.floor(pw / 2);
    const half = Math.floor(w / 2);
    // stepped plinth: two courses with stair edges
    s.fill(0, 0, 0, pw - 1, 0, pw - 1, p.material);
    s.fill(1, 1, 1, pw - 2, 1, pw - 2, fam.chiseled ?? p.material);
    if (fam.stairs) {
      for (let i = 1; i < pw - 1; i++) {
        s.set(i, 1, 0, stairs(p.material, 'south')); s.set(i, 1, pw - 1, stairs(p.material, 'north'));
        s.set(0, 1, i, stairs(p.material, 'east')); s.set(pw - 1, 1, i, stairs(p.material, 'west'));
      }
    }
    // shaft (slightly narrower in the top third for wide obelisks)
    const shaftTop = H - 3;
    for (let y = 2; y <= shaftTop; y++) {
      const t = w >= 5 && y > 2 + (shaftTop - 2) * 0.66 ? 1 : 0;
      const band = (y - 2) % 6 === 5 && fam.chiseled;
      for (let dx = -half + t; dx <= half - t; dx++) for (let dz = -half + t; dz <= half - t; dz++) {
        s.set(c + dx, y, c + dz, band ? fam.chiseled : fam.pillar ? withAxis(fam.pillar, 'y') : p.material);
      }
    }
    // pyramidion
    const tw = w >= 5 ? half - 1 : half;
    let y = shaftTop + 1;
    for (let r = tw; r >= 1; r--, y++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const edge = Math.abs(dx) === r || Math.abs(dz) === r;
        const f = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'west' : 'east') : dz > 0 ? 'north' : 'south';
        s.set(c + dx, y, c + dz, edge && fam.stairs ? stairs(p.material, f) : p.material);
      }
    }
    s.set(c, y, c, p.accent);
    if (materialFamily(p.accent).slab) s.set(c, y + 1, c, slab(p.accent));
    finish(s);
  },
};
