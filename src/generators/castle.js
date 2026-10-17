import { materialFamily, stairs, slab, weather, finish, lamp } from './helpers.js';
import { buildTower } from './tower.js';

/**
 * Castle: curtain walls with a wall-walk and battlements, four corner towers, a gatehouse with a
 * portcullis on the south side, stairs up to the walls and a well in the courtyard.
 */
export default {
  name: 'castle',
  description: 'Castle: curtain walls with wall-walk + battlements, 4 corner towers, south gatehouse, courtyard well',
  params: {
    width: { type: 'int', default: 31, min: 17, max: 201, description: 'outer size along X' },
    depth: { type: 'int', default: 31, min: 17, max: 201, description: 'outer size along Z' },
    wallHeight: { type: 'int', default: 8, min: 4, max: 40, description: 'curtain wall height' },
    towerRadius: { type: 'int', default: 4, min: 3, max: 12, description: 'corner tower radius' },
    towerHeight: { type: 'int', default: 0, min: 0, max: 80, description: 'corner tower height (0 = wallHeight + 6)' },
    towerRoof: { type: 'enum', values: ['cone', 'crenellated', 'flat'], default: 'cone', description: 'corner tower tops' },
    material: { type: 'block', default: 'stone_bricks', description: 'main stone' },
    accent: { type: 'block', default: 'cobblestone', description: 'plinth, wall-walk paving and trim' },
    roofMaterial: { type: 'block', default: '', description: 'tower cone roofs (default deepslate_tiles)' },
    gate: { type: 'bool', default: true, description: 'gatehouse with portcullis on the south wall' },
    weathering: { type: 'number', default: 0.15, min: 0, max: 1, description: 'fraction of mossy/cracked stone' },
  },
  build(s, p, ctx) {
    const W = p.width, D = p.depth, R = p.towerRadius, WH = p.wallHeight;
    const TH = p.towerHeight || WH + 6;
    const mat = p.material, acc = p.accent;
    const fam = materialFamily(mat);
    // wall centre-line rectangle (tower centres at its corners)
    const x0 = R, x1 = W - 1 - R, z0 = R, z1 = D - 1 - R;
    const cxm = Math.floor((x0 + x1) / 2);

    // ── curtain walls: 3 thick, plinth, wall-walk, battlements on the outer edge ──
    const wallSeg = (ax, az, bx, bz, outward) => {
      // outward: [ox, oz] unit vector pointing out of the castle
      const [ox, oz] = outward;
      const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minZ = Math.min(az, bz), maxZ = Math.max(az, bz);
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          for (let t = -1; t <= 1; t++) {
            const wx = x + ox * t, wz = z + oz * t;
            s.fill(wx, 0, wz, wx, WH - 1, wz, mat);
            if (t === 1) {
              // outer edge: parapet + merlons
              s.set(wx, WH, wz, mat);
              const along = ox === 0 ? x : z;
              if (along % 2 === 0) s.set(wx, WH + 1, wz, mat);
            } else {
              s.set(wx, WH - 1, wz, acc); // paved wall-walk
            }
          }
          // plinth outside
          const px = x + ox * 2, pz = z + oz * 2;
          s.set(px, 0, pz, materialFamily(acc).stairs ? stairs(acc, ox ? (ox > 0 ? 'west' : 'east') : oz > 0 ? 'north' : 'south') : acc);
          // string course under the parapet
          s.set(x + ox, WH - 2, z + oz, materialFamily(mat).chiseled ?? mat);
        }
      }
    };
    wallSeg(x0, z0, x1, z0, [0, -1]); // north
    wallSeg(x0, z1, x1, z1, [0, 1]); // south
    wallSeg(x0, z0, x0, z1, [-1, 0]); // west
    wallSeg(x1, z0, x1, z1, [1, 0]); // east

    // ── stairs from the courtyard up to the wall-walk (inside of the west wall) ──
    const sx = x0 + 2;
    const zTop = z1 - 3 - (WH - 1);
    if (zTop > z0 + 2) {
      for (let k = 0; k < WH; k++) {
        const z = z1 - 3 - k;
        if (k > 0) s.fill(sx, 0, z, sx, k - 1, z, mat);
        s.set(sx, k, z, stairs(fam.stairs ? mat : 'stone_bricks', 'north'));
      }
    }

    // ── corner towers (doorways onto the wall-walk) ──
    const walkY = WH;
    const corners = [[x0, z0, 'nw'], [x1, z0, 'ne'], [x0, z1, 'sw'], [x1, z1, 'se']];
    for (const [cx, cz, tag] of corners) {
      const ex = tag.includes('w') ? 1 : -1; // direction of the east/west wall leaving this tower
      const ez = tag.includes('n') ? 1 : -1;
      buildTower(s, {
        cx, cz, y0: 0, radius: R, height: TH, material: mat, shape: 'round', roof: p.towerRoof, roofMaterial: p.roofMaterial,
        windows: true, door: false, stairs: true, weathering: 0,
        floors: [walkY - 1],
        openings: [[ex * R, 0, walkY], [0, ez * R, walkY]],
      }, ctx.rng);
    }

    // ── gatehouse ──
    if (p.gate) {
      const gw = Math.min(11, Math.max(7, (x1 - x0) - 2 * R - 2)) | 1; // odd width
      const gx0 = cxm - (gw - 1) / 2, gx1 = cxm + (gw - 1) / 2;
      const gz0 = z1 - 3, gz1 = z1 + 3;
      const GH = WH + 4;
      s.fill(gx0, 0, gz0, gx1, GH - 1, gz1, mat);
      s.fill(gx0 + 1, 1, gz0 + 1, gx1 - 1, GH - 2, gz1 - 1, 'air');
      s.fill(gx0 + 1, WH - 1, gz0 + 1, gx1 - 1, WH - 1, gz1 - 1, 'spruce_planks'); // upper floor
      // battlements + corner bartizans
      for (let x = gx0; x <= gx1; x++) for (let z = gz0; z <= gz1; z++) {
        const edge = x === gx0 || x === gx1 || z === gz0 || z === gz1;
        if (!edge) continue;
        s.set(x, GH, z, mat);
        if ((x + z) % 2 === 0) s.set(x, GH + 1, z, mat);
      }
      s.fill(gx0 + 1, GH - 1, gz0 + 1, gx1 - 1, GH - 1, gz1 - 1, acc); // roof deck
      // gate passage: 3 wide × 4 tall with a rounded top and a raised portcullis
      const gh = Math.min(4, WH - 2);
      s.fill(cxm - 1, 1, gz0 - 1, cxm + 1, gh, gz1 + 1, 'air');
      s.fill(cxm - 1, 0, gz0 - 1, cxm + 1, 0, gz1 + 1, acc);
      for (const z of [gz0, gz1]) {
        s.set(cxm - 1, gh, z, stairs(fam.stairs ? mat : 'stone_bricks', 'west', 'top'));
        s.set(cxm + 1, gh, z, stairs(fam.stairs ? mat : 'stone_bricks', 'east', 'top'));
      }
      for (let x = cxm - 1; x <= cxm + 1; x++) s.set(x, gh, gz1 - 1, 'iron_bars');
      s.set(cxm, gh + 1, gz1, materialFamily(mat).chiseled ?? mat); // keystone
      // banners and torches on the front
      for (const x of [cxm - 3, cxm + 3]) {
        if (x > gx0 && x < gx1) {
          s.set(x, gh + 2, gz1 + 1, 'red_wall_banner[facing=south]');
          s.set(x, 2, gz1 + 1, 'wall_torch[facing=south]');
        }
      }
      // arrow slits on the upper floor
      for (let x = gx0 + 2; x <= gx1 - 2; x += 2) { s.set(x, WH + 1, gz1, 'air'); s.set(x, WH + 2, gz1, 'air'); }
      // doorways from the wall-walk into the gatehouse
      s.fill(gx0, walkY, z1, gx0, walkY + 1, z1, 'air');
      s.fill(gx1, walkY, z1, gx1, walkY + 1, z1, 'air');
    }

    // ── courtyard well + lights ──
    const wcx = cxm, wcz = Math.floor((z0 + z1) / 2);
    if (x1 - x0 >= 14 && z1 - z0 >= 14) {
      s.fill(wcx - 1, 0, wcz - 1, wcx + 1, 0, wcz + 1, acc);
      s.fill(wcx, -3, wcz, wcx, 0, wcz, 'water');
      s.fill(wcx - 1, -3, wcz - 1, wcx + 1, -1, wcz + 1, acc, { mode: 'walls' });
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) s.fill(wcx + dx, 1, wcz + dz, wcx + dx, 2, wcz + dz, 'spruce_fence');
      s.fill(wcx - 1, 3, wcz - 1, wcx + 1, 3, wcz + 1, slab('spruce'));
      s.set(wcx, 2, wcz, 'lantern[hanging=true]');
      // lamp posts around the courtyard
      for (const [lx, lz] of [[x0 + 4, z0 + 4], [x1 - 4, z0 + 4], [x0 + 4, z1 - 4], [x1 - 4, z1 - 4]]) {
        if (s.get(lx, 0, lz) == null) lamp(s, lx, 0, lz, { style: 'post', height: 3, post: 'spruce_fence' });
      }
    }

    if (p.weathering > 0 && fam.variants.length) weather(s, { from: mat, to: fam.variants, chance: p.weathering, rng: ctx.rng });
    finish(s);
  },
};
