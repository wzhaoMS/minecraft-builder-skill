// Rebuild GT landmarks with REAL architectural detail
// Tech Tower: classical brick, white columns, arched entry, clock tower, gold dome
// Bobby Dodd: proper horseshoe stadium
// CULC: modern glass building with cantilever
// Crosland Tower: brutalist concrete library tower

const mineflayer = require('mineflayer');
const vec3 = require('vec3');
const fs = require('fs');

const bot = mineflayer.createBot({host:'localhost',port:25566,username:'BuilderBot',auth:'offline',version:'1.21.11'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => { console.log(msg); fs.appendFileSync('/tmp/gt_rebuild_log.txt', msg+'\n'); };

async function fill(x1,y1,z1,x2,y2,z2,block) {
  const dx=Math.abs(x2-x1)+1, dy=Math.abs(y2-y1)+1, dz=Math.abs(z2-z1)+1;
  if (dx*dy*dz > 32000) {
    if (dx>=dy&&dx>=dz){const m=Math.floor((Math.min(x1,x2)+Math.max(x1,x2))/2);await fill(Math.min(x1,x2),y1,z1,m,y2,z2,block);await fill(m+1,y1,z1,Math.max(x1,x2),y2,z2,block);}
    else if(dz>=dy){const m=Math.floor((Math.min(z1,z2)+Math.max(z1,z2))/2);await fill(x1,y1,Math.min(z1,z2),x2,y2,m,block);await fill(x1,y1,m+1,x2,y2,Math.max(z1,z2),block);}
    else{const m=Math.floor((Math.min(y1,y2)+Math.max(y1,y2))/2);await fill(x1,Math.min(y1,y2),z1,x2,m,z2,block);await fill(x1,m+1,z1,x2,Math.max(y1,y2),z2,block);}
    return;
  }
  bot.chat(`/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}`);
  await sleep(80);
}

let started = false;
bot.on('spawn', async () => {
  if (started) return; started = true;
  try {
    fs.writeFileSync('/tmp/gt_rebuild_log.txt','');
    await sleep(3000);
    bot.chat('/gamemode creative'); await sleep(1000);

    const oy = -62;
    const campusX = 359, campusZ = -536;
    const Y = oy + 1; // building base

    log('=== REBUILDING GT LANDMARKS WITH DETAIL ===');
    bot.chat('Rebuilding GT landmarks with real architecture...');

    // ═══════════════════════════════════════════════════
    // TECH TOWER — The Lettie Pate Whitehead Evans Admin Building
    // Real features: Red brick, white stone trim, classical columns,
    //   arched main entrance, square clock tower w/ gold dome
    // ═══════════════════════════════════════════════════
    log('Rebuilding Tech Tower...');
    bot.chat('Rebuilding Tech Tower with real architecture...');
    const ttx = campusX + 160, ttz = campusZ + 90;
    const ttw = 30, ttd = 18; // wider building, more realistic

    // Clear old building
    await fill(ttx-5, oy, ttz-5, ttx+ttw+5, oy+50, ttz+ttd+5, 'air');
    await fill(ttx-5, oy, ttz-5, ttx+ttw+5, oy, ttz+ttd+5, 'grass_block');

    // === MAIN BUILDING BODY (3 stories, brick) ===
    // Foundation — stone base
    await fill(ttx, Y, ttz, ttx+ttw, Y, ttz+ttd, 'smooth_stone');
    await fill(ttx-1, Y, ttz-1, ttx+ttw+1, Y, ttz+ttd+1, 'smooth_stone');

    // Brick walls — 3 stories (12 blocks)
    await fill(ttx, Y+1, ttz, ttx+ttw, Y+12, ttz+ttd, 'bricks');
    // Hollow interior
    await fill(ttx+1, Y+1, ttz+1, ttx+ttw-1, Y+11, ttz+ttd-1, 'air');
    // Floors
    await fill(ttx+1, Y+4, ttz+1, ttx+ttw-1, Y+4, ttz+ttd-1, 'oak_planks');
    await fill(ttx+1, Y+8, ttz+1, ttx+ttw-1, Y+8, ttz+ttd-1, 'oak_planks');

    // === WHITE STONE TRIM (quartz) at each floor level ===
    await fill(ttx, Y+4, ttz, ttx+ttw, Y+4, ttz, 'quartz_block');
    await fill(ttx, Y+4, ttz+ttd, ttx+ttw, Y+4, ttz+ttd, 'quartz_block');
    await fill(ttx, Y+8, ttz, ttx+ttw, Y+8, ttz, 'quartz_block');
    await fill(ttx, Y+8, ttz+ttd, ttx+ttw, Y+8, ttz+ttd, 'quartz_block');
    // Top cornice — protruding white trim
    await fill(ttx-1, Y+12, ttz-1, ttx+ttw+1, Y+12, ttz+ttd+1, 'quartz_block');
    await fill(ttx-1, Y+13, ttz-1, ttx+ttw+1, Y+13, ttz+ttd+1, 'quartz_slab');

    // === WINDOWS with white frames ===
    // Front facade (south face, z = ttz)
    for (let x = ttx+2; x <= ttx+ttw-2; x += 3) {
      // 1st floor windows
      await fill(x, Y+2, ttz, x+1, Y+3, ttz, 'glass');
      await fill(x, Y+1, ttz, x+1, Y+1, ttz, 'quartz_slab'); // sill
      // 2nd floor windows
      await fill(x, Y+5, ttz, x+1, Y+7, ttz, 'glass');
      await fill(x, Y+5, ttz, x+1, Y+5, ttz, 'quartz_slab');
      // 3rd floor windows
      await fill(x, Y+9, ttz, x+1, Y+11, ttz, 'glass');
      await fill(x, Y+9, ttz, x+1, Y+9, ttz, 'quartz_slab');
    }
    // Back facade
    for (let x = ttx+2; x <= ttx+ttw-2; x += 3) {
      await fill(x, Y+2, ttz+ttd, x+1, Y+3, ttz+ttd, 'glass');
      await fill(x, Y+5, ttz+ttd, x+1, Y+7, ttz+ttd, 'glass');
      await fill(x, Y+9, ttz+ttd, x+1, Y+11, ttz+ttd, 'glass');
    }
    // Side windows
    for (let z = ttz+2; z <= ttz+ttd-2; z += 3) {
      await fill(ttx, Y+2, z, ttx, Y+3, z+1, 'glass');
      await fill(ttx, Y+5, z, ttx, Y+7, z+1, 'glass');
      await fill(ttx, Y+9, z, ttx, Y+11, z+1, 'glass');
      await fill(ttx+ttw, Y+2, z, ttx+ttw, Y+3, z+1, 'glass');
      await fill(ttx+ttw, Y+5, z, ttx+ttw, Y+7, z+1, 'glass');
      await fill(ttx+ttw, Y+9, z, ttx+ttw, Y+11, z+1, 'glass');
    }

    // === CLASSICAL ENTRANCE — center of south facade ===
    const ecx = ttx + Math.floor(ttw/2); // entrance center x
    // Arched doorway (3 wide, 4 high)
    await fill(ecx-1, Y+1, ttz, ecx+1, Y+4, ttz, 'air');
    // Arch top (stairs)
    await fill(ecx-2, Y+4, ttz, ecx-2, Y+4, ttz, 'quartz_stairs');
    await fill(ecx+2, Y+4, ttz, ecx+2, Y+4, ttz, 'quartz_stairs');
    await fill(ecx-1, Y+5, ttz, ecx+1, Y+5, ttz, 'quartz_block');
    // Columns flanking entrance
    await fill(ecx-3, Y+1, ttz-1, ecx-3, Y+5, ttz-1, 'quartz_pillar');
    await fill(ecx+3, Y+1, ttz-1, ecx+3, Y+5, ttz-1, 'quartz_pillar');
    await fill(ecx-5, Y+1, ttz-1, ecx-5, Y+5, ttz-1, 'quartz_pillar');
    await fill(ecx+5, Y+1, ttz-1, ecx+5, Y+5, ttz-1, 'quartz_pillar');
    // Pediment above columns (triangular)
    await fill(ecx-6, Y+6, ttz-1, ecx+6, Y+6, ttz-1, 'quartz_block');
    await fill(ecx-5, Y+7, ttz-1, ecx+5, Y+7, ttz-1, 'quartz_block');
    await fill(ecx-4, Y+8, ttz-1, ecx+4, Y+8, ttz-1, 'quartz_block');
    await fill(ecx-3, Y+9, ttz-1, ecx+3, Y+9, ttz-1, 'quartz_block');
    await fill(ecx-2, Y+10, ttz-1, ecx+2, Y+10, ttz-1, 'quartz_block');
    // Entry steps
    await fill(ecx-2, Y, ttz-2, ecx+2, Y, ttz-2, 'smooth_stone_slab');
    await fill(ecx-3, oy, ttz-3, ecx+3, oy, ttz-3, 'smooth_stone');

    // === CLOCK TOWER — square tower rising from center of roof ===
    const ctx = ecx - 3, ctz = ttz + Math.floor(ttd/2) - 3;
    const ctw = 7, ctd = 7;
    // Tower walls (brick)
    await fill(ctx, Y+13, ctz, ctx+ctw, Y+28, ctz+ctd, 'bricks');
    await fill(ctx+1, Y+13, ctz+1, ctx+ctw-1, Y+27, ctz+ctd-1, 'air');
    // Tower white trim bands
    await fill(ctx-1, Y+18, ctz-1, ctx+ctw+1, Y+18, ctz+ctd+1, 'quartz_block');
    await fill(ctx-1, Y+24, ctz-1, ctx+ctw+1, Y+24, ctz+ctd+1, 'quartz_block');
    await fill(ctx-1, Y+28, ctz-1, ctx+ctw+1, Y+28, ctz+ctd+1, 'quartz_block');
    // Tower windows (tall arched openings near top)
    // South face
    await fill(ctx+2, Y+19, ctz, ctx+4, Y+23, ctz, 'glass');
    await fill(ctx+2, Y+25, ctz, ctx+4, Y+27, ctz, 'glass');
    // North face
    await fill(ctx+2, Y+19, ctz+ctd, ctx+4, Y+23, ctz+ctd, 'glass');
    await fill(ctx+2, Y+25, ctz+ctd, ctx+4, Y+27, ctz+ctd, 'glass');
    // East face
    await fill(ctx+ctw, Y+19, ctz+2, ctx+ctw, Y+23, ctz+4, 'glass');
    await fill(ctx+ctw, Y+25, ctz+ctd-2, ctx+ctw, Y+27, ctz+ctd-2, 'glass');
    // West face
    await fill(ctx, Y+19, ctz+2, ctx, Y+23, ctz+4, 'glass');

    // === CLOCK FACES (glowstone circles on 4 sides) ===
    const clkY = Y + 21;
    // South clock
    await fill(ctx+2, clkY, ctz, ctx+4, clkY+2, ctz, 'glowstone');
    await fill(ctx+3, clkY-1, ctz, ctx+3, clkY+3, ctz, 'glowstone');
    await fill(ctx+3, clkY+1, ctz, ctx+3, clkY+1, ctz, 'black_concrete'); // center
    // North clock
    await fill(ctx+2, clkY, ctz+ctd, ctx+4, clkY+2, ctz+ctd, 'glowstone');
    await fill(ctx+3, clkY-1, ctz+ctd, ctx+3, clkY+3, ctz+ctd, 'glowstone');
    await fill(ctx+3, clkY+1, ctz+ctd, ctx+3, clkY+1, ctz+ctd, 'black_concrete');

    // === GOLD DOME on top of clock tower ===
    const dcx = ctx + 3, dcz = ctz + 3; // dome center
    // Dome layers (hemisphere)
    await fill(dcx-3, Y+29, dcz-3, dcx+3, Y+29, dcz+3, 'gold_block');
    await fill(dcx-2, Y+30, dcz-2, dcx+2, Y+30, dcz+2, 'gold_block');
    await fill(dcx-2, Y+31, dcz-2, dcx+2, Y+31, dcz+2, 'gold_block');
    await fill(dcx-1, Y+32, dcz-1, dcx+1, Y+32, dcz+1, 'gold_block');
    await fill(dcx-1, Y+33, dcz-1, dcx+1, Y+33, dcz+1, 'gold_block');
    await fill(dcx, Y+34, dcz, dcx, Y+34, dcz, 'gold_block');
    // Spire
    await fill(dcx, Y+35, dcz, dcx, Y+38, dcz, 'gold_block');
    // Lightning rod / finial
    await fill(dcx, Y+39, dcz, dcx, Y+39, dcz, 'lightning_rod');

    // === LANDSCAPING around Tech Tower ===
    // Front lawn
    await fill(ttx-3, oy, ttz-8, ttx+ttw+3, oy, ttz-4, 'grass_block');
    // Walkway to entrance
    await fill(ecx-1, oy, ttz-8, ecx+1, oy, ttz-3, 'smooth_stone');
    // Bushes (leaf blocks at ground level)
    await fill(ttx-1, Y, ttz-1, ttx+2, Y, ttz-1, 'azalea_leaves');
    await fill(ttx+ttw-2, Y, ttz-1, ttx+ttw+1, Y, ttz-1, 'azalea_leaves');
    // GT sign in front
    await fill(ecx-4, Y, ttz-6, ecx+4, Y, ttz-6, 'stone_bricks');
    await fill(ecx-4, Y+1, ttz-6, ecx+4, Y+2, ttz-6, 'stone_bricks');
    await fill(ecx-3, Y+1, ttz-6, ecx+3, Y+1, ttz-6, 'gold_block');

    log('Tech Tower DONE');

    // ═══════════════════════════════════════════════════
    // CROSLAND TOWER (Library) — Brutalist concrete tower
    // Real: Tall, narrow, concrete brutalist, distinctive rectangular shape
    // ═══════════════════════════════════════════════════
    log('Rebuilding Crosland Tower...');
    bot.chat('Rebuilding Crosland Tower (Library)...');
    const clx = campusX + 220, clz = campusZ + 200;

    // Clear old
    await fill(clx-5, oy, clz-5, clx+20, oy+55, clz+15, 'air');
    await fill(clx-5, oy, clz-5, clx+20, oy, clz+15, 'grass_block');

    // Main tower — brutalist concrete, 50 blocks tall, narrow
    const clW = 12, clD = 10, clH = 50;
    // Concrete body
    await fill(clx, Y, clz, clx+clW, Y+clH, clz+clD, 'gray_concrete');
    // Hollow
    await fill(clx+1, Y+1, clz+1, clx+clW-1, Y+clH-1, clz+clD-1, 'air');
    // Narrow vertical window slits (brutalist style)
    for (let z = clz+1; z < clz+clD; z += 3) {
      await fill(clx, Y+3, z, clx, Y+clH-2, z, 'gray_stained_glass');
      await fill(clx+clW, Y+3, z, clx+clW, Y+clH-2, z, 'gray_stained_glass');
    }
    for (let x = clx+2; x < clx+clW; x += 3) {
      await fill(x, Y+3, clz, x, Y+clH-2, clz, 'gray_stained_glass');
      await fill(x, Y+3, clz+clD, x, Y+clH-2, clz+clD, 'gray_stained_glass');
    }
    // Horizontal concrete bands every 5 floors
    for (let y = Y+6; y < Y+clH; y += 5) {
      await fill(clx, y, clz, clx+clW, y, clz, 'light_gray_concrete');
      await fill(clx, y, clz+clD, clx+clW, y, clz+clD, 'light_gray_concrete');
      await fill(clx, y, clz, clx, y, clz+clD, 'light_gray_concrete');
      await fill(clx+clW, y, clz, clx+clW, y, clz+clD, 'light_gray_concrete');
    }
    // Roof mechanical penthouse
    await fill(clx+2, Y+clH+1, clz+2, clx+clW-2, Y+clH+4, clz+clD-2, 'gray_concrete');
    // Entrance
    await fill(clx+4, Y+1, clz, clx+8, Y+3, clz, 'air');
    await fill(clx+4, Y+4, clz, clx+8, Y+4, clz, 'light_gray_concrete'); // lintel

    // Library base building (wider low structure attached)
    await fill(clx-5, Y, clz+clD+1, clx+clW+5, Y+8, clz+clD+12, 'gray_concrete');
    await fill(clx-4, Y+1, clz+clD+2, clx+clW+4, Y+7, clz+clD+11, 'air');
    // Library windows
    for (let x = clx-3; x < clx+clW+4; x += 3) {
      await fill(x, Y+2, clz+clD+12, x+1, Y+6, clz+clD+12, 'light_blue_stained_glass');
    }

    log('Crosland Tower DONE');

    // ═══════════════════════════════════════════════════
    // CULC — Modern glass and steel, cantilever design
    // Real: Glass curtain wall, angular modern architecture
    // ═══════════════════════════════════════════════════
    log('Rebuilding CULC...');
    bot.chat('Rebuilding CULC (modern glass)...');
    const ulx = campusX + 195, ulz = campusZ + 170;

    await fill(ulx-3, oy, ulz-3, ulx+35, oy+25, ulz+22, 'air');
    await fill(ulx-3, oy, ulz-3, ulx+35, oy, ulz+22, 'grass_block');

    // Main body — white concrete + glass curtain wall
    await fill(ulx, Y, ulz, ulx+32, Y+18, ulz+20, 'white_concrete');
    await fill(ulx+1, Y+1, ulz+1, ulx+31, Y+17, ulz+19, 'air');
    // Full glass south facade
    await fill(ulx, Y+1, ulz, ulx+32, Y+17, ulz, 'light_blue_stained_glass');
    // Glass mullion grid (white lines)
    for (let x = ulx; x <= ulx+32; x += 4) {
      await fill(x, Y+1, ulz, x, Y+17, ulz, 'white_concrete');
    }
    for (let y = Y+4; y <= Y+16; y += 4) {
      await fill(ulx, y, ulz, ulx+32, y, ulz, 'white_concrete');
    }
    // Cantilever overhang (extends past ground floor)
    await fill(ulx-3, Y+5, ulz-3, ulx+35, Y+5, ulz, 'white_concrete');
    // Ground floor recessed (pilotis)
    await fill(ulx+2, Y+1, ulz, ulx+30, Y+4, ulz, 'air');
    // Support columns
    for (let x = ulx+4; x <= ulx+28; x += 8) {
      await fill(x, Y+1, ulz+1, x+1, Y+5, ulz+1, 'white_concrete');
    }
    // Roof
    await fill(ulx, Y+18, ulz, ulx+32, Y+18, ulz+20, 'white_concrete');
    // Interior floors
    for (let y = Y+5; y < Y+18; y += 4) {
      await fill(ulx+1, y, ulz+1, ulx+31, y, ulz+19, 'smooth_stone');
    }
    // Staircase atrium (glass box on top)
    await fill(ulx+13, Y+19, ulz+7, ulx+19, Y+22, ulz+13, 'glass');
    await fill(ulx+14, Y+19, ulz+8, ulx+18, Y+21, ulz+12, 'air');

    log('CULC DONE');

    // ═══════════════════════════════════════════════════
    // BOBBY DODD STADIUM — proper horseshoe shape
    // ═══════════════════════════════════════════════════
    log('Rebuilding Bobby Dodd Stadium...');
    bot.chat('Rebuilding Bobby Dodd Stadium...');
    const sdx = campusX + 260, sdz = campusZ + 155;

    await fill(sdx-15, oy, sdz-15, sdx+65, oy+20, sdz+50, 'air');
    await fill(sdx-15, oy, sdz-15, sdx+65, oy, sdz+50, 'grass_block');

    // Football field (green with lines)
    await fill(sdx, oy, sdz, sdx+55, oy, sdz+30, 'lime_concrete');
    // Yard lines every 5 yards (every ~5 blocks at this scale)
    for (let x = sdx+5; x <= sdx+50; x += 5) {
      await fill(x, oy, sdz+1, x, oy, sdz+29, 'white_concrete');
    }
    // End zones
    await fill(sdx, oy, sdz+1, sdx+4, oy, sdz+29, 'gold_block'); // GT gold
    await fill(sdx+51, oy, sdz+1, sdx+55, oy, sdz+29, 'gold_block');

    // West stands (tiered, main grandstand)
    for (let tier = 0; tier < 12; tier++) {
      await fill(sdx-1-tier, oy+tier+1, sdz-2, sdx-1-tier, oy+tier+1, sdz+32, 'stone');
      // Every other row: seats (stairs)
      if (tier % 2 === 0) {
        await fill(sdx-1-tier, oy+tier+1, sdz-2, sdx-1-tier, oy+tier+1, sdz+32, 'stone_brick_stairs');
      }
    }
    // East stands
    for (let tier = 0; tier < 12; tier++) {
      await fill(sdx+56+tier, oy+tier+1, sdz-2, sdx+56+tier, oy+tier+1, sdz+32, 'stone');
      if (tier % 2 === 0) {
        await fill(sdx+56+tier, oy+tier+1, sdz-2, sdx+56+tier, oy+tier+1, sdz+32, 'stone_brick_stairs');
      }
    }
    // South end stands (horseshoe shape)
    for (let tier = 0; tier < 8; tier++) {
      await fill(sdx-1, oy+tier+1, sdz-3-tier, sdx+56, oy+tier+1, sdz-3-tier, 'stone');
    }
    // North open end (horseshoe opening) — press box
    await fill(sdx+10, oy+1, sdz+33, sdx+45, oy+15, sdz+35, 'gray_concrete');
    // Press box windows
    await fill(sdx+12, oy+10, sdz+33, sdx+43, oy+14, sdz+33, 'light_blue_stained_glass');
    // Scoreboard
    await fill(sdx+18, oy+1, sdz+37, sdx+37, oy+16, sdz+37, 'black_concrete');
    await fill(sdx+20, oy+3, sdz+37, sdx+35, oy+14, sdz+37, 'glowstone');
    // "GT" on scoreboard
    await fill(sdx+22, oy+6, sdz+37, sdx+26, oy+6, sdz+37, 'gold_block');
    await fill(sdx+22, oy+6, sdz+37, sdx+22, oy+10, sdz+37, 'gold_block');
    await fill(sdx+22, oy+10, sdz+37, sdx+26, oy+10, sdz+37, 'gold_block');
    await fill(sdx+26, oy+8, sdz+37, sdx+26, oy+10, sdz+37, 'gold_block');
    await fill(sdx+24, oy+8, sdz+37, sdx+26, oy+8, sdz+37, 'gold_block');
    // T
    await fill(sdx+28, oy+10, sdz+37, sdx+33, oy+10, sdz+37, 'gold_block');
    await fill(sdx+30, oy+6, sdz+37, sdx+31, oy+10, sdz+37, 'gold_block');

    // Field goals
    await fill(sdx+2, oy+1, sdz+15, sdx+2, oy+8, sdz+15, 'yellow_concrete');
    await fill(sdx+1, oy+6, sdz+15, sdx+3, oy+8, sdz+15, 'yellow_concrete');
    await fill(sdx+53, oy+1, sdz+15, sdx+53, oy+8, sdz+15, 'yellow_concrete');
    await fill(sdx+52, oy+6, sdz+15, sdx+54, oy+8, sdz+15, 'yellow_concrete');

    // Stadium lights (4 tall poles)
    const lightSpots = [[sdx-13, sdz-5], [sdx-13, sdz+35], [sdx+68, sdz-5], [sdx+68, sdz+35]];
    for (const [lx, lz] of lightSpots) {
      await fill(lx, oy+1, lz, lx, oy+18, lz, 'iron_bars');
      await fill(lx-1, oy+18, lz, lx+1, oy+18, lz, 'glowstone');
      await fill(lx, oy+18, lz-1, lx, oy+18, lz+1, 'glowstone');
    }

    log('Bobby Dodd DONE');

    // ═══════════════════════════════════════════════════
    // COLLEGE OF COMPUTING — Modern building
    // ═══════════════════════════════════════════════════
    log('Rebuilding CoC...');
    bot.chat('Rebuilding College of Computing...');
    const ccx = campusX + 80, ccz = campusZ + 105;

    await fill(ccx-3, oy, ccz-3, ccx+25, oy+22, ccz+18, 'air');
    await fill(ccx-3, oy, ccz-3, ccx+25, oy, ccz+18, 'grass_block');

    // Modern asymmetric design
    // Main wing (taller, glass)
    await fill(ccx, Y, ccz, ccx+14, Y+18, ccz+14, 'white_concrete');
    await fill(ccx+1, Y+1, ccz+1, ccx+13, Y+17, ccz+13, 'air');
    // Full glass front
    await fill(ccx, Y+1, ccz, ccx+14, Y+17, ccz, 'cyan_stained_glass');
    for (let x = ccx; x <= ccx+14; x += 3) {
      await fill(x, Y+1, ccz, x, Y+17, ccz, 'white_concrete'); // mullions
    }
    for (let y = Y+4; y < Y+17; y += 4) {
      await fill(ccx, y, ccz, ccx+14, y, ccz, 'white_concrete'); // spandrels
    }
    // Lower wing (shorter, extending east)  
    await fill(ccx+15, Y, ccz+2, ccx+22, Y+10, ccz+12, 'light_gray_concrete');
    await fill(ccx+16, Y+1, ccz+3, ccx+21, Y+9, ccz+11, 'air');
    for (let z = ccz+3; z < ccz+12; z += 3) {
      await fill(ccx+22, Y+2, z, ccx+22, Y+8, z+1, 'cyan_stained_glass');
    }
    // Entrance — recessed glass
    await fill(ccx+5, Y+1, ccz, ccx+9, Y+3, ccz, 'air');
    // "CoC" sign
    await fill(ccx+3, Y+15, ccz-1, ccx+11, Y+17, ccz-1, 'iron_block');
    await fill(ccx+4, Y+16, ccz-1, ccx+10, Y+16, ccz-1, 'white_concrete');

    log('CoC DONE');

    // ═══════════════════════════════════════════════════
    // ENHANCED DORMS — Not just boxes, add bay windows, entries
    // ═══════════════════════════════════════════════════
    log('Enhancing dorms...');
    bot.chat('Adding details to dorm buildings...');

    const dorms = [
      { name:'Freeman', x:campusX+20, z:campusZ+100, w:14, d:10, h:15 },
      { name:'Montag', x:campusX+20, z:campusZ+120, w:14, d:10, h:15 },
      { name:'Fitten', x:campusX+38, z:campusZ+100, w:14, d:10, h:15 },
      { name:'Fulmer', x:campusX+38, z:campusZ+120, w:14, d:10, h:15 },
    ];
    for (const d of dorms) {
      // Add entrance canopy
      const ex = d.x + Math.floor(d.w/2);
      await fill(ex-2, Y+4, d.z-2, ex+2, Y+4, d.z-1, 'stone_brick_slab');
      await fill(ex-2, Y+1, d.z-2, ex-2, Y+3, d.z-2, 'stone_bricks');
      await fill(ex+2, Y+1, d.z-2, ex+2, Y+3, d.z-2, 'stone_bricks');
      // Lamp by door
      await fill(ex-3, Y+1, d.z-1, ex-3, Y+2, d.z-1, 'iron_bars');
      await fill(ex-3, Y+3, d.z-1, ex-3, Y+3, d.z-1, 'lantern');
    }

    log('=== GT LANDMARK REBUILD COMPLETE ===');
    bot.chat('=== GT landmarks rebuilt! Tech Tower has gold dome, columns, clock faces ===');
    bot.chat('/tp alphasuperduper ' + (ttx+15) + ' ' + (oy+5) + ' ' + (ttz-15) + ' 0 10');
    await sleep(3000);

    log('Builder staying connected.');
  } catch(e) { log('FATAL: '+e.message+'\n'+e.stack); }
});
bot.on('error', e => log('Err: '+e.message));
bot.on('kicked', r => { log('Kicked: '+JSON.stringify(r)); process.exit(1); });
bot.on('end', () => { log('Disconnected'); process.exit(0); });
