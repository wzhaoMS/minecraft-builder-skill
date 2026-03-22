// City Builder — grid streets, buildings of various heights, elevated highway ring
// Uses /fill commands via FAWE bot for speed
const mineflayer = require('mineflayer');
const fs = require('fs');

const bot = mineflayer.createBot({ host:'localhost', port:25566, username:'BuilderBot', auth:'offline', version:'1.21.11' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => { console.log(msg); fs.appendFileSync('/tmp/city_log.txt', msg+'\n'); };

async function fill(x1,y1,z1,x2,y2,z2,block) {
  // Split into chunks if too large (max 32768 blocks per fill)
  const dx = Math.abs(x2-x1)+1, dy = Math.abs(y2-y1)+1, dz = Math.abs(z2-z1)+1;
  if (dx*dy*dz > 32000) {
    // Split along longest axis
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
  await sleep(60);
}

// Seeded random for reproducibility
let seed = 42;
function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function randInt(min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

let started = false;
bot.on('spawn', async () => {
  if (started) return; started = true;
  try {
    fs.writeFileSync('/tmp/city_log.txt','');
    await sleep(3000);
    bot.chat('/gamemode creative'); await sleep(1000);
    bot.chat('/tp BuilderBot alphasuperduper'); await sleep(3000);

    const p = bot.entity.position.floored();
    log('Player at: ' + p);

    // City origin — 40 blocks ahead of player
    const ox = p.x + 40, oy = p.y, oz = p.z - 60;

    // City dimensions
    const CITY_W = 200;  // x-extent
    const CITY_D = 200;  // z-extent
    const BLOCK_SIZE = 22; // building block size (between streets)
    const STREET_W = 5;   // street width
    const CELL = BLOCK_SIZE + STREET_W; // total cell size
    const HWY_H = 12;    // highway elevation above ground
    const HWY_W = 6;     // highway width
    const HWY_MARGIN = 10; // highway distance from city edge

    bot.chat('/time set noon');
    bot.chat('/gamerule doDaylightCycle false');
    await sleep(300);

    // ═══════════════════════════════════════
    // PHASE 1: Clear area & foundation
    // ═══════════════════════════════════════
    log('[CITY] Phase 1: Clearing area...');
    bot.chat('Building city — Phase 1: Clearing...');
    for (let yy = oy; yy < oy + 150; yy += 25) {
      await fill(ox-20, yy, oz-20, ox+CITY_W+20, Math.min(yy+24, oy+150), oz+CITY_D+20, 'air');
    }
    // Ground plane
    await fill(ox-20, oy-1, oz-20, ox+CITY_W+20, oy-1, oz+CITY_D+20, 'gray_concrete');
    await sleep(500);
    log('[CITY] Area cleared');

    // ═══════════════════════════════════════
    // PHASE 2: Street grid
    // ═══════════════════════════════════════
    log('[CITY] Phase 2: Streets...');
    bot.chat('Phase 2: Street grid...');

    // East-West streets
    for (let gz = 0; gz * CELL < CITY_D; gz++) {
      const sz = oz + gz * CELL;
      // Road surface
      await fill(ox, oy-1, sz, ox+CITY_W, oy-1, sz+STREET_W-1, 'black_concrete');
      // Center line (yellow)
      await fill(ox, oy-1, sz+Math.floor(STREET_W/2), ox+CITY_W, oy-1, sz+Math.floor(STREET_W/2), 'yellow_concrete');
      // Sidewalks
      await fill(ox, oy, sz-1, ox+CITY_W, oy, sz-1, 'smooth_stone_slab');
      await fill(ox, oy, sz+STREET_W, ox+CITY_W, oy, sz+STREET_W, 'smooth_stone_slab');
    }
    // North-South streets
    for (let gx = 0; gx * CELL < CITY_W; gx++) {
      const sx = ox + gx * CELL;
      await fill(sx, oy-1, oz, sx+STREET_W-1, oy-1, oz+CITY_D, 'black_concrete');
      await fill(sx+Math.floor(STREET_W/2), oy-1, oz, sx+Math.floor(STREET_W/2), oy-1, oz+CITY_D, 'yellow_concrete');
      await fill(sx-1, oy, oz, sx-1, oy, oz+CITY_D, 'smooth_stone_slab');
      await fill(sx+STREET_W, oy, oz, sx+STREET_W, oy, oz+CITY_D, 'smooth_stone_slab');
    }
    log('[CITY] Streets done');

    // ═══════════════════════════════════════
    // PHASE 3: Buildings
    // ═══════════════════════════════════════
    log('[CITY] Phase 3: Buildings...');
    bot.chat('Phase 3: Buildings...');

    const BODY_MATS = ['white_concrete','light_gray_concrete','cyan_terracotta','gray_concrete','blue_concrete','light_blue_concrete','black_concrete','brown_concrete'];
    const GLASS_MATS = ['light_blue_stained_glass','white_stained_glass','gray_stained_glass','cyan_stained_glass'];
    const ACCENT_MATS = ['white_concrete','gold_block','iron_block','quartz_block','light_gray_concrete'];

    let buildingCount = 0;
    for (let gx = 0; gx * CELL + STREET_W < CITY_W; gx++) {
      for (let gz = 0; gz * CELL + STREET_W < CITY_D; gz++) {
        const bx = ox + gx * CELL + STREET_W + 1;
        const bz = oz + gz * CELL + STREET_W + 1;
        const maxW = BLOCK_SIZE - 2;
        const maxD = BLOCK_SIZE - 2;

        // Skip some lots (parks/parking)
        if (rng() < 0.15) {
          // Park
          await fill(bx, oy-1, bz, bx+maxW, oy-1, bz+maxD, 'grass_block');
          // A few trees
          for (let t = 0; t < 3; t++) {
            const tx = bx + randInt(2, maxW-2), tz = bz + randInt(2, maxD-2);
            for (let dy = 0; dy < 5; dy++) await fill(tx, oy+dy, tz, tx, oy+dy, tz, 'oak_log');
            await fill(tx-2, oy+4, tz-2, tx+2, oy+6, tz+2, 'oak_leaves');
            await fill(tx-1, oy+7, tz-1, tx+1, oy+7, tz+1, 'oak_leaves');
          }
          continue;
        }

        // Determine building height — taller near center
        const cx = (gx * CELL + CELL/2) / CITY_W;
        const cz = (gz * CELL + CELL/2) / CITY_D;
        const distFromCenter = Math.sqrt((cx-0.5)**2 + (cz-0.5)**2);
        const baseHeight = Math.max(8, Math.floor(80 * (1 - distFromCenter * 1.8)));
        const height = baseHeight + randInt(-10, 15);
        const h = Math.max(6, Math.min(120, height));

        // Building footprint (slightly smaller than lot)
        const bw = randInt(Math.floor(maxW*0.6), maxW);
        const bd = randInt(Math.floor(maxD*0.6), maxD);
        const box = bx + Math.floor((maxW - bw)/2);
        const boz = bz + Math.floor((maxD - bd)/2);

        const bodyMat = pick(BODY_MATS);
        const glassMat = pick(GLASS_MATS);
        const accentMat = pick(ACCENT_MATS);

        // Main structure — walls with window grid
        // Build in vertical chunks
        for (let yChunk = 0; yChunk < h; yChunk += 20) {
          const yEnd = Math.min(yChunk + 19, h - 1);
          // Four walls
          await fill(box, oy+yChunk, boz, box+bw-1, oy+yEnd, boz, bodyMat);       // south
          await fill(box, oy+yChunk, boz+bd-1, box+bw-1, oy+yEnd, boz+bd-1, bodyMat); // north
          await fill(box, oy+yChunk, boz, box, oy+yEnd, boz+bd-1, bodyMat);       // west
          await fill(box+bw-1, oy+yChunk, boz, box+bw-1, oy+yEnd, boz+bd-1, bodyMat); // east
        }

        // Windows — use /fill for vertical glass strips (much fewer commands)
        for (let x = box+1; x < box+bw-1; x += 2) {
          // South wall glass column
          await fill(x, oy+2, boz, x, oy+h-1, boz, glassMat);
          // North wall glass column
          await fill(x, oy+2, boz+bd-1, x, oy+h-1, boz+bd-1, glassMat);
        }
        for (let z = boz+1; z < boz+bd-1; z += 2) {
          // West wall glass column
          await fill(box, oy+2, z, box, oy+h-1, z, glassMat);
          // East wall glass column
          await fill(box+bw-1, oy+2, z, box+bw-1, oy+h-1, z, glassMat);
        }
        // Horizontal floor lines (restore body material every 4th floor)
        for (let y = oy+4; y < oy+h; y += 4) {
          await fill(box, y, boz, box+bw-1, y, boz, bodyMat);
          await fill(box, y, boz+bd-1, box+bw-1, y, boz+bd-1, bodyMat);
          await fill(box, y, boz, box, y, boz+bd-1, bodyMat);
          await fill(box+bw-1, y, boz, box+bw-1, y, boz+bd-1, bodyMat);
        }

        // Roof
        await fill(box, oy+h, boz, box+bw-1, oy+h, boz+bd-1, accentMat);

        // Rooftop detail (antenna or helipad)
        if (h > 40 && rng() < 0.5) {
          // Antenna
          const ax = box + Math.floor(bw/2), az = boz + Math.floor(bd/2);
          await fill(ax, oy+h+1, az, ax, oy+h+8, az, accentMat);
          await fill(ax, oy+h+9, az, ax, oy+h+9, az, 'sea_lantern');
        } else if (h > 30) {
          // Helipad
          const hx = box + Math.floor(bw/2), hz = boz + Math.floor(bd/2);
          await fill(hx-2, oy+h+1, hz-2, hx+2, oy+h+1, hz+2, 'white_concrete');
          await fill(hx-1, oy+h+1, hz-1, hx+1, oy+h+1, hz+1, 'yellow_concrete');
        }

        buildingCount++;
        if (buildingCount % 5 === 0) {
          log('  Buildings: ' + buildingCount);
          bot.chat('Buildings: ' + buildingCount);
          await sleep(100);
        }
      }
    }
    log('[CITY] ' + buildingCount + ' buildings done');

    // ═══════════════════════════════════════
    // PHASE 4: Streetlights
    // ═══════════════════════════════════════
    log('[CITY] Phase 4: Streetlights...');
    bot.chat('Phase 4: Streetlights...');
    for (let gx = 0; gx * CELL < CITY_W; gx++) {
      for (let gz = 0; gz * CELL < CITY_D; gz++) {
        const lx = ox + gx * CELL + STREET_W + 1;
        const lz = oz + gz * CELL - 1;
        // Pole + light
        await fill(lx, oy+1, lz, lx, oy+4, lz, 'iron_bars');
        await fill(lx, oy+5, lz, lx, oy+5, lz, 'sea_lantern');
      }
    }

    // ═══════════════════════════════════════
    // PHASE 5: Elevated Highway Ring
    // ═══════════════════════════════════════
    log('[CITY] Phase 5: Highway...');
    bot.chat('Phase 5: Elevated highway ring...');

    const hwy_y = oy + HWY_H;
    const inner = HWY_MARGIN;
    const outer = HWY_MARGIN + HWY_W;

    // South highway (runs E-W along south edge)
    // Supports (pillars)
    for (let x = ox - inner; x <= ox + CITY_W + inner; x += 12) {
      await fill(x, oy, oz - outer, x+1, hwy_y-1, oz - outer+1, 'gray_concrete');
    }
    // Road deck
    await fill(ox - inner, hwy_y, oz - outer, ox + CITY_W + inner, hwy_y, oz - outer + HWY_W, 'gray_concrete');
    // Lanes
    await fill(ox - inner, hwy_y, oz - outer + Math.floor(HWY_W/2), ox + CITY_W + inner, hwy_y, oz - outer + Math.floor(HWY_W/2), 'white_concrete');
    // Barriers
    await fill(ox - inner, hwy_y+1, oz - outer, ox + CITY_W + inner, hwy_y+1, oz - outer, 'stone_brick_wall');
    await fill(ox - inner, hwy_y+1, oz - outer + HWY_W, ox + CITY_W + inner, hwy_y+1, oz - outer + HWY_W, 'stone_brick_wall');

    // North highway
    for (let x = ox - inner; x <= ox + CITY_W + inner; x += 12) {
      await fill(x, oy, oz + CITY_D + inner, x+1, hwy_y-1, oz + CITY_D + inner+1, 'gray_concrete');
    }
    await fill(ox - inner, hwy_y, oz + CITY_D + inner, ox + CITY_W + inner, hwy_y, oz + CITY_D + inner + HWY_W, 'gray_concrete');
    await fill(ox - inner, hwy_y, oz + CITY_D + inner + Math.floor(HWY_W/2), ox + CITY_W + inner, hwy_y, oz + CITY_D + inner + Math.floor(HWY_W/2), 'white_concrete');
    await fill(ox - inner, hwy_y+1, oz + CITY_D + inner, ox + CITY_W + inner, hwy_y+1, oz + CITY_D + inner, 'stone_brick_wall');
    await fill(ox - inner, hwy_y+1, oz + CITY_D + inner + HWY_W, ox + CITY_W + inner, hwy_y+1, oz + CITY_D + inner + HWY_W, 'stone_brick_wall');

    // West highway (runs N-S along west edge)
    for (let z = oz - outer; z <= oz + CITY_D + outer; z += 12) {
      await fill(ox - outer, oy, z, ox - outer+1, hwy_y-1, z+1, 'gray_concrete');
    }
    await fill(ox - outer, hwy_y, oz - outer, ox - outer + HWY_W, hwy_y, oz + CITY_D + outer, 'gray_concrete');
    await fill(ox - outer + Math.floor(HWY_W/2), hwy_y, oz - outer, ox - outer + Math.floor(HWY_W/2), hwy_y, oz + CITY_D + outer, 'white_concrete');
    await fill(ox - outer, hwy_y+1, oz - outer, ox - outer, hwy_y+1, oz + CITY_D + outer, 'stone_brick_wall');
    await fill(ox - outer + HWY_W, hwy_y+1, oz - outer, ox - outer + HWY_W, hwy_y+1, oz + CITY_D + outer, 'stone_brick_wall');

    // East highway
    for (let z = oz - outer; z <= oz + CITY_D + outer; z += 12) {
      await fill(ox + CITY_W + inner, oy, z, ox + CITY_W + inner+1, hwy_y-1, z+1, 'gray_concrete');
    }
    await fill(ox + CITY_W + inner, hwy_y, oz - outer, ox + CITY_W + inner + HWY_W, hwy_y, oz + CITY_D + outer, 'gray_concrete');
    await fill(ox + CITY_W + inner + Math.floor(HWY_W/2), hwy_y, oz - outer, ox + CITY_W + inner + Math.floor(HWY_W/2), hwy_y, oz + CITY_D + outer, 'white_concrete');
    await fill(ox + CITY_W + inner, hwy_y+1, oz - outer, ox + CITY_W + inner, hwy_y+1, oz + CITY_D + outer, 'stone_brick_wall');
    await fill(ox + CITY_W + inner + HWY_W, hwy_y+1, oz - outer, ox + CITY_W + inner + HWY_W, hwy_y+1, oz + CITY_D + outer, 'stone_brick_wall');

    // Highway on-ramps (diagonal ramps from ground to highway at 4 corners)
    // SW corner ramp
    for (let i = 0; i < HWY_H; i++) {
      const ry = oy + i;
      const rz = oz - outer - 1 - (HWY_H - i);
      await fill(ox - inner, ry, rz, ox - inner + HWY_W, ry, rz+1, 'gray_concrete');
    }
    // NE corner ramp
    for (let i = 0; i < HWY_H; i++) {
      const ry = oy + i;
      const rz = oz + CITY_D + outer + 1 + (HWY_H - i);
      await fill(ox + CITY_W + inner, ry, rz, ox + CITY_W + inner + HWY_W, ry, rz+1, 'gray_concrete');
    }

    // Highway lights
    for (let x = ox - inner; x <= ox + CITY_W + inner; x += 15) {
      await fill(x, hwy_y+2, oz - outer + Math.floor(HWY_W/2), x, hwy_y+2, oz - outer + Math.floor(HWY_W/2), 'sea_lantern');
      await fill(x, hwy_y+2, oz + CITY_D + inner + Math.floor(HWY_W/2), x, hwy_y+2, oz + CITY_D + inner + Math.floor(HWY_W/2), 'sea_lantern');
    }
    for (let z = oz - outer; z <= oz + CITY_D + outer; z += 15) {
      await fill(ox - outer + Math.floor(HWY_W/2), hwy_y+2, z, ox - outer + Math.floor(HWY_W/2), hwy_y+2, z, 'sea_lantern');
      await fill(ox + CITY_W + inner + Math.floor(HWY_W/2), hwy_y+2, z, ox + CITY_W + inner + Math.floor(HWY_W/2), hwy_y+2, z, 'sea_lantern');
    }
    await sleep(200);

    log('[CITY] Highway done');

    // ═══════════════════════════════════════
    // PHASE 6: Paste existing skyscrapers in center
    // ═══════════════════════════════════════
    log('[CITY] Phase 6: Pasting landmark towers...');
    bot.chat('Phase 6: Downtown skyscrapers...');

    const centerX = ox + Math.floor(CITY_W/2);
    const centerZ = oz + Math.floor(CITY_D/2);
    const towers = [
      { name: "ModernGlassTower", dx: -20, dz: 0 },
      { name: "ArtDecoTower", dx: 10, dz: 0 },
      { name: "CylinderTower", dx: -5, dz: 25 },
      { name: "DarkTower", dx: 20, dz: -20 },
      { name: "SilverTower", dx: -25, dz: -15 }
    ];

    for (const t of towers) {
      const tx = centerX + t.dx, tz = centerZ + t.dz;
      bot.chat(`/tp BuilderBot ${tx} ${oy} ${tz}`);
      await sleep(500);
      bot.chat(`//schem load ${t.name}`);
      await sleep(2000);
      bot.chat('//paste -a');
      await sleep(3000);
      log('  Pasted ' + t.name);
    }

    // ═══════════════════════════════════════
    // DONE — TP player to aerial view
    // ═══════════════════════════════════════
    log('[CITY] COMPLETE!');
    bot.chat('City complete! ' + buildingCount + ' buildings + highway ring');
    bot.chat(`/tp alphasuperduper ${centerX} ${oy+100} ${oz-40} 0 30`);
    await sleep(3000);
    bot.quit();
  } catch(e) { log('FATAL: ' + e.message + '\n' + e.stack); bot.quit(); }
});
bot.on('message', msg => {
  const s = msg.toString();
  if (s.includes('error') || s.includes('Error') || s.includes('Kicked'))
    log('MSG: ' + s);
});
bot.on('error', e => log('Err: ' + e.message));
bot.on('kicked', r => { log('Kicked: ' + JSON.stringify(r)); process.exit(1); });
bot.on('end', () => { log('Done'); process.exit(0); });
