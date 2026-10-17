import { materialFamily, stairs, slab, door, dirFromDelta, fixStairShapes, hipRoof, weather, spiralStairs } from './helpers.js';
import { buildCone } from './cone.js';

/**
 * Castle tower: round or square shaft with arrow slits, a door on the south, a spiral staircase
 * inside, and a conical roof / corbelled crenellated top / flat top.
 */
export default {
  name: 'tower',
  description: 'Castle tower: round/square, arrow slits, south door, spiral stairs, cone/crenellated/flat top',
  params: {
    radius: { type: 'int', default: 4, min: 2, max: 24, description: 'radius (half-width for square towers)' },
    height: { type: 'int', default: 18, min: 5, max: 200, description: 'height of the shaft' },
    material: { type: 'block', default: 'stone_bricks', description: 'wall block' },
    shape: { type: 'enum', values: ['round', 'square'], default: 'round', description: 'floor plan' },
    roof: { type: 'enum', values: ['cone', 'crenellated', 'flat'], default: 'cone', description: 'top' },
    roofMaterial: { type: 'block', default: '', description: 'roof block (default: deepslate_tiles for cones, the wall block otherwise)' },
    windows: { type: 'bool', default: true, description: 'arrow slits' },
    door: { type: 'bool', default: true, description: 'door on the south side' },
    stairs: { type: 'bool', default: true, description: 'spiral staircase inside (radius ≥ 3)' },
    weathering: { type: 'number', default: 0.12, min: 0, max: 1, description: 'fraction of mossy/cracked variants' },
  },
  build(s, p, ctx) {
    const R = p.radius + 1;
    buildTower(s, { ...p, cx: R, cz: R, y0: 0 }, ctx.rng);
  },
};

/**
 * Draw a tower centred on (cx, cz) with its base at y0. Used by the tower and castle generators.
 * Extra options: openings: [[dx, dz, y]] doorways (2 tall) to cut into the wall (e.g. from walls),
 * floors: [y] extra interior floor levels (wood) leaving the stairwell open.
 */
export function buildTower(s, o, rng) {
  const r = o.radius, H = o.height, cx = o.cx, cz = o.cz, y0 = o.y0 ?? 0;
  const mat = o.material;
  const round = o.shape !== 'square';
  const inside = (dx, dz, rr) => (round ? dx * dx + dz * dz <= (rr + 0.5) * (rr + 0.5) : Math.abs(dx) <= rr && Math.abs(dz) <= rr);
  const ring = (dx, dz, rr) => inside(dx, dz, rr) && !inside(dx, dz, rr - 1);
  const cells = (rr) => {
    const out = [];
    for (let dz = -rr - 1; dz <= rr + 1; dz++) for (let dx = -rr - 1; dx <= rr + 1; dx++) if (inside(dx, dz, rr)) out.push([dx, dz]);
    return out;
  };
  const fam = materialFamily(mat);
  const roofMat = o.roofMaterial || (o.roof === 'cone' ? 'deepslate_tiles' : mat);
  const set = (dx, y, dz, b) => s.set(cx + dx, y0 + y, cz + dz, b);
  const get = (dx, y, dz) => s.get(cx + dx, y0 + y, cz + dz);

  // shaft
  for (const [dx, dz] of cells(r)) {
    const wall = ring(dx, dz, r);
    set(dx, 0, dz, wall ? mat : mat);
    for (let y = 1; y < H; y++) set(dx, y, dz, wall ? mat : 'air');
  }
  // plinth: a slightly wider base course
  for (const [dx, dz] of cells(r + 1)) if (!inside(dx, dz, r)) set(dx, 0, dz, fam.stairs ? stairs(mat, dirFromDelta(-dx, -dz)) : mat);

  // spiral staircase around a central column (placed after the top so the last step can cut
  // through the deck)
  const spiral = o.stairs !== false && r >= 3;
  const stairwell = (dx, dz) => spiral && Math.abs(dx) <= 1 && Math.abs(dz) <= 1;

  // extra floors (e.g. at the castle wall-walk level), leaving the stairwell open
  for (const fy of o.floors ?? []) {
    for (const [dx, dz] of cells(r - 1)) if (!stairwell(dx, dz)) set(dx, fy, dz, 'spruce_planks');
  }

  // door on the south
  if (o.door !== false) {
    door(s, cx, y0 + 1, cz + r, { facing: 'south', material: 'spruce' });
    set(0, 0, r + 1, fam.stairs ? stairs(mat, 'north') : mat);
    for (const dx of [-1, 1]) if (get(dx, 2, r) === mat || get(dx, 2, r) == null) set(dx, 2, r + 1, 'wall_torch[facing=south]');
    for (let z = 2; z < r; z++) { set(0, 1, z, 'air'); set(0, 2, z, 'air'); }
  }
  for (const [dx, dz, y] of o.openings ?? []) { set(dx, y, dz, 'air'); set(dx, y + 1, dz, 'air'); }

  // arrow slits: 1×2 openings at alternating angles every 5 blocks
  if (o.windows !== false) {
    const ringCells = cells(r).filter(([dx, dz]) => ring(dx, dz, r));
    let level = 0;
    for (let y = 4; y < H - 3; y += 5, level++) {
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + (round && level % 2 ? Math.PI / 4 : 0);
        const ux = Math.sin(a), uz = Math.cos(a);
        let best = null, bd = -Infinity;
        for (const [dx, dz] of ringCells) {
          const d = dx * ux + dz * uz - 0.3 * Math.abs(dx * uz - dz * ux);
          if (d > bd) { bd = d; best = [dx, dz]; }
        }
        if (!best) continue;
        set(best[0], y, best[1], 'air');
        set(best[0], y + 1, best[1], 'air');
      }
    }
  }

  // top
  const deck = H;
  if (o.roof === 'cone') {
    for (const [dx, dz] of cells(r)) set(dx, deck, dz, ring(dx, dz, r) ? mat : 'spruce_planks');
    const coneH = Math.max(4, Math.round((r + 1) * 2.2));
    if (round) {
      buildCone(s, cx, y0 + deck + 1, cz, r + 1, coneH, roofMat, { hollow: true, base: false, smooth: true, interior: 'air', tip: 'lightning_rod[facing=up]' });
    } else {
      hipRoof(s, { x1: cx - r, z1: cz - r, x2: cx + r, z2: cz + r, y: y0 + deck + 1, material: roofMat, overhang: 1 });
    }
    // dormer-like lookout: a lantern under the cone
    set(0, deck + 1, 0, 'lantern[hanging=false]');
  } else {
    // corbels (upside-down stairs) under an overhanging deck + crenellated parapet
    const overhang = o.roof === 'crenellated' ? 1 : 0;
    if (overhang) {
      for (const [dx, dz] of cells(r + 1)) {
        if (inside(dx, dz, r)) continue;
        set(dx, deck - 1, dz, fam.stairs ? stairs(mat, dirFromDelta(-dx, -dz), 'top') : mat);
      }
    }
    const top = r + overhang;
    for (const [dx, dz] of cells(top)) set(dx, deck, dz, ring(dx, dz, top) ? mat : roofMat);
    if (o.roof === 'crenellated') {
      const edge = cells(top).filter(([dx, dz]) => ring(dx, dz, top));
      const n = Math.max(8, 2 * Math.round((Math.PI * top) / 2));
      for (const [dx, dz] of edge) {
        set(dx, deck + 1, dz, mat);
        const merlon = round ? Math.floor(((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * n) % 2 === 0 : (dx + dz) % 2 === 0;
        if (merlon) set(dx, deck + 2, dz, mat);
      }
    } else {
      const edge = cells(top).filter(([dx, dz]) => ring(dx, dz, top));
      for (const [dx, dz] of edge) set(dx, deck + 1, dz, fam.wall ?? slab(mat));
    }
    // lanterns on the deck
    if (r >= 3) for (const [dx, dz] of [[r - 1, 0], [-(r - 1), 0]]) if (!stairwell(dx, dz)) set(dx, deck + 1, dz, 'lantern[hanging=false]');
  }
  // spiral steps from y=1 up to the deck, with 2 blocks of headroom above every step
  if (spiral) spiralStairs(s, cx, y0, cz, { steps: H, material: fam.stairs ? mat : 'stone_bricks', column: mat });
  if (o.weathering > 0 && fam.variants.length) weather(s, { from: mat, to: fam.variants, chance: o.weathering, rng });
  fixStairShapes(s);
  return s;
}
