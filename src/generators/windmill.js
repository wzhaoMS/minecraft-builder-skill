import { materialFamily, door, stairs, slab, dirFromDelta, finish, withAxis } from './helpers.js';
import { buildCone } from './cone.js';

/** Windmill: tapering stone tower, wooden cap, four cloth sails on the south face. */
export default {
  name: 'windmill',
  description: 'Windmill: tapering stone tower, conical wooden cap, four lattice sails facing south, door and windows',
  params: {
    height: { type: 'int', default: 14, min: 8, max: 48, description: 'tower height' },
    radius: { type: 'int', default: 4, min: 3, max: 10, description: 'base radius' },
    material: { type: 'block', default: 'cobblestone', description: 'tower' },
    roof: { type: 'block', default: 'spruce', description: 'cap (stairs are used when available)' },
    sails: { type: 'block', default: 'white_wool', description: 'sail cloth' },
  },
  build(s, p) {
    const R = p.radius, H = p.height;
    const L = Math.max(5, Math.round(H * 0.62)); // sail length
    const c = Math.max(R + 2, L + 1);
    const rAt = (y) => R - Math.floor((y * 1.5) / H);
    const inside = (dx, dz, r) => dx * dx + dz * dz <= (r + 0.5) * (r + 0.5);
    const fam = materialFamily(p.material);
    for (let y = 0; y < H; y++) {
      const r = rAt(y);
      for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
        if (!inside(dx, dz, r)) continue;
        s.set(c + dx, y, c + dz, y === 0 ? p.material : !inside(dx, dz, r - 1) ? p.material : 'air');
      }
    }
    // plinth, door, windows
    for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
      if (inside(dx, dz, R + 1) && !inside(dx, dz, R) && fam.stairs) s.set(c + dx, 0, c + dz, stairs(p.material, dirFromDelta(-dx, -dz)));
    }
    door(s, c, 1, c + rAt(1), { facing: 'south', material: p.roof });
    s.set(c, 0, c + R + 1, fam.stairs ? stairs(p.material, 'north') : p.material);
    for (const [ux, uz, y] of [[1, 0, 4], [-1, 0, 4], [0, -1, 7], [1, 0, 9], [-1, 0, 9]]) {
      if (y >= H - 2) continue;
      const r = rAt(y);
      s.set(c + ux * r, y, c + uz * r, 'glass_pane');
    }
    // mill floor and cap
    const rt = rAt(H - 1);
    for (let dz = -rt; dz <= rt; dz++) for (let dx = -rt; dx <= rt; dx++) if (inside(dx, dz, rt - 1)) s.set(c + dx, H - 1, c + dz, `${materialFamily(p.roof).planks ?? 'spruce_planks'}`);
    buildCone(s, c, H, c, rt + 1, rt + 4, p.roof, { hollow: true, base: false, smooth: true, interior: 'air' });
    // axle and sails on the south face
    const hubY = H + 1, hubZ = c + rt + 2;
    const log = materialFamily(p.roof).log ?? 'spruce_log';
    for (let z = c + rt - 1; z <= hubZ; z++) s.set(c, hubY, z, withAxis(log, 'z'));
    const fence = materialFamily(p.roof).fence ?? 'spruce_fence';
    // four arms (up, right, down, left as seen from the south) with cloth on their clockwise side
    const arms = [[0, 1, 1, 0], [1, 0, 0, -1], [0, -1, -1, 0], [-1, 0, 0, 1]]; // [ax, ay, clothX, clothY]
    for (const [ax, ay, cx, cy] of arms) {
      for (let i = 1; i <= L; i++) {
        const X = c + ax * i, Y = hubY + ay * i;
        if (Y < 1) continue;
        s.set(X, Y, hubZ, fence);
        if (i >= 2) for (const k of [1, 2]) {
          const Xc = X + cx * k, Yc = Y + cy * k;
          if (Yc >= 1) s.set(Xc, Yc, hubZ, k === 2 && i % 2 === 0 ? fence : p.sails);
        }
      }
    }
    s.set(c, hubY, hubZ, withAxis(log, 'z'));
    s.set(c, hubY, hubZ + 1, materialFamily(p.roof).button ? `${materialFamily(p.roof).button}[face=wall,facing=south]` : slab(p.roof));
    finish(s);
  },
};
