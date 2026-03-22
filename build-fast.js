// Fast blueprint builder — uses /setblock commands (not human-like placeBlock)
// Much faster for large blueprints (thousands of blocks)
const mineflayer = require('mineflayer');
const vec3 = require('vec3');
const fs = require('fs');

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
const BATCH = parseInt(getArg('batch', '20')); // commands per tick

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => { console.log(msg); fs.appendFileSync('/tmp/fast_build_log.txt', msg + '\n'); };

if (!FILE) { console.log('Usage: node build-fast.js --file blueprint.json [--clear] [--at x,y,z]'); process.exit(0); }

fs.writeFileSync('/tmp/fast_build_log.txt', '');

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const palette = data.palette || {};
const blocks = data.blocks.map(b => ({
  x: b.x, y: b.y, z: b.z,
  name: palette[b.b] || b.b || b.name || 'stone'
}));
// Sort bottom-up
blocks.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
log('[FAST] Loaded ' + blocks.length + ' blocks from ' + FILE);

const bot = mineflayer.createBot({ host: 'localhost', port: PORT, username: USERNAME, auth: 'offline', version: '1.21.11' });

let started = false;
bot.on('spawn', async () => {
  if (started) return; started = true;
  try {
    await sleep(3000);
    bot.chat('/gamemode creative'); await sleep(1000);

    // Find origin
    let origin;
    if (AT) {
      const [x, y, z] = AT.split(',').map(Number);
      origin = vec3(x, y, z);
    } else {
      bot.chat('/tp ' + USERNAME + ' alphasuperduper');
      await sleep(3000);
      origin = bot.entity.position.floored().offset(15, 0, 0);
    }
    log('[FAST] Origin: ' + origin);

    bot.chat('/gamerule doDaylightCycle false');
    bot.chat('/time set noon');
    await sleep(300);

    // Clear area
    if (CLEAR) {
      const maxX = Math.max(...blocks.map(b => Math.abs(b.x)));
      const maxY = Math.max(...blocks.map(b => b.y));
      const maxZ = Math.max(...blocks.map(b => Math.abs(b.z)));
      const r = Math.max(maxX, maxZ) + 5;
      // Clear in chunks (max 32768 blocks per fill)
      for (let yy = 0; yy <= maxY + 5; yy += 30) {
        bot.chat('/fill ' + (origin.x - r) + ' ' + (origin.y + yy) + ' ' + (origin.z - r) + ' ' +
          (origin.x + r) + ' ' + (origin.y + Math.min(yy + 29, maxY + 5)) + ' ' + (origin.z + r) + ' air');
        await sleep(200);
      }
      bot.chat('/fill ' + (origin.x - r) + ' ' + (origin.y - 1) + ' ' + (origin.z - r) + ' ' +
        (origin.x + r) + ' ' + (origin.y - 1) + ' ' + (origin.z + r) + ' smooth_stone');
      await sleep(500);
      log('[FAST] Cleared, radius=' + r);
    }

    bot.chat('Building ' + (data.name || FILE) + ' — ' + blocks.length + ' blocks via /setblock');

    // Place blocks using /setblock in batches
    let placed = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const x = origin.x + b.x, y = origin.y + b.y, z = origin.z + b.z;
      bot.chat('/setblock ' + x + ' ' + y + ' ' + z + ' ' + b.name);
      placed++;

      if (placed % BATCH === 0) {
        await sleep(50); // small pause every batch to avoid spam kick
      }
      if (placed % 500 === 0) {
        log('  [' + placed + '/' + blocks.length + ']');
        bot.chat('Progress: ' + placed + '/' + blocks.length);
        await sleep(100);
      }
    }

    log('[FAST] DONE! placed=' + placed);
    bot.chat('Build complete! ' + placed + ' blocks placed.');
    await sleep(2000);
    bot.quit();
  } catch (e) { log('FATAL: ' + e.message + '\n' + e.stack); bot.quit(); }
});
bot.on('error', e => log('Err: ' + e.message));
bot.on('kicked', r => { log('Kicked: ' + JSON.stringify(r)); process.exit(1); });
bot.on('end', () => { log('Done'); process.exit(0); });
