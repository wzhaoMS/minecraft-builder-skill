import { materialFamily, slab, stairs, lamp, finish, dirFromDelta } from './helpers.js';

/** Fountain: round basin with a rim, water, a tiered centre column spilling water. */
export default {
  name: 'fountain',
  description: 'Round fountain: basin with a stair/slab rim, water pool, tiered centre column with a water spout',
  params: {
    radius: { type: 'int', default: 4, min: 2, max: 16, description: 'basin radius' },
    material: { type: 'block', default: 'stone_bricks', description: 'basin / column stone (try quartz_block, prismarine)' },
    height: { type: 'int', default: 3, min: 1, max: 12, description: 'column height above the pool' },
    lights: { type: 'bool', default: true, description: 'lanterns around the basin' },
  },
  build(s, p) {
    const r = p.radius;
    buildFountain(s, r + 1, r + 1, p);
    finish(s);
  },
};

/** Draw a fountain centred on (cx, cz): pool surface at y = 0, basin floor at y = -1. */
export function buildFountain(s, cx, cz, { radius = 4, material = 'stone_bricks', height = 3, lights = true } = {}) {
  const r = radius;
  const fam = materialFamily(material);
  const dist = (dx, dz) => Math.sqrt(dx * dx + dz * dz);
  for (let dz = -r - 1; dz <= r + 1; dz++) {
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d = dist(dx, dz);
      const X = cx + dx, Z = cz + dz;
      if (d <= r - 0.5) {
        s.set(X, -2, Z, material);
        s.set(X, -1, Z, 'water');
        s.set(X, 0, Z, 'water');
      } else if (d <= r + 0.5) {
        s.set(X, -2, Z, material);
        s.set(X, -1, Z, material);
        s.set(X, 0, Z, material);
        s.set(X, 1, Z, fam.slab ? slab(material) : material);
      } else if (d <= r + 1.5) {
        // a step around the basin
        s.set(X, 0, Z, fam.stairs ? stairs(material, dirFromDelta(-dx, -dz)) : slab(material));
      }
    }
  }
  // centre column with a smaller bowl and a spout on top
  s.fill(cx, -1, cz, cx, height, cz, fam.pillar ? `${fam.pillar}[axis=y]` : material);
  if (r >= 3) {
    for (const [dx, dz, f] of [[1, 0, 'west'], [-1, 0, 'east'], [0, 1, 'north'], [0, -1, 'south']]) {
      s.set(cx + dx, height, cz + dz, fam.stairs ? stairs(material, f, 'top') : slab(material, 'top'));
    }
  }
  s.set(cx, height + 1, cz, 'water');
  if (lights && r >= 3) {
    for (const [dx, dz] of [[r + 1, 0], [-(r + 1), 0], [0, r + 1], [0, -(r + 1)]]) {
      lamp(s, cx + dx, 1, cz + dz, { style: 'post', height: 3, post: 'dark_oak_fence' });
    }
  }
  return s;
}
