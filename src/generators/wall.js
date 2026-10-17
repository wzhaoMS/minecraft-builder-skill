import { materialFamily, slab, finish } from './helpers.js';

/** Straight wall — compatible with the v1 blueprint generator ({ width, height, material }). */
export default {
  name: 'wall',
  description: 'Straight wall along X (front faces south), optional crenellations and pillars',
  params: {
    width: { type: 'int', default: 10, min: 1, max: 512, description: 'length along X' },
    height: { type: 'int', default: 5, min: 1, max: 256, description: 'height' },
    material: { type: 'block', default: 'white_concrete', description: 'wall block' },
    thickness: { type: 'int', default: 1, min: 1, max: 8, description: 'thickness along Z' },
    crenellations: { type: 'bool', default: false, description: 'battlements (merlons) along the top' },
    pillarEvery: { type: 'int', default: 0, min: 0, max: 64, description: 'pillar every N blocks (0 = none)' },
    pillar: { type: 'block', default: '', description: 'pillar block (default: the material\'s chiseled/pillar variant or the material)' },
  },
  build(s, p) {
    const W = p.width, H = p.height, T = p.thickness;
    s.fill(0, 0, 0, W - 1, H - 1, T - 1, p.material);
    if (p.pillarEvery > 0) {
      const fam = materialFamily(p.material);
      const pil = p.pillar || fam.pillar || fam.chiseled || p.material;
      for (let x = 0; x < W; x += p.pillarEvery) {
        s.fill(x, 0, -1, x, H - 1, T, pil);
        if (fam.slab) { s.set(x, H, -1, slab(p.material)); s.set(x, H, T, slab(p.material)); }
      }
      if ((W - 1) % p.pillarEvery !== 0) s.fill(W - 1, 0, -1, W - 1, H - 1, T, pil);
    }
    if (p.crenellations) {
      for (let x = 0; x < W; x++) {
        if (x % 2 === 0 || x === W - 1) s.fill(x, H, 0, x, H, T - 1, p.material);
      }
    }
    finish(s);
  },
};
