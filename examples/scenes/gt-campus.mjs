/**
 * Georgia Tech campus — and, optionally, the Atlanta around it. Blueprint port of the legacy bot scripts
 * build-gt-city.js, build-gt-rebuild.js, build-details.js and build-realism2.js.
 *
 * The original code is kept statement by statement. Every pass is one function below and reaches the Structure
 * through three small shims (`fill`, `sb`, `blockAt`). Passes run in the order the author ran them:
 *
 *   1. campus     build-gt-city.js phase 1 — roads, Tech Green, ~20 landmark boxes, Bobby Dodd, dorms, "GT", streetlights
 *   2. city       build-gt-city.js phase 2 — Atlanta blocks around the campus and the elevated highway ring
 *   3. landmarks  build-gt-rebuild.js — Tech Tower, Crosland Tower, CULC, Bobby Dodd, College of Computing, dorm entrances
 *   4. details    build-details.js — crosswalks, traffic lights, trees, parking lots with cars, fountain, Buzz statue, …
 *   5. realism    build-realism2.js — shops, subway entrances, canal, alleys, church, hotel, hospital, MARTA, …
 *
 * What differs from the scripts:
 *   - No bot: chat / log / sleep / `/tp` lines and the `await`s are gone, and so is the chunked /fill (`fill` has no volume limit).
 *   - Coordinates are relative. The campus' north-west corner is (0, 0) (legacy: player position - 50 = 359, -536) and the
 *     ground surface is y = -1 (legacy `oy`: -62), so buildings start at y = 0 and the roads sit flush in the ground.
 *   - `bot.blockAt(vec3(...))` reads the blueprint under construction (what the earlier passes put there, properties
 *     stripped, `air` where nothing was placed) instead of a live world.
 *   - Each pass keeps its own fixed-seed LCG (12345 / 777 / 31415), so the layout matches the original; `seed` has no effect.
 *   - The 401×60×401 air "flatten" at the start of pass 1 only happens with `flatten: true` (`mcb build --clear` is the
 *     normal way to clear the site); the grass base of the campus is always placed.
 *   - Passes 4 and 5 look at the city (parking lots, billboards, rooftops, lit windows, alleys, …), so the whole pipeline
 *     always runs. With `city: false` only the campus square (x, z in 0..400) of the result is kept: the campus is the
 *     same with or without the city, and nothing is left floating around it.
 *   - Blocks are validated for Minecraft 1.21.11: `chain` is `iron_chain` since 1.21.9. Two real problems that `mcb info`
 *     pointed out are fixed as well: lanterns under a ceiling (shop lights, subway tunnel, hotel lobby) are `hanging=true`
 *     instead of floating, and the MARTA rails sit on top of the platform deck instead of replacing a row of it.
 */

// Ground surface and campus origin (legacy: oy = -62, campusX = 359, campusZ = -536)
const oy = -1;
const campusX = 0, campusZ = 0;
const CW = 400, CD = 400;

/** What the legacy `fill`, `sb` and `bot.blockAt(vec3(...))` do, against a Structure. */
function shims(world) {
  return {
    fill: (x1, y1, z1, x2, y2, z2, b) => world.fill(x1, y1, z1, x2, y2, z2, b),
    sb: (x, y, z, b) => world.set(x, y, z, b),
    blockAt: (x, y, z) => ({ name: (world.get(x, y, z) ?? 'air').replace(/[[{].*$/s, '') }),
  };
}

/** Copy the campus square (x, z in 0..CW × 0..CD, any y) of `src` into `dst`. */
function copyCampusSquare(src, dst) {
  const ids = [];
  src.forEach((x, y, z, b, id) => {
    if (x >= campusX && x <= campusX + CW && z >= campusZ && z <= campusZ + CD) dst.setId(x, y, z, (ids[id] ??= dst.idOf(b)));
  });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. CAMPUS — build-gt-city.js, phase 1
// ══════════════════════════════════════════════════════════════════════════════════════════════
function campusPass(world, { flatten }) {
  const { fill } = shims(world);

  // Building helper — glass tower with windows
  function buildTower(ox, oy, oz, w, d, h, body, glass, accent, name) {
    // Walls
    for (let yc = 0; yc < h; yc += 25) {
      const ye = Math.min(yc+24, h-1);
      fill(ox, oy+yc, oz, ox+w-1, oy+ye, oz, body);
      fill(ox, oy+yc, oz+d-1, ox+w-1, oy+ye, oz+d-1, body);
      fill(ox, oy+yc, oz, ox, oy+ye, oz+d-1, body);
      fill(ox+w-1, oy+yc, oz, ox+w-1, oy+ye, oz+d-1, body);
    }
    // Glass columns on all 4 walls
    for (let x = ox+1; x < ox+w-1; x += 2) {
      fill(x, oy+2, oz, x, oy+h-1, oz, glass);
      fill(x, oy+2, oz+d-1, x, oy+h-1, oz+d-1, glass);
    }
    for (let z = oz+1; z < oz+d-1; z += 2) {
      fill(ox, oy+2, z, ox, oy+h-1, z, glass);
      fill(ox+w-1, oy+2, z, ox+w-1, oy+h-1, z, glass);
    }
    // Floor lines every 4 blocks
    for (let y = oy+4; y < oy+h; y += 4) {
      fill(ox, y, oz, ox+w-1, y, oz, body);
      fill(ox, y, oz+d-1, ox+w-1, y, oz+d-1, body);
      fill(ox, y, oz, ox, y, oz+d-1, body);
      fill(ox+w-1, y, oz, ox+w-1, y, oz+d-1, body);
    }
    // Roof
    fill(ox, oy+h, oz, ox+w-1, oy+h, oz+d-1, accent);
    // Antenna
    const cx = ox+Math.floor(w/2), cz = oz+Math.floor(d/2);
    fill(cx, oy+h+1, cz, cx, oy+h+8, cz, accent);
    fill(cx, oy+h+9, cz, cx, oy+h+9, cz, 'sea_lantern');
    // Door
    fill(ox+Math.floor(w/2), oy, oz, ox+Math.floor(w/2)+1, oy+2, oz, 'air');
    // Lobby floor
    fill(ox+1, oy, oz+1, ox+w-2, oy, oz+d-2, 'polished_deepslate');
  }

  // Flatten campus area (400x400): the air clear is opt-in (`flatten`); `mcb build --clear` is the normal way to clear the site
  if (flatten) fill(campusX, oy+1, campusZ, campusX+CW, oy+60, campusZ+CD, 'air');
  fill(campusX, oy, campusZ, campusX+CW, oy, campusZ+CD, 'grass_block');

  // ── Roads ──
  // Main E-W roads
  const roads_ew = [
    { z: campusZ + 50, name: "10th St" },
    { z: campusZ + 150, name: "Ferst Dr" },
    { z: campusZ + 250, name: "Bobby Dodd Way" },
    { z: campusZ + 340, name: "North Ave" },
  ];
  for (const rd of roads_ew) {
    fill(campusX, oy, rd.z, campusX+CW, oy, rd.z+5, 'gray_concrete');
    fill(campusX, oy, rd.z+2, campusX+CW, oy, rd.z+2, 'yellow_concrete');
    fill(campusX, oy+1, rd.z-1, campusX+CW, oy+1, rd.z-1, 'smooth_stone_slab');
    fill(campusX, oy+1, rd.z+6, campusX+CW, oy+1, rd.z+6, 'smooth_stone_slab');
  }
  // Main N-S roads
  const roads_ns = [
    { x: campusX + 60, name: "Hemphill Ave" },
    { x: campusX + 140, name: "Atlantic Dr" },
    { x: campusX + 220, name: "Techwood Dr" },
    { x: campusX + 310, name: "Spring St" },
  ];
  for (const rd of roads_ns) {
    fill(rd.x, oy, campusZ, rd.x+5, oy, campusZ+CD, 'gray_concrete');
    fill(rd.x+2, oy, campusZ, rd.x+2, oy, campusZ+CD, 'yellow_concrete');
    fill(rd.x-1, oy+1, campusZ, rd.x-1, oy+1, campusZ+CD, 'smooth_stone_slab');
    fill(rd.x+6, oy+1, campusZ, rd.x+6, oy+1, campusZ+CD, 'smooth_stone_slab');
  }

  // ── Paths (tan concrete) ──
  // Tech Walk (diagonal-ish path through campus)
  for (let i = 0; i < 200; i++) {
    const px = campusX + 80 + i, pz = campusZ + 70 + Math.floor(i * 0.8);
    fill(px, oy, pz, px+1, oy, pz+1, 'smooth_sandstone');
  }

  // ── Green spaces ──
  // Tech Green (main quad)
  const tgx = campusX + 150, tgz = campusZ + 160;
  fill(tgx, oy, tgz, tgx+60, oy, tgz+40, 'grass_block');
  // Trees on Tech Green
  for (let tx = tgx+5; tx < tgx+60; tx += 12) {
    for (let tz = tgz+5; tz < tgz+40; tz += 12) {
      fill(tx, oy+1, tz, tx, oy+5, tz, 'oak_log');
      fill(tx-2, oy+4, tz-2, tx+2, oy+6, tz+2, 'oak_leaves');
      fill(tx-1, oy+7, tz-1, tx+1, oy+7, tz+1, 'oak_leaves');
    }
  }

  // ── GT BUILDINGS ──
  const Y = oy + 1; // building base

  // Tech Tower (Admin Building) — iconic gold-domed clock tower
  const ttx = campusX + 170, ttz = campusZ + 100;
  buildTower(ttx, Y, ttz, 20, 14, 30, 'bricks', 'white_stained_glass', 'stone_bricks', 'Tech Tower');
  // Gold dome on top
  for (let dy = 0; dy < 6; dy++) {
    const r = Math.max(1, 4 - dy);
    fill(ttx+10-r, Y+31+dy, ttz+7-r, ttx+10+r, Y+31+dy, ttz+7+r, 'gold_block');
  }
  // Clock faces (glowstone)
  fill(ttx+9, Y+25, ttz, ttx+11, Y+27, ttz, 'glowstone');
  fill(ttx+9, Y+25, ttz+13, ttx+11, Y+27, ttz+13, 'glowstone');

  // Klaus Advanced Computing Building
  buildTower(campusX+85, Y, campusZ+160, 24, 16, 20, 'light_gray_concrete', 'light_blue_stained_glass', 'white_concrete', 'Klaus Computing');

  // College of Computing (CoC)
  buildTower(campusX+85, Y, campusZ+110, 20, 14, 16, 'white_concrete', 'cyan_stained_glass', 'iron_block', 'College of Computing');

  // Crosland Tower (Library tower)
  buildTower(campusX+225, Y, campusZ+210, 10, 10, 45, 'brown_concrete', 'white_stained_glass', 'brown_terracotta', 'Crosland Tower');

  // CULC (Clough Undergraduate Learning Commons)
  buildTower(campusX+200, Y, campusZ+175, 30, 18, 15, 'white_concrete', 'light_blue_stained_glass', 'iron_block', 'CULC');

  // Student Center
  buildTower(campusX+200, Y, campusZ+260, 25, 16, 12, 'bricks', 'white_stained_glass', 'stone_bricks', 'Student Center');

  // Bobby Dodd Stadium (open-air)
  const sdx = campusX + 270, sdz = campusZ + 160;
  // Field
  fill(sdx, oy, sdz, sdx+50, oy, sdz+30, 'lime_concrete');
  // Field lines
  for (let lx = sdx+5; lx <= sdx+45; lx += 10) {
    fill(lx, oy, sdz, lx, oy, sdz+30, 'white_concrete');
  }
  // Stands (tiered)
  for (let tier = 0; tier < 8; tier++) {
    fill(sdx-3-tier, oy+tier+1, sdz, sdx-3-tier, oy+tier+1, sdz+30, 'stone');
    fill(sdx+53+tier, oy+tier+1, sdz, sdx+53+tier, oy+tier+1, sdz+30, 'stone');
    fill(sdx, oy+tier+1, sdz-3-tier, sdx+50, oy+tier+1, sdz-3-tier, 'stone');
  }
  // Scoreboard
  fill(sdx+20, oy+1, sdz+35, sdx+30, oy+10, sdz+35, 'black_concrete');
  fill(sdx+22, oy+3, sdz+35, sdx+28, oy+8, sdz+35, 'glowstone');

  // CRC (Campus Recreation Center)
  buildTower(campusX+40, Y, campusZ+220, 22, 18, 12, 'light_gray_concrete', 'light_blue_stained_glass', 'white_concrete', 'CRC');

  // Howey Physics
  buildTower(campusX+130, Y, campusZ+130, 18, 12, 14, 'white_concrete', 'gray_stained_glass', 'stone_bricks', 'Howey Physics');

  // Van Leer (ECE)
  buildTower(campusX+130, Y, campusZ+75, 16, 14, 16, 'bricks', 'white_stained_glass', 'stone_bricks', 'Van Leer ECE');

  // ISyE (Groseclose)
  buildTower(campusX+70, Y, campusZ+200, 18, 12, 14, 'gray_concrete', 'white_stained_glass', 'light_gray_concrete', 'ISyE Groseclose');

  // Scheller College of Business
  buildTower(campusX+320, Y, campusZ+90, 22, 16, 18, 'white_concrete', 'light_blue_stained_glass', 'gold_block', 'Scheller Business');

  // MRDC (Manufacturing)
  buildTower(campusX+100, Y, campusZ+80, 18, 14, 12, 'gray_concrete', 'gray_stained_glass', 'iron_block', 'MRDC');

  // Skiles (Classroom)
  buildTower(campusX+235, Y, campusZ+260, 20, 12, 10, 'bricks', 'white_stained_glass', 'stone_bricks', 'Skiles Classroom');

  // Dorms cluster (west side)
  const dorms = [
    { name: 'Freeman', dx: 20, dz: 100, w: 14, d: 10, h: 15 },
    { name: 'Montag', dx: 20, dz: 120, w: 14, d: 10, h: 15 },
    { name: 'Fitten', dx: 38, dz: 100, w: 14, d: 10, h: 15 },
    { name: 'Fulmer', dx: 38, dz: 120, w: 14, d: 10, h: 15 },
    { name: 'Perry', dx: 325, dz: 210, w: 12, d: 10, h: 12 },
    { name: 'Hopkins', dx: 340, dz: 230, w: 12, d: 10, h: 12 },
    { name: 'Glenn', dx: 340, dz: 250, w: 12, d: 10, h: 12 },
  ];
  for (const d of dorms) {
    buildTower(campusX+d.dx, Y, campusZ+d.dz, d.w, d.d, d.h, 'bricks', 'white_stained_glass', 'stone_bricks', d.name + ' Dorm');
  }

  // "GT" letters on Tech Green (gold blocks)
  const ltx = tgx + 10, ltz = tgz + 15;
  // G
  fill(ltx, oy+1, ltz, ltx+6, oy+1, ltz, 'gold_block');
  fill(ltx, oy+1, ltz, ltx, oy+1, ltz+8, 'gold_block');
  fill(ltx, oy+1, ltz+8, ltx+6, oy+1, ltz+8, 'gold_block');
  fill(ltx+6, oy+1, ltz+4, ltx+6, oy+1, ltz+8, 'gold_block');
  fill(ltx+3, oy+1, ltz+4, ltx+6, oy+1, ltz+4, 'gold_block');
  // T
  fill(ltx+10, oy+1, ltz, ltx+18, oy+1, ltz, 'gold_block');
  fill(ltx+14, oy+1, ltz, ltx+14, oy+1, ltz+8, 'gold_block');

  // Streetlights
  for (const rd of roads_ew) {
    for (let x = campusX; x < campusX+CW; x += 20) {
      fill(x, oy+1, rd.z-2, x, oy+4, rd.z-2, 'iron_bars');
      fill(x, oy+5, rd.z-2, x, oy+5, rd.z-2, 'sea_lantern');
    }
  }
  for (const rd of roads_ns) {
    for (let z = campusZ; z < campusZ+CD; z += 20) {
      fill(rd.x-2, oy+1, z, rd.x-2, oy+4, z, 'iron_bars');
      fill(rd.x-2, oy+5, z, rd.x-2, oy+5, z, 'sea_lantern');
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. CITY — build-gt-city.js, phase 2 (Atlanta blocks around the campus + elevated highway ring)
// ══════════════════════════════════════════════════════════════════════════════════════════════
function cityPass(world) {
  const { fill } = shims(world);

  // City extends beyond campus in all directions
  const CITY_MARGIN = 150; // blocks beyond campus edge
  const cityX1 = campusX - CITY_MARGIN, cityZ1 = campusZ - CITY_MARGIN;
  const cityX2 = campusX + CW + CITY_MARGIN, cityZ2 = campusZ + CD + CITY_MARGIN;
  const BLOCK_SIZE = 20, STREET_W = 5, CELL = BLOCK_SIZE + STREET_W;

  let seed = 12345;
  function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function randInt(a, b) { return Math.floor(rng() * (b - a + 1)) + a; }
  function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

  const BODY = ['white_concrete','light_gray_concrete','cyan_terracotta','gray_concrete','blue_concrete','black_concrete','brown_concrete'];
  const GLASS = ['light_blue_stained_glass','white_stained_glass','gray_stained_glass','cyan_stained_glass'];
  const ACCENT = ['white_concrete','gold_block','iron_block','quartz_block'];

  // Build city blocks OUTSIDE campus area
  let bldgCount = 0;
  // West city blocks
  for (let gx = cityX1; gx < campusX - 10; gx += CELL) {
    for (let gz = cityZ1; gz < cityZ2; gz += CELL) {
      buildCityBlock(gx, gz);
    }
  }
  // East city blocks
  for (let gx = campusX + CW + 10; gx < cityX2; gx += CELL) {
    for (let gz = cityZ1; gz < cityZ2; gz += CELL) {
      buildCityBlock(gx, gz);
    }
  }
  // North city blocks (between campus sides)
  for (let gx = campusX; gx < campusX + CW; gx += CELL) {
    for (let gz = cityZ1; gz < campusZ - 10; gz += CELL) {
      buildCityBlock(gx, gz);
    }
  }
  // South city blocks
  for (let gx = campusX; gx < campusX + CW; gx += CELL) {
    for (let gz = campusZ + CD + 10; gz < cityZ2; gz += CELL) {
      buildCityBlock(gx, gz);
    }
  }

  function buildCityBlock(bx, bz) {
    // Flatten
    fill(bx, oy, bz, bx+CELL-1, oy, bz+CELL-1, 'gray_concrete');
    // Road edges
    fill(bx, oy, bz, bx+STREET_W-1, oy, bz+CELL-1, 'black_concrete');
    fill(bx, oy, bz, bx+CELL-1, oy, bz+STREET_W-1, 'black_concrete');

    // Skip some for parks
    if (rng() < 0.12) {
      fill(bx+STREET_W+1, oy, bz+STREET_W+1, bx+CELL-2, oy, bz+CELL-2, 'grass_block');
      // Tree
      const tx = bx+STREET_W+5, tz = bz+STREET_W+5;
      fill(tx, oy+1, tz, tx, oy+5, tz, 'oak_log');
      fill(tx-2, oy+4, tz-2, tx+2, oy+6, tz+2, 'oak_leaves');
      bldgCount++;
      return;
    }

    // Building
    const bw = randInt(10, BLOCK_SIZE-2), bd = randInt(10, BLOCK_SIZE-2);
    const h = randInt(8, 60);
    const body = pick(BODY), glass = pick(GLASS), accent = pick(ACCENT);
    const tbx = bx + STREET_W + 1, tbz = bz + STREET_W + 1;

    // Walls in chunks
    for (let yc = 0; yc < h; yc += 25) {
      const ye = Math.min(yc+24, h-1);
      fill(tbx, oy+1+yc, tbz, tbx+bw-1, oy+1+ye, tbz, body);
      fill(tbx, oy+1+yc, tbz+bd-1, tbx+bw-1, oy+1+ye, tbz+bd-1, body);
      fill(tbx, oy+1+yc, tbz, tbx, oy+1+ye, tbz+bd-1, body);
      fill(tbx+bw-1, oy+1+yc, tbz, tbx+bw-1, oy+1+ye, tbz+bd-1, body);
    }
    // Glass columns
    for (let x = tbx+1; x < tbx+bw-1; x += 2) {
      fill(x, oy+3, tbz, x, oy+h, tbz, glass);
      fill(x, oy+3, tbz+bd-1, x, oy+h, tbz+bd-1, glass);
    }
    for (let z = tbz+1; z < tbz+bd-1; z += 2) {
      fill(tbx, oy+3, z, tbx, oy+h, z, glass);
      fill(tbx+bw-1, oy+3, z, tbx+bw-1, oy+h, z, glass);
    }
    // Floor lines
    for (let y = oy+5; y < oy+1+h; y += 4) {
      fill(tbx, y, tbz, tbx+bw-1, y, tbz, body);
      fill(tbx, y, tbz+bd-1, tbx+bw-1, y, tbz+bd-1, body);
      fill(tbx, y, tbz, tbx, y, tbz+bd-1, body);
      fill(tbx+bw-1, y, tbz, tbx+bw-1, y, tbz+bd-1, body);
    }
    // Roof + antenna
    fill(tbx, oy+1+h, tbz, tbx+bw-1, oy+1+h, tbz+bd-1, accent);
    if (h > 30) {
      const ax = tbx+Math.floor(bw/2), az = tbz+Math.floor(bd/2);
      fill(ax, oy+2+h, az, ax, oy+6+h, az, accent);
      fill(ax, oy+7+h, az, ax, oy+7+h, az, 'sea_lantern');
    }

    bldgCount++;
  }


  // ── Highway ring ──
  const hwyY = oy + 12, hwyW = 6;
  const hx1 = cityX1 - 10, hz1 = cityZ1 - 10, hx2 = cityX2 + 10, hz2 = cityZ2 + 10;

  // Pillars + deck for all 4 sides
  // South
  for (let x = hx1; x <= hx2; x += 14) { fill(x, oy+1, hz1, x+1, hwyY-1, hz1+1, 'gray_concrete'); }
  fill(hx1, hwyY, hz1, hx2, hwyY, hz1+hwyW, 'gray_concrete');
  fill(hx1, hwyY, hz1+3, hx2, hwyY, hz1+3, 'white_concrete');
  fill(hx1, hwyY+1, hz1, hx2, hwyY+1, hz1, 'stone_brick_wall');
  fill(hx1, hwyY+1, hz1+hwyW, hx2, hwyY+1, hz1+hwyW, 'stone_brick_wall');
  // North
  for (let x = hx1; x <= hx2; x += 14) { fill(x, oy+1, hz2, x+1, hwyY-1, hz2+1, 'gray_concrete'); }
  fill(hx1, hwyY, hz2, hx2, hwyY, hz2+hwyW, 'gray_concrete');
  fill(hx1, hwyY, hz2+3, hx2, hwyY, hz2+3, 'white_concrete');
  fill(hx1, hwyY+1, hz2, hx2, hwyY+1, hz2, 'stone_brick_wall');
  fill(hx1, hwyY+1, hz2+hwyW, hx2, hwyY+1, hz2+hwyW, 'stone_brick_wall');
  // West
  for (let z = hz1; z <= hz2+hwyW; z += 14) { fill(hx1, oy+1, z, hx1+1, hwyY-1, z+1, 'gray_concrete'); }
  fill(hx1, hwyY, hz1, hx1+hwyW, hwyY, hz2+hwyW, 'gray_concrete');
  fill(hx1+3, hwyY, hz1, hx1+3, hwyY, hz2+hwyW, 'white_concrete');
  fill(hx1, hwyY+1, hz1, hx1, hwyY+1, hz2+hwyW, 'stone_brick_wall');
  fill(hx1+hwyW, hwyY+1, hz1, hx1+hwyW, hwyY+1, hz2+hwyW, 'stone_brick_wall');
  // East
  for (let z = hz1; z <= hz2+hwyW; z += 14) { fill(hx2, oy+1, z, hx2+1, hwyY-1, z+1, 'gray_concrete'); }
  fill(hx2, hwyY, hz1, hx2+hwyW, hwyY, hz2+hwyW, 'gray_concrete');
  fill(hx2+3, hwyY, hz1, hx2+3, hwyY, hz2+hwyW, 'white_concrete');
  fill(hx2, hwyY+1, hz1, hx2, hwyY+1, hz2+hwyW, 'stone_brick_wall');
  fill(hx2+hwyW, hwyY+1, hz1, hx2+hwyW, hwyY+1, hz2+hwyW, 'stone_brick_wall');

  // Highway lights
  for (let x = hx1; x <= hx2; x += 18) {
    fill(x, hwyY+2, hz1+3, x, hwyY+2, hz1+3, 'sea_lantern');
    fill(x, hwyY+2, hz2+3, x, hwyY+2, hz2+3, 'sea_lantern');
  }
  for (let z = hz1; z <= hz2+hwyW; z += 18) {
    fill(hx1+3, hwyY+2, z, hx1+3, hwyY+2, z, 'sea_lantern');
    fill(hx2+3, hwyY+2, z, hx2+3, hwyY+2, z, 'sea_lantern');
  }

  return { buildings: bldgCount };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 3. LANDMARKS — build-gt-rebuild.js (clears the placeholder boxes of pass 1 and rebuilds them with real detail)
// ══════════════════════════════════════════════════════════════════════════════════════════════
function landmarksPass(world) {
  const { fill } = shims(world);

  const Y = oy + 1; // building base


  // ═══════════════════════════════════════════════════
  // TECH TOWER — The Lettie Pate Whitehead Evans Admin Building
  // Real features: Red brick, white stone trim, classical columns,
  //   arched main entrance, square clock tower w/ gold dome
  // ═══════════════════════════════════════════════════
  const ttx = campusX + 160, ttz = campusZ + 90;
  const ttw = 30, ttd = 18; // wider building, more realistic

  // Clear old building
  fill(ttx-5, oy, ttz-5, ttx+ttw+5, oy+50, ttz+ttd+5, 'air');
  fill(ttx-5, oy, ttz-5, ttx+ttw+5, oy, ttz+ttd+5, 'grass_block');

  // === MAIN BUILDING BODY (3 stories, brick) ===
  // Foundation — stone base
  fill(ttx, Y, ttz, ttx+ttw, Y, ttz+ttd, 'smooth_stone');
  fill(ttx-1, Y, ttz-1, ttx+ttw+1, Y, ttz+ttd+1, 'smooth_stone');

  // Brick walls — 3 stories (12 blocks)
  fill(ttx, Y+1, ttz, ttx+ttw, Y+12, ttz+ttd, 'bricks');
  // Hollow interior
  fill(ttx+1, Y+1, ttz+1, ttx+ttw-1, Y+11, ttz+ttd-1, 'air');
  // Floors
  fill(ttx+1, Y+4, ttz+1, ttx+ttw-1, Y+4, ttz+ttd-1, 'oak_planks');
  fill(ttx+1, Y+8, ttz+1, ttx+ttw-1, Y+8, ttz+ttd-1, 'oak_planks');

  // === WHITE STONE TRIM (quartz) at each floor level ===
  fill(ttx, Y+4, ttz, ttx+ttw, Y+4, ttz, 'quartz_block');
  fill(ttx, Y+4, ttz+ttd, ttx+ttw, Y+4, ttz+ttd, 'quartz_block');
  fill(ttx, Y+8, ttz, ttx+ttw, Y+8, ttz, 'quartz_block');
  fill(ttx, Y+8, ttz+ttd, ttx+ttw, Y+8, ttz+ttd, 'quartz_block');
  // Top cornice — protruding white trim
  fill(ttx-1, Y+12, ttz-1, ttx+ttw+1, Y+12, ttz+ttd+1, 'quartz_block');
  fill(ttx-1, Y+13, ttz-1, ttx+ttw+1, Y+13, ttz+ttd+1, 'quartz_slab');

  // === WINDOWS with white frames ===
  // Front facade (south face, z = ttz)
  for (let x = ttx+2; x <= ttx+ttw-2; x += 3) {
    // 1st floor windows
    fill(x, Y+2, ttz, x+1, Y+3, ttz, 'glass');
    fill(x, Y+1, ttz, x+1, Y+1, ttz, 'quartz_slab'); // sill
    // 2nd floor windows
    fill(x, Y+5, ttz, x+1, Y+7, ttz, 'glass');
    fill(x, Y+5, ttz, x+1, Y+5, ttz, 'quartz_slab');
    // 3rd floor windows
    fill(x, Y+9, ttz, x+1, Y+11, ttz, 'glass');
    fill(x, Y+9, ttz, x+1, Y+9, ttz, 'quartz_slab');
  }
  // Back facade
  for (let x = ttx+2; x <= ttx+ttw-2; x += 3) {
    fill(x, Y+2, ttz+ttd, x+1, Y+3, ttz+ttd, 'glass');
    fill(x, Y+5, ttz+ttd, x+1, Y+7, ttz+ttd, 'glass');
    fill(x, Y+9, ttz+ttd, x+1, Y+11, ttz+ttd, 'glass');
  }
  // Side windows
  for (let z = ttz+2; z <= ttz+ttd-2; z += 3) {
    fill(ttx, Y+2, z, ttx, Y+3, z+1, 'glass');
    fill(ttx, Y+5, z, ttx, Y+7, z+1, 'glass');
    fill(ttx, Y+9, z, ttx, Y+11, z+1, 'glass');
    fill(ttx+ttw, Y+2, z, ttx+ttw, Y+3, z+1, 'glass');
    fill(ttx+ttw, Y+5, z, ttx+ttw, Y+7, z+1, 'glass');
    fill(ttx+ttw, Y+9, z, ttx+ttw, Y+11, z+1, 'glass');
  }

  // === CLASSICAL ENTRANCE — center of south facade ===
  const ecx = ttx + Math.floor(ttw/2); // entrance center x
  // Arched doorway (3 wide, 4 high)
  fill(ecx-1, Y+1, ttz, ecx+1, Y+4, ttz, 'air');
  // Arch top (stairs)
  fill(ecx-2, Y+4, ttz, ecx-2, Y+4, ttz, 'quartz_stairs');
  fill(ecx+2, Y+4, ttz, ecx+2, Y+4, ttz, 'quartz_stairs');
  fill(ecx-1, Y+5, ttz, ecx+1, Y+5, ttz, 'quartz_block');
  // Columns flanking entrance
  fill(ecx-3, Y+1, ttz-1, ecx-3, Y+5, ttz-1, 'quartz_pillar');
  fill(ecx+3, Y+1, ttz-1, ecx+3, Y+5, ttz-1, 'quartz_pillar');
  fill(ecx-5, Y+1, ttz-1, ecx-5, Y+5, ttz-1, 'quartz_pillar');
  fill(ecx+5, Y+1, ttz-1, ecx+5, Y+5, ttz-1, 'quartz_pillar');
  // Pediment above columns (triangular)
  fill(ecx-6, Y+6, ttz-1, ecx+6, Y+6, ttz-1, 'quartz_block');
  fill(ecx-5, Y+7, ttz-1, ecx+5, Y+7, ttz-1, 'quartz_block');
  fill(ecx-4, Y+8, ttz-1, ecx+4, Y+8, ttz-1, 'quartz_block');
  fill(ecx-3, Y+9, ttz-1, ecx+3, Y+9, ttz-1, 'quartz_block');
  fill(ecx-2, Y+10, ttz-1, ecx+2, Y+10, ttz-1, 'quartz_block');
  // Entry steps
  fill(ecx-2, Y, ttz-2, ecx+2, Y, ttz-2, 'smooth_stone_slab');
  fill(ecx-3, oy, ttz-3, ecx+3, oy, ttz-3, 'smooth_stone');

  // === CLOCK TOWER — square tower rising from center of roof ===
  const ctx = ecx - 3, ctz = ttz + Math.floor(ttd/2) - 3;
  const ctw = 7, ctd = 7;
  // Tower walls (brick)
  fill(ctx, Y+13, ctz, ctx+ctw, Y+28, ctz+ctd, 'bricks');
  fill(ctx+1, Y+13, ctz+1, ctx+ctw-1, Y+27, ctz+ctd-1, 'air');
  // Tower white trim bands
  fill(ctx-1, Y+18, ctz-1, ctx+ctw+1, Y+18, ctz+ctd+1, 'quartz_block');
  fill(ctx-1, Y+24, ctz-1, ctx+ctw+1, Y+24, ctz+ctd+1, 'quartz_block');
  fill(ctx-1, Y+28, ctz-1, ctx+ctw+1, Y+28, ctz+ctd+1, 'quartz_block');
  // Tower windows (tall arched openings near top)
  // South face
  fill(ctx+2, Y+19, ctz, ctx+4, Y+23, ctz, 'glass');
  fill(ctx+2, Y+25, ctz, ctx+4, Y+27, ctz, 'glass');
  // North face
  fill(ctx+2, Y+19, ctz+ctd, ctx+4, Y+23, ctz+ctd, 'glass');
  fill(ctx+2, Y+25, ctz+ctd, ctx+4, Y+27, ctz+ctd, 'glass');
  // East face
  fill(ctx+ctw, Y+19, ctz+2, ctx+ctw, Y+23, ctz+4, 'glass');
  fill(ctx+ctw, Y+25, ctz+ctd-2, ctx+ctw, Y+27, ctz+ctd-2, 'glass');
  // West face
  fill(ctx, Y+19, ctz+2, ctx, Y+23, ctz+4, 'glass');

  // === CLOCK FACES (glowstone circles on 4 sides) ===
  const clkY = Y + 21;
  // South clock
  fill(ctx+2, clkY, ctz, ctx+4, clkY+2, ctz, 'glowstone');
  fill(ctx+3, clkY-1, ctz, ctx+3, clkY+3, ctz, 'glowstone');
  fill(ctx+3, clkY+1, ctz, ctx+3, clkY+1, ctz, 'black_concrete'); // center
  // North clock
  fill(ctx+2, clkY, ctz+ctd, ctx+4, clkY+2, ctz+ctd, 'glowstone');
  fill(ctx+3, clkY-1, ctz+ctd, ctx+3, clkY+3, ctz+ctd, 'glowstone');
  fill(ctx+3, clkY+1, ctz+ctd, ctx+3, clkY+1, ctz+ctd, 'black_concrete');

  // === GOLD DOME on top of clock tower ===
  const dcx = ctx + 3, dcz = ctz + 3; // dome center
  // Dome layers (hemisphere)
  fill(dcx-3, Y+29, dcz-3, dcx+3, Y+29, dcz+3, 'gold_block');
  fill(dcx-2, Y+30, dcz-2, dcx+2, Y+30, dcz+2, 'gold_block');
  fill(dcx-2, Y+31, dcz-2, dcx+2, Y+31, dcz+2, 'gold_block');
  fill(dcx-1, Y+32, dcz-1, dcx+1, Y+32, dcz+1, 'gold_block');
  fill(dcx-1, Y+33, dcz-1, dcx+1, Y+33, dcz+1, 'gold_block');
  fill(dcx, Y+34, dcz, dcx, Y+34, dcz, 'gold_block');
  // Spire
  fill(dcx, Y+35, dcz, dcx, Y+38, dcz, 'gold_block');
  // Lightning rod / finial
  fill(dcx, Y+39, dcz, dcx, Y+39, dcz, 'lightning_rod');

  // === LANDSCAPING around Tech Tower ===
  // Front lawn
  fill(ttx-3, oy, ttz-8, ttx+ttw+3, oy, ttz-4, 'grass_block');
  // Walkway to entrance
  fill(ecx-1, oy, ttz-8, ecx+1, oy, ttz-3, 'smooth_stone');
  // Bushes (leaf blocks at ground level)
  fill(ttx-1, Y, ttz-1, ttx+2, Y, ttz-1, 'azalea_leaves');
  fill(ttx+ttw-2, Y, ttz-1, ttx+ttw+1, Y, ttz-1, 'azalea_leaves');
  // GT sign in front
  fill(ecx-4, Y, ttz-6, ecx+4, Y, ttz-6, 'stone_bricks');
  fill(ecx-4, Y+1, ttz-6, ecx+4, Y+2, ttz-6, 'stone_bricks');
  fill(ecx-3, Y+1, ttz-6, ecx+3, Y+1, ttz-6, 'gold_block');


  // ═══════════════════════════════════════════════════
  // CROSLAND TOWER (Library) — Brutalist concrete tower
  // Real: Tall, narrow, concrete brutalist, distinctive rectangular shape
  // ═══════════════════════════════════════════════════
  const clx = campusX + 220, clz = campusZ + 200;

  // Clear old
  fill(clx-5, oy, clz-5, clx+20, oy+55, clz+15, 'air');
  fill(clx-5, oy, clz-5, clx+20, oy, clz+15, 'grass_block');

  // Main tower — brutalist concrete, 50 blocks tall, narrow
  const clW = 12, clD = 10, clH = 50;
  // Concrete body
  fill(clx, Y, clz, clx+clW, Y+clH, clz+clD, 'gray_concrete');
  // Hollow
  fill(clx+1, Y+1, clz+1, clx+clW-1, Y+clH-1, clz+clD-1, 'air');
  // Narrow vertical window slits (brutalist style)
  for (let z = clz+1; z < clz+clD; z += 3) {
    fill(clx, Y+3, z, clx, Y+clH-2, z, 'gray_stained_glass');
    fill(clx+clW, Y+3, z, clx+clW, Y+clH-2, z, 'gray_stained_glass');
  }
  for (let x = clx+2; x < clx+clW; x += 3) {
    fill(x, Y+3, clz, x, Y+clH-2, clz, 'gray_stained_glass');
    fill(x, Y+3, clz+clD, x, Y+clH-2, clz+clD, 'gray_stained_glass');
  }
  // Horizontal concrete bands every 5 floors
  for (let y = Y+6; y < Y+clH; y += 5) {
    fill(clx, y, clz, clx+clW, y, clz, 'light_gray_concrete');
    fill(clx, y, clz+clD, clx+clW, y, clz+clD, 'light_gray_concrete');
    fill(clx, y, clz, clx, y, clz+clD, 'light_gray_concrete');
    fill(clx+clW, y, clz, clx+clW, y, clz+clD, 'light_gray_concrete');
  }
  // Roof mechanical penthouse
  fill(clx+2, Y+clH+1, clz+2, clx+clW-2, Y+clH+4, clz+clD-2, 'gray_concrete');
  // Entrance
  fill(clx+4, Y+1, clz, clx+8, Y+3, clz, 'air');
  fill(clx+4, Y+4, clz, clx+8, Y+4, clz, 'light_gray_concrete'); // lintel

  // Library base building (wider low structure attached)
  fill(clx-5, Y, clz+clD+1, clx+clW+5, Y+8, clz+clD+12, 'gray_concrete');
  fill(clx-4, Y+1, clz+clD+2, clx+clW+4, Y+7, clz+clD+11, 'air');
  // Library windows
  for (let x = clx-3; x < clx+clW+4; x += 3) {
    fill(x, Y+2, clz+clD+12, x+1, Y+6, clz+clD+12, 'light_blue_stained_glass');
  }


  // ═══════════════════════════════════════════════════
  // CULC — Modern glass and steel, cantilever design
  // Real: Glass curtain wall, angular modern architecture
  // ═══════════════════════════════════════════════════
  const ulx = campusX + 195, ulz = campusZ + 170;

  fill(ulx-3, oy, ulz-3, ulx+35, oy+25, ulz+22, 'air');
  fill(ulx-3, oy, ulz-3, ulx+35, oy, ulz+22, 'grass_block');

  // Main body — white concrete + glass curtain wall
  fill(ulx, Y, ulz, ulx+32, Y+18, ulz+20, 'white_concrete');
  fill(ulx+1, Y+1, ulz+1, ulx+31, Y+17, ulz+19, 'air');
  // Full glass south facade
  fill(ulx, Y+1, ulz, ulx+32, Y+17, ulz, 'light_blue_stained_glass');
  // Glass mullion grid (white lines)
  for (let x = ulx; x <= ulx+32; x += 4) {
    fill(x, Y+1, ulz, x, Y+17, ulz, 'white_concrete');
  }
  for (let y = Y+4; y <= Y+16; y += 4) {
    fill(ulx, y, ulz, ulx+32, y, ulz, 'white_concrete');
  }
  // Cantilever overhang (extends past ground floor)
  fill(ulx-3, Y+5, ulz-3, ulx+35, Y+5, ulz, 'white_concrete');
  // Ground floor recessed (pilotis)
  fill(ulx+2, Y+1, ulz, ulx+30, Y+4, ulz, 'air');
  // Support columns
  for (let x = ulx+4; x <= ulx+28; x += 8) {
    fill(x, Y+1, ulz+1, x+1, Y+5, ulz+1, 'white_concrete');
  }
  // Roof
  fill(ulx, Y+18, ulz, ulx+32, Y+18, ulz+20, 'white_concrete');
  // Interior floors
  for (let y = Y+5; y < Y+18; y += 4) {
    fill(ulx+1, y, ulz+1, ulx+31, y, ulz+19, 'smooth_stone');
  }
  // Staircase atrium (glass box on top)
  fill(ulx+13, Y+19, ulz+7, ulx+19, Y+22, ulz+13, 'glass');
  fill(ulx+14, Y+19, ulz+8, ulx+18, Y+21, ulz+12, 'air');


  // ═══════════════════════════════════════════════════
  // BOBBY DODD STADIUM — proper horseshoe shape
  // ═══════════════════════════════════════════════════
  const sdx = campusX + 260, sdz = campusZ + 155;

  fill(sdx-15, oy, sdz-15, sdx+65, oy+20, sdz+50, 'air');
  fill(sdx-15, oy, sdz-15, sdx+65, oy, sdz+50, 'grass_block');

  // Football field (green with lines)
  fill(sdx, oy, sdz, sdx+55, oy, sdz+30, 'lime_concrete');
  // Yard lines every 5 yards (every ~5 blocks at this scale)
  for (let x = sdx+5; x <= sdx+50; x += 5) {
    fill(x, oy, sdz+1, x, oy, sdz+29, 'white_concrete');
  }
  // End zones
  fill(sdx, oy, sdz+1, sdx+4, oy, sdz+29, 'gold_block'); // GT gold
  fill(sdx+51, oy, sdz+1, sdx+55, oy, sdz+29, 'gold_block');

  // West stands (tiered, main grandstand)
  for (let tier = 0; tier < 12; tier++) {
    fill(sdx-1-tier, oy+tier+1, sdz-2, sdx-1-tier, oy+tier+1, sdz+32, 'stone');
    // Every other row: seats (stairs)
    if (tier % 2 === 0) {
      fill(sdx-1-tier, oy+tier+1, sdz-2, sdx-1-tier, oy+tier+1, sdz+32, 'stone_brick_stairs');
    }
  }
  // East stands
  for (let tier = 0; tier < 12; tier++) {
    fill(sdx+56+tier, oy+tier+1, sdz-2, sdx+56+tier, oy+tier+1, sdz+32, 'stone');
    if (tier % 2 === 0) {
      fill(sdx+56+tier, oy+tier+1, sdz-2, sdx+56+tier, oy+tier+1, sdz+32, 'stone_brick_stairs');
    }
  }
  // South end stands (horseshoe shape)
  for (let tier = 0; tier < 8; tier++) {
    fill(sdx-1, oy+tier+1, sdz-3-tier, sdx+56, oy+tier+1, sdz-3-tier, 'stone');
  }
  // North open end (horseshoe opening) — press box
  fill(sdx+10, oy+1, sdz+33, sdx+45, oy+15, sdz+35, 'gray_concrete');
  // Press box windows
  fill(sdx+12, oy+10, sdz+33, sdx+43, oy+14, sdz+33, 'light_blue_stained_glass');
  // Scoreboard
  fill(sdx+18, oy+1, sdz+37, sdx+37, oy+16, sdz+37, 'black_concrete');
  fill(sdx+20, oy+3, sdz+37, sdx+35, oy+14, sdz+37, 'glowstone');
  // "GT" on scoreboard
  fill(sdx+22, oy+6, sdz+37, sdx+26, oy+6, sdz+37, 'gold_block');
  fill(sdx+22, oy+6, sdz+37, sdx+22, oy+10, sdz+37, 'gold_block');
  fill(sdx+22, oy+10, sdz+37, sdx+26, oy+10, sdz+37, 'gold_block');
  fill(sdx+26, oy+8, sdz+37, sdx+26, oy+10, sdz+37, 'gold_block');
  fill(sdx+24, oy+8, sdz+37, sdx+26, oy+8, sdz+37, 'gold_block');
  // T
  fill(sdx+28, oy+10, sdz+37, sdx+33, oy+10, sdz+37, 'gold_block');
  fill(sdx+30, oy+6, sdz+37, sdx+31, oy+10, sdz+37, 'gold_block');

  // Field goals
  fill(sdx+2, oy+1, sdz+15, sdx+2, oy+8, sdz+15, 'yellow_concrete');
  fill(sdx+1, oy+6, sdz+15, sdx+3, oy+8, sdz+15, 'yellow_concrete');
  fill(sdx+53, oy+1, sdz+15, sdx+53, oy+8, sdz+15, 'yellow_concrete');
  fill(sdx+52, oy+6, sdz+15, sdx+54, oy+8, sdz+15, 'yellow_concrete');

  // Stadium lights (4 tall poles)
  const lightSpots = [[sdx-13, sdz-5], [sdx-13, sdz+35], [sdx+68, sdz-5], [sdx+68, sdz+35]];
  for (const [lx, lz] of lightSpots) {
    fill(lx, oy+1, lz, lx, oy+18, lz, 'iron_bars');
    fill(lx-1, oy+18, lz, lx+1, oy+18, lz, 'glowstone');
    fill(lx, oy+18, lz-1, lx, oy+18, lz+1, 'glowstone');
  }


  // ═══════════════════════════════════════════════════
  // COLLEGE OF COMPUTING — Modern building
  // ═══════════════════════════════════════════════════
  const ccx = campusX + 80, ccz = campusZ + 105;

  fill(ccx-3, oy, ccz-3, ccx+25, oy+22, ccz+18, 'air');
  fill(ccx-3, oy, ccz-3, ccx+25, oy, ccz+18, 'grass_block');

  // Modern asymmetric design
  // Main wing (taller, glass)
  fill(ccx, Y, ccz, ccx+14, Y+18, ccz+14, 'white_concrete');
  fill(ccx+1, Y+1, ccz+1, ccx+13, Y+17, ccz+13, 'air');
  // Full glass front
  fill(ccx, Y+1, ccz, ccx+14, Y+17, ccz, 'cyan_stained_glass');
  for (let x = ccx; x <= ccx+14; x += 3) {
    fill(x, Y+1, ccz, x, Y+17, ccz, 'white_concrete'); // mullions
  }
  for (let y = Y+4; y < Y+17; y += 4) {
    fill(ccx, y, ccz, ccx+14, y, ccz, 'white_concrete'); // spandrels
  }
  // Lower wing (shorter, extending east)  
  fill(ccx+15, Y, ccz+2, ccx+22, Y+10, ccz+12, 'light_gray_concrete');
  fill(ccx+16, Y+1, ccz+3, ccx+21, Y+9, ccz+11, 'air');
  for (let z = ccz+3; z < ccz+12; z += 3) {
    fill(ccx+22, Y+2, z, ccx+22, Y+8, z+1, 'cyan_stained_glass');
  }
  // Entrance — recessed glass
  fill(ccx+5, Y+1, ccz, ccx+9, Y+3, ccz, 'air');
  // "CoC" sign
  fill(ccx+3, Y+15, ccz-1, ccx+11, Y+17, ccz-1, 'iron_block');
  fill(ccx+4, Y+16, ccz-1, ccx+10, Y+16, ccz-1, 'white_concrete');


  // ═══════════════════════════════════════════════════
  // ENHANCED DORMS — Not just boxes, add bay windows, entries
  // ═══════════════════════════════════════════════════

  const dorms = [
    { name:'Freeman', x:campusX+20, z:campusZ+100, w:14, d:10, h:15 },
    { name:'Montag', x:campusX+20, z:campusZ+120, w:14, d:10, h:15 },
    { name:'Fitten', x:campusX+38, z:campusZ+100, w:14, d:10, h:15 },
    { name:'Fulmer', x:campusX+38, z:campusZ+120, w:14, d:10, h:15 },
  ];
  for (const d of dorms) {
    // Add entrance canopy
    const ex = d.x + Math.floor(d.w/2);
    fill(ex-2, Y+4, d.z-2, ex+2, Y+4, d.z-1, 'stone_brick_slab');
    fill(ex-2, Y+1, d.z-2, ex-2, Y+3, d.z-2, 'stone_bricks');
    fill(ex+2, Y+1, d.z-2, ex+2, Y+3, d.z-2, 'stone_bricks');
    // Lamp by door
    fill(ex-3, Y+1, d.z-1, ex-3, Y+2, d.z-1, 'iron_bars');
    fill(ex-3, Y+3, d.z-1, ex-3, Y+3, d.z-1, 'lantern');
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 4. DETAILS — build-details.js (crosswalks, traffic lights, trees, parking lots, fountain, bus stops, billboards, …)
// ══════════════════════════════════════════════════════════════════════════════════════════════
function detailsPass(world) {
  const { fill, sb, blockAt } = shims(world);

  let seed = 777;
  function rng() { seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }
  function randInt(a,b) { return Math.floor(rng()*(b-a+1))+a; }
  function pick(a) { return a[Math.floor(rng()*a.length)]; }

  const CITY_MARGIN = 150;
  const cityX1 = campusX - CITY_MARGIN, cityZ1 = campusZ - CITY_MARGIN;
  const cityX2 = campusX + CW + CITY_MARGIN, cityZ2 = campusZ + CD + CITY_MARGIN;


  let detailCount = 0;

  // ═══════════════════════════════════════
  // PHASE A: Crosswalks & Traffic Lights
  // ═══════════════════════════════════════

  // E-W road crosswalks at N-S street intersections
  const ewRoads = [campusZ+50, campusZ+150, campusZ+250, campusZ+340];
  const nsRoads = [campusX+60, campusX+140, campusX+220, campusX+310];

  for (const rz of ewRoads) {
    for (const rx of nsRoads) {
      // Crosswalk stripes (white lines across road)
      for (let dx = 0; dx < 5; dx += 2) {
        fill(rx+dx, oy, rz-2, rx+dx, oy, rz-1, 'white_concrete');
        fill(rx+dx, oy, rz+6, rx+dx, oy, rz+7, 'white_concrete');
      }
      // Traffic light pole (SE corner)
      fill(rx+6, oy+1, rz+7, rx+6, oy+4, rz+7, 'iron_bars');
      sb(rx+6, oy+5, rz+7, 'black_concrete');
      sb(rx+6, oy+5, rz+6, 'red_concrete'); // red light face
      sb(rx+5, oy+5, rz+7, 'lime_concrete'); // green light face
      // Traffic light pole (NW corner)
      fill(rx-2, oy+1, rz-2, rx-2, oy+4, rz-2, 'iron_bars');
      sb(rx-2, oy+5, rz-2, 'black_concrete');
      sb(rx-2, oy+5, rz-1, 'red_concrete');
      sb(rx-1, oy+5, rz-2, 'lime_concrete');
      detailCount += 2;
    }
  }

  // ═══════════════════════════════════════
  // PHASE B: Sidewalk Trees & Street Furniture
  // ═══════════════════════════════════════

  // Trees along all roads
  for (const rz of ewRoads) {
    for (let x = campusX; x < campusX+CW; x += 15) {
      if (rng() < 0.3) continue; // skip some for variety
      // Tree on south sidewalk
      const tz = rz + 8;
      fill(x, oy+1, tz, x, oy+4, tz, 'birch_log');
      fill(x-1, oy+4, tz-1, x+1, oy+5, tz+1, 'birch_leaves');
      sb(x, oy+6, tz, 'birch_leaves');
      detailCount++;
      // Fire hydrant every ~45 blocks (the original tested the world x, where campusX was 359)
      if ((x + 359) % 45 < 15) {
        sb(x+3, oy+1, tz, 'red_concrete');
        detailCount++;
      }
    }
  }
  for (const rx of nsRoads) {
    for (let z = campusZ; z < campusZ+CD; z += 15) {
      if (rng() < 0.3) continue;
      const tx = rx + 8;
      fill(tx, oy+1, z, tx, oy+4, z, 'birch_log');
      fill(tx-1, oy+4, z-1, tx+1, oy+5, z+1, 'birch_leaves');
      sb(tx, oy+6, z, 'birch_leaves');
      detailCount++;
    }
  }

  // Benches along sidewalks (every ~30 blocks)
  for (const rz of ewRoads) {
    for (let x = campusX+10; x < campusX+CW; x += 30) {
      // Oak stair bench
      fill(x, oy+1, rz-2, x+1, oy+1, rz-2, 'oak_stairs');
      detailCount++;
    }
  }

  // Trash cans (cauldrons)
  for (const rz of ewRoads) {
    for (let x = campusX+20; x < campusX+CW; x += 40) {
      sb(x, oy+1, rz+7, 'cauldron');
      detailCount++;
    }
  }

  // ═══════════════════════════════════════
  // PHASE C: Parking Lots with Cars
  // ═══════════════════════════════════════

  // Add parking lots in city area (outside campus)
  const carColors = ['red_concrete','blue_concrete','white_concrete','black_concrete','gray_concrete','yellow_concrete','lime_concrete'];
  let carCount = 0;

  // Parking lots at several city locations
  const parkingLots = [
    { x: cityX1+20, z: cityZ1+20, w: 40, d: 25 },
    { x: cityX2-65, z: cityZ1+20, w: 40, d: 25 },
    { x: cityX1+20, z: cityZ2-50, w: 40, d: 25 },
    { x: cityX2-65, z: cityZ2-50, w: 40, d: 25 },
    { x: campusX+350, z: campusZ+30, w: 30, d: 20 }, // GT parking deck area
  ];

  for (const lot of parkingLots) {
    // Asphalt surface
    fill(lot.x, oy, lot.z, lot.x+lot.w, oy, lot.z+lot.d, 'black_concrete');
    // Parking lines
    for (let x = lot.x+3; x < lot.x+lot.w-3; x += 4) {
      fill(x, oy, lot.z+2, x, oy, lot.z+4, 'white_concrete');
      fill(x, oy, lot.z+lot.d-5, x, oy, lot.z+lot.d-3, 'white_concrete');
    }
    // Cars (colored blocks, 2 long)
    for (let x = lot.x+3; x < lot.x+lot.w-5; x += 4) {
      if (rng() < 0.3) continue; // empty spots
      const color = pick(carColors);
      fill(x, oy+1, lot.z+2, x+1, oy+1, lot.z+3, color);
      sb(x, oy+2, lot.z+2, 'glass');
      carCount++;
      if (rng() < 0.7) {
        fill(x, oy+1, lot.z+lot.d-4, x+1, oy+1, lot.z+lot.d-3, pick(carColors));
        sb(x, oy+2, lot.z+lot.d-4, 'glass');
        carCount++;
      }
    }
    detailCount++;
  }

  // Cars parked along streets
  for (const rz of ewRoads) {
    for (let x = campusX+15; x < campusX+CW-15; x += randInt(8,15)) {
      if (rng() < 0.5) continue;
      const color = pick(carColors);
      fill(x, oy+1, rz-1, x+1, oy+1, rz-1, color);
      sb(x, oy+2, rz-1, 'glass');
      carCount++;
    }
  }

  // ═══════════════════════════════════════
  // PHASE D: Enhanced Parks
  // ═══════════════════════════════════════

  // Main fountain on Tech Green
  const ftx = campusX+180, ftz = campusZ+180;
  // Fountain basin (stone bricks)
  fill(ftx-3, oy, ftz-3, ftx+3, oy, ftz+3, 'stone_bricks');
  fill(ftx-3, oy+1, ftz-3, ftx+3, oy+1, ftz-3, 'stone_brick_wall');
  fill(ftx-3, oy+1, ftz+3, ftx+3, oy+1, ftz+3, 'stone_brick_wall');
  fill(ftx-3, oy+1, ftz-3, ftx-3, oy+1, ftz+3, 'stone_brick_wall');
  fill(ftx+3, oy+1, ftz-3, ftx+3, oy+1, ftz+3, 'stone_brick_wall');
  // Water
  fill(ftx-2, oy+1, ftz-2, ftx+2, oy+1, ftz+2, 'water');
  // Center pillar
  fill(ftx, oy+1, ftz, ftx, oy+3, ftz, 'stone_bricks');
  sb(ftx, oy+4, ftz, 'sea_lantern');
  detailCount++;

  // Flower beds around campus paths
  const flowers = ['poppy','dandelion','blue_orchid','allium','azure_bluet','red_tulip','orange_tulip','pink_tulip','oxeye_daisy','cornflower','lily_of_the_valley'];
  for (let i = 0; i < 80; i++) {
    const fx = campusX + randInt(10, CW-10);
    const fz = campusZ + randInt(10, CD-10);
    // Small flower patch
    for (let dx = 0; dx < 3; dx++) {
      for (let dz = 0; dz < 3; dz++) {
        if (rng() < 0.5) {
          const block = blockAt(fx+dx, oy, fz+dz);
          if (block && block.name === 'grass_block') {
            sb(fx+dx, oy+1, fz+dz, pick(flowers));
          }
        }
      }
    }
  }
  detailCount += 80;

  // ═══════════════════════════════════════
  // PHASE E: Bus Stops, Billboards, Awnings
  // ═══════════════════════════════════════

  // Bus stops along main roads (glass shelters)
  const busStops = [
    { x: campusX+80, z: campusZ+48 },
    { x: campusX+200, z: campusZ+48 },
    { x: campusX+80, z: campusZ+148 },
    { x: campusX+200, z: campusZ+248 },
    { x: campusX+300, z: campusZ+338 },
  ];
  for (const bs of busStops) {
    // Shelter frame
    fill(bs.x, oy+1, bs.z, bs.x, oy+3, bs.z, 'iron_bars');
    fill(bs.x+3, oy+1, bs.z, bs.x+3, oy+3, bs.z, 'iron_bars');
    fill(bs.x, oy+4, bs.z, bs.x+3, oy+4, bs.z, 'smooth_stone_slab');
    // Glass back
    fill(bs.x, oy+1, bs.z, bs.x+3, oy+3, bs.z, 'glass');
    // Bench inside
    fill(bs.x+1, oy+1, bs.z+1, bs.x+2, oy+1, bs.z+1, 'oak_stairs');
    detailCount++;
  }

  // Billboards in city area
  for (let i = 0; i < 12; i++) {
    const bx = randInt(cityX1+30, cityX2-30);
    const bz = randInt(cityZ1+30, cityZ2-30);
    // Check it's in city, not campus
    if (bx > campusX-5 && bx < campusX+CW+5 && bz > campusZ-5 && bz < campusZ+CD+5) continue;
    // Pole
    fill(bx, oy+1, bz, bx, oy+10, bz, 'iron_bars');
    // Billboard face
    const boardColor = pick(['white_concrete','yellow_concrete','cyan_concrete','lime_concrete']);
    fill(bx-3, oy+8, bz, bx+3, oy+12, bz, boardColor);
    fill(bx-2, oy+9, bz, bx+2, oy+11, bz, pick(['blue_concrete','red_concrete','black_concrete']));
    detailCount++;
  }

  // Awnings on buildings (colored wool overhangs at ground floor)
  for (let gx = cityX1; gx < cityX2; gx += 25) {
    for (let gz = cityZ1; gz < cityZ2; gz += 25) {
      if (gx > campusX && gx < campusX+CW && gz > campusZ && gz < campusZ+CD) continue;
      if (rng() < 0.7) continue;
      const awningColor = pick(['red_wool','blue_wool','green_wool','yellow_wool','orange_wool','white_wool']);
      fill(gx+6, oy+3, gz+6, gx+10, oy+3, gz+6, awningColor);
      detailCount++;
    }
  }

  // ═══════════════════════════════════════
  // PHASE F: Lit windows (random glowstone in buildings)
  // ═══════════════════════════════════════

  // Scatter lit windows in city buildings
  for (let gx = cityX1; gx < cityX2; gx += 25) {
    for (let gz = cityZ1; gz < cityZ2; gz += 25) {
      if (gx > campusX && gx < campusX+CW && gz > campusZ && gz < campusZ+CD) continue;
      // Check a spot at height 5 to see if there's a building
      const checkBlock = blockAt(gx+8, oy+5, gz+8);
      if (!checkBlock || checkBlock.name === 'air') continue;
      // Add some glowstone windows
      for (let y = oy+3; y < oy+40; y += 4) {
        if (rng() < 0.6) continue;
        const wx = gx + randInt(7, 12);
        const wz = gz + 6;
        const block = blockAt(wx, y, wz);
        if (block && block.name.includes('glass')) {
          sb(wx, y, wz, 'glowstone');
          detailCount++;
        }
      }
    }
  }

  // ═══════════════════════════════════════
  // PHASE G: Highway enhancements
  // ═══════════════════════════════════════
  const hwyY = oy + 12;
  const hx1 = cityX1-10, hz1 = cityZ1-10, hx2 = cityX2+10, hz2 = cityZ2+10;

  // Highway signs
  const signs = [
    { x: hx1+50, z: hz1, text: 'I-75/85 NORTH', color: 'green_concrete' },
    { x: hx1+200, z: hz1, text: 'EXIT 249A GT', color: 'green_concrete' },
    { x: hx2-100, z: hz1, text: 'DOWNTOWN 2MI', color: 'green_concrete' },
    { x: hx1+50, z: hz2, text: 'I-75/85 SOUTH', color: 'green_concrete' },
    { x: hx1+200, z: hz2, text: 'MIDTOWN', color: 'green_concrete' },
  ];
  for (const s of signs) {
    // Sign post
    fill(s.x, hwyY+1, s.z+3, s.x, hwyY+4, s.z+3, 'iron_bars');
    // Sign board
    fill(s.x-4, hwyY+4, s.z+3, s.x+4, hwyY+6, s.z+3, s.color);
    fill(s.x-3, hwyY+5, s.z+3, s.x+3, hwyY+5, s.z+3, 'white_concrete');
    detailCount++;
  }

  // Cars on highway
  for (let x = hx1+20; x < hx2-20; x += randInt(8,16)) {
    const color = pick(carColors);
    fill(x, hwyY+1, hz1+2, x+1, hwyY+1, hz1+2, color);
    sb(x, hwyY+2, hz1+2, 'glass');
    if (rng() < 0.5) {
      fill(x+4, hwyY+1, hz1+4, x+5, hwyY+1, hz1+4, pick(carColors));
      sb(x+4, hwyY+2, hz1+4, 'glass');
    }
  }
  // Cars on north highway
  for (let x = hx1+20; x < hx2-20; x += randInt(8,16)) {
    const color = pick(carColors);
    fill(x, hwyY+1, hz2+2, x+1, hwyY+1, hz2+2, color);
    sb(x, hwyY+2, hz2+2, 'glass');
  }

  // ═══════════════════════════════════════
  // PHASE H: GT Campus Special Details
  // ═══════════════════════════════════════

  // Buzz statue (yellow/black figure near Tech Green)
  const bx = campusX+165, bz = campusZ+155;
  // Body (yellow)
  fill(bx, oy+1, bz, bx+1, oy+1, bz+1, 'yellow_concrete'); // feet
  fill(bx, oy+2, bz, bx+1, oy+3, bz+1, 'yellow_concrete'); // legs
  fill(bx, oy+4, bz, bx+1, oy+5, bz+1, 'yellow_concrete'); // torso
  fill(bx, oy+6, bz, bx+1, oy+6, bz+1, 'black_concrete'); // head stripes
  fill(bx, oy+7, bz, bx+1, oy+7, bz+1, 'yellow_concrete'); // head top
  // Wings
  fill(bx-1, oy+4, bz, bx-1, oy+5, bz+1, 'white_concrete');
  fill(bx+2, oy+4, bz, bx+2, oy+5, bz+1, 'white_concrete');
  // Eyes
  sb(bx, oy+6, bz-1, 'black_concrete');
  sb(bx+1, oy+6, bz-1, 'black_concrete');
  detailCount++;

  // "GEORGIA TECH" sign at campus entrance (south side, North Ave)
  const signX = campusX+180, signZ = campusZ+345;
  fill(signX-2, oy+1, signZ, signX-2, oy+3, signZ, 'stone_bricks');
  fill(signX+12, oy+1, signZ, signX+12, oy+3, signZ, 'stone_bricks');
  fill(signX-2, oy+3, signZ, signX+12, oy+3, signZ, 'stone_bricks');
  fill(signX, oy+4, signZ, signX+10, oy+5, signZ, 'gold_block');
  fill(signX+1, oy+4, signZ, signX+9, oy+4, signZ, 'white_concrete');
  detailCount++;

  // Flagpoles
  const flagPoles = [
    { x: campusX+175, z: campusZ+95 }, // near Tech Tower
    { x: campusX+200, z: campusZ+340 }, // North Ave entrance
  ];
  for (const fp of flagPoles) {
    fill(fp.x, oy+1, fp.z, fp.x, oy+12, fp.z, 'iron_bars');
    fill(fp.x+1, oy+10, fp.z, fp.x+3, oy+12, fp.z, 'blue_wool'); // flag
    detailCount++;
  }

  // More campus trees (varied species)
  const treeTypes = [
    { log: 'oak_log', leaves: 'oak_leaves', h: 6 },
    { log: 'birch_log', leaves: 'birch_leaves', h: 7 },
    { log: 'dark_oak_log', leaves: 'dark_oak_leaves', h: 5 },
    { log: 'spruce_log', leaves: 'spruce_leaves', h: 8 },
  ];
  for (let i = 0; i < 60; i++) {
    const tx = campusX + randInt(10, CW-10);
    const tz = campusZ + randInt(10, CD-10);
    const block = blockAt(tx, oy, tz);
    if (!block || block.name !== 'grass_block') continue;
    const tree = pick(treeTypes);
    fill(tx, oy+1, tz, tx, oy+tree.h-2, tz, tree.log);
    fill(tx-2, oy+tree.h-3, tz-2, tx+2, oy+tree.h-1, tz+2, tree.leaves);
    fill(tx-1, oy+tree.h, tz-1, tx+1, oy+tree.h, tz+1, tree.leaves);
    detailCount++;
  }

  // Lampposts on campus paths (shorter, more decorative)
  for (let i = 0; i < 100; i += 15) {
    const px = campusX + 80 + i, pz = campusZ + 70 + Math.floor(i * 0.8);
    fill(px+2, oy+1, pz+2, px+2, oy+3, pz+2, 'dark_oak_fence');
    sb(px+2, oy+4, pz+2, 'lantern');
    detailCount++;
  }

  return { details: detailCount, cars: carCount };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 5. REALISM — build-realism2.js (canal, shops, alleyways, church, hotel, hospital, subway, MARTA, …)
// ══════════════════════════════════════════════════════════════════════════════════════════════
function realismPass(world) {
  const { fill, blockAt } = shims(world);

  let seed=31415;
  function rng(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;}
  function ri(a,b){return Math.floor(rng()*(b-a+1))+a;}
  function pick(a){return a[Math.floor(rng()*a.length)];}

  const MARGIN=150;
  const cx1=campusX-MARGIN, cz1=campusZ-MARGIN;
  const cx2=campusX+CW+MARGIN, cz2=campusZ+CD+MARGIN;


  let count=0;

  // ═══════════════════════════════════════════
  // 1. CANAL / RIVER through the city
  // ═══════════════════════════════════════════
  const canalZ = campusZ + CD + 80; // south of campus
  const canalW = 8;
  // Dig canal trench
  fill(cx1, oy-3, canalZ, cx2, oy-1, canalZ+canalW, 'air');
  // Stone walls
  fill(cx1, oy-3, canalZ-1, cx2, oy, canalZ-1, 'stone_bricks');
  fill(cx1, oy-3, canalZ+canalW+1, cx2, oy, canalZ+canalW+1, 'stone_bricks');
  // Bottom
  fill(cx1, oy-4, canalZ, cx2, oy-4, canalZ+canalW, 'stone_bricks');
  // Water
  fill(cx1, oy-3, canalZ, cx2, oy-2, canalZ+canalW, 'water');
  // Bridges over canal every 60 blocks
  for (let x = cx1+30; x < cx2; x += 60) {
    fill(x-3, oy, canalZ-1, x+3, oy, canalZ+canalW+1, 'stone_bricks');
    fill(x-3, oy+1, canalZ-1, x-3, oy+1, canalZ+canalW+1, 'stone_brick_wall');
    fill(x+3, oy+1, canalZ-1, x+3, oy+1, canalZ+canalW+1, 'stone_brick_wall');
    // Lanterns on bridge
    fill(x-2, oy+1, canalZ-1, x-2, oy+2, canalZ-1, 'iron_bars');
    fill(x-2, oy+3, canalZ-1, x-2, oy+3, canalZ-1, 'lantern');
    fill(x+2, oy+1, canalZ+canalW+1, x+2, oy+2, canalZ+canalW+1, 'iron_bars');
    fill(x+2, oy+3, canalZ+canalW+1, x+2, oy+3, canalZ+canalW+1, 'lantern');
    count++;
  }

  // ═══════════════════════════════════════════
  // 2. SMALL SHOPS row (ground-level variety)
  // ═══════════════════════════════════════════
  const shopColors = ['red_concrete','blue_concrete','green_concrete','yellow_concrete','orange_concrete','white_concrete','cyan_concrete','magenta_concrete'];
  const awningColors = ['red_wool','blue_wool','green_wool','white_wool','orange_wool','lime_wool','yellow_wool'];
  const shopNames = [
    {w:5,d:6,h:4,name:'Cafe'},{w:6,d:5,h:4,name:'Bookstore'},
    {w:4,d:5,h:3,name:'Bakery'},{w:7,d:6,h:5,name:'Restaurant'},
    {w:5,d:5,h:4,name:'Barber'},{w:6,d:6,h:4,name:'Pharmacy'},
    {w:4,d:4,h:3,name:'Florist'},{w:5,d:5,h:4,name:'Gift Shop'},
  ];

  // Build shop rows along several streets
  const shopStreets = [
    { x: campusX+65, z: campusZ+55, dir:'z', len: 180 },  // along Atlantic Dr
    { x: campusX+145, z: campusZ+155, dir:'z', len: 80 },  
    { x: campusX+55, z: campusZ+55, dir:'x', len: 120 },  // along 10th St
    { x: campusX+55, z: campusZ+255, dir:'x', len: 150 },  // along Bobby Dodd
  ];

  for (const st of shopStreets) {
    let pos = 0;
    while (pos < st.len) {
      const shop = pick(shopNames);
      const color = pick(shopColors);
      const awning = pick(awningColors);
      let sx, sz;
      if (st.dir === 'z') { sx = st.x; sz = st.z + pos; }
      else { sx = st.x + pos; sz = st.z; }

      // Shop body
      fill(sx, oy+1, sz, sx+shop.w-1, oy+shop.h, sz+shop.d-1, color);
      // Hollow interior
      fill(sx+1, oy+1, sz+1, sx+shop.w-2, oy+shop.h-1, sz+shop.d-2, 'air');
      // Floor
      fill(sx+1, oy, sz+1, sx+shop.w-2, oy, sz+shop.d-2, 'oak_planks');
      // Glass front
      fill(sx+1, oy+1, sz, sx+shop.w-2, oy+shop.h-1, sz, 'glass');
      // Door
      fill(sx+Math.floor(shop.w/2), oy+1, sz, sx+Math.floor(shop.w/2), oy+2, sz, 'air');
      // Awning overhang
      fill(sx, oy+shop.h, sz-1, sx+shop.w-1, oy+shop.h, sz-1, awning);
      // Interior light
      fill(sx+Math.floor(shop.w/2), oy+shop.h-1, sz+Math.floor(shop.d/2), sx+Math.floor(shop.w/2), oy+shop.h-1, sz+Math.floor(shop.d/2), 'lantern[hanging=true]');
      // Counter inside
      fill(sx+1, oy+1, sz+shop.d-2, sx+shop.w-2, oy+1, sz+shop.d-2, 'oak_stairs');

      pos += shop.w + ri(1,3); // gap between shops
      count++;
    }
  }

  // ═══════════════════════════════════════════
  // 3. ALLEYWAYS between city buildings
  // ═══════════════════════════════════════════

  for (let gx = cx1; gx < cx2; gx += 25) {
    for (let gz = cz1; gz < cz2; gz += 25) {
      if (gx > campusX-5 && gx < campusX+CW+5 && gz > campusZ-5 && gz < campusZ+CD+5) continue;
      if (rng() < 0.6) continue; // not every block

      const ax = gx + 18, az = gz + 8; // alley position

      // Dumpster (dark green)
      fill(ax, oy+1, az, ax+1, oy+2, az, 'green_terracotta');
      // Pipe on wall
      fill(ax+2, oy+1, az+2, ax+2, oy+8, az+2, 'iron_bars');
      // Fire escape ladder
      if (rng() < 0.5) {
        fill(ax-1, oy+1, az+3, ax-1, oy+12, az+3, 'iron_chain');
        // Fire escape platforms
        for (let fy = oy+4; fy < oy+14; fy += 4) {
          fill(ax-2, fy, az+2, ax, fy, az+4, 'iron_bars');
        }
      }
      // Puddle (water in alley)
      if (rng() < 0.3) {
        fill(ax, oy, az+1, ax+1, oy, az+1, 'water');
      }
      // AC unit on wall
      if (rng() < 0.4) {
        fill(ax+3, oy+3, az, ax+3, oy+4, az+1, 'iron_block');
      }
      count++;
    }
  }

  // ═══════════════════════════════════════════
  // 4. MAJOR INFRASTRUCTURE
  // ═══════════════════════════════════════════

  // GAS STATION (west of campus)
  const gsx = campusX - 80, gsz = campusZ + 100;
  // Canopy
  fill(gsx, oy, gsz, gsx+20, oy, gsz+12, 'black_concrete'); // asphalt
  fill(gsx+2, oy+5, gsz+2, gsx+18, oy+5, gsz+10, 'white_concrete'); // canopy roof
  // Canopy pillars
  fill(gsx+2, oy+1, gsz+2, gsx+2, oy+4, gsz+2, 'iron_block');
  fill(gsx+18, oy+1, gsz+2, gsx+18, oy+4, gsz+2, 'iron_block');
  fill(gsx+2, oy+1, gsz+10, gsx+2, oy+4, gsz+10, 'iron_block');
  fill(gsx+18, oy+1, gsz+10, gsx+18, oy+4, gsz+10, 'iron_block');
  // Pumps
  for (let px = gsx+6; px <= gsx+14; px += 4) {
    fill(px, oy+1, gsz+5, px, oy+2, gsz+5, 'quartz_block');
    fill(px, oy+2, gsz+5, px, oy+2, gsz+5, 'black_concrete');
    fill(px, oy+1, gsz+7, px, oy+2, gsz+7, 'quartz_block');
    fill(px, oy+2, gsz+7, px, oy+2, gsz+7, 'black_concrete');
  }
  // Convenience store behind
  fill(gsx, oy+1, gsz+13, gsx+10, oy+4, gsz+18, 'white_concrete');
  fill(gsx+1, oy+1, gsz+14, gsx+9, oy+3, gsz+17, 'air');
  fill(gsx+1, oy+1, gsz+13, gsx+5, oy+3, gsz+13, 'glass');
  fill(gsx+3, oy+1, gsz+13, gsx+3, oy+2, gsz+13, 'air'); // door
  // Canopy lights
  fill(gsx+5, oy+4, gsz+5, gsx+5, oy+4, gsz+5, 'glowstone');
  fill(gsx+15, oy+4, gsz+5, gsx+15, oy+4, gsz+5, 'glowstone');
  fill(gsx+5, oy+4, gsz+7, gsx+5, oy+4, gsz+7, 'glowstone');
  fill(gsx+15, oy+4, gsz+7, gsx+15, oy+4, gsz+7, 'glowstone');
  // Sign
  fill(gsx+3, oy+5, gsz+13, gsx+7, oy+7, gsz+13, 'red_concrete');
  count++;

  // CHURCH (east of campus)
  const chx = campusX + CW + 60, chz = campusZ + 150;
  // Main body
  fill(chx, oy+1, chz, chx+14, oy+12, chz+22, 'stone_bricks');
  fill(chx+1, oy+1, chz+1, chx+13, oy+11, chz+21, 'air');
  // Stained glass windows
  for (let z = chz+2; z < chz+20; z += 4) {
    const gc = pick(['red_stained_glass','blue_stained_glass','yellow_stained_glass','purple_stained_glass']);
    fill(chx, oy+3, z, chx, oy+8, z+1, gc);
    fill(chx+14, oy+3, z, chx+14, oy+8, z+1, gc);
  }
  // Peaked roof
  for (let dy = 0; dy < 6; dy++) {
    fill(chx+dy, oy+13+dy, chz, chx+14-dy, oy+13+dy, chz+22, 'dark_oak_planks');
  }
  // Bell tower
  fill(chx+5, oy+1, chz-5, chx+9, oy+20, chz, 'stone_bricks');
  fill(chx+6, oy+15, chz-4, chx+8, oy+18, chz-1, 'air'); // belfry windows
  // Cross on top
  fill(chx+7, oy+21, chz-3, chx+7, oy+25, chz-3, 'gold_block');
  fill(chx+6, oy+23, chz-3, chx+8, oy+23, chz-3, 'gold_block');
  // Door
  fill(chx+6, oy+1, chz, chx+8, oy+4, chz, 'dark_oak_planks');
  fill(chx+7, oy+1, chz, chx+7, oy+3, chz, 'air');
  // Pews inside
  for (let z = chz+4; z < chz+18; z += 2) {
    fill(chx+3, oy+1, z, chx+5, oy+1, z, 'oak_stairs');
    fill(chx+9, oy+1, z, chx+11, oy+1, z, 'oak_stairs');
  }
  count++;

  // HOTEL (tall building with distinct look)
  const htx = cx2 - 60, htz = campusZ + 50;
  // Main body — brown with gold trim
  fill(htx, oy+1, htz, htx+18, oy+45, htz+14, 'brown_concrete');
  // Glass strip facades
  for (let x = htx+1; x < htx+18; x += 2) {
    fill(x, oy+2, htz, x, oy+44, htz, 'white_stained_glass');
    fill(x, oy+2, htz+14, x, oy+44, htz+14, 'white_stained_glass');
  }
  for (let z = htz+1; z < htz+14; z += 2) {
    fill(htx, oy+2, z, htx, oy+44, z, 'white_stained_glass');
    fill(htx+18, oy+2, z, htx+18, oy+44, z, 'white_stained_glass');
  }
  // Floor lines
  for (let y = oy+5; y < oy+45; y += 4) {
    fill(htx, y, htz, htx+18, y, htz, 'brown_concrete');
    fill(htx, y, htz+14, htx+18, y, htz+14, 'brown_concrete');
  }
  // Lobby — grand entrance with columns
  fill(htx+6, oy+1, htz, htx+12, oy+5, htz, 'air');
  fill(htx+6, oy+1, htz-1, htx+6, oy+5, htz-1, 'quartz_pillar');
  fill(htx+12, oy+1, htz-1, htx+12, oy+5, htz-1, 'quartz_pillar');
  fill(htx+6, oy+6, htz-1, htx+12, oy+6, htz-1, 'quartz_block');
  // Reception desk
  fill(htx+3, oy+1, htz+3, htx+8, oy+1, htz+3, 'polished_granite');
  // Lobby chandelier
  fill(htx+9, oy+5, htz+4, htx+9, oy+5, htz+4, 'iron_chain');
  fill(htx+9, oy+4, htz+4, htx+9, oy+4, htz+4, 'lantern[hanging=true]');
  // Roof
  fill(htx, oy+46, htz, htx+18, oy+46, htz+14, 'gold_block');
  // Rooftop pool!
  fill(htx+3, oy+46, htz+3, htx+15, oy+46, htz+11, 'light_blue_concrete');
  fill(htx+4, oy+46, htz+4, htx+14, oy+46, htz+10, 'water');
  count++;

  // HOSPITAL  
  const hox = campusX - 100, hoz = campusZ + 250;
  fill(hox, oy+1, hoz, hox+25, oy+20, hoz+18, 'white_concrete');
  for (let x = hox+1; x < hox+25; x += 2) {
    fill(x, oy+3, hoz, x, oy+19, hoz, 'light_blue_stained_glass');
    fill(x, oy+3, hoz+18, x, oy+19, hoz+18, 'light_blue_stained_glass');
  }
  for (let y = oy+5; y < oy+20; y += 4) {
    fill(hox, y, hoz, hox+25, y, hoz, 'white_concrete');
    fill(hox, y, hoz+18, hox+25, y, hoz+18, 'white_concrete');
  }
  // Red cross on front
  fill(hox+12, oy+14, hoz-1, hox+14, oy+14, hoz-1, 'red_concrete');
  fill(hox+13, oy+13, hoz-1, hox+13, oy+15, hoz-1, 'red_concrete');
  // Emergency entrance overhang
  fill(hox+8, oy+4, hoz-3, hox+18, oy+4, hoz-1, 'white_concrete');
  fill(hox+8, oy+1, hoz-3, hox+8, oy+3, hoz-3, 'white_concrete');
  fill(hox+18, oy+1, hoz-3, hox+18, oy+3, hoz-3, 'white_concrete');
  // Ambulance (white+red car)
  fill(hox+12, oy+1, hoz-4, hox+14, oy+1, hoz-4, 'white_concrete');
  fill(hox+12, oy+2, hoz-4, hox+12, oy+2, hoz-4, 'red_concrete');
  fill(hox+14, oy+2, hoz-4, hox+14, oy+2, hoz-4, 'glass');
  count++;

  // SUBWAY ENTRANCE (multiple locations)
  const subwaySpots = [
    {x: campusX+100, z: campusZ+48},
    {x: campusX+250, z: campusZ+148},
    {x: campusX+180, z: campusZ+338},
  ];
  for (const sub of subwaySpots) {
    // Stairway down
    fill(sub.x, oy, sub.z, sub.x+4, oy, sub.z+2, 'air');
    fill(sub.x, oy-1, sub.z, sub.x+4, oy-1, sub.z+2, 'air');
    fill(sub.x, oy-2, sub.z, sub.x+4, oy-2, sub.z+2, 'air');
    // Stairs
    fill(sub.x, oy, sub.z, sub.x+4, oy, sub.z, 'stone_brick_stairs');
    fill(sub.x, oy-1, sub.z+1, sub.x+4, oy-1, sub.z+1, 'stone_brick_stairs');
    fill(sub.x, oy-2, sub.z+2, sub.x+4, oy-2, sub.z+2, 'stone_bricks');
    // Railings
    fill(sub.x-1, oy+1, sub.z, sub.x-1, oy+1, sub.z+2, 'iron_bars');
    fill(sub.x+5, oy+1, sub.z, sub.x+5, oy+1, sub.z+2, 'iron_bars');
    // Subway sign (green)
    fill(sub.x, oy+2, sub.z-1, sub.x+4, oy+3, sub.z-1, 'green_concrete');
    fill(sub.x+1, oy+2, sub.z-1, sub.x+3, oy+2, sub.z-1, 'white_concrete');
    // Underground platform
    fill(sub.x-2, oy-4, sub.z-2, sub.x+8, oy-3, sub.z+6, 'air');
    fill(sub.x-2, oy-5, sub.z-2, sub.x+8, oy-5, sub.z+6, 'smooth_stone');
    fill(sub.x-2, oy-4, sub.z-2, sub.x+8, oy-4, sub.z-2, 'yellow_concrete'); // warning line
    // Lights in tunnel
    fill(sub.x+3, oy-3, sub.z+2, sub.x+3, oy-3, sub.z+2, 'lantern[hanging=true]');
    count++;
  }

  // ═══════════════════════════════════════════
  // 5. PARKS with real features
  // ═══════════════════════════════════════════

  // CITY PARK (large park south of campus)
  const pkx = campusX + 100, pkz = campusZ + CD + 30;
  fill(pkx, oy, pkz, pkx+80, oy, pkz+50, 'grass_block');
  // Winding path through park
  for (let i = 0; i < 80; i++) {
    const pz = pkz + 25 + Math.floor(Math.sin(i*0.15)*10);
    fill(pkx+i, oy, pz, pkx+i, oy, pz+1, 'gravel');
  }
  // Pond
  fill(pkx+50, oy-1, pkz+20, pkx+65, oy-1, pkz+35, 'water');
  fill(pkx+48, oy, pkz+18, pkx+67, oy, pkz+37, 'grass_block');
  fill(pkx+50, oy, pkz+20, pkx+65, oy, pkz+35, 'air'); // cut grass for pond edge
  fill(pkx+50, oy-1, pkz+20, pkx+65, oy-1, pkz+35, 'water');
  // Lily pads
  for (let i = 0; i < 8; i++) {
    fill(pkx+52+ri(0,10), oy, pkz+22+ri(0,10), pkx+52+ri(0,10), oy, pkz+22+ri(0,10), 'lily_pad');
  }
  // Playground
  fill(pkx+10, oy, pkz+10, pkx+25, oy, pkz+20, 'sand');
  // Slide (stairs + slab)
  fill(pkx+15, oy+1, pkz+12, pkx+15, oy+4, pkz+12, 'iron_bars');
  fill(pkx+15, oy+4, pkz+12, pkx+15, oy+4, pkz+15, 'smooth_stone_slab');
  // Swings (chains + oak plank seat)
  fill(pkx+20, oy+1, pkz+14, pkx+20, oy+4, pkz+14, 'oak_fence');
  fill(pkx+20, oy+4, pkz+14, pkx+20, oy+4, pkz+16, 'oak_fence');
  fill(pkx+20, oy+1, pkz+16, pkx+20, oy+4, pkz+16, 'oak_fence');
  fill(pkx+20, oy+4, pkz+15, pkx+20, oy+4, pkz+15, 'oak_planks');
  fill(pkx+20, oy+3, pkz+15, pkx+20, oy+3, pkz+15, 'iron_chain');
  fill(pkx+20, oy+2, pkz+15, pkx+20, oy+2, pkz+15, 'oak_slab');

  // Park benches facing pond
  for (let z = pkz+22; z < pkz+34; z += 4) {
    fill(pkx+47, oy+1, z, pkx+48, oy+1, z, 'oak_stairs');
  }
  // Trees (varied)
  const parkTrees = [[pkx+5,pkz+5],[pkx+20,pkz+30],[pkx+40,pkz+10],[pkx+40,pkz+40],[pkx+70,pkz+15],[pkx+70,pkz+40],[pkx+30,pkz+45]];
  for (const [tx,tz] of parkTrees) {
    const h = ri(5,8);
    const lt = pick(['oak_leaves','birch_leaves','dark_oak_leaves']);
    const lo = pick(['oak_log','birch_log','dark_oak_log']);
    fill(tx, oy+1, tz, tx, oy+h-1, tz, lo);
    fill(tx-2, oy+h-2, tz-2, tx+2, oy+h, tz+2, lt);
    fill(tx-1, oy+h+1, tz-1, tx+1, oy+h+1, tz+1, lt);
  }
  count++;

  // ═══════════════════════════════════════════
  // 6. BRIDGES between tall buildings
  // ═══════════════════════════════════════════
  // Add glass sky bridges connecting random tall buildings
  for (let i = 0; i < 15; i++) {
    const bx = cx1 + ri(30, (cx2-cx1)-30);
    const bz = cz1 + ri(30, (cz2-cz1)-30);
    if (bx > campusX && bx < campusX+CW && bz > campusZ && bz < campusZ+CD) continue;
    const by = oy + ri(15, 35);
    const blen = ri(8, 15);
    // Glass tunnel bridge
    fill(bx, by, bz, bx+blen, by, bz+2, 'glass');
    fill(bx, by+3, bz, bx+blen, by+3, bz+2, 'glass');
    fill(bx, by+1, bz, bx+blen, by+2, bz, 'glass');
    fill(bx, by+1, bz+2, bx+blen, by+2, bz+2, 'glass');
    // Interior walkway
    fill(bx, by, bz+1, bx+blen, by, bz+1, 'smooth_stone');
    fill(bx+1, by+1, bz+1, bx+blen-1, by+2, bz+1, 'air');
    count++;
  }

  // ═══════════════════════════════════════════
  // 7. ROOFTOP DETAILS
  // ═══════════════════════════════════════════
  for (let gx = cx1; gx < cx2; gx += 25) {
    for (let gz = cz1; gz < cz2; gz += 25) {
      if (gx > campusX && gx < campusX+CW && gz > campusZ && gz < campusZ+CD) continue;
      if (rng() < 0.5) continue;

      // Find roof height by checking upward
      let roofY = oy+5;
      for (let y = oy+60; y > oy; y--) {
        const b = blockAt(gx+10, y, gz+10);
        if (b && b.name !== 'air' && b.name !== 'void_air' && !b.name.includes('glass')) {
          roofY = y;
          break;
        }
      }
      if (roofY < oy+5) continue;

      const r = rng();
      if (r < 0.3) {
        // Water tower
        fill(gx+8, roofY+1, gz+8, gx+8, roofY+4, gz+8, 'iron_bars');
        fill(gx+12, roofY+1, gz+8, gx+12, roofY+4, gz+8, 'iron_bars');
        fill(gx+8, roofY+1, gz+12, gx+8, roofY+4, gz+12, 'iron_bars');
        fill(gx+12, roofY+1, gz+12, gx+12, roofY+4, gz+12, 'iron_bars');
        fill(gx+7, roofY+4, gz+7, gx+13, roofY+7, gz+13, 'spruce_planks');
      } else if (r < 0.6) {
        // AC units
        fill(gx+8, roofY+1, gz+8, gx+10, roofY+2, gz+10, 'iron_block');
        fill(gx+9, roofY+2, gz+9, gx+9, roofY+2, gz+9, 'iron_bars');
        if (rng() < 0.5) {
          fill(gx+12, roofY+1, gz+8, gx+14, roofY+2, gz+10, 'iron_block');
        }
      } else {
        // Rooftop garden
        fill(gx+7, roofY+1, gz+7, gx+13, roofY+1, gz+13, 'grass_block');
        fill(gx+9, roofY+2, gz+10, gx+9, roofY+5, gz+10, 'oak_log');
        fill(gx+7, roofY+5, gz+8, gx+11, roofY+6, gz+12, 'oak_leaves');
      }
      count++;
    }
  }

  // ═══════════════════════════════════════════
  // 8. STREET-LEVEL LIFE — more cars, pedestrians areas
  // ═══════════════════════════════════════════

  // Outdoor dining areas (tables + chairs near shops)
  for (let i = 0; i < 25; i++) {
    const dx = campusX + ri(70, CW-30);
    const dz = campusZ + ri(60, CD-30);
    // Table
    fill(dx, oy+1, dz, dx, oy+1, dz, 'dark_oak_fence');
    fill(dx, oy+2, dz, dx, oy+2, dz, 'dark_oak_pressure_plate');
    // Chairs (stairs facing table)
    fill(dx+1, oy+1, dz, dx+1, oy+1, dz, 'oak_stairs');
    fill(dx-1, oy+1, dz, dx-1, oy+1, dz, 'oak_stairs');
    // Umbrella (wool on fence)
    fill(dx, oy+3, dz, dx, oy+3, dz, 'dark_oak_fence');
    fill(dx-1, oy+4, dz-1, dx+1, oy+4, dz+1, pick(['red_wool','white_wool','blue_wool']));
    count++;
  }

  // Food trucks / street vendor carts
  for (let i = 0; i < 10; i++) {
    const vx = cx1 + ri(50, (cx2-cx1)-50);
    const vz = cz1 + ri(50, (cz2-cz1)-50);
    if (vx > campusX && vx < campusX+CW && vz > campusZ && vz < campusZ+CD) continue;
    const color = pick(['red_concrete','yellow_concrete','blue_concrete','white_concrete']);
    // Truck body
    fill(vx, oy+1, vz, vx+3, oy+3, vz+1, color);
    fill(vx+1, oy+1, vz, vx+2, oy+2, vz, 'air'); // serving window
    // Wheels
    fill(vx, oy+1, vz, vx, oy+1, vz, 'black_concrete');
    fill(vx+3, oy+1, vz, vx+3, oy+1, vz, 'black_concrete');
    count++;
  }

  // ═══════════════════════════════════════════
  // 9. MARTA STATION (Atlanta's transit)
  // ═══════════════════════════════════════════
  const mx = campusX + CW + 30, mz = campusZ + 300;
  // Elevated platform
  fill(mx, oy+1, mz, mx+4, oy+6, mz, 'gray_concrete'); // support pillar
  fill(mx+20, oy+1, mz, mx+24, oy+6, mz, 'gray_concrete'); // support pillar
  fill(mx, oy+1, mz+15, mx+4, oy+6, mz+15, 'gray_concrete');
  fill(mx+20, oy+1, mz+15, mx+24, oy+6, mz+15, 'gray_concrete');
  // Platform deck
  fill(mx-2, oy+7, mz-2, mx+26, oy+7, mz+17, 'smooth_stone');
  // Canopy roof
  fill(mx-2, oy+11, mz-2, mx+26, oy+11, mz+17, 'light_gray_concrete');
  // Platform pillars
  for (let x = mx; x <= mx+24; x += 8) {
    fill(x, oy+8, mz, x, oy+10, mz, 'iron_block');
    fill(x, oy+8, mz+15, x, oy+10, mz+15, 'iron_block');
  }
  // Rail tracks (one block up, on the deck: at deck level they had nothing below them)
  fill(mx+2, oy+8, mz+5, mx+22, oy+8, mz+5, 'rail');
  fill(mx+2, oy+8, mz+10, mx+22, oy+8, mz+10, 'rail');
  // Warning lines
  fill(mx+2, oy+7, mz+4, mx+22, oy+7, mz+4, 'yellow_concrete');
  fill(mx+2, oy+7, mz+11, mx+22, oy+7, mz+11, 'yellow_concrete');
  // MARTA sign
  fill(mx+8, oy+10, mz-2, mx+16, oy+10, mz-2, 'blue_concrete');
  fill(mx+9, oy+10, mz-2, mx+15, oy+10, mz-2, 'gold_block');
  // Stairs up
  for (let dy = 0; dy < 7; dy++) {
    fill(mx-3, oy+1+dy, mz+7+dy, mx-1, oy+1+dy, mz+7+dy, 'stone_brick_stairs');
  }
  count++;

  // ═══════════════════════════════════════════
  // 10. FINAL POLISH — street signs, mailboxes, manholes
  // ═══════════════════════════════════════════

  // Manholes (iron trapdoors on roads)
  for (let i = 0; i < 40; i++) {
    const mx2 = campusX + ri(5, CW-5);
    const mz2 = pick([campusZ+52, campusZ+152, campusZ+252, campusZ+342]);
    fill(mx2, oy, mz2, mx2, oy, mz2, 'iron_trapdoor');
    count++;
  }

  // Mailboxes (blue concrete + chest)
  for (let i = 0; i < 15; i++) {
    const mbx = campusX + ri(10, CW-10);
    const mbz = campusZ + ri(10, CD-10);
    fill(mbx, oy+1, mbz, mbx, oy+2, mbz, 'blue_concrete');
    count++;
  }

  // Newspaper stands (note blocks)
  for (let i = 0; i < 12; i++) {
    const nx = campusX + ri(10, CW-10);
    const nz = campusZ + pick([48, 148, 248, 338]);
    fill(nx, oy+1, nz, nx, oy+1, nz, 'note_block');
    count++;
  }

  return { features: count };
}

export default {
  name: 'gt-campus',
  description:
    'Georgia Tech campus in Atlanta (401×401 blocks): roads, Tech Green, Tech Tower with its gold dome, Bobby Dodd Stadium, CULC, ' +
    'Crosland Tower, dorms, then crosswalks, trees, parking, fountain, Buzz statue, shops and subway entrances. ' +
    'Ported from the legacy bot scripts (build-gt-city / build-gt-rebuild / build-details / build-realism2). ' +
    '`city: true` adds the surrounding city, highway ring, canal, hotel, church… (about 730×730 blocks). ' +
    'The legacy "flatten" (air above the campus) is off by default: clear the site with `mcb build --clear`, or set `flatten: true`.',
  params: {
    city: { type: 'bool', default: false, description: 'also build the Atlanta city around the campus (blocks, highway ring, canal, hotel, church, hospital, MARTA, …) — huge' },
    details: { type: 'bool', default: true, description: 'detail pass: crosswalks, traffic lights, trees, benches, parking lots with cars, fountain, flowers, bus stops, Buzz statue, …' },
    realism: { type: 'bool', default: true, description: 'realism pass: shops with awnings, subway entrances, outdoor dining, manholes, mailboxes, …' },
    flatten: { type: 'bool', default: false, description: 'clear the 401×60×401 campus volume to air inside the blueprint (the legacy flatten); `mcb build --clear` normally does this' },
  },
  build(s, p, ctx) {
    // Passes 4 and 5 read what the city put into the world, so the city is built whenever they run. For `city: false`
    // everything goes into a scratch structure and only the campus square is kept.
    const needCity = p.city || p.details || p.realism;
    const world = p.city || !needCity ? s : new ctx.Structure();
    const features = {};
    campusPass(world, { flatten: p.flatten });
    if (needCity) features.city = cityPass(world);
    landmarksPass(world);
    if (p.details) features.details = detailsPass(world);
    if (p.realism) features.realism = realismPass(world);
    if (world !== s) copyCampusSquare(world, s);
    s.meta.features = features;
  },
};
