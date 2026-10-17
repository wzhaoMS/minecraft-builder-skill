import { materialFamily, stairs, slab, dirFromDelta, fixStairShapes } from './helpers.js';

/**
 * Pyramid — compatible with the v1 blueprint generator ({ height, material }).
 * Classic: one-block steps (smoothed with stairs when the material has them).
 * stepped: a Mesoamerican step pyramid with terraces, a south staircase and a temple on top.
 */
export default {
  name: 'pyramid',
  description: 'Pyramid: classic (stair-smoothed when possible) or stepped temple pyramid with a south staircase',
  params: {
    height: { type: 'int', default: 12, min: 2, max: 128, description: 'number of layers (base width = 2*height-1)' },
    material: { type: 'block', default: 'gold_block', description: 'block to build with (sandstone, stone_bricks, quartz… have stairs for smooth faces)' },
    hollow: { type: 'bool', default: true, description: 'hollow shell with a floor' },
    smooth: { type: 'bool', default: true, description: 'classic pyramid: stairs on the faces when the material has stairs' },
    stepped: { type: 'bool', default: false, description: 'Mesoamerican step pyramid with terraces, staircase and temple' },
  },
  build(s, p) {
    if (p.stepped) return steppedPyramid(s, p);
    const h = p.height, c = h - 1;
    const useStairs = p.smooth && !!materialFamily(p.material).stairs;
    for (let y = 0; y < h; y++) {
      const w = c - y;
      for (let z = c - w; z <= c + w; z++) {
        for (let x = c - w; x <= c + w; x++) {
          const ring = Math.abs(x - c) === w || Math.abs(z - c) === w;
          if (p.hollow && !ring && y > 0) continue;
          let b = p.material;
          if (ring && useStairs && w > 0) b = stairs(p.material, dirFromDelta(c - x, c - z));
          s.set(x, y, z, b);
        }
      }
    }
    if (useStairs) fixStairShapes(s);
  },
};

function steppedPyramid(s, p) {
  const h = p.height, w0 = h - 1, c = w0;
  const tierH = h >= 14 ? 3 : 2;
  const templeH = h >= 10 ? 4 : 0;
  const nt = Math.max(1, Math.floor((h - templeH) / tierH));
  const wTop = Math.max(2, Math.min(w0, Math.ceil(w0 * 0.3)));
  const inset = Math.max(1, Math.round((w0 - wTop) / Math.max(1, nt - 1)));
  const accent = materialFamily(p.material).chiseled ?? materialFamily(p.material).base ?? p.material;
  let y = 0, w = w0;
  for (let t = 0; t < nt && w >= 1; t++) {
    for (let dy = 0; dy < tierH; dy++) {
      const yy = y + dy;
      s.fill(c - w, yy, c - w, c + w, yy, c + w, p.material, { mode: p.hollow && dy < tierH - 1 && yy > 0 ? 'walls' : 'replace' });
    }
    // decorative band on the terrace edge
    if (tierH >= 3) s.fill(c - w, y + 1, c - w, c + w, y + 1, c + w, accent, { mode: 'walls' });
    y += tierH;
    if (t < nt - 1) w = Math.max(wTop, w - inset);
  }
  const topY = y; // platform surface level (blocks above stand here)
  // south staircase (3 wide) with cheek walls, from the ground up to the platform
  const hasStairs = !!materialFamily(p.material).stairs;
  for (let k = 0; k < topY; k++) {
    const z = c + w + (topY - 1 - k);
    for (let x = c - 1; x <= c + 1; x++) {
      s.set(x, k, z, hasStairs ? stairs(p.material, 'north') : slab(p.material));
      if (k > 0) s.fill(x, 0, z, x, k - 1, z, p.material);
    }
    for (const x of [c - 2, c + 2]) s.fill(x, 0, z, x, k, z, p.material);
  }
  // temple on top
  if (templeH && w >= 2) {
    const tw = Math.min(w, 3);
    s.fill(c - tw, topY, c - tw, c + tw, topY + templeH - 2, c + tw, p.material, { mode: 'walls' });
    s.fill(c - tw + 1, topY, c - tw + 1, c + tw - 1, topY + templeH - 2, c + tw - 1, 'air');
    s.fill(c - tw, topY + templeH - 1, c - tw, c + tw, topY + templeH - 1, c + tw, accent);
    s.fill(c - tw + 1, topY + templeH, c - tw + 1, c + tw - 1, topY + templeH, c + tw - 1, slab(p.material));
    // open doorway on the south with torches either side
    s.set(c, topY, c + tw, 'air');
    s.set(c, topY + 1, c + tw, 'air');
    s.set(c - 1, topY + 1, c + tw + 1, `wall_torch[facing=south]`);
    s.set(c + 1, topY + 1, c + tw + 1, `wall_torch[facing=south]`);
  }
  fixStairShapes(s);
}
