// GT Campus + Atlanta City Builder — builds continuously near the player
// Phase 1: GT Campus landmarks
// Phase 2: City grid with buildings, streets, highways
// Uses /fill for bulk, stays connected and keeps building
const mineflayer = require('mineflayer');
const fs = require('fs');

const bot = mineflayer.createBot({ host:'localhost', port:25566, username:'BuilderBot', auth:'offline', version:'1.21.11' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => { console.log(msg); fs.appendFileSync('/tmp/gt_city_log.txt', msg+'\n'); };

async function fill(x1,y1,z1,x2,y2,z2,block) {
  const dx=Math.abs(x2-x1)+1, dy=Math.abs(y2-y1)+1, dz=Math.abs(z2-z1)+1;
  if (dx*dy*dz > 32000) {
    if (dx >= dy && dx >= dz) {
      const mid = Math.floor((Math.min(x1,x2)+Math.max(x1,x2))/2);
      await fill(Math.min(x1,x2),y1,z1,mid,y2,z2,block);
      await fill(mid+1,y1,z1,Math.max(x1,x2),y2,z2,block);
    } else if (dz >= dy) {
      const mid = Math.floor((Math.min(z1,z2)+Math.max(z1,z2))/2);
      await fill(x1,y1,Math.min(z1,z2),x2,y2,mid,block);
      await fill(x1,y1,mid+1,x2,y2,Math.max(z1,z2),block);
    } else {
      const mid = Math.floor((Math.min(y1,y2)+Math.max(y1,y2))/2);
      await fill(x1,Math.min(y1,y2),z1,x2,mid,z2,block);
      await fill(x1,mid+1,z1,x2,Math.max(y1,y2),z2,block);
    }
    return;
  }
  bot.chat(`/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}`);
  await sleep(80);
}

// Building helper — glass tower with windows
async function buildTower(ox, oy, oz, w, d, h, body, glass, accent, name) {
  log(`  Building ${name} at ${ox},${oy},${oz} (${w}x${h}x${d})`);
  bot.chat(`Building ${name}...`);
  // Walls
  for (let yc = 0; yc < h; yc += 25) {
    const ye = Math.min(yc+24, h-1);
    await fill(ox, oy+yc, oz, ox+w-1, oy+ye, oz, body);
    await fill(ox, oy+yc, oz+d-1, ox+w-1, oy+ye, oz+d-1, body);
    await fill(ox, oy+yc, oz, ox, oy+ye, oz+d-1, body);
    await fill(ox+w-1, oy+yc, oz, ox+w-1, oy+ye, oz+d-1, body);
  }
  // Glass columns on all 4 walls
  for (let x = ox+1; x < ox+w-1; x += 2) {
    await fill(x, oy+2, oz, x, oy+h-1, oz, glass);
    await fill(x, oy+2, oz+d-1, x, oy+h-1, oz+d-1, glass);
  }
  for (let z = oz+1; z < oz+d-1; z += 2) {
    await fill(ox, oy+2, z, ox, oy+h-1, z, glass);
    await fill(ox+w-1, oy+2, z, ox+w-1, oy+h-1, z, glass);
  }
  // Floor lines every 4 blocks
  for (let y = oy+4; y < oy+h; y += 4) {
    await fill(ox, y, oz, ox+w-1, y, oz, body);
    await fill(ox, y, oz+d-1, ox+w-1, y, oz+d-1, body);
    await fill(ox, y, oz, ox, y, oz+d-1, body);
    await fill(ox+w-1, y, oz, ox+w-1, y, oz+d-1, body);
  }
  // Roof
  await fill(ox, oy+h, oz, ox+w-1, oy+h, oz+d-1, accent);
  // Antenna
  const cx = ox+Math.floor(w/2), cz = oz+Math.floor(d/2);
  await fill(cx, oy+h+1, cz, cx, oy+h+8, cz, accent);
  await fill(cx, oy+h+9, cz, cx, oy+h+9, cz, 'sea_lantern');
  // Door
  await fill(ox+Math.floor(w/2), oy, oz, ox+Math.floor(w/2)+1, oy+2, oz, 'air');
  // Lobby floor
  await fill(ox+1, oy, oz+1, ox+w-2, oy, oz+d-2, 'polished_deepslate');
}

let started = false;
bot.on('spawn', async () => {
  if (started) return; started = true;
  try {
    fs.writeFileSync('/tmp/gt_city_log.txt', '');
    await sleep(3000);
    bot.chat('/gamemode creative'); await sleep(1000);
    bot.chat('/tp BuilderBot alphasuperduper'); await sleep(3000);

    const p = bot.entity.position.floored();
    const oy = -62; // ground level from scout
    const ox = p.x, oz = p.z;
    log(`Player at ${p}, building at ground y=${oy}`);

    bot.chat('/time set noon');
    bot.chat('/gamerule doDaylightCycle false');
    await sleep(300);

    // ══════════════════════════════════════════════════════
    // PHASE 1: GEORGIA TECH CAMPUS
    // ══════════════════════════════════════════════════════
    log('=== PHASE 1: GEORGIA TECH CAMPUS ===');
    bot.chat('=== Building Georgia Tech Campus ===');

    // Flatten campus area (400x400 centered on player)
    const campusX = ox - 50, campusZ = oz - 50;
    const CW = 400, CD = 400;
    log('Flattening campus...');
    for (let yy = oy+1; yy < oy+60; yy += 25) {
      await fill(campusX, yy, campusZ, campusX+CW, Math.min(yy+24, oy+60), campusZ+CD, 'air');
    }
    await fill(campusX, oy, campusZ, campusX+CW, oy, campusZ+CD, 'grass_block');
    log('Campus flattened');

    // ── Roads ──
    log('Building roads...');
    // Main E-W roads
    const roads_ew = [
      { z: campusZ + 50, name: "10th St" },
      { z: campusZ + 150, name: "Ferst Dr" },
      { z: campusZ + 250, name: "Bobby Dodd Way" },
      { z: campusZ + 340, name: "North Ave" },
    ];
    for (const rd of roads_ew) {
      await fill(campusX, oy, rd.z, campusX+CW, oy, rd.z+5, 'gray_concrete');
      await fill(campusX, oy, rd.z+2, campusX+CW, oy, rd.z+2, 'yellow_concrete');
      await fill(campusX, oy+1, rd.z-1, campusX+CW, oy+1, rd.z-1, 'smooth_stone_slab');
      await fill(campusX, oy+1, rd.z+6, campusX+CW, oy+1, rd.z+6, 'smooth_stone_slab');
    }
    // Main N-S roads
    const roads_ns = [
      { x: campusX + 60, name: "Hemphill Ave" },
      { x: campusX + 140, name: "Atlantic Dr" },
      { x: campusX + 220, name: "Techwood Dr" },
      { x: campusX + 310, name: "Spring St" },
    ];
    for (const rd of roads_ns) {
      await fill(rd.x, oy, campusZ, rd.x+5, oy, campusZ+CD, 'gray_concrete');
      await fill(rd.x+2, oy, campusZ, rd.x+2, oy, campusZ+CD, 'yellow_concrete');
      await fill(rd.x-1, oy+1, campusZ, rd.x-1, oy+1, campusZ+CD, 'smooth_stone_slab');
      await fill(rd.x+6, oy+1, campusZ, rd.x+6, oy+1, campusZ+CD, 'smooth_stone_slab');
    }
    log('Roads done');

    // ── Paths (tan concrete) ──
    // Tech Walk (diagonal-ish path through campus)
    for (let i = 0; i < 200; i++) {
      const px = campusX + 80 + i, pz = campusZ + 70 + Math.floor(i * 0.8);
      await fill(px, oy, pz, px+1, oy, pz+1, 'smooth_sandstone');
    }

    // ── Green spaces ──
    log('Adding green spaces...');
    // Tech Green (main quad)
    const tgx = campusX + 150, tgz = campusZ + 160;
    await fill(tgx, oy, tgz, tgx+60, oy, tgz+40, 'grass_block');
    // Trees on Tech Green
    for (let tx = tgx+5; tx < tgx+60; tx += 12) {
      for (let tz = tgz+5; tz < tgz+40; tz += 12) {
        await fill(tx, oy+1, tz, tx, oy+5, tz, 'oak_log');
        await fill(tx-2, oy+4, tz-2, tx+2, oy+6, tz+2, 'oak_leaves');
        await fill(tx-1, oy+7, tz-1, tx+1, oy+7, tz+1, 'oak_leaves');
      }
    }

    // ── GT BUILDINGS ──
    log('Building GT landmarks...');
    const Y = oy + 1; // building base

    // Tech Tower (Admin Building) — iconic gold-domed clock tower
    const ttx = campusX + 170, ttz = campusZ + 100;
    await buildTower(ttx, Y, ttz, 20, 14, 30, 'bricks', 'white_stained_glass', 'stone_bricks', 'Tech Tower');
    // Gold dome on top
    for (let dy = 0; dy < 6; dy++) {
      const r = Math.max(1, 4 - dy);
      await fill(ttx+10-r, Y+31+dy, ttz+7-r, ttx+10+r, Y+31+dy, ttz+7+r, 'gold_block');
    }
    // Clock faces (glowstone)
    await fill(ttx+9, Y+25, ttz, ttx+11, Y+27, ttz, 'glowstone');
    await fill(ttx+9, Y+25, ttz+13, ttx+11, Y+27, ttz+13, 'glowstone');

    // Klaus Advanced Computing Building
    await buildTower(campusX+85, Y, campusZ+160, 24, 16, 20, 'light_gray_concrete', 'light_blue_stained_glass', 'white_concrete', 'Klaus Computing');

    // College of Computing (CoC)
    await buildTower(campusX+85, Y, campusZ+110, 20, 14, 16, 'white_concrete', 'cyan_stained_glass', 'iron_block', 'College of Computing');

    // Crosland Tower (Library tower)
    await buildTower(campusX+225, Y, campusZ+210, 10, 10, 45, 'brown_concrete', 'white_stained_glass', 'brown_terracotta', 'Crosland Tower');

    // CULC (Clough Undergraduate Learning Commons)
    await buildTower(campusX+200, Y, campusZ+175, 30, 18, 15, 'white_concrete', 'light_blue_stained_glass', 'iron_block', 'CULC');

    // Student Center
    await buildTower(campusX+200, Y, campusZ+260, 25, 16, 12, 'bricks', 'white_stained_glass', 'stone_bricks', 'Student Center');

    // Bobby Dodd Stadium (open-air)
    const sdx = campusX + 270, sdz = campusZ + 160;
    log('  Building Bobby Dodd Stadium...');
    bot.chat('Building Bobby Dodd Stadium...');
    // Field
    await fill(sdx, oy, sdz, sdx+50, oy, sdz+30, 'lime_concrete');
    // Field lines
    for (let lx = sdx+5; lx <= sdx+45; lx += 10) {
      await fill(lx, oy, sdz, lx, oy, sdz+30, 'white_concrete');
    }
    // Stands (tiered)
    for (let tier = 0; tier < 8; tier++) {
      await fill(sdx-3-tier, oy+tier+1, sdz, sdx-3-tier, oy+tier+1, sdz+30, 'stone');
      await fill(sdx+53+tier, oy+tier+1, sdz, sdx+53+tier, oy+tier+1, sdz+30, 'stone');
      await fill(sdx, oy+tier+1, sdz-3-tier, sdx+50, oy+tier+1, sdz-3-tier, 'stone');
    }
    // Scoreboard
    await fill(sdx+20, oy+1, sdz+35, sdx+30, oy+10, sdz+35, 'black_concrete');
    await fill(sdx+22, oy+3, sdz+35, sdx+28, oy+8, sdz+35, 'glowstone');

    // CRC (Campus Recreation Center)
    await buildTower(campusX+40, Y, campusZ+220, 22, 18, 12, 'light_gray_concrete', 'light_blue_stained_glass', 'white_concrete', 'CRC');

    // Howey Physics
    await buildTower(campusX+130, Y, campusZ+130, 18, 12, 14, 'white_concrete', 'gray_stained_glass', 'stone_bricks', 'Howey Physics');

    // Van Leer (ECE)
    await buildTower(campusX+130, Y, campusZ+75, 16, 14, 16, 'bricks', 'white_stained_glass', 'stone_bricks', 'Van Leer ECE');

    // ISyE (Groseclose)
    await buildTower(campusX+70, Y, campusZ+200, 18, 12, 14, 'gray_concrete', 'white_stained_glass', 'light_gray_concrete', 'ISyE Groseclose');

    // Scheller College of Business
    await buildTower(campusX+320, Y, campusZ+90, 22, 16, 18, 'white_concrete', 'light_blue_stained_glass', 'gold_block', 'Scheller Business');

    // MRDC (Manufacturing)
    await buildTower(campusX+100, Y, campusZ+80, 18, 14, 12, 'gray_concrete', 'gray_stained_glass', 'iron_block', 'MRDC');

    // Skiles (Classroom)
    await buildTower(campusX+235, Y, campusZ+260, 20, 12, 10, 'bricks', 'white_stained_glass', 'stone_bricks', 'Skiles Classroom');

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
      await buildTower(campusX+d.dx, Y, campusZ+d.dz, d.w, d.d, d.h, 'bricks', 'white_stained_glass', 'stone_bricks', d.name + ' Dorm');
    }

    // "GT" letters on Tech Green (gold blocks)
    const ltx = tgx + 10, ltz = tgz + 15;
    // G
    await fill(ltx, oy+1, ltz, ltx+6, oy+1, ltz, 'gold_block');
    await fill(ltx, oy+1, ltz, ltx, oy+1, ltz+8, 'gold_block');
    await fill(ltx, oy+1, ltz+8, ltx+6, oy+1, ltz+8, 'gold_block');
    await fill(ltx+6, oy+1, ltz+4, ltx+6, oy+1, ltz+8, 'gold_block');
    await fill(ltx+3, oy+1, ltz+4, ltx+6, oy+1, ltz+4, 'gold_block');
    // T
    await fill(ltx+10, oy+1, ltz, ltx+18, oy+1, ltz, 'gold_block');
    await fill(ltx+14, oy+1, ltz, ltx+14, oy+1, ltz+8, 'gold_block');

    // Streetlights
    log('Adding streetlights...');
    for (const rd of roads_ew) {
      for (let x = campusX; x < campusX+CW; x += 20) {
        await fill(x, oy+1, rd.z-2, x, oy+4, rd.z-2, 'iron_bars');
        await fill(x, oy+5, rd.z-2, x, oy+5, rd.z-2, 'sea_lantern');
      }
    }
    for (const rd of roads_ns) {
      for (let z = campusZ; z < campusZ+CD; z += 20) {
        await fill(rd.x-2, oy+1, z, rd.x-2, oy+4, z, 'iron_bars');
        await fill(rd.x-2, oy+5, z, rd.x-2, oy+5, z, 'sea_lantern');
      }
    }

    log('=== GT CAMPUS COMPLETE ===');
    bot.chat('=== Georgia Tech Campus Complete! ===');
    // TP player to aerial view
    bot.chat(`/tp alphasuperduper ${campusX + 200} ${oy + 80} ${campusZ - 30} 0 30`);
    await sleep(3000);

    // ══════════════════════════════════════════════════════
    // PHASE 2: ATLANTA CITY around campus
    // ══════════════════════════════════════════════════════
    log('=== PHASE 2: ATLANTA CITY ===');
    bot.chat('=== Now building Atlanta city around campus ===');

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
        await buildCityBlock(gx, gz);
      }
    }
    // East city blocks
    for (let gx = campusX + CW + 10; gx < cityX2; gx += CELL) {
      for (let gz = cityZ1; gz < cityZ2; gz += CELL) {
        await buildCityBlock(gx, gz);
      }
    }
    // North city blocks (between campus sides)
    for (let gx = campusX; gx < campusX + CW; gx += CELL) {
      for (let gz = cityZ1; gz < campusZ - 10; gz += CELL) {
        await buildCityBlock(gx, gz);
      }
    }
    // South city blocks
    for (let gx = campusX; gx < campusX + CW; gx += CELL) {
      for (let gz = campusZ + CD + 10; gz < cityZ2; gz += CELL) {
        await buildCityBlock(gx, gz);
      }
    }

    async function buildCityBlock(bx, bz) {
      // Flatten
      await fill(bx, oy, bz, bx+CELL-1, oy, bz+CELL-1, 'gray_concrete');
      // Road edges
      await fill(bx, oy, bz, bx+STREET_W-1, oy, bz+CELL-1, 'black_concrete');
      await fill(bx, oy, bz, bx+CELL-1, oy, bz+STREET_W-1, 'black_concrete');

      // Skip some for parks
      if (rng() < 0.12) {
        await fill(bx+STREET_W+1, oy, bz+STREET_W+1, bx+CELL-2, oy, bz+CELL-2, 'grass_block');
        // Tree
        const tx = bx+STREET_W+5, tz = bz+STREET_W+5;
        await fill(tx, oy+1, tz, tx, oy+5, tz, 'oak_log');
        await fill(tx-2, oy+4, tz-2, tx+2, oy+6, tz+2, 'oak_leaves');
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
        await fill(tbx, oy+1+yc, tbz, tbx+bw-1, oy+1+ye, tbz, body);
        await fill(tbx, oy+1+yc, tbz+bd-1, tbx+bw-1, oy+1+ye, tbz+bd-1, body);
        await fill(tbx, oy+1+yc, tbz, tbx, oy+1+ye, tbz+bd-1, body);
        await fill(tbx+bw-1, oy+1+yc, tbz, tbx+bw-1, oy+1+ye, tbz+bd-1, body);
      }
      // Glass columns
      for (let x = tbx+1; x < tbx+bw-1; x += 2) {
        await fill(x, oy+3, tbz, x, oy+h, tbz, glass);
        await fill(x, oy+3, tbz+bd-1, x, oy+h, tbz+bd-1, glass);
      }
      for (let z = tbz+1; z < tbz+bd-1; z += 2) {
        await fill(tbx, oy+3, z, tbx, oy+h, z, glass);
        await fill(tbx+bw-1, oy+3, z, tbx+bw-1, oy+h, z, glass);
      }
      // Floor lines
      for (let y = oy+5; y < oy+1+h; y += 4) {
        await fill(tbx, y, tbz, tbx+bw-1, y, tbz, body);
        await fill(tbx, y, tbz+bd-1, tbx+bw-1, y, tbz+bd-1, body);
        await fill(tbx, y, tbz, tbx, y, tbz+bd-1, body);
        await fill(tbx+bw-1, y, tbz, tbx+bw-1, y, tbz+bd-1, body);
      }
      // Roof + antenna
      await fill(tbx, oy+1+h, tbz, tbx+bw-1, oy+1+h, tbz+bd-1, accent);
      if (h > 30) {
        const ax = tbx+Math.floor(bw/2), az = tbz+Math.floor(bd/2);
        await fill(ax, oy+2+h, az, ax, oy+6+h, az, accent);
        await fill(ax, oy+7+h, az, ax, oy+7+h, az, 'sea_lantern');
      }

      bldgCount++;
      if (bldgCount % 5 === 0) {
        log(`  City buildings: ${bldgCount}`);
        bot.chat(`City buildings: ${bldgCount}`);
      }
    }

    log(`=== CITY COMPLETE: ${bldgCount} buildings ===`);

    // ── Highway ring ──
    log('Building highway ring...');
    bot.chat('Building elevated highway...');
    const hwyY = oy + 12, hwyW = 6;
    const hx1 = cityX1 - 10, hz1 = cityZ1 - 10, hx2 = cityX2 + 10, hz2 = cityZ2 + 10;

    // Pillars + deck for all 4 sides
    // South
    for (let x = hx1; x <= hx2; x += 14) { await fill(x, oy+1, hz1, x+1, hwyY-1, hz1+1, 'gray_concrete'); }
    await fill(hx1, hwyY, hz1, hx2, hwyY, hz1+hwyW, 'gray_concrete');
    await fill(hx1, hwyY, hz1+3, hx2, hwyY, hz1+3, 'white_concrete');
    await fill(hx1, hwyY+1, hz1, hx2, hwyY+1, hz1, 'stone_brick_wall');
    await fill(hx1, hwyY+1, hz1+hwyW, hx2, hwyY+1, hz1+hwyW, 'stone_brick_wall');
    // North
    for (let x = hx1; x <= hx2; x += 14) { await fill(x, oy+1, hz2, x+1, hwyY-1, hz2+1, 'gray_concrete'); }
    await fill(hx1, hwyY, hz2, hx2, hwyY, hz2+hwyW, 'gray_concrete');
    await fill(hx1, hwyY, hz2+3, hx2, hwyY, hz2+3, 'white_concrete');
    await fill(hx1, hwyY+1, hz2, hx2, hwyY+1, hz2, 'stone_brick_wall');
    await fill(hx1, hwyY+1, hz2+hwyW, hx2, hwyY+1, hz2+hwyW, 'stone_brick_wall');
    // West
    for (let z = hz1; z <= hz2+hwyW; z += 14) { await fill(hx1, oy+1, z, hx1+1, hwyY-1, z+1, 'gray_concrete'); }
    await fill(hx1, hwyY, hz1, hx1+hwyW, hwyY, hz2+hwyW, 'gray_concrete');
    await fill(hx1+3, hwyY, hz1, hx1+3, hwyY, hz2+hwyW, 'white_concrete');
    await fill(hx1, hwyY+1, hz1, hx1, hwyY+1, hz2+hwyW, 'stone_brick_wall');
    await fill(hx1+hwyW, hwyY+1, hz1, hx1+hwyW, hwyY+1, hz2+hwyW, 'stone_brick_wall');
    // East
    for (let z = hz1; z <= hz2+hwyW; z += 14) { await fill(hx2, oy+1, z, hx2+1, hwyY-1, z+1, 'gray_concrete'); }
    await fill(hx2, hwyY, hz1, hx2+hwyW, hwyY, hz2+hwyW, 'gray_concrete');
    await fill(hx2+3, hwyY, hz1, hx2+3, hwyY, hz2+hwyW, 'white_concrete');
    await fill(hx2, hwyY+1, hz1, hx2, hwyY+1, hz2+hwyW, 'stone_brick_wall');
    await fill(hx2+hwyW, hwyY+1, hz1, hx2+hwyW, hwyY+1, hz2+hwyW, 'stone_brick_wall');

    // Highway lights
    for (let x = hx1; x <= hx2; x += 18) {
      await fill(x, hwyY+2, hz1+3, x, hwyY+2, hz1+3, 'sea_lantern');
      await fill(x, hwyY+2, hz2+3, x, hwyY+2, hz2+3, 'sea_lantern');
    }
    for (let z = hz1; z <= hz2+hwyW; z += 18) {
      await fill(hx1+3, hwyY+2, z, hx1+3, hwyY+2, z, 'sea_lantern');
      await fill(hx2+3, hwyY+2, z, hx2+3, hwyY+2, z, 'sea_lantern');
    }

    log('=== ALL DONE ===');
    bot.chat(`=== GT Campus + Atlanta City COMPLETE! ${bldgCount} city buildings + GT landmarks + highway ===`);
    bot.chat(`/tp alphasuperduper ${campusX+200} ${oy+100} ${campusZ-60} 0 30`);
    await sleep(5000);

    // Stay connected — don't quit
    log('Builder staying connected. Building complete.');
    bot.chat('Build complete! I am staying connected. Tell me if you want more.');

  } catch(e) { log('FATAL: ' + e.message + '\n' + e.stack); }
});
bot.on('message', msg => {
  const s = msg.toString();
  if (s.includes('error') || s.includes('Error') || s.includes('Kicked') || s.includes('exceeded'))
    log('MSG: ' + s);
});
bot.on('error', e => log('Err: ' + e.message));
bot.on('kicked', r => { log('Kicked: ' + JSON.stringify(r)); process.exit(1); });
bot.on('end', () => { log('Disconnected'); process.exit(0); });
