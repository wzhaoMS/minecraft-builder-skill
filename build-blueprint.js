/**
 * Generic Blueprint Builder — builds any structure from a blueprint file.
 *
 * Blueprint formats supported:
 *   1. JSON: { blocks: [{x, y, z, name}], palette: {alias: "mc_block_name"} }
 *   2. .schem/.schematic: Sponge/MCEdit format (via prismarine-schematic)
 *
 * Usage:
 *   node build-blueprint.js [options]
 *
 * Options:
 *   --port 25566          Server port (default: 25566)
 *   --file blueprint.json Blueprint file (.json, .schem, .schematic)
 *   --near-player         Build near the player (default)
 *   --at x,y,z            Build at specific coordinates
 *   --clear               Clear the area before building
 *   --clear-radius 30     Radius to clear (default: auto from blueprint size)
 *   --verify              Verify each block after placement
 *   --username BuilderBot Bot username (default: BuilderBot)
 *
 * JSON Blueprint Format:
 *   {
 *     "name": "My House",
 *     "palette": {
 *       "W": "white_concrete",
 *       "R": "red_concrete",
 *       "G": "glass"
 *     },
 *     "blocks": [
 *       {"x": 0, "y": 0, "z": 0, "b": "W"},
 *       {"x": 1, "y": 0, "z": 0, "b": "R"}
 *     ]
 *   }
 *
 * Or generate blocks programmatically in a "generator" field:
 *   {
 *     "name": "Sphere",
 *     "generator": "sphere",
 *     "params": { "radius": 10, "material": "glass" }
 *   }
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear } = goals;
const vec3 = require('vec3');
const fs = require('fs');
const path = require('path');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
function hasFlag(name) { return args.includes('--' + name); }

const PORT = parseInt(getArg('port', '25566'));
const FILE = getArg('file', null);
const USERNAME = getArg('username', 'BuilderBot');
const AT = getArg('at', null);
const CLEAR = hasFlag('clear');
const VERIFY = hasFlag('verify');
const CLEAR_RADIUS = parseInt(getArg('clear-radius', '0'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
function isAir(b) { return !b || b.name === 'air' || b.name === 'void_air' || b.name === 'cave_air'; }
const log = msg => { console.log(msg); fs.appendFileSync('/tmp/blueprint_log.txt', msg + '\n'); };

// ── Load blueprint ──
async function loadBlueprint(file, mcData) {
  const ext = path.extname(file).toLowerCase();

  if (ext === '.json') {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    log('[BP] Loaded JSON: ' + (data.name || file));

    if (data.generator) {
      return generateBlocks(data.generator, data.params || {});
    }

    const palette = data.palette || {};
    return data.blocks.map(b => ({
      x: b.x, y: b.y, z: b.z,
      name: palette[b.b] || b.b || b.name || 'stone'
    }));
  }

  if (ext === '.schem' || ext === '.schematic') {
    const { Schematic } = require('prismarine-schematic');
    const buf = fs.readFileSync(file);
    const schem = await Schematic.read(buf);
    log('[BP] Loaded schematic: ' + schem.size + ' size');

    const blocks = [];
    schem.forEach((block, pos) => {
      if (block.name !== 'air') {
        blocks.push({ x: pos.x, y: pos.y, z: pos.z, name: block.name });
      }
    });
    return blocks;
  }

  throw new Error('Unknown file format: ' + ext);
}

// ── Built-in generators ──
function generateBlocks(type, params) {
  const blocks = [];
  const mat = params.material || 'white_concrete';

  switch (type) {
    case 'sphere': {
      const r = params.radius || 5;
      for (let x = -r; x <= r; x++)
        for (let y = -r; y <= r; y++)
          for (let z = -r; z <= r; z++) {
            const d = Math.sqrt(x * x + y * y + z * z);
            if (d <= r + 0.5 && d >= r - 0.5)
              blocks.push({ x, y: y + r, z, name: mat });
          }
      break;
    }
    case 'pyramid': {
      const h = params.height || 10;
      for (let y = 0; y < h; y++) {
        const w = h - y;
        for (let x = -w; x <= w; x++)
          for (let z = -w; z <= w; z++) {
            if (Math.abs(x) === w || Math.abs(z) === w || y === 0)
              blocks.push({ x, y, z, name: mat });
          }
      }
      break;
    }
    case 'wall': {
      const w = params.width || 10, h = params.height || 5;
      for (let x = 0; x < w; x++)
        for (let y = 0; y < h; y++)
          blocks.push({ x, y, z: 0, name: mat });
      break;
    }
    case 'house': {
      const w = params.width || 8, d = params.depth || 8, h = params.height || 5;
      const wall = params.wall || 'red_concrete';
      const roof = params.roof || 'dark_oak_planks';
      const floor = params.floor || 'stone_bricks';
      // Floor
      for (let x = 0; x < w; x++) for (let z = 0; z < d; z++)
        blocks.push({ x, y: 0, z, name: floor });
      // Walls
      for (let y = 1; y < h; y++) {
        for (let x = 0; x < w; x++) {
          blocks.push({ x, y, z: 0, name: wall });
          blocks.push({ x, y, z: d - 1, name: wall });
        }
        for (let z = 1; z < d - 1; z++) {
          blocks.push({ x: 0, y, z, name: wall });
          blocks.push({ x: w - 1, y, z, name: wall });
        }
      }
      // Door (gap)
      blocks.splice(blocks.findIndex(b => b.x === Math.floor(w / 2) && b.y === 1 && b.z === 0), 1);
      blocks.splice(blocks.findIndex(b => b.x === Math.floor(w / 2) && b.y === 2 && b.z === 0), 1);
      // Roof
      for (let x = -1; x <= w; x++) for (let z = -1; z <= d; z++)
        blocks.push({ x, y: h, z, name: roof });
      break;
    }
    default:
      throw new Error('Unknown generator: ' + type);
  }

  return blocks;
}

// ── Main ──
async function main() {
  if (!FILE) {
    console.log('Usage: node build-blueprint.js --file <blueprint.json|.schem>');
    console.log('       node build-blueprint.js --file sphere.json --clear --near-player');
    console.log('\nExample sphere.json:');
    console.log(JSON.stringify({ name: "Glass Sphere", generator: "sphere", params: { radius: 8, material: "glass" } }, null, 2));
    process.exit(0);
  }

  fs.writeFileSync('/tmp/blueprint_log.txt', '');

  const bot = mineflayer.createBot({ host: 'localhost', port: PORT, username: USERNAME, auth: 'offline', version: '1.21.11' });
  bot.loadPlugin(pathfinder);

  let started = false;
  bot.on('spawn', async () => {
    if (started) return; started = true;
    try {
      await sleep(3000);
      const mcData = require('minecraft-data')(bot.version);
      const mv = new Movements(bot, mcData);
      mv.allowFreeMotion = true;
      mv.canDig = false;
      bot.pathfinder.setMovements(mv);
      bot.chat('/gamemode creative'); await sleep(1000);

      // Load blueprint
      const rawBlocks = await loadBlueprint(FILE, mcData);
      log('[BP] ' + rawBlocks.length + ' blocks loaded');

      // Deduplicate + sort bottom-up
      const seen = new Set(), blocks = [];
      for (const b of rawBlocks) {
        const k = b.x + ',' + b.y + ',' + b.z;
        if (!seen.has(k)) { seen.add(k); blocks.push(b); }
      }
      blocks.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);

      // Find origin
      let origin;
      if (AT) {
        const [x, y, z] = AT.split(',').map(Number);
        origin = vec3(x, y, z);
      } else {
        // Near player
        bot.chat('/tp ' + USERNAME + ' alphasuperduper');
        await sleep(3000);
        origin = bot.entity.position.floored().offset(15, 0, 0);
      }
      log('[BP] Origin: ' + origin);

      // Clear area if requested
      if (CLEAR) {
        const maxX = Math.max(...blocks.map(b => Math.abs(b.x)));
        const maxY = Math.max(...blocks.map(b => b.y));
        const maxZ = Math.max(...blocks.map(b => Math.abs(b.z)));
        const r = CLEAR_RADIUS || Math.max(maxX, maxZ) + 5;
        const h = maxY + 5;

        bot.chat('/fill ' + (origin.x - r) + ' ' + origin.y + ' ' + (origin.z - r) + ' ' + (origin.x + r) + ' ' + (origin.y + h) + ' ' + (origin.z + r) + ' air');
        await sleep(1000);
        bot.chat('/fill ' + (origin.x - r) + ' ' + (origin.y - 1) + ' ' + (origin.z - r) + ' ' + (origin.x + r) + ' ' + (origin.y - 1) + ' ' + (origin.z + r) + ' smooth_stone');
        await sleep(500);
        log('[BP] Area cleared, radius=' + r);
      }

      bot.chat('/gamerule doDaylightCycle false');
      bot.chat('/time set noon');
      await sleep(300);

      bot.chat('Building ' + (rawBlocks.name || FILE) + ' — ' + blocks.length + ' blocks!');
      log('[BP] Building ' + blocks.length + ' blocks');

      // Build
      const PI = require('prismarine-item')(bot.version);
      let placed = 0, failed = 0, curMat = null;

      for (const bl of blocks) {
        const target = origin.offset(bl.x, bl.y, bl.z);
        let ex = bot.blockAt(target);
        if (ex && !isAir(ex)) { placed++; continue; }

        // Find ref
        const dirs = [vec3(0, -1, 0), vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 0, 1), vec3(0, 0, -1), vec3(0, 1, 0)];
        let ref = null, face = null;
        for (const d of dirs) { const r = bot.blockAt(target.plus(d)); if (r && !isAir(r)) { ref = r; face = target.minus(r.position); break; } }

        if (!ref) {
          bot.chat('/setblock ' + target.x + ' ' + (target.y - 1) + ' ' + target.z + ' smooth_stone');
          await sleep(100);
          ref = bot.blockAt(target.offset(0, -1, 0));
          face = vec3(0, 1, 0);
          if (!ref || isAir(ref)) { failed++; continue; }
        }

        try {
          // Move away if too close
          const bp = bot.entity.position;
          if (Math.abs(bp.x - target.x) < 1 && Math.abs(bp.y - target.y) < 2 && Math.abs(bp.z - target.z) < 1) {
            bot.chat('/tp ' + USERNAME + ' ' + (target.x + 3) + ' ' + (target.y + 1) + ' ' + target.z);
            await sleep(300);
          }

          const dist = bot.entity.position.distanceTo(target);
          if (dist > 4.5) {
            try { await bot.pathfinder.goto(new GoalNear(target.x, target.y, target.z, 3)); }
            catch (e) { bot.chat('/tp ' + USERNAME + ' ' + (target.x + 3) + ' ' + (target.y + 1) + ' ' + target.z); await sleep(300); }
            await sleep(80);
          }

          // Equip
          const matName = bl.name;
          if (curMat !== matName) {
            const item = mcData.itemsByName[matName];
            if (item) { await bot.creative.setInventorySlot(36, new PI(item.id, 64)); await sleep(80); }
            curMat = matName;
          }
          const held = bot.inventory.items().find(i => i.name === matName);
          if (held) await bot.equip(held, 'hand');

          // Look + place
          const cp = ref.position.offset(0.5, 0.5, 0.5).plus(vec3(face.x * 0.5, face.y * 0.5, face.z * 0.5));
          await bot.lookAt(cp); await sleep(30);
          await bot.placeBlock(ref, face); await sleep(20);

          // Verify
          if (VERIFY) {
            const check = bot.blockAt(target);
            if (check && !isAir(check)) placed++; else failed++;
          } else {
            placed++;
          }
        } catch (e) { failed++; }

        if ((placed + failed) % 100 === 0 && placed > 0) {
          log('  [' + placed + '/' + blocks.length + '] failed=' + failed);
          bot.chat('Progress: ' + placed + '/' + blocks.length);
        }
        await sleep(30);
      }

      log('[BP] DONE placed=' + placed + ' failed=' + failed + ' total=' + blocks.length);
      bot.chat('Build complete! ' + placed + '/' + blocks.length + ' placed');
      await sleep(2000);
      bot.quit();
    } catch (e) { log('FATAL: ' + e.message); bot.quit(); }
  });

  bot.on('error', e => log('Err: ' + e.message));
  bot.on('kicked', r => { log('Kicked: ' + JSON.stringify(r)); process.exit(1); });
  bot.on('end', () => { log('Done'); process.exit(0); });
}

main();
