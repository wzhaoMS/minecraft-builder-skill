// capture-tower-tech-v4.js — Built on the EXACT setup that produced
// frame_070 (the beautiful TECH shot) but with:
//  - Tower made taller (24 tall instead of 12)
//  - TECH letters at the TOP of the tower, not midway
//  - Bot visibly flies to each gold block (two-bot setup)
//  - Longer hold on the final shot
const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const vec3 = require('vec3');

const FRAMES_DIR = '/tmp/ai-pivot/frames-v4';
const VIEWER_PORT = 3007;
const FRAME_INTERVAL_MS = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeTECH(startCol) {
  const blocks = [];
  let p = startCol;
  blocks.push([p, 4], [p + 1, 4], [p + 2, 4]);
  for (let y = 0; y < 5; y++) blocks.push([p + 1, y]);
  p += 4;
  for (let y = 0; y < 5; y++) blocks.push([p, y]);
  blocks.push([p + 1, 4], [p + 2, 4], [p + 1, 2], [p + 2, 2], [p + 1, 0], [p + 2, 0]);
  p += 4;
  for (let y = 0; y < 5; y++) blocks.push([p, y]);
  blocks.push([p + 1, 4], [p + 2, 4], [p + 1, 0], [p + 2, 0]);
  p += 4;
  for (let y = 0; y < 5; y++) blocks.push([p, y]);
  for (let y = 0; y < 5; y++) blocks.push([p + 3, y]);
  blocks.push([p + 1, 2], [p + 2, 2]);
  const seen = new Set();
  const out = [];
  for (const [px, dy] of blocks) {
    const k = px + ',' + dy;
    if (!seen.has(k)) { seen.add(k); out.push([px, dy]); }
  }
  return out;
}

(async () => {
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const camBot = mineflayer.createBot({
    host: 'localhost', port: 25566, username: 'CameraBot', auth: 'offline', version: '1.21.1',
  });
  await new Promise((res, rej) => { camBot.once('spawn', res); camBot.once('kicked', rej); camBot.once('error', rej); });
  console.log('[boot] CameraBot in');
  mineflayerViewer(camBot, { port: VIEWER_PORT, firstPerson: false });
  await sleep(5000);

  const buildBot = mineflayer.createBot({
    host: 'localhost', port: 25566, username: 'BuilderBot', auth: 'offline', version: '1.21.1',
  });
  await new Promise((res, rej) => { buildBot.once('spawn', res); buildBot.once('kicked', rej); buildBot.once('error', rej); });
  console.log('[boot] BuilderBot in');
  buildBot.chat('/gamemode creative');
  await sleep(400);
  // Enable flying so /tp positions stick (otherwise gravity makes bot fall)
  try { buildBot.creative.startFlying(); } catch (e) { console.log('[warn] startFlying failed:', e.message); }
  await sleep(200);

  // === EXACT proven coords. Tower 18 wide so TECH (16 cols wide) fits with 1-col padding.
  //     TECH letters near the TOP so there's tower body BELOW them.
  const TX = -2, TZ = -1;
  const TW = 18, TD = 8;
  const TY = 95;
  const TH = 14;
  const SOUTH_FACE_Z = TZ + TD - 1;
  const LY = TY + TH - 7;   // top-third: letters span TY+7..TY+11, body below TY+7

  // === Camera FAR back + HIGH enough to see the TECH letters at top of tower ===
  // Use proven camera position. Tower spans y=95..109 (14 tall), TECH at y=102..106.
  const camX = TX + TW / 2;
  const camY = TY + 6;
  const camZ = TZ + TD + 5;
  buildBot.chat(`/tp CameraBot ${camX} ${camY} ${camZ} 180 -5`);
  await sleep(300);

  buildBot.chat(`/tp BuilderBot ${TX + TW / 2} ${TY + 12} ${TZ + 4} 0 0`);
  await sleep(2500);

  console.log('[setup] modest pre-clear (only air above ground, not below) + tower');
  // Air bubble that ONLY goes from TY (ground level) upward (avoid water-flood)
  // Wider than before to wipe orphan brick from previous runs.
  // Split into 2 halves to stay under /fill's 32,768 block limit.
  buildBot.chat(`/fill ${TX - 12} ${TY + 1} ${TZ - 8} ${TX + TW + 12} ${TY + 10} ${TZ + TD + 22} air`);
  await sleep(300);
  buildBot.chat(`/fill ${TX - 12} ${TY + 11} ${TZ - 8} ${TX + TW + 12} ${TY + TH + 8} ${TZ + TD + 22} air`);
  await sleep(300);
  // Specifically wipe the TECH-letter plane (in case any leftover gold)
  buildBot.chat(`/fill ${TX - 2} ${LY - 1} ${SOUTH_FACE_Z + 1} ${TX + TW + 2} ${LY + 6} ${SOUTH_FACE_Z + 1} air`);
  await sleep(400);
  // Stone foundation (just under the tower footprint and a small plaza)
  buildBot.chat(`/fill ${TX - 2} ${TY - 1} ${TZ - 2} ${TX + TW + 1} ${TY - 1} ${TZ + TD + 1} stone`);
  await sleep(200);
  // Grass on top
  buildBot.chat(`/fill ${TX - 2} ${TY} ${TZ - 2} ${TX + TW + 1} ${TY} ${TZ + TD + 1} grass_block`);
  await sleep(200);
  // Stone-brick base (first 2 layers)
  buildBot.chat(`/fill ${TX - 1} ${TY + 1} ${TZ - 1} ${TX + TW} ${TY + 2} ${TZ + TD} stone_bricks hollow`);
  await sleep(200);
  // Tower body — bricks
  buildBot.chat(`/fill ${TX} ${TY + 3} ${TZ} ${TX + TW - 1} ${TY + TH - 1} ${TZ + TD - 1} bricks hollow`);
  await sleep(200);
  // Window strips on south face (vertical glass)
  for (let y = TY + 4; y < TY + TH - 9; y += 5) {
    buildBot.chat(`/setblock ${TX + 3} ${y} ${SOUTH_FACE_Z} glass`);
    buildBot.chat(`/setblock ${TX + 10} ${y} ${SOUTH_FACE_Z} glass`);
  }
  await sleep(200);
  // Stone-brick cornice band right above the brick body (where TECH sits)
  buildBot.chat(`/fill ${TX - 1} ${TY + TH} ${TZ - 1} ${TX + TW} ${TY + TH} ${TZ + TD} stone_bricks`);
  await sleep(200);
  // Pointed roof — 3 tapered layers + spike
  for (let r = 0; r < 4; r++) {
    const ax = TX + r, bx = TX + TW - 1 - r;
    const az = TZ + r, bz = TZ + TD - 1 - r;
    if (ax > bx || az > bz) break;
    buildBot.chat(`/fill ${ax} ${TY + TH + 1 + r} ${az} ${bx} ${TY + TH + 1 + r} ${bz} dark_oak_planks`);
    await sleep(80);
  }
  buildBot.chat(`/setblock ${TX + Math.floor(TW / 2)} ${TY + TH + 5} ${TZ + 3} dark_oak_planks`);
  buildBot.chat(`/setblock ${TX + Math.floor(TW / 2)} ${TY + TH + 5} ${TZ + 4} dark_oak_planks`);
  await sleep(800);

  // Re-pin camera and confirm view
  buildBot.chat(`/tp CameraBot ${camX} ${camY} ${camZ} 180 -5`);
  await sleep(1500);

  console.log('[puppeteer] launching');
  const browser = await puppeteer.launch({
    headless: 'new', defaultViewport: { width: 960, height: 720, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${VIEWER_PORT}/`, { waitUntil: 'domcontentloaded' });
  page.on('console', (m) => { const t = m.text(); if (t && !t.includes('Unknown entity') && !t.includes('404')) console.log('[viewer]', t.slice(0, 180)); });
  await sleep(5500);

  let frameIdx = 0;
  let stopCapture = false;
  const capturePromise = (async () => {
    while (!stopCapture) {
      const filename = path.join(FRAMES_DIR, `frame_${String(frameIdx).padStart(3, '0')}.png`);
      try { await page.screenshot({ path: filename, type: 'png' }); } catch (e) { /* ignore */ }
      frameIdx++;
      if (frameIdx % 25 === 0) console.log(`[cap] ${frameIdx}`);
      await sleep(FRAME_INTERVAL_MS);
    }
  })();

  // Hold 3 seconds on the empty tower (clear "before")
  await sleep(3000);

  // Equip gold
  const mcData = require('minecraft-data')(buildBot.version);
  const PI = require('prismarine-item')(buildBot.version);
  const goldItem = mcData.itemsByName['gold_block'];
  await buildBot.creative.setInventorySlot(36, new PI(goldItem.id, 64));
  await sleep(200);
  const goldStack = buildBot.inventory.items().find((i) => i.name === 'gold_block');
  if (goldStack) await buildBot.equip(goldStack, 'hand');

  const startCol = TX + 1;   // 1-col padding from left edge of wall
  const techPositions = makeTECH(startCol);
  // Sort in scan order: left-to-right, top-to-bottom (visual reading order)
  // dy is the row offset from bottom; we want top first so sort by -dy.
  techPositions.sort((a, b) => (a[0] - b[0]) || (b[1] - a[1]));
  console.log(`[place] ${techPositions.length} gold blocks (scan-order)`);
  console.log(`[place] ${techPositions.length} gold blocks on south face near top`);

  for (let i = 0; i < techPositions.length; i++) {
    const [px, dy] = techPositions[i];
    const tx = px;
    const ty = LY + dy;
    const tz = SOUTH_FACE_Z + 1;

    // /tp to position. yaw=180 in /tp is supposed to set body, but Paper or
    // prismarine-viewer may not honor it. We follow up with a raw packet.
    buildBot.chat(`/tp BuilderBot ${tx + 0.5} ${ty} ${tz + 1.5} 180 0`);
    await sleep(280);

    // RAW PACKET: send position_look directly from BuilderBot client to server.
    // This sets the player's body yaw at the protocol level. CameraBot's mineflayer
    // sees this via the entity rotation packet from the server.
    try {
      buildBot._client.write('position_look', {
        x: tx + 0.5,
        y: ty,
        z: tz + 1.5,
        yaw: 180,    // degrees, MC convention: 180 = facing -Z (north)
        pitch: 0,
        onGround: false,
      });
      // Also set internal mineflayer state so the next iteration starts clean
      buildBot.entity.yaw = Math.PI;
      buildBot.entity.pitch = 0;
    } catch (e) {
      console.log('[warn] raw packet failed:', e.message);
    }
    await sleep(300);

    try { buildBot.swingArm('right'); } catch (e) {}
    await sleep(100);

    buildBot.chat(`/setblock ${tx} ${ty} ${tz} gold_block`);
    await sleep(220);

    if ((i + 1) % 10 === 0) console.log(`[place] ${i + 1}/${techPositions.length}`);
  }

  console.log('[hold] glory shot 6 sec');
  // Move BuilderBot far away so it doesnt cover the tower in final frame
  buildBot.chat(`/tp BuilderBot ${TX + TW / 2} ${TY + 1} ${TZ + TD + 6} 180 0`);
  await sleep(6000);

  stopCapture = true;
  await capturePromise;
  console.log(`[done] ${frameIdx} frames in ${FRAMES_DIR}`);

  await browser.close();
  buildBot.end();
  camBot.end();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
