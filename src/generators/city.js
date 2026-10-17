import { slab, door, doubleDoor, lamp, plant, chair, finish } from './helpers.js';
import { glassTower, setbackTower, cylinderTower } from './skyscraper.js';
import { buildTree } from './tree.js';
import { buildFountain } from './fountain.js';

/**
 * City district (port + upgrade of build-city.js, no WorldEdit pastes): street grid with lane
 * markings and zebra crossings, raised sidewalks with street lamps and trees, buildings that get
 * taller toward the centre (glass / art-deco / cylinder skyscrapers, mid-rise offices with varied
 * facades, low-rise shops with awnings), parks with trees, paths, benches and fountains, parked cars,
 * and an elevated highway ring on pillars with exit ramps.
 */
export default {
  name: 'city',
  description: 'City district: streets with markings & crosswalks, sidewalks & lamps, varied buildings taller toward the centre, parks, elevated highway ring',
  params: {
    width: { type: 'int', default: 160, min: 48, max: 1024, description: 'approximate size along X (incl. highway)' },
    depth: { type: 'int', default: 160, min: 48, max: 1024, description: 'approximate size along Z (incl. highway)' },
    blockSize: { type: 'int', default: 22, min: 12, max: 64, description: 'city block (lot) size between streets' },
    streetWidth: { type: 'int', default: 5, min: 3, max: 15, description: 'street width' },
    maxHeight: { type: 'int', default: 90, min: 10, max: 300, description: 'tallest buildings (city centre)' },
    parks: { type: 'number', default: 0.15, min: 0, max: 1, description: 'fraction of blocks that become parks' },
    highway: { type: 'bool', default: true, description: 'elevated highway ring around the city' },
    details: { type: 'bool', default: true, description: 'street trees, parked cars, benches, rooftop details' },
  },
  build(s, p, ctx) {
    buildCity(s, p, ctx.rng);
    finish(s);
  },
};

const MID_PALETTES = [
  { body: 'white_concrete', glass: 'light_blue_stained_glass', accent: 'light_gray_concrete' },
  { body: 'light_gray_concrete', glass: 'gray_stained_glass', accent: 'white_concrete' },
  { body: 'cyan_terracotta', glass: 'light_blue_stained_glass', accent: 'white_concrete' },
  { body: 'gray_concrete', glass: 'cyan_stained_glass', accent: 'quartz_block' },
  { body: 'blue_concrete', glass: 'light_blue_stained_glass', accent: 'white_concrete' },
  { body: 'black_concrete', glass: 'gray_stained_glass', accent: 'iron_block' },
  { body: 'brown_concrete', glass: 'white_stained_glass', accent: 'white_terracotta' },
  { body: 'bricks', glass: 'glass', accent: 'smooth_stone' },
  { body: 'white_terracotta', glass: 'brown_stained_glass', accent: 'terracotta' },
];
const SKY_PALETTES = [
  { body: 'cyan_terracotta', glass: 'light_blue_stained_glass', accent: 'white_concrete' },
  { body: 'gray_concrete', glass: 'white_stained_glass', accent: 'gold_block' },
  { body: 'cyan_concrete', glass: 'light_blue_stained_glass', accent: 'white_concrete' },
  { body: 'black_concrete', glass: 'gray_stained_glass', accent: 'gold_block' },
  { body: 'light_gray_concrete', glass: 'white_stained_glass', accent: 'iron_block' },
  { body: 'blue_terracotta', glass: 'blue_stained_glass', accent: 'quartz_block' },
];
const SHOP_WALLS = ['bricks', 'red_terracotta', 'white_terracotta', 'orange_terracotta', 'light_blue_terracotta', 'mud_bricks', 'yellow_terracotta', 'stone_bricks'];
const AWNINGS = ['red', 'blue', 'green', 'yellow', 'orange', 'white', 'lime', 'cyan', 'magenta'];
const CAR_COLORS = ['red', 'blue', 'white', 'black', 'gray', 'yellow', 'lime', 'light_blue', 'orange'];

export function buildCity(s, p, rng) {
  const SW = p.streetWidth, BS = p.blockSize, CELL = BS + SW;
  const HW = 7, HGAP = 4, HY = 12; // highway width, gap to the grid, deck level
  const margin = p.highway ? HGAP + HW + 1 : 0;
  const n = Math.max(1, Math.round((p.width - 2 * margin - SW) / CELL));
  const m = Math.max(1, Math.round((p.depth - 2 * margin - SW) / CELL));
  const GW = n * CELL + SW, GD = m * CELL + SW;
  const half = Math.floor(SW / 2);
  const isStreetX = (x) => ((x % CELL) + CELL) % CELL < SW; // inside a north-south street band
  const isStreetZ = (z) => ((z % CELL) + CELL) % CELL < SW;

  // ── street surface, centre lines, crosswalks ──
  for (let x = 0; x < GW; x++) {
    for (let z = 0; z < GD; z++) {
      const sx = isStreetX(x), sz = isStreetZ(z);
      if (!sx && !sz) continue;
      let b = 'black_concrete';
      const ox = ((x % CELL) + CELL) % CELL, oz = ((z % CELL) + CELL) % CELL;
      if (sx && sz) b = 'black_concrete'; // intersection
      else if (sx && ox === half && z % 6 < 3 && !nearIntersection(z, CELL, SW)) b = 'yellow_concrete';
      else if (sz && oz === half && x % 6 < 3 && !nearIntersection(x, CELL, SW)) b = 'yellow_concrete';
      // zebra crossings just outside each intersection
      if (sx && !sz && crossingZone(z, CELL, SW) && ox % 2 === 0) b = 'white_concrete';
      if (sz && !sx && crossingZone(x, CELL, SW) && oz % 2 === 0) b = 'white_concrete';
      s.set(x, -1, z, b);
    }
  }

  // ── lots ──
  const centerX = GW / 2, centerZ = GD / 2;
  const maxDist = Math.hypot(centerX, centerZ);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const lx0 = i * CELL + SW, lz0 = j * CELL + SW, lx1 = lx0 + BS - 1, lz1 = lz0 + BS - 1;
      sidewalk(s, lx0, lz0, lx1, lz1, p, rng);
      const ix0 = lx0 + 2, iz0 = lz0 + 2, ix1 = lx1 - 2, iz1 = lz1 - 2; // inner area
      const dist = Math.hypot((lx0 + lx1) / 2 - centerX, (lz0 + lz1) / 2 - centerZ) / maxDist;
      if (rng() < p.parks) { park(s, ix0, iz0, ix1, iz1, p, rng); continue; }
      s.fill(ix0, -1, iz0, ix1, -1, iz1, 'smooth_stone');
      const base = Math.max(8, Math.floor(p.maxHeight * (1 - dist * 1.6)));
      const h = Math.max(6, Math.min(p.maxHeight, base + rng.int(-8, 12)));
      const avail = ix1 - ix0 + 1;
      if (h >= 40 && avail >= 14) {
        const pal = rng.pick(SKY_PALETTES);
        const style = rng.pick(['glass', 'glass', 'setback', 'cylinder']);
        if (style === 'cylinder') {
          const r = Math.max(4, Math.floor((avail - 3) / 2) - 1);
          const ox = ix0 + Math.floor((avail - (2 * r + 3)) / 2), oz = iz0 + Math.floor((avail - (2 * r + 3)) / 2);
          cylinderTower(s, { radius: r, height: h, ...pal, spire: rng.int(0, 12), crown: 6 }, ox, oz);
        } else if (style === 'setback') {
          const bw = avail - 4 - (avail % 2), bd = bw;
          setbackTower(s, { width: bw, depth: bd, height: h, ...pal, spire: rng.int(8, 20), tiers: rng.int(3, 5) }, ix0 + 2, iz0 + 2);
        } else {
          const bw = rng.int(Math.max(8, avail - 8), avail - 2), bd = rng.int(Math.max(8, avail - 8), avail - 2);
          glassTower(s, { width: bw, depth: bd, height: h, ...pal, spire: rng.chance(0.6) ? rng.int(6, 18) : 0 }, ix0 + Math.floor((avail - bw) / 2), iz0 + Math.floor((avail - bd) / 2));
        }
      } else if (h >= 14) {
        const bw = rng.int(Math.max(6, Math.ceil(avail * 0.6)), avail - 2), bd = rng.int(Math.max(6, Math.ceil(avail * 0.6)), avail - 2);
        midrise(s, ix0 + Math.floor((avail - bw) / 2), iz0 + Math.floor((avail - bd) / 2), bw, bd, h, p, rng);
      } else {
        shops(s, ix0, iz0, ix1, iz1, Math.min(h, 12), p, rng);
      }
    }
  }

  if (p.details) parkedCars(s, n, m, CELL, SW, rng);
  if (p.highway) {
    greenBelt(s, GW, GD, HW + HGAP, HGAP, rng, p.details);
    highway(s, GW, GD, HW, HGAP, HY, rng, p.details);
  }
}

/** Grass ground between the street grid and the outer edge of the highway, with a row of trees. */
function greenBelt(s, GW, GD, M, HGAP, rng, details) {
  for (let x = -M; x < GW + M; x++) {
    for (let z = -M; z < GD + M; z++) {
      if (x >= 0 && x < GW && z >= 0 && z < GD) continue;
      if (s.get(x, -1, z) == null) s.set(x, -1, z, 'grass_block');
    }
  }
  if (!details) return;
  const d = Math.ceil(HGAP / 2); // tree line in the middle of the gap
  const spots = [];
  for (let x = 4; x < GW - 4; x += 9) spots.push([x, -d], [x, GD - 1 + d]);
  for (let z = 4; z < GD - 4; z += 9) spots.push([-d, z], [GW - 1 + d, z]);
  for (const [x, z] of spots) {
    if (!rng.chance(0.8)) continue;
    buildTree(s, x, 0, z, { type: rng.pick(['birch', 'birch', 'oak', 'azalea']), height: 0 }, rng);
    for (let k = 0; k < 2; k++) {
      const fx = x + rng.int(-2, 2), fz = z + rng.int(-1, 1);
      if (s.get(fx, 0, fz) == null && s.get(fx, -1, fz) === 'grass_block') plant(s, fx, 0, fz, rng.pick(['poppy', 'dandelion', 'short_grass', 'cornflower']));
    }
  }
}

function nearIntersection(v, CELL, SW) {
  const o = ((v % CELL) + CELL) % CELL;
  return o < SW + 2 || o >= CELL - 2;
}
function crossingZone(v, CELL, SW) {
  const o = ((v % CELL) + CELL) % CELL;
  return (o >= SW && o < SW + 2) || (o >= CELL - 2);
}

function sidewalk(s, x0, z0, x1, z1, p, rng) {
  s.fill(x0, -1, z0, x1, -1, z1, 'stone');
  s.fill(x0, 0, z0, x1, 0, z1, 'smooth_stone_slab[type=bottom]', { mode: 'walls' });
  s.fill(x0 + 1, 0, z0 + 1, x1 - 1, 0, z1 - 1, 'smooth_stone_slab[type=bottom]', { mode: 'walls' });
  // street lamps at the corners (arms over the street) and mid-block
  const L = (x, z, f) => lamp(s, x, 0, z, { style: 'street', height: 5, post: 'polished_blackstone_wall', facing: f, arm: 1 });
  L(x0, z0, 'north'); L(x1, z0, 'east'); L(x1, z1, 'south'); L(x0, z1, 'west');
  if (x1 - x0 >= 16) {
    const mx = Math.floor((x0 + x1) / 2), mz = Math.floor((z0 + z1) / 2);
    L(mx, z0, 'north'); L(mx, z1, 'south'); L(x0, mz, 'west'); L(x1, mz, 'east');
  }
  if (!p.details) return;
  // street trees in planters on the inner sidewalk row (away from lamps and entrances)
  const mx = Math.floor((x0 + x1) / 2), mz = Math.floor((z0 + z1) / 2);
  const spots = [];
  for (let x = x0 + 3; x <= x1 - 3; x += 5) if (Math.abs(x - mx) > 1) spots.push([x, z0 + 1], [x, z1 - 1]);
  for (let z = z0 + 3; z <= z1 - 3; z += 5) if (Math.abs(z - mz) > 1) spots.push([x0 + 1, z], [x1 - 1, z]);
  for (const [x, z] of spots) {
    if (!rng.chance(0.7)) continue;
    s.set(x, -1, z, 'grass_block');
    s.fill(x, 0, z, x, 2, z, 'oak_log[axis=y]');
    for (let dy = 3; dy <= 4; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (dy === 4 && dx !== 0 && dz !== 0) continue;
      if (s.get(x + dx, dy, z + dz) == null) s.set(x + dx, dy, z + dz, 'oak_leaves[persistent=true]');
    }
    s.set(x, 5, z, 'oak_leaves[persistent=true]');
  }
}

function park(s, x0, z0, x1, z1, p, rng) {
  s.fill(x0, -1, z0, x1, -1, z1, 'grass_block');
  const cx = Math.floor((x0 + x1) / 2), cz = Math.floor((z0 + z1) / 2);
  // cross paths
  s.fill(cx - 1, -1, z0, cx + 1, -1, z1, 'dirt_path');
  s.fill(x0, -1, cz - 1, x1, -1, cz + 1, 'dirt_path');
  const size = x1 - x0 + 1;
  const fr = size >= 15 ? 3 : 2;
  if (size >= 11) buildFountain(s, cx, cz, { radius: fr, material: 'stone_bricks', height: 2, lights: false });
  // trees in the four quadrants
  const types = ['oak', 'birch', 'cherry', 'oak', 'dark_oak', 'spruce', 'azalea'];
  const quads = [[x0, z0, cx - 2, cz - 2], [cx + 2, z0, x1, cz - 2], [x0, cz + 2, cx - 2, z1], [cx + 2, cz + 2, x1, z1]];
  for (const [qx0, qz0, qx1, qz1] of quads) {
    if (qx1 - qx0 < 3 || qz1 - qz0 < 3) continue;
    const tx = Math.floor((qx0 + qx1) / 2) + rng.int(-1, 1), tz = Math.floor((qz0 + qz1) / 2) + rng.int(-1, 1);
    buildTree(s, tx, 0, tz, { type: rng.pick(types) }, rng);
    // flowers and grass tufts
    for (let k = 0; k < 6; k++) {
      const fx = rng.int(qx0, qx1), fz = rng.int(qz0, qz1);
      if (s.get(fx, 0, fz) == null && s.get(fx, -1, fz) === 'grass_block') {
        plant(s, fx, 0, fz, rng.pick(['poppy', 'dandelion', 'cornflower', 'allium', 'oxeye_daisy', 'short_grass', 'short_grass', 'azure_bluet']));
      }
    }
  }
  // benches facing the paths and lamps at the path ends
  for (const [bx, bz, f] of [[cx - 2, z0 + 2, 'east'], [cx + 2, z1 - 2, 'west'], [x0 + 2, cz - 2, 'south'], [x1 - 2, cz + 2, 'north']]) {
    if (s.get(bx, 0, bz) == null) chair(s, bx, 0, bz, { facing: f, material: 'spruce' });
  }
  for (const [lx, lz] of [[cx - 2, z0], [cx + 2, z1], [x0, cz + 2], [x1, cz - 2]]) {
    if (s.get(lx, 0, lz) == null) lamp(s, lx, 0, lz, { style: 'post', height: 3, post: 'dark_oak_fence' });
  }
}

function frontDoor(s, x0, w, z, y = 1) {
  if (w % 2) door(s, x0 + (w - 1) / 2, y, z, { facing: 'south', material: 'dark_oak' });
  else doubleDoor(s, x0 + w / 2 - 1, y, z, { facing: 'south', material: 'dark_oak' });
}

function midrise(s, x0, z0, w, d, h, p, rng) {
  const pal = rng.pick(MID_PALETTES);
  const style = rng.pick(['strips', 'grid', 'ribbon']);
  const { body, glass, accent } = pal;
  s.fill(x0, 0, z0, x0 + w - 1, 0, z0 + d - 1, 'polished_andesite');
  for (let y = 1; y < h; y++) {
    const f = (y - 5) % 4;
    for (let x = x0; x < x0 + w; x++) {
      for (let z = z0; z < z0 + d; z++) {
        const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
        if (!edge) continue;
        const corner = (x === x0 || x === x0 + w - 1) && (z === z0 || z === z0 + d - 1);
        const ep = z === z0 || z === z0 + d - 1 ? x - x0 : z - z0;
        let b;
        if (corner) b = accent;
        else if (y <= 3) b = ep % 4 === 0 ? body : 'glass';
        else if (y === 4) b = accent;
        else if (f === 0) b = body;
        else if (style === 'strips') b = ep % 2 === 1 ? glass : body;
        else if (style === 'grid') b = ep % 3 !== 0 && f !== 3 ? glass : body;
        else b = f !== 3 ? glass : body;
        s.set(x, y, z, b);
      }
    }
    if (y >= 5 && f === 0) s.fill(x0 + 1, y, z0 + 1, x0 + w - 2, y, z0 + d - 2, body);
  }
  frontDoor(s, x0, w, z0 + d - 1);
  // cornice + roof
  s.fill(x0, h, z0, x0 + w - 1, h, z0 + d - 1, accent);
  s.fill(x0, h + 1, z0, x0 + w - 1, h + 1, z0 + d - 1, body, { mode: 'walls' });
  if (p.details) rooftop(s, x0 + 1, z0 + 1, x0 + w - 2, z0 + d - 2, h + 1, rng);
}

function shops(s, x0, z0, x1, z1, h, p, rng) {
  // one or two shop buildings side by side, each with a storefront, awning and flat roof
  const total = x1 - x0 + 1;
  const units = total >= 16 && rng.chance(0.6) ? 2 : 1;
  const uw = Math.floor((total - (units - 1)) / units);
  for (let u = 0; u < units; u++) {
    const bx0 = x0 + u * (uw + 1), bx1 = bx0 + uw - 1;
    const bd = rng.int(Math.max(8, z1 - z0 - 6), z1 - z0 + 1);
    const bz1 = z1, bz0 = z1 - bd + 1;
    const hh = Math.max(6, h - rng.int(0, 3));
    const wall = rng.pick(SHOP_WALLS);
    const w = bx1 - bx0 + 1;
    s.fill(bx0, 0, bz0, bx1, 0, bz1, 'spruce_planks');
    s.fill(bx0, 1, bz0, bx1, hh - 1, bz1, wall, { mode: 'walls' });
    // storefront
    s.fill(bx0 + 1, 1, bz1, bx1 - 1, 3, bz1, 'glass_pane');
    frontDoor(s, bx0, w, bz1);
    const aw = `${rng.pick(AWNINGS)}_wool`;
    s.fill(bx0 + 1, 4, bz1 + 1, bx1 - 1, 4, bz1 + 1, aw);
    // upper floor windows
    for (let y = 6; y <= hh - 3; y += 4) {
      for (let x = bx0 + 2; x <= bx1 - 2; x += 3) { s.set(x, y, bz1, 'glass_pane'); s.set(x, y + 1, bz1, 'glass_pane'); s.set(x, y, bz0, 'glass_pane'); s.set(x, y + 1, bz0, 'glass_pane'); }
      for (let z = bz0 + 2; z <= bz1 - 2; z += 3) { s.set(bx0, y, z, 'glass_pane'); s.set(bx0, y + 1, z, 'glass_pane'); s.set(bx1, y, z, 'glass_pane'); s.set(bx1, y + 1, z, 'glass_pane'); }
      s.fill(bx0 + 1, y - 1, bz0 + 1, bx1 - 1, y - 1, bz1 - 1, 'spruce_planks');
    }
    s.fill(bx0, hh, bz0, bx1, hh, bz1, wall);
    s.fill(bx0, hh + 1, bz0, bx1, hh + 1, bz1, slab('stone_bricks'), { mode: 'walls' });
    s.set(bx0, 3, bz1 + 1, 'wall_torch[facing=south]');
    if (p.details && rng.chance(0.5)) rooftop(s, bx0 + 1, bz0 + 1, bx1 - 1, bz1 - 1, hh + 1, rng);
  }
}

function rooftop(s, x0, z0, x1, z1, y, rng) {
  const w = x1 - x0 + 1, d = z1 - z0 + 1;
  if (w < 4 || d < 4) return;
  const kind = rng.pick(['water', 'ac', 'antenna', 'helipad', 'ac', 'garden']);
  const cx = Math.floor((x0 + x1) / 2), cz = Math.floor((z0 + z1) / 2);
  if (kind === 'water' && w >= 6) {
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) s.fill(cx + dx, y, cz + dz, cx + dx, y + 2, cz + dz, 'spruce_fence');
    s.fill(cx - 1, y + 3, cz - 1, cx + 1, y + 5, cz + 1, 'spruce_planks');
    s.set(cx, y + 6, cz, slab('spruce'));
  } else if (kind === 'helipad' && w >= 7 && d >= 7) {
    s.fill(cx - 3, y, cz - 3, cx + 3, y, cz + 3, 'gray_concrete');
    for (let dz = -2; dz <= 2; dz++) { s.set(cx - 1, y, cz + dz, 'yellow_concrete'); s.set(cx + 1, y, cz + dz, 'yellow_concrete'); }
    s.set(cx, y, cz, 'yellow_concrete');
  } else if (kind === 'antenna') {
    const ah = rng.int(4, 8);
    s.fill(cx, y, cz, cx, y + ah - 1, cz, 'iron_bars');
    s.set(cx, y + ah, cz, 'end_rod[facing=up]');
  } else if (kind === 'garden') {
    s.fill(x0 + 1, y - 1, z0 + 1, x1 - 1, y - 1, z1 - 1, 'grass_block');
    for (let k = 0; k < 6; k++) plant(s, rng.int(x0 + 1, x1 - 1), y, rng.int(z0 + 1, z1 - 1), rng.pick(['poppy', 'dandelion', 'short_grass', 'azalea']));
  } else {
    for (let k = 0; k < Math.min(4, Math.floor(w / 3)); k++) {
      const ax = rng.int(x0, x1 - 1), az = rng.int(z0, z1);
      if (s.get(ax, y, az) == null && s.get(ax + 1, y, az) == null) {
        s.set(ax, y, az, 'light_gray_concrete');
        s.set(ax + 1, y, az, 'iron_block');
        s.set(ax + 1, y + 1, az, 'iron_trapdoor[facing=north,half=bottom,open=false]');
      }
    }
  }
}

function car(s, x, z, color, axis = 'x') {
  const body = `${color}_concrete`;
  for (let k = 0; k < 3; k++) {
    const X = axis === 'x' ? x + k : x, Z = axis === 'x' ? z : z + k;
    s.set(X, 0, Z, body);
    if (k === 1) s.set(X, 1, Z, 'black_stained_glass');
  }
}

function parkedCars(s, n, m, CELL, SW, rng) {
  // along the curb lanes of east-west streets
  for (let j = 0; j <= m; j++) {
    const z0 = j * CELL;
    for (let i = 0; i < n; i++) {
      const xa = i * CELL + SW + 3, xb = i * CELL + CELL - 6;
      for (let x = xa; x <= xb; x += rng.int(5, 9)) {
        if (!rng.chance(0.45)) continue;
        const lane = rng.chance(0.5) ? z0 : z0 + SW - 1;
        car(s, x, lane, rng.pick(CAR_COLORS));
      }
    }
  }
  for (let i = 0; i <= n; i++) {
    const x0 = i * CELL;
    for (let j = 0; j < m; j++) {
      const za = j * CELL + SW + 3, zb = j * CELL + CELL - 6;
      for (let z = za; z <= zb; z += rng.int(6, 10)) {
        if (!rng.chance(0.35)) continue;
        const lane = rng.chance(0.5) ? x0 : x0 + SW - 1;
        car(s, lane, z, rng.pick(CAR_COLORS), 'z');
      }
    }
  }
}

function highway(s, GW, GD, HW, HGAP, HY, rng, details) {
  const X0 = -HGAP - HW, X1 = GW - 1 + HGAP + HW, Z0 = -HGAP - HW, Z1 = GD - 1 + HGAP + HW;
  const inRing = (x, z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1 && !(x >= X0 + HW && x <= X1 - HW && z >= Z0 + HW && z <= Z1 - HW);
  // deck with barriers and a yellow centre line
  for (let x = X0; x <= X1; x++) {
    for (let z = Z0; z <= Z1; z++) {
      if (!inRing(x, z)) continue;
      const dOut = Math.min(x - X0, X1 - x, z - Z0, Z1 - z); // distance from the outer edge
      s.set(x, HY, z, dOut === Math.floor(HW / 2) ? 'yellow_concrete' : 'gray_concrete');
      s.set(x, HY - 1, z, 'light_gray_concrete');
      if (dOut === 0 || dOut === HW - 1) s.set(x, HY + 1, z, 'andesite_wall');
    }
  }
  // pillars (T-shaped piers) every 12 blocks around the ring
  const mid = Math.floor(HW / 2);
  const pier = (x, z, alongX) => {
    s.fill(x, 0, z, x, HY - 2, z, 'light_gray_concrete');
    if (alongX) s.fill(x, HY - 2, z - mid, x, HY - 2, z + mid, 'light_gray_concrete');
    else s.fill(x - mid, HY - 2, z, x + mid, HY - 2, z, 'light_gray_concrete');
  };
  for (let x = X0 + mid; x <= X1 - mid; x += 12) { pier(x, Z0 + mid, true); pier(x, Z1 - mid, true); }
  for (let z = Z0 + mid + 12; z <= Z1 - mid - 12; z += 12) { pier(X0 + mid, z, false); pier(X1 - mid, z, false); }
  // lanterns on the barriers
  for (let x = X0 + 4; x <= X1 - 4; x += 10) for (const z of [Z0, Z1]) s.set(x, HY + 2, z, 'lantern[hanging=false]');
  for (let z = Z0 + 4; z <= Z1 - 4; z += 10) for (const x of [X0, X1]) s.set(x, HY + 2, z, 'lantern[hanging=false]');
  // exit ramps running alongside the south (descending east) and north (descending west) edges
  rampAlong(s, Math.floor((X0 + X1) / 2) - 6, Z1 + 1, 1, HY);
  rampAlong(s, Math.floor((X0 + X1) / 2) + 6, Z0 - 4, -1, HY);
  // cars on the highway
  if (details) {
    for (let k = 0; k < 10; k++) {
      const x = rng.int(X0 + 8, X1 - 12);
      const z = rng.chance(0.5) ? Z0 + rng.pick([1, 2, 4, 5]) : Z1 - rng.pick([1, 2, 4, 5]);
      const body = `${rng.pick(CAR_COLORS)}_concrete`;
      if (s.get(x, HY + 1, z) != null || s.get(x + 2, HY + 1, z) != null) continue;
      s.fill(x, HY + 1, z, x + 2, HY + 1, z, body);
      s.set(x + 1, HY + 2, z, 'black_stained_glass');
    }
  }
}

/** A 4-wide ramp beside the ring: level with the deck for 4 blocks (merge), then down to the ground. */
function rampAlong(s, xStart, z0, dir, HY) {
  const RW = 4;
  // open the ring barrier where the ramp merges (and drop the lanterns that stood on it)
  for (let k = -1; k <= 4; k++) {
    const x = xStart + dir * k;
    const barrierZ = dir > 0 ? z0 - 1 : z0 + RW;
    if (s.get(x, HY + 1, barrierZ) === 'andesite_wall') s.set(x, HY + 1, barrierZ, 'air');
    if (/lantern/.test(s.get(x, HY + 2, barrierZ) ?? '')) s.set(x, HY + 2, barrierZ, null);
  }
  for (let k = 0; ; k++) {
    const x = xStart + dir * k;
    const top = HY + 1 - Math.max(0, k - 3) * 0.5; // surface height
    if (top <= 0) break;
    const full = Number.isInteger(top);
    const yb = full ? top - 1 : Math.floor(top);
    for (let z = z0; z < z0 + RW; z++) {
      if (yb > 0) s.fill(x, 0, z, x, yb - 1, z, 'light_gray_concrete');
      s.set(x, yb, z, full ? 'gray_concrete' : 'smooth_stone_slab[type=bottom]');
    }
    if (top > 1) s.set(x, yb + 1, dir > 0 ? z0 + RW : z0 - 1, 'andesite_wall');
  }
}
