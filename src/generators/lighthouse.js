import { materialFamily, door, stairs, spiralStairs, dirFromDelta, finish } from './helpers.js';
import { buildCone } from './cone.js';

/** Lighthouse: striped tapering tower, spiral stairs, gallery with railing, glass lantern room, red cap. */
export default {
  name: 'lighthouse',
  description: 'Lighthouse: red/white striped tapering tower, spiral stairs, gallery with railing, glowing lantern room, cone cap',
  params: {
    height: { type: 'int', default: 24, min: 10, max: 120, description: 'tower height (below the gallery)' },
    radius: { type: 'int', default: 4, min: 3, max: 10, description: 'base radius' },
    material: { type: 'block', default: 'white_concrete', description: 'main colour' },
    stripes: { type: 'block', default: 'red_concrete', description: 'stripe colour (same as material = no stripes)' },
    roof: { type: 'block', default: 'red_nether_bricks', description: 'cap material (stairs are used when available)' },
    light: { type: 'block', default: 'sea_lantern', description: 'light block in the lantern room' },
  },
  build(s, p) {
    const R = p.radius, H = p.height;
    const c = R + 2;
    const rAt = (y) => R - Math.floor((y * 1.2) / H); // taper by one block
    const inside = (dx, dz, r) => dx * dx + dz * dz <= (r + 0.5) * (r + 0.5);
    for (let y = 0; y < H; y++) {
      const r = rAt(y);
      const band = Math.floor(y / 4) % 2 === 1 ? p.stripes : p.material;
      for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
        if (!inside(dx, dz, r)) continue;
        const wall = !inside(dx, dz, r - 1);
        s.set(c + dx, y, c + dz, y === 0 ? 'stone_bricks' : wall ? band : 'air');
      }
    }
    // base plinth
    for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
      if (inside(dx, dz, R + 1) && !inside(dx, dz, R)) s.set(c + dx, 0, c + dz, stairs('stone_bricks', dirFromDelta(-dx, -dz)));
    }
    // door on the south + small windows climbing around the tower
    door(s, c, 1, c + rAt(1), { facing: 'south', material: 'spruce' });
    s.set(c, 0, c + R + 1, stairs('stone_bricks', 'north'));
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let y = 6, k = 0; y < H - 3; y += 5, k++) {
      const [ux, uz] = dirs[k % 4];
      const r = rAt(y);
      s.set(c + ux * r, y, c + uz * r, 'glass_pane');
      s.set(c + ux * r, y + 1, c + uz * r, 'glass_pane');
    }
    // gallery deck + railing
    const rt = rAt(H - 1);
    const gy = H;
    for (let dz = -rt - 1; dz <= rt + 1; dz++) for (let dx = -rt - 1; dx <= rt + 1; dx++) {
      if (!inside(dx, dz, rt + 1)) continue;
      s.set(c + dx, gy, c + dz, inside(dx, dz, rt) ? 'smooth_stone' : p.stripes);
      if (!inside(dx, dz, rt)) s.set(c + dx, gy + 1, c + dz, 'iron_bars');
      // corbels under the overhang
      if (!inside(dx, dz, rt) && materialFamily('stone_bricks').stairs) s.set(c + dx, gy - 1, c + dz, stairs('stone_bricks', dirFromDelta(-dx, -dz), 'top'));
    }
    // lantern room: glass ring around a glowing core
    const lr = Math.max(2, rt - 1);
    for (let y = gy + 1; y <= gy + 3; y++) {
      for (let dz = -lr; dz <= lr; dz++) for (let dx = -lr; dx <= lr; dx++) {
        if (!inside(dx, dz, lr)) continue;
        const ring = !inside(dx, dz, lr - 1);
        s.set(c + dx, y, c + dz, ring ? (y === gy + 3 ? p.stripes : 'glass') : 'air');
      }
    }
    s.set(c, gy + 1, c, p.light);
    s.set(c, gy + 2, c, p.light);
    // doorway from the lantern room onto the gallery (south)
    s.set(c, gy + 1, c + lr, 'air');
    s.set(c, gy + 2, c + lr, 'air');
    buildCone(s, c, gy + 4, c, lr + 1, lr + 3, p.roof, { hollow: true, base: true, smooth: true, interior: 'air', tip: 'lightning_rod[facing=up]' });
    // spiral stairs up to the gallery level (the lantern core sits on the column)
    spiralStairs(s, c, 0, c, { steps: H, material: 'stone_bricks', column: 'stone_bricks' });
    finish(s);
  },
};
