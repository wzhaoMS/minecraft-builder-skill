import { materialFamily, stairs } from './helpers.js';

/** Free-standing arch (elliptical ring) in the X-Y plane, extruded `depth` blocks along Z. */
export default {
  name: 'arch',
  description: 'Elliptical arch / gateway; the opening faces north-south, stairs smooth the curves',
  params: {
    width: { type: 'int', default: 9, min: 3, max: 128, description: 'outer width along X' },
    height: { type: 'int', default: 8, min: 2, max: 128, description: 'outer height' },
    depth: { type: 'int', default: 2, min: 1, max: 64, description: 'thickness along Z' },
    thickness: { type: 'int', default: 2, min: 1, max: 32, description: 'thickness of the arch ring' },
    material: { type: 'block', default: 'stone_bricks', description: 'block to build with' },
    smooth: { type: 'bool', default: true, description: 'smooth the curves with stairs (if the material has stairs)' },
  },
  build(s, p) {
    const W = p.width, H = p.height, t = Math.min(p.thickness, Math.floor((W - 1) / 2), H - 1);
    const A = W / 2; // outer half-width
    const rIn = Math.max(0.5, A - t); // inner half-width of the opening
    // Roman arch: vertical legs up to the springline, then semicircles. Low arches become elliptical.
    const ys = Math.max(0, H - A);
    const B = ys > 0 ? A : H, b = ys > 0 ? rIn : Math.max(0.5, H - t);
    const inEllipse = (u, v, ax, ay) => (u * u) / (ax * ax) + (v * v) / (ay * ay);
    const opening = (x, y) => {
      if (y < 0) return false;
      const u = x + 0.5 - A, v = y + 0.5 - ys;
      return v <= 0 ? Math.abs(u) < rIn : inEllipse(u, v, rIn, b) < 1;
    };
    const solid = (x, y) => {
      if (x < 0 || x >= W || y < 0 || y >= H) return false;
      const u = x + 0.5 - A, v = y + 0.5 - ys;
      if (opening(x, y)) return false;
      return v <= 0 || inEllipse(u, v, A, B) <= 1;
    };
    const smooth = p.smooth && !!materialFamily(p.material).stairs;
    for (let y = 0; y <= H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x + 0.5 - A;
        let block = null;
        if (solid(x, y)) block = p.material;
        else if (smooth && y >= 1) {
          const out = u < 0 ? -1 : 1; // toward the outside of the arch
          if (opening(x, y)) {
            // corner pocket under the intrados: solid above and solid toward the outside
            if (solid(x, y + 1) && solid(x + out, y) && !solid(x - out, y)) block = stairs(p.material, out < 0 ? 'west' : 'east', 'top');
          } else if (solid(x, y - 1) && solid(x - out, y) && !solid(x + out, y) && Math.abs(u) > 0.5) {
            // step on the extrados: solid below and solid toward the centre
            block = stairs(p.material, out < 0 ? 'east' : 'west');
          }
        }
        if (block) for (let z = 0; z < p.depth; z++) s.set(x, y, z, block);
      }
    }
  },
};
