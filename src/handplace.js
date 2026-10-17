/**
 * "Hand" mode: the bot flies over the build and places blocks one by one like a player
 * (visible, slow, great for demos). Blocks are placed bottom-up while the bot hovers two blocks
 * above the current block, so its path is always clear. Anything the bot can't place by hand
 * (no neighbour to click, no matching item, server refusal) is set with /setblock instead, and
 * block-state details (stair facing, slab half…) are corrected with /setblock afterwards.
 */
import { createRequire } from 'node:module';
import { blockName, isAir } from './core/blockstate.js';
import { placementPhase } from './core/blockinfo.js';
import { placementState } from './compile/plan.js';
import { blockMatches } from './build.js';

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ITEM_FOR = {
  wall_torch: 'torch', soul_wall_torch: 'soul_torch', redstone_wall_torch: 'redstone_torch', copper_wall_torch: 'copper_torch',
  redstone_wire: 'redstone', water: 'water_bucket', lava: 'lava_bucket', tripwire: 'string', cocoa: 'cocoa_beans',
  wheat: 'wheat_seeds', carrots: 'carrot', potatoes: 'potato', beetroots: 'beetroot_seeds', pumpkin_stem: 'pumpkin_seeds',
  melon_stem: 'melon_seeds', sweet_berry_bush: 'sweet_berries', cave_vines: 'glow_berries', bamboo_sapling: 'bamboo',
  kelp_plant: 'kelp', twisting_vines_plant: 'twisting_vines', weeping_vines_plant: 'weeping_vines', tall_seagrass: 'seagrass',
};

function itemName(name) {
  if (ITEM_FOR[name]) return ITEM_FOR[name];
  if (/_wall_sign$/.test(name)) return name.replace('_wall_sign', '_sign');
  if (/_wall_hanging_sign$/.test(name)) return name.replace('_wall_hanging_sign', '_hanging_sign');
  if (/_wall_banner$/.test(name)) return name.replace('_wall_banner', '_banner');
  if (/_wall_head$|_wall_skull$/.test(name)) return name.replace('_wall_', '_');
  if (/_wall_fan$/.test(name)) return name.replace('_wall_fan', '_fan');
  if (/^potted_/.test(name)) return null;
  return name;
}

const FACES = [
  [0, -1, 0], // reference below → click its top face
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  [0, 1, 0],
];

/**
 * @param {import('./transport/bot.js').BotTransport} transport
 * @param {import('./core/structure.js').Structure} world absolute coordinates
 */
export async function handPlace(transport, world, { bps = 8, onProgress = () => {}, log = () => {} } = {}) {
  if (transport.kind !== 'bot') throw new Error('Hand mode needs the bot transport');
  const bot = transport.bot;
  const V = require('vec3').Vec3;
  const mcData = require('minecraft-data')(bot.version);
  const Item = require('prismarine-item')(bot.version);

  const list = [];
  world.forEach((x, y, z, b) => list.push({ x, y, z, block: placementState(b), phase: isAir(b) ? -1 : placementPhase(b) }));
  list.sort((a, b) => a.phase - b.phase || a.y - b.y || a.z - b.z || ((a.z & 1) ? b.x - a.x : a.x - b.x));

  // Clear air first with plain commands (not interesting to watch).
  const air = list.filter((v) => v.phase === -1);
  if (air.length) await transport.run(air.map((v) => `setblock ${v.x} ${v.y} ${v.z} air`), {});

  const stats = { placedByHand: 0, setblock: 0, corrected: 0 };
  const solids = list.filter((v) => v.phase >= 0);
  let held = null;
  const minDelay = 1000 / Math.max(1, bps);
  let lastArea = null;

  const tStart = Date.now();
  for (let i = 0; i < solids.length; i++) {
    const t0 = Date.now();
    const v = solids[i];
    const target = new V(v.x, v.y, v.z);
    const name = blockName(v.block);
    const areaKey = `${Math.floor(v.x / 64)},${Math.floor(v.z / 64)}`;
    if (areaKey !== lastArea) {
      await transport.loadArea({ x1: v.x - 16, z1: v.z - 16, x2: v.x + 16, z2: v.z + 16 }, { topY: v.y });
      lastArea = areaKey;
    }
    let done = false;
    const item = itemName(name);
    const itemDef = item ? mcData.itemsByName[item] : null;
    if (v.phase === 0 && itemDef) {
      let ref = null, face = null;
      for (const [dx, dy, dz] of FACES) {
        const nb = bot.blockAt(target.offset(dx, dy, dz));
        if (nb && nb.boundingBox === 'block' && !isAir(nb.name)) { ref = nb; face = new V(-dx, -dy, -dz); break; }
      }
      if (ref) {
        try {
          const hover = new V(v.x + 0.5, v.y + 2, v.z + 0.5);
          if (bot.entity.position.distanceTo(hover) > 12) await transport.command(`tp @s ${hover.x} ${hover.y} ${hover.z}`, { allowErrors: true });
          else await withTimeout(bot.creative.flyTo(hover), 3000).catch(() => {});
          if (held !== item) {
            await bot.creative.setInventorySlot(36, new Item(itemDef.id, 64));
            await bot.equip(itemDef.id, 'hand').catch(() => {});
            held = item;
          }
          await bot.lookAt(ref.position.offset(0.5 + face.x * 0.5, 0.5 + face.y * 0.5, 0.5 + face.z * 0.5), true);
          await withTimeout(bot.placeBlock(ref, face), 2500);
          stats.placedByHand++;
          done = true;
        } catch {
          done = false;
        }
      }
    }
    if (!done) {
      try { bot.swingArm('right'); } catch { /* ignore */ }
      await transport.command(`setblock ${v.x} ${v.y} ${v.z} ${v.block}`, { allowErrors: true });
      stats.setblock++;
    } else {
      // fix orientation / state if the hand placement chose differently
      await sleep(30);
      const actual = transport.readBlock(v.x, v.y, v.z);
      if (!blockMatches(v.block, actual, { strict: true })) {
        await transport.command(`setblock ${v.x} ${v.y} ${v.z} ${v.block}`, { allowErrors: true });
        stats.corrected++;
      }
    }
    const perBlock = (Date.now() - tStart) / (i + 1);
    onProgress({ stage: 'build', done: i + 1, total: solids.length, blocksDone: i + 1, blocksTotal: solids.length, etaMs: Math.round((solids.length - i - 1) * Math.max(perBlock, minDelay)) });
    const wait = minDelay - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  log(`hand mode: ${stats.placedByHand} placed by hand, ${stats.setblock} via /setblock, ${stats.corrected} corrected`);
  return stats;
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}
