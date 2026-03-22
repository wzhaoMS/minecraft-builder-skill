// City Detail Enhancer — adds realistic details to existing city
// Runs continuously, adding layer after layer of realism
// Phase A: Crosswalks, traffic lights, fire hydrants
// Phase B: Sidewalk trees, benches, trash cans
// Phase C: Parking lots with cars
// Phase D: Parks with fountains, paths, flower beds
// Phase E: Bus stops, billboards, awnings
// Phase F: Building interiors (lobbies, lit windows at night)
// Phase G: Highway details (signs, barriers, on-ramps)
// Phase H: GT campus details (buzz statue, fountains, signs)
// Repeats with more detail each pass

const mineflayer = require('mineflayer');
const vec3 = require('vec3');
const fs = require('fs');

const bot = mineflayer.createBot({ host:'localhost', port:25566, username:'DetailBot', auth:'offline', version:'1.21.11' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => { console.log(msg); fs.appendFileSync('/tmp/detail_log.txt', msg+'\n'); };

async function fill(x1,y1,z1,x2,y2,z2,block) {
  const dx=Math.abs(x2-x1)+1, dy=Math.abs(y2-y1)+1, dz=Math.abs(z2-z1)+1;
  if (dx*dy*dz > 32000) {
    if (dx >= dy && dx >= dz) {
      const mid=Math.floor((Math.min(x1,x2)+Math.max(x1,x2))/2);
      await fill(Math.min(x1,x2),y1,z1,mid,y2,z2,block);
      await fill(mid+1,y1,z1,Math.max(x1,x2),y2,z2,block);
    } else if (dz >= dy) {
      const mid=Math.floor((Math.min(z1,z2)+Math.max(z1,z2))/2);
      await fill(x1,y1,Math.min(z1,z2),x2,y2,mid,block);
      await fill(x1,y1,mid+1,x2,y2,Math.max(z1,z2),block);
    } else {
      const mid=Math.floor((Math.min(y1,y2)+Math.max(y1,y2))/2);
      await fill(x1,Math.min(y1,y2),z1,x2,mid,z2,block);
      await fill(x1,mid+1,z1,x2,Math.max(y1,y2),z2,block);
    }
    return;
  }
  bot.chat(`/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}`);
  await sleep(80);
}

async function sb(x,y,z,block) {
  bot.chat(`/setblock ${x} ${y} ${z} ${block}`);
  await sleep(30);
}

let seed = 777;
function rng() { seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }
function randInt(a,b) { return Math.floor(rng()*(b-a+1))+a; }
function pick(a) { return a[Math.floor(rng()*a.length)]; }

let started = false;
bot.on('spawn', async () => {
  if (started) return; started = true;
  try {
    fs.writeFileSync('/tmp/detail_log.txt','');
    await sleep(5000);
    bot.chat('/gamemode creative'); await sleep(1000);
    bot.chat('/op DetailBot'); await sleep(500);

    // Get reference from existing build
    // Campus origin from main builder: campusX = playerX - 50, campusZ = playerZ - 50
    // Player was at (409, -61, -486), so campusX=359, campusZ=-536
    const oy = -62; // ground level
    const campusX = 359, campusZ = -536;
    const CW = 400, CD = 400;
    const CITY_MARGIN = 150;
    const cityX1 = campusX - CITY_MARGIN, cityZ1 = campusZ - CITY_MARGIN;
    const cityX2 = campusX + CW + CITY_MARGIN, cityZ2 = campusZ + CD + CITY_MARGIN;

    log('=== DETAIL ENHANCER STARTED ===');
    log(`Campus: ${campusX},${campusZ} to ${campusX+CW},${campusZ+CD}`);
    log(`City: ${cityX1},${cityZ1} to ${cityX2},${cityZ2}`);
    bot.chat('=== Detail Enhancer starting — making the city realistic ===');

    let detailCount = 0;

    // ═══════════════════════════════════════
    // PHASE A: Crosswalks & Traffic Lights
    // ═══════════════════════════════════════
    log('[A] Crosswalks & Traffic Lights...');
    bot.chat('Phase A: Crosswalks & traffic lights...');

    // E-W road crosswalks at N-S street intersections
    const ewRoads = [campusZ+50, campusZ+150, campusZ+250, campusZ+340];
    const nsRoads = [campusX+60, campusX+140, campusX+220, campusX+310];

    for (const rz of ewRoads) {
      for (const rx of nsRoads) {
        // Crosswalk stripes (white lines across road)
        for (let dx = 0; dx < 5; dx += 2) {
          await fill(rx+dx, oy, rz-2, rx+dx, oy, rz-1, 'white_concrete');
          await fill(rx+dx, oy, rz+6, rx+dx, oy, rz+7, 'white_concrete');
        }
        // Traffic light pole (SE corner)
        await fill(rx+6, oy+1, rz+7, rx+6, oy+4, rz+7, 'iron_bars');
        await sb(rx+6, oy+5, rz+7, 'black_concrete');
        await sb(rx+6, oy+5, rz+6, 'red_concrete'); // red light face
        await sb(rx+5, oy+5, rz+7, 'lime_concrete'); // green light face
        // Traffic light pole (NW corner)
        await fill(rx-2, oy+1, rz-2, rx-2, oy+4, rz-2, 'iron_bars');
        await sb(rx-2, oy+5, rz-2, 'black_concrete');
        await sb(rx-2, oy+5, rz-1, 'red_concrete');
        await sb(rx-1, oy+5, rz-2, 'lime_concrete');
        detailCount += 2;
      }
    }
    log(`[A] Done: ${detailCount} details`);

    // ═══════════════════════════════════════
    // PHASE B: Sidewalk Trees & Street Furniture
    // ═══════════════════════════════════════
    log('[B] Sidewalk trees, benches, hydrants...');
    bot.chat('Phase B: Street trees, benches, hydrants...');

    // Trees along all roads
    for (const rz of ewRoads) {
      for (let x = campusX; x < campusX+CW; x += 15) {
        if (rng() < 0.3) continue; // skip some for variety
        // Tree on south sidewalk
        const tz = rz + 8;
        await fill(x, oy+1, tz, x, oy+4, tz, 'birch_log');
        await fill(x-1, oy+4, tz-1, x+1, oy+5, tz+1, 'birch_leaves');
        await sb(x, oy+6, tz, 'birch_leaves');
        detailCount++;
        // Fire hydrant every ~45 blocks
        if (x % 45 < 15) {
          await sb(x+3, oy+1, tz, 'red_concrete');
          detailCount++;
        }
      }
    }
    for (const rx of nsRoads) {
      for (let z = campusZ; z < campusZ+CD; z += 15) {
        if (rng() < 0.3) continue;
        const tx = rx + 8;
        await fill(tx, oy+1, z, tx, oy+4, z, 'birch_log');
        await fill(tx-1, oy+4, z-1, tx+1, oy+5, z+1, 'birch_leaves');
        await sb(tx, oy+6, z, 'birch_leaves');
        detailCount++;
      }
    }

    // Benches along sidewalks (every ~30 blocks)
    for (const rz of ewRoads) {
      for (let x = campusX+10; x < campusX+CW; x += 30) {
        // Oak stair bench
        await fill(x, oy+1, rz-2, x+1, oy+1, rz-2, 'oak_stairs');
        detailCount++;
      }
    }

    // Trash cans (cauldrons)
    for (const rz of ewRoads) {
      for (let x = campusX+20; x < campusX+CW; x += 40) {
        await sb(x, oy+1, rz+7, 'cauldron');
        detailCount++;
      }
    }
    log(`[B] Done: ${detailCount} details`);

    // ═══════════════════════════════════════
    // PHASE C: Parking Lots with Cars
    // ═══════════════════════════════════════
    log('[C] Parking lots & cars...');
    bot.chat('Phase C: Parking lots with cars...');

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
      await fill(lot.x, oy, lot.z, lot.x+lot.w, oy, lot.z+lot.d, 'black_concrete');
      // Parking lines
      for (let x = lot.x+3; x < lot.x+lot.w-3; x += 4) {
        await fill(x, oy, lot.z+2, x, oy, lot.z+4, 'white_concrete');
        await fill(x, oy, lot.z+lot.d-5, x, oy, lot.z+lot.d-3, 'white_concrete');
      }
      // Cars (colored blocks, 2 long)
      for (let x = lot.x+3; x < lot.x+lot.w-5; x += 4) {
        if (rng() < 0.3) continue; // empty spots
        const color = pick(carColors);
        await fill(x, oy+1, lot.z+2, x+1, oy+1, lot.z+3, color);
        await sb(x, oy+2, lot.z+2, 'glass');
        carCount++;
        if (rng() < 0.7) {
          await fill(x, oy+1, lot.z+lot.d-4, x+1, oy+1, lot.z+lot.d-3, pick(carColors));
          await sb(x, oy+2, lot.z+lot.d-4, 'glass');
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
        await fill(x, oy+1, rz-1, x+1, oy+1, rz-1, color);
        await sb(x, oy+2, rz-1, 'glass');
        carCount++;
      }
    }
    log(`[C] ${carCount} cars placed, ${detailCount} details total`);

    // ═══════════════════════════════════════
    // PHASE D: Enhanced Parks
    // ═══════════════════════════════════════
    log('[D] Park details — fountains, flowers, paths...');
    bot.chat('Phase D: Parks, fountains, flower beds...');

    // Main fountain on Tech Green
    const ftx = campusX+180, ftz = campusZ+180;
    // Fountain basin (stone bricks)
    await fill(ftx-3, oy, ftz-3, ftx+3, oy, ftz+3, 'stone_bricks');
    await fill(ftx-3, oy+1, ftz-3, ftx+3, oy+1, ftz-3, 'stone_brick_wall');
    await fill(ftx-3, oy+1, ftz+3, ftx+3, oy+1, ftz+3, 'stone_brick_wall');
    await fill(ftx-3, oy+1, ftz-3, ftx-3, oy+1, ftz+3, 'stone_brick_wall');
    await fill(ftx+3, oy+1, ftz-3, ftx+3, oy+1, ftz+3, 'stone_brick_wall');
    // Water
    await fill(ftx-2, oy+1, ftz-2, ftx+2, oy+1, ftz+2, 'water');
    // Center pillar
    await fill(ftx, oy+1, ftz, ftx, oy+3, ftz, 'stone_bricks');
    await sb(ftx, oy+4, ftz, 'sea_lantern');
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
            const block = bot.blockAt(vec3(fx+dx, oy, fz+dz));
            if (block && block.name === 'grass_block') {
              await sb(fx+dx, oy+1, fz+dz, pick(flowers));
            }
          }
        }
      }
      if (i % 20 === 0) await sleep(50);
    }
    detailCount += 80;
    log(`[D] Done: ${detailCount} details`);

    // ═══════════════════════════════════════
    // PHASE E: Bus Stops, Billboards, Awnings
    // ═══════════════════════════════════════
    log('[E] Bus stops, billboards, awnings...');
    bot.chat('Phase E: Bus stops, billboards...');

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
      await fill(bs.x, oy+1, bs.z, bs.x, oy+3, bs.z, 'iron_bars');
      await fill(bs.x+3, oy+1, bs.z, bs.x+3, oy+3, bs.z, 'iron_bars');
      await fill(bs.x, oy+4, bs.z, bs.x+3, oy+4, bs.z, 'smooth_stone_slab');
      // Glass back
      await fill(bs.x, oy+1, bs.z, bs.x+3, oy+3, bs.z, 'glass');
      // Bench inside
      await fill(bs.x+1, oy+1, bs.z+1, bs.x+2, oy+1, bs.z+1, 'oak_stairs');
      detailCount++;
    }

    // Billboards in city area
    for (let i = 0; i < 12; i++) {
      const bx = randInt(cityX1+30, cityX2-30);
      const bz = randInt(cityZ1+30, cityZ2-30);
      // Check it's in city, not campus
      if (bx > campusX-5 && bx < campusX+CW+5 && bz > campusZ-5 && bz < campusZ+CD+5) continue;
      // Pole
      await fill(bx, oy+1, bz, bx, oy+10, bz, 'iron_bars');
      // Billboard face
      const boardColor = pick(['white_concrete','yellow_concrete','cyan_concrete','lime_concrete']);
      await fill(bx-3, oy+8, bz, bx+3, oy+12, bz, boardColor);
      await fill(bx-2, oy+9, bz, bx+2, oy+11, bz, pick(['blue_concrete','red_concrete','black_concrete']));
      detailCount++;
    }

    // Awnings on buildings (colored wool overhangs at ground floor)
    for (let gx = cityX1; gx < cityX2; gx += 25) {
      for (let gz = cityZ1; gz < cityZ2; gz += 25) {
        if (gx > campusX && gx < campusX+CW && gz > campusZ && gz < campusZ+CD) continue;
        if (rng() < 0.7) continue;
        const awningColor = pick(['red_wool','blue_wool','green_wool','yellow_wool','orange_wool','white_wool']);
        await fill(gx+6, oy+3, gz+6, gx+10, oy+3, gz+6, awningColor);
        detailCount++;
      }
    }
    log(`[E] Done: ${detailCount} details`);

    // ═══════════════════════════════════════
    // PHASE F: Lit windows (random glowstone in buildings)
    // ═══════════════════════════════════════
    log('[F] Lit windows & building details...');
    bot.chat('Phase F: Lit windows in buildings...');

    // Scatter lit windows in city buildings
    for (let gx = cityX1; gx < cityX2; gx += 25) {
      for (let gz = cityZ1; gz < cityZ2; gz += 25) {
        if (gx > campusX && gx < campusX+CW && gz > campusZ && gz < campusZ+CD) continue;
        // Check a spot at height 5 to see if there's a building
        const checkBlock = bot.blockAt(vec3(gx+8, oy+5, gz+8));
        if (!checkBlock || checkBlock.name === 'air') continue;
        // Add some glowstone windows
        for (let y = oy+3; y < oy+40; y += 4) {
          if (rng() < 0.6) continue;
          const wx = gx + randInt(7, 12);
          const wz = gz + 6;
          const block = bot.blockAt(vec3(wx, y, wz));
          if (block && block.name.includes('glass')) {
            await sb(wx, y, wz, 'glowstone');
            detailCount++;
          }
        }
      }
      if (gx % 100 < 25) {
        log(`  Lit windows progress: x=${gx}, details=${detailCount}`);
        await sleep(50);
      }
    }
    log(`[F] Done: ${detailCount} details`);

    // ═══════════════════════════════════════
    // PHASE G: Highway enhancements
    // ═══════════════════════════════════════
    log('[G] Highway signs & details...');
    bot.chat('Phase G: Highway signs, exit ramps...');
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
      await fill(s.x, hwyY+1, s.z+3, s.x, hwyY+4, s.z+3, 'iron_bars');
      // Sign board
      await fill(s.x-4, hwyY+4, s.z+3, s.x+4, hwyY+6, s.z+3, s.color);
      await fill(s.x-3, hwyY+5, s.z+3, s.x+3, hwyY+5, s.z+3, 'white_concrete');
      detailCount++;
    }

    // Cars on highway
    for (let x = hx1+20; x < hx2-20; x += randInt(8,16)) {
      const color = pick(carColors);
      await fill(x, hwyY+1, hz1+2, x+1, hwyY+1, hz1+2, color);
      await sb(x, hwyY+2, hz1+2, 'glass');
      if (rng() < 0.5) {
        await fill(x+4, hwyY+1, hz1+4, x+5, hwyY+1, hz1+4, pick(carColors));
        await sb(x+4, hwyY+2, hz1+4, 'glass');
      }
    }
    // Cars on north highway
    for (let x = hx1+20; x < hx2-20; x += randInt(8,16)) {
      const color = pick(carColors);
      await fill(x, hwyY+1, hz2+2, x+1, hwyY+1, hz2+2, color);
      await sb(x, hwyY+2, hz2+2, 'glass');
    }
    log(`[G] Done: ${detailCount} details`);

    // ═══════════════════════════════════════
    // PHASE H: GT Campus Special Details
    // ═══════════════════════════════════════
    log('[H] GT campus special details...');
    bot.chat('Phase H: GT campus details — Buzz statue, signage...');

    // Buzz statue (yellow/black figure near Tech Green)
    const bx = campusX+165, bz = campusZ+155;
    // Body (yellow)
    await fill(bx, oy+1, bz, bx+1, oy+1, bz+1, 'yellow_concrete'); // feet
    await fill(bx, oy+2, bz, bx+1, oy+3, bz+1, 'yellow_concrete'); // legs
    await fill(bx, oy+4, bz, bx+1, oy+5, bz+1, 'yellow_concrete'); // torso
    await fill(bx, oy+6, bz, bx+1, oy+6, bz+1, 'black_concrete'); // head stripes
    await fill(bx, oy+7, bz, bx+1, oy+7, bz+1, 'yellow_concrete'); // head top
    // Wings
    await fill(bx-1, oy+4, bz, bx-1, oy+5, bz+1, 'white_concrete');
    await fill(bx+2, oy+4, bz, bx+2, oy+5, bz+1, 'white_concrete');
    // Eyes
    await sb(bx, oy+6, bz-1, 'black_concrete');
    await sb(bx+1, oy+6, bz-1, 'black_concrete');
    detailCount++;

    // "GEORGIA TECH" sign at campus entrance (south side, North Ave)
    const signX = campusX+180, signZ = campusZ+345;
    await fill(signX-2, oy+1, signZ, signX-2, oy+3, signZ, 'stone_bricks');
    await fill(signX+12, oy+1, signZ, signX+12, oy+3, signZ, 'stone_bricks');
    await fill(signX-2, oy+3, signZ, signX+12, oy+3, signZ, 'stone_bricks');
    await fill(signX, oy+4, signZ, signX+10, oy+5, signZ, 'gold_block');
    await fill(signX+1, oy+4, signZ, signX+9, oy+4, signZ, 'white_concrete');
    detailCount++;

    // Flagpoles
    const flagPoles = [
      { x: campusX+175, z: campusZ+95 }, // near Tech Tower
      { x: campusX+200, z: campusZ+340 }, // North Ave entrance
    ];
    for (const fp of flagPoles) {
      await fill(fp.x, oy+1, fp.z, fp.x, oy+12, fp.z, 'iron_bars');
      await fill(fp.x+1, oy+10, fp.z, fp.x+3, oy+12, fp.z, 'blue_wool'); // flag
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
      const block = bot.blockAt(vec3(tx, oy, tz));
      if (!block || block.name !== 'grass_block') continue;
      const tree = pick(treeTypes);
      await fill(tx, oy+1, tz, tx, oy+tree.h-2, tz, tree.log);
      await fill(tx-2, oy+tree.h-3, tz-2, tx+2, oy+tree.h-1, tz+2, tree.leaves);
      await fill(tx-1, oy+tree.h, tz-1, tx+1, oy+tree.h, tz+1, tree.leaves);
      detailCount++;
      if (i % 15 === 0) await sleep(50);
    }

    // Lampposts on campus paths (shorter, more decorative)
    for (let i = 0; i < 100; i += 15) {
      const px = campusX + 80 + i, pz = campusZ + 70 + Math.floor(i * 0.8);
      await fill(px+2, oy+1, pz+2, px+2, oy+3, pz+2, 'dark_oak_fence');
      await sb(px+2, oy+4, pz+2, 'lantern');
      detailCount++;
    }

    log(`[H] Done: ${detailCount} total details`);
    log('=== ALL DETAIL PHASES COMPLETE ===');
    bot.chat(`=== Detail enhancement complete! ${detailCount} details added ===`);
    bot.chat('City now has: crosswalks, traffic lights, trees, benches, parking lots, cars, fountains, flowers, bus stops, billboards, lit windows, highway signs, Buzz statue, GT signage');

    // Stay connected
    log('DetailBot staying connected.');

  } catch(e) { log('FATAL: ' + e.message + '\n' + e.stack); }
});
bot.on('error', e => log('Err: ' + e.message));
bot.on('kicked', r => { log('Kicked: ' + JSON.stringify(r)); process.exit(1); });
bot.on('end', () => { log('Disconnected'); process.exit(0); });
