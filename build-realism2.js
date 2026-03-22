// City Realism Pass 2 — Based on top-rated MC city builds research
// Key lessons from "Negative Space" guide (4.7/5 rated) & Zingopolis/World of Worlds:
//   1. ALLEYWAYS between buildings with pipes, dumpsters, fire escapes
//   2. GROUND-LEVEL shops with awnings, signs, varied storefronts  
//   3. MIXED heights — tiny shops next to towers
//   4. INFRASTRUCTURE — subway, gas station, church, hospital, hotel, mall
//   5. WATER — river/canal through the city
//   6. TERRAIN — not flat, slight elevation changes
//   7. NEGATIVE SPACE — bridges between buildings, overhangs, recessed entries

const mineflayer = require('mineflayer');
const vec3 = require('vec3');
const fs = require('fs');

const bot = mineflayer.createBot({host:'localhost',port:25566,username:'BuilderBot',auth:'offline',version:'1.21.11'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => { console.log(msg); fs.appendFileSync('/tmp/realism_log.txt', msg+'\n'); };

async function fill(x1,y1,z1,x2,y2,z2,block) {
  const dx=Math.abs(x2-x1)+1, dy=Math.abs(y2-y1)+1, dz=Math.abs(z2-z1)+1;
  if (dx*dy*dz > 32000) {
    if (dx>=dy&&dx>=dz) { const m=Math.floor((Math.min(x1,x2)+Math.max(x1,x2))/2); await fill(Math.min(x1,x2),y1,z1,m,y2,z2,block); await fill(m+1,y1,z1,Math.max(x1,x2),y2,z2,block); }
    else if (dz>=dy) { const m=Math.floor((Math.min(z1,z2)+Math.max(z1,z2))/2); await fill(x1,y1,Math.min(z1,z2),x2,y2,m,block); await fill(x1,y1,m+1,x2,y2,Math.max(z1,z2),block); }
    else { const m=Math.floor((Math.min(y1,y2)+Math.max(y1,y2))/2); await fill(x1,Math.min(y1,y2),z1,x2,m,z2,block); await fill(x1,m+1,z1,x2,Math.max(y1,y2),z2,block); }
    return;
  }
  bot.chat(`/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}`);
  await sleep(80);
}

let seed=31415;
function rng(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;}
function ri(a,b){return Math.floor(rng()*(b-a+1))+a;}
function pick(a){return a[Math.floor(rng()*a.length)];}

let started=false;
bot.on('spawn', async()=>{
  if(started)return; started=true;
  try {
    fs.writeFileSync('/tmp/realism_log.txt','');
    await sleep(3000);
    bot.chat('/gamemode creative'); await sleep(1000);

    const oy=-62; // ground
    const campusX=359, campusZ=-536, CW=400, CD=400;
    const MARGIN=150;
    const cx1=campusX-MARGIN, cz1=campusZ-MARGIN;
    const cx2=campusX+CW+MARGIN, cz2=campusZ+CD+MARGIN;

    log('=== REALISM PASS 2 — Making the city alive ===');
    bot.chat('=== Realism Pass 2: Alleyways, shops, infrastructure, water ===');

    let count=0;

    // ═══════════════════════════════════════════
    // 1. CANAL / RIVER through the city
    // ═══════════════════════════════════════════
    log('[1] Building canal...');
    bot.chat('[1/10] Digging canal through city...');
    const canalZ = campusZ + CD + 80; // south of campus
    const canalW = 8;
    // Dig canal trench
    await fill(cx1, oy-3, canalZ, cx2, oy-1, canalZ+canalW, 'air');
    // Stone walls
    await fill(cx1, oy-3, canalZ-1, cx2, oy, canalZ-1, 'stone_bricks');
    await fill(cx1, oy-3, canalZ+canalW+1, cx2, oy, canalZ+canalW+1, 'stone_bricks');
    // Bottom
    await fill(cx1, oy-4, canalZ, cx2, oy-4, canalZ+canalW, 'stone_bricks');
    // Water
    await fill(cx1, oy-3, canalZ, cx2, oy-2, canalZ+canalW, 'water');
    // Bridges over canal every 60 blocks
    for (let x = cx1+30; x < cx2; x += 60) {
      await fill(x-3, oy, canalZ-1, x+3, oy, canalZ+canalW+1, 'stone_bricks');
      await fill(x-3, oy+1, canalZ-1, x-3, oy+1, canalZ+canalW+1, 'stone_brick_wall');
      await fill(x+3, oy+1, canalZ-1, x+3, oy+1, canalZ+canalW+1, 'stone_brick_wall');
      // Lanterns on bridge
      await fill(x-2, oy+1, canalZ-1, x-2, oy+2, canalZ-1, 'iron_bars');
      await fill(x-2, oy+3, canalZ-1, x-2, oy+3, canalZ-1, 'lantern');
      await fill(x+2, oy+1, canalZ+canalW+1, x+2, oy+2, canalZ+canalW+1, 'iron_bars');
      await fill(x+2, oy+3, canalZ+canalW+1, x+2, oy+3, canalZ+canalW+1, 'lantern');
      count++;
    }
    log('[1] Canal done');

    // ═══════════════════════════════════════════
    // 2. SMALL SHOPS row (ground-level variety)
    // ═══════════════════════════════════════════
    log('[2] Building shop rows...');
    bot.chat('[2/10] Ground-level shops & storefronts...');
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
        await fill(sx, oy+1, sz, sx+shop.w-1, oy+shop.h, sz+shop.d-1, color);
        // Hollow interior
        await fill(sx+1, oy+1, sz+1, sx+shop.w-2, oy+shop.h-1, sz+shop.d-2, 'air');
        // Floor
        await fill(sx+1, oy, sz+1, sx+shop.w-2, oy, sz+shop.d-2, 'oak_planks');
        // Glass front
        await fill(sx+1, oy+1, sz, sx+shop.w-2, oy+shop.h-1, sz, 'glass');
        // Door
        await fill(sx+Math.floor(shop.w/2), oy+1, sz, sx+Math.floor(shop.w/2), oy+2, sz, 'air');
        // Awning overhang
        await fill(sx, oy+shop.h, sz-1, sx+shop.w-1, oy+shop.h, sz-1, awning);
        // Interior light
        await fill(sx+Math.floor(shop.w/2), oy+shop.h-1, sz+Math.floor(shop.d/2), sx+Math.floor(shop.w/2), oy+shop.h-1, sz+Math.floor(shop.d/2), 'lantern');
        // Counter inside
        await fill(sx+1, oy+1, sz+shop.d-2, sx+shop.w-2, oy+1, sz+shop.d-2, 'oak_stairs');

        pos += shop.w + ri(1,3); // gap between shops
        count++;
      }
    }
    log(`[2] ${count} shops built`);

    // ═══════════════════════════════════════════
    // 3. ALLEYWAYS between city buildings
    // ═══════════════════════════════════════════
    log('[3] Adding alleyways...');
    bot.chat('[3/10] Alleyways with dumpsters, fire escapes, pipes...');

    for (let gx = cx1; gx < cx2; gx += 25) {
      for (let gz = cz1; gz < cz2; gz += 25) {
        if (gx > campusX-5 && gx < campusX+CW+5 && gz > campusZ-5 && gz < campusZ+CD+5) continue;
        if (rng() < 0.6) continue; // not every block

        const ax = gx + 18, az = gz + 8; // alley position

        // Dumpster (dark green)
        await fill(ax, oy+1, az, ax+1, oy+2, az, 'green_terracotta');
        // Pipe on wall
        await fill(ax+2, oy+1, az+2, ax+2, oy+8, az+2, 'iron_bars');
        // Fire escape ladder
        if (rng() < 0.5) {
          await fill(ax-1, oy+1, az+3, ax-1, oy+12, az+3, 'chain');
          // Fire escape platforms
          for (let fy = oy+4; fy < oy+14; fy += 4) {
            await fill(ax-2, fy, az+2, ax, fy, az+4, 'iron_bars');
          }
        }
        // Puddle (water in alley)
        if (rng() < 0.3) {
          await fill(ax, oy, az+1, ax+1, oy, az+1, 'water');
        }
        // AC unit on wall
        if (rng() < 0.4) {
          await fill(ax+3, oy+3, az, ax+3, oy+4, az+1, 'iron_block');
        }
        count++;
      }
    }
    log(`[3] Alleyways done: ${count}`);

    // ═══════════════════════════════════════════
    // 4. MAJOR INFRASTRUCTURE
    // ═══════════════════════════════════════════
    log('[4] Building infrastructure...');
    bot.chat('[4/10] Gas station, church, hotel, hospital...');

    // GAS STATION (west of campus)
    const gsx = campusX - 80, gsz = campusZ + 100;
    log('  Gas Station...');
    // Canopy
    await fill(gsx, oy, gsz, gsx+20, oy, gsz+12, 'black_concrete'); // asphalt
    await fill(gsx+2, oy+5, gsz+2, gsx+18, oy+5, gsz+10, 'white_concrete'); // canopy roof
    // Canopy pillars
    await fill(gsx+2, oy+1, gsz+2, gsx+2, oy+4, gsz+2, 'iron_block');
    await fill(gsx+18, oy+1, gsz+2, gsx+18, oy+4, gsz+2, 'iron_block');
    await fill(gsx+2, oy+1, gsz+10, gsx+2, oy+4, gsz+10, 'iron_block');
    await fill(gsx+18, oy+1, gsz+10, gsx+18, oy+4, gsz+10, 'iron_block');
    // Pumps
    for (let px = gsx+6; px <= gsx+14; px += 4) {
      await fill(px, oy+1, gsz+5, px, oy+2, gsz+5, 'quartz_block');
      await fill(px, oy+2, gsz+5, px, oy+2, gsz+5, 'black_concrete');
      await fill(px, oy+1, gsz+7, px, oy+2, gsz+7, 'quartz_block');
      await fill(px, oy+2, gsz+7, px, oy+2, gsz+7, 'black_concrete');
    }
    // Convenience store behind
    await fill(gsx, oy+1, gsz+13, gsx+10, oy+4, gsz+18, 'white_concrete');
    await fill(gsx+1, oy+1, gsz+14, gsx+9, oy+3, gsz+17, 'air');
    await fill(gsx+1, oy+1, gsz+13, gsx+5, oy+3, gsz+13, 'glass');
    await fill(gsx+3, oy+1, gsz+13, gsx+3, oy+2, gsz+13, 'air'); // door
    // Canopy lights
    await fill(gsx+5, oy+4, gsz+5, gsx+5, oy+4, gsz+5, 'glowstone');
    await fill(gsx+15, oy+4, gsz+5, gsx+15, oy+4, gsz+5, 'glowstone');
    await fill(gsx+5, oy+4, gsz+7, gsx+5, oy+4, gsz+7, 'glowstone');
    await fill(gsx+15, oy+4, gsz+7, gsx+15, oy+4, gsz+7, 'glowstone');
    // Sign
    await fill(gsx+3, oy+5, gsz+13, gsx+7, oy+7, gsz+13, 'red_concrete');
    count++;

    // CHURCH (east of campus)
    const chx = campusX + CW + 60, chz = campusZ + 150;
    log('  Church...');
    // Main body
    await fill(chx, oy+1, chz, chx+14, oy+12, chz+22, 'stone_bricks');
    await fill(chx+1, oy+1, chz+1, chx+13, oy+11, chz+21, 'air');
    // Stained glass windows
    for (let z = chz+2; z < chz+20; z += 4) {
      const gc = pick(['red_stained_glass','blue_stained_glass','yellow_stained_glass','purple_stained_glass']);
      await fill(chx, oy+3, z, chx, oy+8, z+1, gc);
      await fill(chx+14, oy+3, z, chx+14, oy+8, z+1, gc);
    }
    // Peaked roof
    for (let dy = 0; dy < 6; dy++) {
      await fill(chx+dy, oy+13+dy, chz, chx+14-dy, oy+13+dy, chz+22, 'dark_oak_planks');
    }
    // Bell tower
    await fill(chx+5, oy+1, chz-5, chx+9, oy+20, chz, 'stone_bricks');
    await fill(chx+6, oy+15, chz-4, chx+8, oy+18, chz-1, 'air'); // belfry windows
    // Cross on top
    await fill(chx+7, oy+21, chz-3, chx+7, oy+25, chz-3, 'gold_block');
    await fill(chx+6, oy+23, chz-3, chx+8, oy+23, chz-3, 'gold_block');
    // Door
    await fill(chx+6, oy+1, chz, chx+8, oy+4, chz, 'dark_oak_planks');
    await fill(chx+7, oy+1, chz, chx+7, oy+3, chz, 'air');
    // Pews inside
    for (let z = chz+4; z < chz+18; z += 2) {
      await fill(chx+3, oy+1, z, chx+5, oy+1, z, 'oak_stairs');
      await fill(chx+9, oy+1, z, chx+11, oy+1, z, 'oak_stairs');
    }
    count++;

    // HOTEL (tall building with distinct look)
    const htx = cx2 - 60, htz = campusZ + 50;
    log('  Hotel...');
    // Main body — brown with gold trim
    await fill(htx, oy+1, htz, htx+18, oy+45, htz+14, 'brown_concrete');
    // Glass strip facades
    for (let x = htx+1; x < htx+18; x += 2) {
      await fill(x, oy+2, htz, x, oy+44, htz, 'white_stained_glass');
      await fill(x, oy+2, htz+14, x, oy+44, htz+14, 'white_stained_glass');
    }
    for (let z = htz+1; z < htz+14; z += 2) {
      await fill(htx, oy+2, z, htx, oy+44, z, 'white_stained_glass');
      await fill(htx+18, oy+2, z, htx+18, oy+44, z, 'white_stained_glass');
    }
    // Floor lines
    for (let y = oy+5; y < oy+45; y += 4) {
      await fill(htx, y, htz, htx+18, y, htz, 'brown_concrete');
      await fill(htx, y, htz+14, htx+18, y, htz+14, 'brown_concrete');
    }
    // Lobby — grand entrance with columns
    await fill(htx+6, oy+1, htz, htx+12, oy+5, htz, 'air');
    await fill(htx+6, oy+1, htz-1, htx+6, oy+5, htz-1, 'quartz_pillar');
    await fill(htx+12, oy+1, htz-1, htx+12, oy+5, htz-1, 'quartz_pillar');
    await fill(htx+6, oy+6, htz-1, htx+12, oy+6, htz-1, 'quartz_block');
    // Reception desk
    await fill(htx+3, oy+1, htz+3, htx+8, oy+1, htz+3, 'polished_granite');
    // Lobby chandelier
    await fill(htx+9, oy+5, htz+4, htx+9, oy+5, htz+4, 'chain');
    await fill(htx+9, oy+4, htz+4, htx+9, oy+4, htz+4, 'lantern');
    // Roof
    await fill(htx, oy+46, htz, htx+18, oy+46, htz+14, 'gold_block');
    // Rooftop pool!
    await fill(htx+3, oy+46, htz+3, htx+15, oy+46, htz+11, 'light_blue_concrete');
    await fill(htx+4, oy+46, htz+4, htx+14, oy+46, htz+10, 'water');
    count++;

    // HOSPITAL  
    const hox = campusX - 100, hoz = campusZ + 250;
    log('  Hospital...');
    await fill(hox, oy+1, hoz, hox+25, oy+20, hoz+18, 'white_concrete');
    for (let x = hox+1; x < hox+25; x += 2) {
      await fill(x, oy+3, hoz, x, oy+19, hoz, 'light_blue_stained_glass');
      await fill(x, oy+3, hoz+18, x, oy+19, hoz+18, 'light_blue_stained_glass');
    }
    for (let y = oy+5; y < oy+20; y += 4) {
      await fill(hox, y, hoz, hox+25, y, hoz, 'white_concrete');
      await fill(hox, y, hoz+18, hox+25, y, hoz+18, 'white_concrete');
    }
    // Red cross on front
    await fill(hox+12, oy+14, hoz-1, hox+14, oy+14, hoz-1, 'red_concrete');
    await fill(hox+13, oy+13, hoz-1, hox+13, oy+15, hoz-1, 'red_concrete');
    // Emergency entrance overhang
    await fill(hox+8, oy+4, hoz-3, hox+18, oy+4, hoz-1, 'white_concrete');
    await fill(hox+8, oy+1, hoz-3, hox+8, oy+3, hoz-3, 'white_concrete');
    await fill(hox+18, oy+1, hoz-3, hox+18, oy+3, hoz-3, 'white_concrete');
    // Ambulance (white+red car)
    await fill(hox+12, oy+1, hoz-4, hox+14, oy+1, hoz-4, 'white_concrete');
    await fill(hox+12, oy+2, hoz-4, hox+12, oy+2, hoz-4, 'red_concrete');
    await fill(hox+14, oy+2, hoz-4, hox+14, oy+2, hoz-4, 'glass');
    count++;

    // SUBWAY ENTRANCE (multiple locations)
    log('  Subway entrances...');
    const subwaySpots = [
      {x: campusX+100, z: campusZ+48},
      {x: campusX+250, z: campusZ+148},
      {x: campusX+180, z: campusZ+338},
    ];
    for (const sub of subwaySpots) {
      // Stairway down
      await fill(sub.x, oy, sub.z, sub.x+4, oy, sub.z+2, 'air');
      await fill(sub.x, oy-1, sub.z, sub.x+4, oy-1, sub.z+2, 'air');
      await fill(sub.x, oy-2, sub.z, sub.x+4, oy-2, sub.z+2, 'air');
      // Stairs
      await fill(sub.x, oy, sub.z, sub.x+4, oy, sub.z, 'stone_brick_stairs');
      await fill(sub.x, oy-1, sub.z+1, sub.x+4, oy-1, sub.z+1, 'stone_brick_stairs');
      await fill(sub.x, oy-2, sub.z+2, sub.x+4, oy-2, sub.z+2, 'stone_bricks');
      // Railings
      await fill(sub.x-1, oy+1, sub.z, sub.x-1, oy+1, sub.z+2, 'iron_bars');
      await fill(sub.x+5, oy+1, sub.z, sub.x+5, oy+1, sub.z+2, 'iron_bars');
      // Subway sign (green)
      await fill(sub.x, oy+2, sub.z-1, sub.x+4, oy+3, sub.z-1, 'green_concrete');
      await fill(sub.x+1, oy+2, sub.z-1, sub.x+3, oy+2, sub.z-1, 'white_concrete');
      // Underground platform
      await fill(sub.x-2, oy-4, sub.z-2, sub.x+8, oy-3, sub.z+6, 'air');
      await fill(sub.x-2, oy-5, sub.z-2, sub.x+8, oy-5, sub.z+6, 'smooth_stone');
      await fill(sub.x-2, oy-4, sub.z-2, sub.x+8, oy-4, sub.z-2, 'yellow_concrete'); // warning line
      // Lights in tunnel
      await fill(sub.x+3, oy-3, sub.z+2, sub.x+3, oy-3, sub.z+2, 'lantern');
      count++;
    }
    log(`[4] Infrastructure done: ${count}`);

    // ═══════════════════════════════════════════
    // 5. PARKS with real features
    // ═══════════════════════════════════════════
    log('[5] Enhanced parks...');
    bot.chat('[5/10] Parks with playgrounds, paths, ponds...');

    // CITY PARK (large park south of campus)
    const pkx = campusX + 100, pkz = campusZ + CD + 30;
    await fill(pkx, oy, pkz, pkx+80, oy, pkz+50, 'grass_block');
    // Winding path through park
    for (let i = 0; i < 80; i++) {
      const pz = pkz + 25 + Math.floor(Math.sin(i*0.15)*10);
      await fill(pkx+i, oy, pz, pkx+i, oy, pz+1, 'gravel');
    }
    // Pond
    await fill(pkx+50, oy-1, pkz+20, pkx+65, oy-1, pkz+35, 'water');
    await fill(pkx+48, oy, pkz+18, pkx+67, oy, pkz+37, 'grass_block');
    await fill(pkx+50, oy, pkz+20, pkx+65, oy, pkz+35, 'air'); // cut grass for pond edge
    await fill(pkx+50, oy-1, pkz+20, pkx+65, oy-1, pkz+35, 'water');
    // Lily pads
    for (let i = 0; i < 8; i++) {
      await fill(pkx+52+ri(0,10), oy, pkz+22+ri(0,10), pkx+52+ri(0,10), oy, pkz+22+ri(0,10), 'lily_pad');
    }
    // Playground
    await fill(pkx+10, oy, pkz+10, pkx+25, oy, pkz+20, 'sand');
    // Slide (stairs + slab)
    await fill(pkx+15, oy+1, pkz+12, pkx+15, oy+4, pkz+12, 'iron_bars');
    await fill(pkx+15, oy+4, pkz+12, pkx+15, oy+4, pkz+15, 'smooth_stone_slab');
    // Swings (chains + oak plank seat)
    await fill(pkx+20, oy+1, pkz+14, pkx+20, oy+4, pkz+14, 'oak_fence');
    await fill(pkx+20, oy+4, pkz+14, pkx+20, oy+4, pkz+16, 'oak_fence');
    await fill(pkx+20, oy+1, pkz+16, pkx+20, oy+4, pkz+16, 'oak_fence');
    await fill(pkx+20, oy+4, pkz+15, pkx+20, oy+4, pkz+15, 'oak_planks');
    await fill(pkx+20, oy+3, pkz+15, pkx+20, oy+3, pkz+15, 'chain');
    await fill(pkx+20, oy+2, pkz+15, pkx+20, oy+2, pkz+15, 'oak_slab');

    // Park benches facing pond
    for (let z = pkz+22; z < pkz+34; z += 4) {
      await fill(pkx+47, oy+1, z, pkx+48, oy+1, z, 'oak_stairs');
    }
    // Trees (varied)
    const parkTrees = [[pkx+5,pkz+5],[pkx+20,pkz+30],[pkx+40,pkz+10],[pkx+40,pkz+40],[pkx+70,pkz+15],[pkx+70,pkz+40],[pkx+30,pkz+45]];
    for (const [tx,tz] of parkTrees) {
      const h = ri(5,8);
      const lt = pick(['oak_leaves','birch_leaves','dark_oak_leaves']);
      const lo = pick(['oak_log','birch_log','dark_oak_log']);
      await fill(tx, oy+1, tz, tx, oy+h-1, tz, lo);
      await fill(tx-2, oy+h-2, tz-2, tx+2, oy+h, tz+2, lt);
      await fill(tx-1, oy+h+1, tz-1, tx+1, oy+h+1, tz+1, lt);
    }
    count++;
    log(`[5] Parks: ${count}`);

    // ═══════════════════════════════════════════
    // 6. BRIDGES between tall buildings
    // ═══════════════════════════════════════════
    log('[6] Sky bridges...');
    bot.chat('[6/10] Sky bridges between buildings...');
    // Add glass sky bridges connecting random tall buildings
    for (let i = 0; i < 15; i++) {
      const bx = cx1 + ri(30, (cx2-cx1)-30);
      const bz = cz1 + ri(30, (cz2-cz1)-30);
      if (bx > campusX && bx < campusX+CW && bz > campusZ && bz < campusZ+CD) continue;
      const by = oy + ri(15, 35);
      const blen = ri(8, 15);
      // Glass tunnel bridge
      await fill(bx, by, bz, bx+blen, by, bz+2, 'glass');
      await fill(bx, by+3, bz, bx+blen, by+3, bz+2, 'glass');
      await fill(bx, by+1, bz, bx+blen, by+2, bz, 'glass');
      await fill(bx, by+1, bz+2, bx+blen, by+2, bz+2, 'glass');
      // Interior walkway
      await fill(bx, by, bz+1, bx+blen, by, bz+1, 'smooth_stone');
      await fill(bx+1, by+1, bz+1, bx+blen-1, by+2, bz+1, 'air');
      count++;
    }
    log(`[6] Bridges: ${count}`);

    // ═══════════════════════════════════════════
    // 7. ROOFTOP DETAILS
    // ═══════════════════════════════════════════
    log('[7] Rooftop details...');
    bot.chat('[7/10] Rooftop AC units, water towers, gardens...');
    for (let gx = cx1; gx < cx2; gx += 25) {
      for (let gz = cz1; gz < cz2; gz += 25) {
        if (gx > campusX && gx < campusX+CW && gz > campusZ && gz < campusZ+CD) continue;
        if (rng() < 0.5) continue;

        // Find roof height by checking upward
        let roofY = oy+5;
        for (let y = oy+60; y > oy; y--) {
          const b = bot.blockAt(vec3(gx+10, y, gz+10));
          if (b && b.name !== 'air' && b.name !== 'void_air' && !b.name.includes('glass')) {
            roofY = y;
            break;
          }
        }
        if (roofY < oy+5) continue;

        const r = rng();
        if (r < 0.3) {
          // Water tower
          await fill(gx+8, roofY+1, gz+8, gx+8, roofY+4, gz+8, 'iron_bars');
          await fill(gx+12, roofY+1, gz+8, gx+12, roofY+4, gz+8, 'iron_bars');
          await fill(gx+8, roofY+1, gz+12, gx+8, roofY+4, gz+12, 'iron_bars');
          await fill(gx+12, roofY+1, gz+12, gx+12, roofY+4, gz+12, 'iron_bars');
          await fill(gx+7, roofY+4, gz+7, gx+13, roofY+7, gz+13, 'spruce_planks');
        } else if (r < 0.6) {
          // AC units
          await fill(gx+8, roofY+1, gz+8, gx+10, roofY+2, gz+10, 'iron_block');
          await fill(gx+9, roofY+2, gz+9, gx+9, roofY+2, gz+9, 'iron_bars');
          if (rng() < 0.5) {
            await fill(gx+12, roofY+1, gz+8, gx+14, roofY+2, gz+10, 'iron_block');
          }
        } else {
          // Rooftop garden
          await fill(gx+7, roofY+1, gz+7, gx+13, roofY+1, gz+13, 'grass_block');
          await fill(gx+9, roofY+2, gz+10, gx+9, roofY+5, gz+10, 'oak_log');
          await fill(gx+7, roofY+5, gz+8, gx+11, roofY+6, gz+12, 'oak_leaves');
        }
        count++;
      }
    }
    log(`[7] Rooftops: ${count}`);

    // ═══════════════════════════════════════════
    // 8. STREET-LEVEL LIFE — more cars, pedestrians areas
    // ═══════════════════════════════════════════
    log('[8] Street life...');
    bot.chat('[8/10] More cars, outdoor dining, street vendors...');

    // Outdoor dining areas (tables + chairs near shops)
    for (let i = 0; i < 25; i++) {
      const dx = campusX + ri(70, CW-30);
      const dz = campusZ + ri(60, CD-30);
      // Table
      await fill(dx, oy+1, dz, dx, oy+1, dz, 'dark_oak_fence');
      await fill(dx, oy+2, dz, dx, oy+2, dz, 'dark_oak_pressure_plate');
      // Chairs (stairs facing table)
      await fill(dx+1, oy+1, dz, dx+1, oy+1, dz, 'oak_stairs');
      await fill(dx-1, oy+1, dz, dx-1, oy+1, dz, 'oak_stairs');
      // Umbrella (wool on fence)
      await fill(dx, oy+3, dz, dx, oy+3, dz, 'dark_oak_fence');
      await fill(dx-1, oy+4, dz-1, dx+1, oy+4, dz+1, pick(['red_wool','white_wool','blue_wool']));
      count++;
    }

    // Food trucks / street vendor carts
    for (let i = 0; i < 10; i++) {
      const vx = cx1 + ri(50, (cx2-cx1)-50);
      const vz = cz1 + ri(50, (cz2-cz1)-50);
      if (vx > campusX && vx < campusX+CW && vz > campusZ && vz < campusZ+CD) continue;
      const color = pick(['red_concrete','yellow_concrete','blue_concrete','white_concrete']);
      // Truck body
      await fill(vx, oy+1, vz, vx+3, oy+3, vz+1, color);
      await fill(vx+1, oy+1, vz, vx+2, oy+2, vz, 'air'); // serving window
      // Wheels
      await fill(vx, oy+1, vz, vx, oy+1, vz, 'black_concrete');
      await fill(vx+3, oy+1, vz, vx+3, oy+1, vz, 'black_concrete');
      count++;
    }
    log(`[8] Street life: ${count}`);

    // ═══════════════════════════════════════════
    // 9. MARTA STATION (Atlanta's transit)
    // ═══════════════════════════════════════════
    log('[9] MARTA station...');
    bot.chat('[9/10] MARTA transit station...');
    const mx = campusX + CW + 30, mz = campusZ + 300;
    // Elevated platform
    await fill(mx, oy+1, mz, mx+4, oy+6, mz, 'gray_concrete'); // support pillar
    await fill(mx+20, oy+1, mz, mx+24, oy+6, mz, 'gray_concrete'); // support pillar
    await fill(mx, oy+1, mz+15, mx+4, oy+6, mz+15, 'gray_concrete');
    await fill(mx+20, oy+1, mz+15, mx+24, oy+6, mz+15, 'gray_concrete');
    // Platform deck
    await fill(mx-2, oy+7, mz-2, mx+26, oy+7, mz+17, 'smooth_stone');
    // Canopy roof
    await fill(mx-2, oy+11, mz-2, mx+26, oy+11, mz+17, 'light_gray_concrete');
    // Platform pillars
    for (let x = mx; x <= mx+24; x += 8) {
      await fill(x, oy+8, mz, x, oy+10, mz, 'iron_block');
      await fill(x, oy+8, mz+15, x, oy+10, mz+15, 'iron_block');
    }
    // Rail tracks
    await fill(mx+2, oy+7, mz+5, mx+22, oy+7, mz+5, 'rail');
    await fill(mx+2, oy+7, mz+10, mx+22, oy+7, mz+10, 'rail');
    // Warning lines
    await fill(mx+2, oy+7, mz+4, mx+22, oy+7, mz+4, 'yellow_concrete');
    await fill(mx+2, oy+7, mz+11, mx+22, oy+7, mz+11, 'yellow_concrete');
    // MARTA sign
    await fill(mx+8, oy+10, mz-2, mx+16, oy+10, mz-2, 'blue_concrete');
    await fill(mx+9, oy+10, mz-2, mx+15, oy+10, mz-2, 'gold_block');
    // Stairs up
    for (let dy = 0; dy < 7; dy++) {
      await fill(mx-3, oy+1+dy, mz+7+dy, mx-1, oy+1+dy, mz+7+dy, 'stone_brick_stairs');
    }
    count++;
    log(`[9] MARTA: ${count}`);

    // ═══════════════════════════════════════════
    // 10. FINAL POLISH — street signs, mailboxes, manholes
    // ═══════════════════════════════════════════
    log('[10] Final polish...');
    bot.chat('[10/10] Signs, mailboxes, manholes, curb detail...');

    // Manholes (iron trapdoors on roads)
    for (let i = 0; i < 40; i++) {
      const mx2 = campusX + ri(5, CW-5);
      const mz2 = pick([campusZ+52, campusZ+152, campusZ+252, campusZ+342]);
      await fill(mx2, oy, mz2, mx2, oy, mz2, 'iron_trapdoor');
      count++;
    }

    // Mailboxes (blue concrete + chest)
    for (let i = 0; i < 15; i++) {
      const mbx = campusX + ri(10, CW-10);
      const mbz = campusZ + ri(10, CD-10);
      await fill(mbx, oy+1, mbz, mbx, oy+2, mbz, 'blue_concrete');
      count++;
    }

    // Newspaper stands (note blocks)
    for (let i = 0; i < 12; i++) {
      const nx = campusX + ri(10, CW-10);
      const nz = campusZ + pick([48, 148, 248, 338]);
      await fill(nx, oy+1, nz, nx, oy+1, nz, 'note_block');
      count++;
    }

    log(`=== REALISM PASS 2 COMPLETE: ${count} features added ===`);
    bot.chat(`=== Realism complete! ${count} features: canal, shops, alleyways, gas station, church, hotel, hospital, subway, MARTA, park, sky bridges, rooftop details, food trucks, outdoor dining ===`);

    // TP player for aerial view
    bot.chat(`/tp alphasuperduper ${campusX+200} ${oy+100} ${campusZ-80} 0 30`);
    await sleep(3000);

    // Stay connected
    log('Builder staying connected.');

  } catch(e) { log('FATAL: '+e.message+'\n'+e.stack); }
});
bot.on('error', e => log('Err: '+e.message));
bot.on('kicked', r => { log('Kicked: '+JSON.stringify(r)); process.exit(1); });
bot.on('end', () => { log('Disconnected'); process.exit(0); });
