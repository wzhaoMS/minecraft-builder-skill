import {
  materialFamily, stairs, slab, door, doubleDoor, bed, gableRoof, hipRoof, flatRoof, decorateWindow, lamp, carpet, chair,
  withAxis, finish, topAt, plant,
} from './helpers.js';

/**
 * A cozy house: foundation course, timber-framed walls (corner posts, beams, door frame), windows
 * with sills and shutters, a gable / hip / flat roof with eaves, chimney with smoke, lanterns and
 * furniture. Compatible with the v1 blueprint generator params
 * { width, depth, height, wall, roof, floor }.
 */
export default {
  name: 'house',
  description: 'Cozy timber-framed house: gable/hip/flat roof, windows, door on the south, chimney, lights, furniture',
  params: {
    style: { type: 'enum', values: ['classic', 'medieval', 'rustic', 'modern'], default: 'classic', description: 'material preset (explicit params override it): classic = red walls; medieval = white walls, dark-oak frame; rustic = spruce cabin; modern = white concrete, flat roof' },
    width: { type: 'int', default: 8, min: 5, max: 48, description: 'wall footprint along X (the eaves add `overhang` on each side)' },
    depth: { type: 'int', default: 8, min: 5, max: 48, description: 'wall footprint along Z (the eaves add `overhang` on each side)' },
    height: { type: 'int', default: 5, min: 4, max: 24, description: 'wall height incl. the foundation course (≥9 → 2 storeys, ≥13 → 3)' },
    wall: { type: 'block', default: 'red_concrete', description: 'wall infill (try white_terracotta, spruce_planks, cobblestone, bricks)' },
    roof: { type: 'block', default: 'dark_oak_planks', description: 'roof material — its stairs/slabs are used (no stairs → stepped roof)' },
    floor: { type: 'block', default: 'stone_bricks', description: 'interior floor' },
    roofStyle: { type: 'enum', values: ['gable', 'hip', 'flat'], default: 'gable', description: 'roof shape' },
    ridge: { type: 'enum', values: ['auto', 'x', 'z'], default: 'auto', description: 'gable ridge direction (auto: along the longer side, front gable when square)' },
    trim: { type: 'block', default: '', description: 'corner posts / beams (default: stripped log matching the roof wood)' },
    foundation: { type: 'block', default: 'cobblestone', description: 'foundation course at y=0' },
    door: { type: 'block', default: '', description: 'door material (default: matches the trim wood)' },
    glass: { type: 'block', default: 'glass_pane', description: 'window block' },
    windows: { type: 'bool', default: true, description: 'windows on all sides' },
    shutters: { type: 'bool', default: true, description: 'window sills and shutters' },
    overhang: { type: 'int', default: 1, min: 0, max: 3, description: 'roof overhang (eaves)' },
    chimney: { type: 'bool', default: true, description: 'brick chimney with campfire smoke' },
    lights: { type: 'bool', default: true, description: 'lanterns by the door and inside' },
    interior: { type: 'bool', default: true, description: 'furniture: bed, chest, crafting table, table & chairs, carpet' },
  },
  presets: {
    classic: {},
    medieval: { wall: 'white_terracotta', roof: 'dark_oak_planks', trim: 'stripped_dark_oak_log', foundation: 'cobblestone', floor: 'spruce_planks', height: 6 },
    rustic: { wall: 'spruce_planks', roof: 'spruce_planks', trim: 'spruce_log', foundation: 'mossy_cobblestone', floor: 'oak_planks' },
    modern: {
      wall: 'white_concrete', roof: 'smooth_quartz', roofStyle: 'flat', trim: 'smooth_quartz', foundation: 'gray_concrete',
      floor: 'polished_andesite', glass: 'gray_stained_glass_pane', shutters: false, chimney: false, door: 'birch_door',
    },
  },
  build(s, p, ctx) {
    buildHouse(s, p, ctx.rng);
  },
};

/** Spread windows over a wall segment of `len` cells: returns [{ off, w }] symmetric layouts. */
function windowLayout(len) {
  if (len <= 0) return [];
  if (len <= 2) return [{ off: 0, w: len }];
  let best = null;
  for (const ww of [1, 2, 3]) {
    for (const g of [2, 1, 3]) {
      for (let n = 1; n <= 8; n++) {
        const used = n * ww + (n - 1) * g;
        const rem = len - used;
        if (rem < 2) break;
        if (rem % 2) continue;
        const glass = (n * ww) / len;
        const score = -Math.abs(glass - 0.4) - (n > 1 ? 0.05 * Math.abs(g - 2) : 0) - 0.05 * Math.abs(rem / 2 - 1.5) - (ww === 3 ? 0.05 : 0) + 0.01 * (n - 1);
        if (!best || score > best.score + 1e-9) best = { score, ww, g, n, rem };
      }
    }
  }
  if (!best) return [{ off: Math.floor((len - 1) / 2), w: 1 }];
  const out = [];
  for (let i = 0; i < best.n; i++) out.push({ off: best.rem / 2 + i * (best.ww + best.g), w: best.ww });
  return out;
}

/** Split [a..b] by posts (sorted positions within) into open segments. */
function segments(a, b, posts) {
  const out = [];
  let start = a;
  for (const q of [...posts].sort((m, n) => m - n)) {
    if (q < a || q > b) continue;
    if (q > start) out.push([start, q - 1]);
    start = q + 1;
  }
  if (start <= b) out.push([start, b]);
  return out;
}

/** Add posts so that no open segment is longer than `max`. */
function addMidPosts(a, b, posts, max = 10) {
  const out = [...posts];
  for (const [s0, s1] of segments(a, b, posts)) {
    const len = s1 - s0 + 1;
    if (len <= max) continue;
    const m = Math.ceil((len + 1) / (max + 1));
    for (let i = 1; i < m; i++) out.push(s0 + Math.round((i * (len + 1)) / m) - 1);
  }
  return out;
}

export function buildHouse(s, p, rng) {
  const W = p.width, D = p.depth, H = p.height;
  const roofFam = materialFamily(p.roof);
  const wallFam = materialFamily(p.wall);
  const woodType = roofFam.kind === 'wood' ? roofFam.type : wallFam.kind === 'wood' ? wallFam.type : 'spruce';
  const woodFam = materialFamily(woodType);
  let trim = p.trim;
  if (!trim) trim = wallFam.kind === 'wood' && wallFam.type === woodType ? woodFam.log : woodFam.strippedLog;
  const trimFam = materialFamily(trim);
  const frameWood = trimFam.kind === 'wood' ? trimFam.type : woodType;
  const frameFam = materialFamily(frameWood);
  const planks = frameFam.planks ?? 'spruce_planks';
  const doorMat = p.door || frameFam.door || 'spruce_door';
  const post = withAxis(trim, 'y');
  const beamX = withAxis(trim, 'x');
  const beamZ = withAxis(trim, 'z');
  const gableFill = p.wall;
  const sillMat = frameFam.stairs ? frameWood : p.foundation;

  // storeys: beams at the top of each storey
  const stories = H >= 13 ? 3 : H >= 9 ? 2 : 1;
  const storyH = Math.floor((H - 1) / stories);
  const beams = [];
  for (let k = 1; k < stories; k++) beams.push(k * storyH);
  beams.push(H - 1);
  const top = H - 1;

  // ── door ──
  const single = W % 2 === 1;
  const doorX0 = single ? (W - 1) / 2 : W / 2 - 1;
  const doorX1 = single ? doorX0 : doorX0 + 1;
  const flank = W >= 7;
  const frontPosts = [0, W - 1];
  if (flank) frontPosts.push(doorX0 - 1, doorX1 + 1);

  // ── roof planning (needed to keep windows away from the chimney) ──
  const ridge = p.ridge === 'auto' ? (W > D ? 'x' : 'z') : p.ridge;
  let chim = null; // { cells: [[x,z]], wall: 'north'|'east'|null }
  if (p.chimney) {
    if (p.roofStyle === 'gable' && ridge === 'z' && W >= 5) {
      chim = { cells: single ? [[doorX0, 0]] : [[doorX0, 0], [doorX1, 0]], wall: 'north' };
    } else if (p.roofStyle === 'gable' && ridge === 'x' && D >= 5) {
      const cz0 = D % 2 ? (D - 1) / 2 : D / 2 - 1;
      chim = { cells: D % 2 ? [[W - 1, cz0]] : [[W - 1, cz0], [W - 1, cz0 + 1]], wall: 'east' };
    } else {
      chim = { cells: [[W - 3, 1]], wall: null };
    }
  }
  const ladderZ = stories > 1 ? 1 : null;

  // posts per wall (positions along the wall's axis)
  const wallsDef = [
    { side: 'south', axis: 'x', fixed: D - 1, len: W, posts: frontPosts },
    { side: 'north', axis: 'x', fixed: 0, len: W, posts: [0, W - 1, ...(chim?.wall === 'north' ? chim.cells.map((c) => c[0]) : [])] },
    { side: 'east', axis: 'z', fixed: W - 1, len: D, posts: [0, D - 1, ...(chim?.wall === 'east' ? chim.cells.map((c) => c[1]) : []), ...(ladderZ != null ? [ladderZ] : [])] },
    { side: 'west', axis: 'z', fixed: 0, len: D, posts: [0, D - 1] },
  ];
  for (const w of wallsDef) w.posts = addMidPosts(0, w.len - 1, w.posts);
  const at = (w, i) => (w.axis === 'x' ? [i, w.fixed] : [w.fixed, i]);

  // ── foundation, floor, interior air ──
  s.fill(0, 0, 0, W - 1, 0, D - 1, p.foundation);
  s.fill(1, 0, 1, W - 2, 0, D - 2, p.floor);
  s.fill(1, 1, 1, W - 2, top, D - 2, 'air');

  // ── walls with timber frame ──
  for (const w of wallsDef) {
    const chimneyCells = new Set((chim?.wall === w.side ? chim.cells : []).map(([x, z]) => `${x},${z}`));
    for (let i = 0; i < w.len; i++) {
      const [x, z] = at(w, i);
      const isPost = w.posts.includes(i);
      for (let y = 1; y <= top; y++) {
        let b = p.wall;
        if (chimneyCells.has(`${x},${z}`)) b = 'bricks';
        else if (isPost) b = post;
        else if (beams.includes(y)) b = w.axis === 'x' ? beamX : beamZ;
        s.set(x, y, z, b);
      }
    }
  }
  // corners always posts
  for (const [x, z] of [[0, 0], [W - 1, 0], [0, D - 1], [W - 1, D - 1]]) s.fill(x, 1, z, x, top, z, post);

  // interior floors / ceilings
  for (const by of beams) s.fill(1, by, 1, W - 2, by, D - 2, planks);

  // ── door, frame, step ──
  if (single) door(s, doorX0, 1, D - 1, { facing: 'south', material: doorMat, hinge: 'left' });
  else doubleDoor(s, doorX0, 1, D - 1, { facing: 'south', material: doorMat });
  if (flank && beams[0] > 3) s.fill(doorX0 - 1, 3, D - 1, doorX1 + 1, 3, D - 1, beamX); // lintel
  const fFam = materialFamily(p.foundation);
  for (let x = doorX0; x <= doorX1; x++) s.set(x, 0, D, fFam.stairs ? stairs(p.foundation, 'north') : slab(p.foundation));

  // ── lights by the door: lanterns hanging from fence brackets ──
  if (p.lights) {
    const ly = Math.min(beams[0] - 1, 3);
    for (const x of [doorX0 - 1, doorX1 + 1]) lamp(s, x, ly - 1, D, { style: 'wall', post: frameFam.fence ?? 'spruce_fence' });
  }

  // ── windows ──
  if (p.windows) {
    for (const w of wallsDef) {
      const open = segments(1, w.len - 2, w.posts);
      for (let k = 0; k < stories; k++) {
        const base = k === 0 ? 0 : beams[k - 1];
        const ceil = beams[k];
        const y0 = base + 2;
        const y1 = Math.min(ceil - 1, base + 3);
        if (y1 < y0) continue;
        for (const [a, b] of open) {
          // keep the door bay free on the ground floor
          if (k === 0 && w.side === 'south' && a <= doorX1 && b >= doorX0) continue;
          for (const win of windowLayout(b - a + 1)) {
            const cells = [];
            for (let i = 0; i < win.w; i++) cells.push(at(w, a + win.off + i));
            for (const [x, z] of cells) s.fill(x, y0, z, x, y1, z, p.glass);
            if (p.shutters) {
              decorateWindow(s, cells, y0, y1 - y0 + 1, w.side, { sill: sillMat, shutters: k === 0 || w.side === 'south' ? frameWood : null });
            }
            if (k === 0 && w.side === 'south' && p.shutters && rng.chance(0.85)) {
              const pots = ['potted_red_tulip', 'potted_poppy', 'potted_blue_orchid', 'potted_allium', 'potted_azure_bluet', 'potted_oxeye_daisy', 'potted_cornflower', 'potted_fern'];
              const [x, z] = cells[Math.floor(cells.length / 2)];
              if (s.get(x, y0, z + 1) == null) s.set(x, y0, z + 1, rng.pick(pots));
            }
          }
        }
      }
    }
  }

  // ── roof ──
  const roofY = H;
  let roofTop = roofY;
  if (p.roofStyle === 'gable') {
    const r = gableRoof(s, { x1: 0, z1: 0, x2: W - 1, z2: D - 1, y: roofY, material: p.roof, ridge, overhang: p.overhang, gableFill });
    roofTop = r.topY;
    // gable windows (front gable keeps one centred, back gable only if no chimney there)
    if (p.windows) {
      const span = ridge === 'x' ? D : W;
      const gw = span % 2 ? 1 : 2;
      const gy = roofY + 1;
      if (span - 2 * 2 - 2 >= gw) {
        const c0 = span % 2 ? (span - 1) / 2 : span / 2 - 1;
        for (const end of ridge === 'x' ? ['west', 'east'] : ['south', 'north']) {
          if (chim?.wall === end) continue;
          for (let i = 0; i < gw; i++) {
            const pos = c0 + i;
            const [x, z] = ridge === 'x' ? [end === 'west' ? 0 : W - 1, pos] : [pos, end === 'north' ? 0 : D - 1];
            s.set(x, gy, z, p.glass);
          }
        }
      }
    }
  } else if (p.roofStyle === 'hip') {
    roofTop = hipRoof(s, { x1: 0, z1: 0, x2: W - 1, z2: D - 1, y: roofY, material: p.roof, overhang: p.overhang }).topY;
  } else {
    const r = flatRoof(s, { x1: 0, z1: 0, x2: W - 1, z2: D - 1, y: roofY, material: roofFam.base ?? p.roof, parapetMaterial: trimFam.kind === 'wood' ? p.wall : trim, overhang: 0 });
    roofTop = r.topY;
  }
  // attic: clear the space under the roof
  for (let x = 1; x <= W - 2; x++) {
    for (let z = 1; z <= D - 2; z++) {
      for (let y = roofY; y <= roofTop; y++) {
        if (s.get(x, y, z) != null) break;
        s.set(x, y, z, 'air');
      }
    }
  }

  // ── chimney ──
  if (chim) {
    let maxRoof = roofY;
    for (const [x, z] of chim.cells) {
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = topAt(s, x + dx, z + dz, roofY - 2, roofTop + 2);
        if (t != null && t > maxRoof) maxRoof = t;
      }
    }
    const chTop = maxRoof + 1;
    for (const [x, z] of chim.cells) s.fill(x, 1, z, x, chTop, z, 'bricks');
    const [cx, cz] = chim.cells[0];
    s.set(cx, chTop + 1, cz, 'campfire[facing=south,lit=true,signal_fire=false]');
    if (chim.cells.length > 1) s.set(chim.cells[1][0], chTop + 1, chim.cells[1][1], slab('bricks'));
  }

  // ── interior ──
  const occupied = new Set();
  const free = (x, y, z) => x >= 1 && x <= W - 2 && z >= 1 && z <= D - 2 && !occupied.has(`${x},${y},${z}`) && s.get(x, y, z) === 'air';
  const mark = (x, y, z) => occupied.add(`${x},${y},${z}`);
  // keep the entrance path clear
  for (let z = 1; z <= D - 2; z++) for (let x = doorX0; x <= doorX1; x++) if (z >= D - 3) mark(x, 1, z);
  if (chim && !chim.wall) for (const [x, z] of chim.cells) for (let y = 1; y <= top; y++) mark(x, y, z);

  // ladder between storeys (east wall, near the back; the wall cell behind it is a post)
  if (ladderZ != null) {
    for (let y = 1; y <= beams[stories - 2]; y++) {
      s.set(W - 2, y, ladderZ, 'ladder[facing=west]');
      mark(W - 2, y, ladderZ);
    }
  }

  if (p.interior && W >= 6 && D >= 6) {
    const bedColor = rng.pick(['red', 'blue', 'light_blue', 'green', 'yellow', 'white', 'cyan', 'orange']);
    const rugColor = rng.pick(['red', 'brown', 'white', 'light_gray', 'green', 'blue', 'orange']);
    const sleepY = stories > 1 ? beams[0] + 1 : 1;
    // bed: head against the back wall in the north-west corner
    if (free(1, sleepY, 1) && free(1, sleepY, 2)) {
      bed(s, 1, sleepY, 2, { facing: 'north', color: bedColor });
      mark(1, sleepY, 1); mark(1, sleepY, 2);
      if (free(2, sleepY, 1)) { s.set(2, sleepY, 1, 'chest[facing=south,type=single]'); mark(2, sleepY, 1); }
    }
    const y = 1;
    // kitchen corner: crafting table + furnace/smoker on the back wall, east side
    const kitchen = [[W - 2, 1, 'crafting_table'], [W - 3, 1, 'smoker[facing=south,lit=false]'], [W - 4, 1, 'barrel[facing=up,open=false]']];
    for (const [x, z, b] of kitchen) if (x > 2 && free(x, y, z)) { s.set(x, y, z, b); mark(x, y, z); }
    // table with chairs on the east side, middle of the room
    const tz = Math.floor((D - 1) / 2) + (D >= 9 ? 1 : 0);
    if (W >= 7 && D >= 7 && free(W - 2, y, tz) && free(W - 3, y, tz)) {
      const tableWood = frameFam.fence && frameFam.pressurePlate ? frameWood : 'spruce';
      s.set(W - 2, y, tz, materialFamily(tableWood).fence);
      s.set(W - 2, y + 1, tz, materialFamily(tableWood).pressurePlate);
      mark(W - 2, y, tz); mark(W - 2, y + 1, tz);
      chair(s, W - 3, y, tz, { facing: 'east', material: tableWood });
      mark(W - 3, y, tz);
      if (free(W - 2, y, tz + 1) && tz + 1 < D - 2) { chair(s, W - 2, y, tz + 1, { facing: 'north', material: tableWood }); mark(W - 2, y, tz + 1); }
    }
    // bookshelves along the west wall
    for (let z = 4; z <= Math.min(D - 3, 5); z++) {
      if (D >= 8 && free(1, y, z)) { s.set(1, y, z, 'bookshelf'); mark(1, y, z); }
    }
    // potted plant in the front-west corner
    if (free(1, y, D - 2)) { s.set(1, y, D - 2, 'potted_fern'); mark(1, y, D - 2); }
    // rug in the middle
    const rx0 = 2, rx1 = W - 3 - (W >= 7 ? 1 : 0), rz0 = 3, rz1 = D - 3;
    if (rx1 - rx0 >= 1 && rz1 - rz0 >= 1) {
      for (let x = rx0; x <= rx1; x++) for (let z = rz0; z <= rz1; z++) if (free(x, y, z) && !occupied.has(`${x},${y},${z}`)) { carpet(s, x, z, x, z, y, rugColor); }
    }
    if (stories > 1) {
      // upper storeys: a second bed + rug
      for (let k = 1; k < stories; k++) {
        const fy = beams[k - 1] + 1;
        if (fy === sleepY) continue;
        if (free(1, fy, 1) && free(1, fy, 2)) { bed(s, 1, fy, 2, { facing: 'north', color: rng.pick(['red', 'blue', 'green', 'white']) }); mark(1, fy, 1); mark(1, fy, 2); }
        if (free(2, fy, 1)) { s.set(2, fy, 1, 'chest[facing=south,type=single]'); mark(2, fy, 1); }
      }
    }
  }

  // ── lights (inside): a lantern hanging from each ceiling ──
  if (p.lights) {
    const cx = Math.floor((W - 1) / 2), cz = Math.floor((D - 1) / 2);
    for (let k = 0; k < stories; k++) {
      const ly = beams[k] - 1;
      if (s.get(cx, ly, cz) === 'air' && ly > (k === 0 ? 2 : beams[k - 1] + 2)) s.set(cx, ly, cz, 'lantern[hanging=true]');
    }
  }

  // a little greenery by the front corners
  if (p.shutters) {
    for (const x of [-1, W]) {
      if (s.get(x, 0, D) == null && rng.chance(0.9)) plant(s, x, 0, D, rng.pick(['rose_bush', 'lilac', 'peony', 'azalea', 'flowering_azalea']));
    }
  }

  finish(s);
  return s;
}
