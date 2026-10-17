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
    pillarDepth: { type: 'int', default: 1, min: 0, max: 3, description: 'how far pillars stick out on each side; this makes the wall thickness+2×pillarDepth deep with its face moved back by pillarDepth — 0 keeps pillars flush (lines up with other walls)' },
  },
  build(s, p) {
    const W = p.width, H = p.height, T = p.thickness, D = p.pillarDepth;
    s.fill(0, 0, 0, W - 1, H - 1, T - 1, p.material);
    if (p.pillarEvery > 0) {
      const fam = materialFamily(p.material);
      const pil = p.pillar || fam.pillar || fam.chiseled || p.material;
      const pillarAt = (x) => {
        s.fill(x, 0, -D, x, H - 1, T - 1 + D, pil);
        if (D > 0 && fam.slab) { s.set(x, H, -D, slab(p.material)); s.set(x, H, T - 1 + D, slab(p.material)); }
      };
      for (let x = 0; x < W; x += p.pillarEvery) pillarAt(x);
      if ((W - 1) % p.pillarEvery !== 0) pillarAt(W - 1);
    }
    if (p.crenellations) {
      for (let x = 0; x < W; x++) {
        if (x % 2 === 0 || x === W - 1) s.fill(x, H, 0, x, H, T - 1, p.material);
      }
    }
    finish(s);
  },
};
