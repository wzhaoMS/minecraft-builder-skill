import { materialFamily, stairs, dirFromDelta, fixStairShapes } from './helpers.js';

/**
 * Draw a cone centred on (cx, cz) with its base at y0.
 * @param {import('../core/structure.js').Structure} s
 * @param {{ hollow?: boolean, base?: boolean, smooth?: boolean, interior?: string|null, tip?: string|null }} [opts]
 *   hollow: shell only · base: close the bottom of a hollow cone · smooth: stairs on the outer surface
 *   (when the material has stairs) · interior: block for the inside of a hollow cone (e.g. 'air') ·
 *   tip: block placed on top of the apex (e.g. a lightning rod)
 * @returns {number} y of the apex
 */
export function buildCone(s, cx, y0, cz, radius, height, material, { hollow = false, base = true, smooth = false, interior = null, tip = null } = {}) {
  const rAt = (y) => (radius * (height - y - 0.5)) / height;
  const inside = (dx, y, dz) => {
    if (y < 0) return !(hollow && base);
    if (y >= height) return false;
    const r = rAt(y);
    return dx * dx + dz * dz <= (r + 0.5) * (r + 0.5);
  };
  const useStairs = smooth && !!materialFamily(material).stairs;
  const R = Math.ceil(radius) + 1;
  for (let y = 0; y < height; y++) {
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (!inside(dx, y, dz)) continue;
        const exposedTop = !inside(dx, y + 1, dz);
        const shell = exposedTop || !inside(dx + 1, y, dz) || !inside(dx - 1, y, dz) || !inside(dx, y, dz + 1) || !inside(dx, y, dz - 1) || !inside(dx, y - 1, dz);
        let b;
        if (hollow && !shell) b = interior;
        else if (useStairs && exposedTop && (dx !== 0 || dz !== 0)) b = stairs(material, dirFromDelta(-dx, -dz));
        else b = materialFamily(material).base ?? material;
        if (b) s.set(cx + dx, y0 + y, cz + dz, b);
      }
    }
  }
  if (tip) s.set(cx, y0 + height, cz, tip);
  if (useStairs) fixStairShapes(s, { x1: cx - R, x2: cx + R, z1: cz - R, z2: cz + R, y1: y0, y2: y0 + height });
  return y0 + height - 1;
}

export default {
  name: 'cone',
  description: 'Cone (solid or hollow), optionally smoothed with stairs',
  params: {
    radius: { type: 'int', default: 6, min: 1, max: 64, description: 'base radius' },
    height: { type: 'int', default: 12, min: 1, max: 256, description: 'height in blocks' },
    material: { type: 'block', default: 'stone', description: 'block to build with' },
    hollow: { type: 'bool', default: false, description: 'shell only' },
    smooth: { type: 'bool', default: false, description: 'use stairs on the surface when the material has stairs' },
  },
  build(s, p) {
    buildCone(s, p.radius, 0, p.radius, p.radius, p.height, p.material, { hollow: p.hollow, base: true, smooth: p.smooth });
  },
};
