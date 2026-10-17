/**
 * Build planner: world-space Structure → ordered list of /fill and /setblock operations.
 *
 * Ordering (what makes builds come out right):
 *   phase 0  structural blocks, bottom-up (gravity blocks always have their support placed first)
 *   phase 1  support-dependent blocks (torches, doors, beds, plants, rails, signs, carpets…), bottom-up
 *   phase 2  fluids (water / lava) last so they don't flow before walls exist
 * Within a phase, operations are grouped by 64×64 tiles in serpentine order so the builder only
 * needs the chunks of one tile loaded at a time.
 */
import { Structure } from '../core/structure.js';
import { parseBlock, formatBlock } from '../core/blockstate.js';
import { placementPhase, isLeaves } from '../core/blockinfo.js';
import { greedyBoxes, boxVolume } from './greedy.js';

export const MAX_COMMAND_LENGTH = 256;

/**
 * Adjust block states for stable placement:
 *  - leaves get persistent=true unless specified (otherwise they decay away from logs)
 */
export function placementState(block) {
  if (isLeaves(block)) {
    const b = parseBlock(block);
    if (!('persistent' in b.props)) {
      b.props.persistent = 'true';
      return formatBlock(b);
    }
  }
  return block;
}

/**
 * @typedef {{ kind: 'fill'|'setblock', x1:number,y1:number,z1:number,x2:number,y2:number,z2:number,
 *             block: string, phase: number, tile: string, volume: number, cmd: string }} Op
 */

/**
 * @param {Structure} world structure in absolute world coordinates
 * @param {{ strict?: boolean, maxVolume?: number, tile?: number, clearBox?: number[]|null,
 *           singleBlocks?: boolean }} [opts]
 * @returns {{ ops: Op[], stats: object }}
 */
export function planBuild(world, opts = {}) {
  const { strict = false, maxVolume = 32768, tile = 64, clearBox = null, singleBlocks = false } = opts;
  // Re-map palette through placementState
  const s = new Structure({ name: world.name });
  const remap = world.palette.map((b) => (b == null ? 0 : s.idOf(placementState(b))));
  world.forEach((x, y, z, b, id) => s.setId(x, y, z, remap[id]));

  const boxes = singleBlocks ? unitBoxes(s) : greedyBoxes(s, { maxVolume, tile });
  const tileOf = (b) => `${Math.floor(b.x1 / tile)},${Math.floor(b.z1 / tile)}`;
  const tileOrder = serpentineOrder(boxes.map(tileOf));
  const ops = [];

  if (clearBox) {
    const [x1, y1, z1, x2, y2, z2] = clearBox;
    for (const b of splitBox({ x1, y1, z1, x2, y2, z2 }, maxVolume, tile)) {
      ops.push(makeOp(b, 'air', -1, tileOf(b), strict));
    }
  }

  for (const b of boxes) {
    const block = s.palette[b.id];
    ops.push(makeOp(b, block, placementPhase(block), tileOf(b), strict));
  }
  ops.sort((a, b) => a.phase - b.phase || (tileOrder.get(a.tile) ?? 0) - (tileOrder.get(b.tile) ?? 0) || a.y1 - b.y1 || a.z1 - b.z1 || a.x1 - b.x1);
  for (const op of ops) {
    if (op.cmd.length + 1 > MAX_COMMAND_LENGTH) {
      throw new Error(`Command too long (${op.cmd.length + 1} > ${MAX_COMMAND_LENGTH} chars): ${op.cmd.slice(0, 80)}… — shorten the block NBT.`);
    }
    if (op.volume > maxVolume) throw new Error(`internal: planned a ${op.volume}-block fill above the ${maxVolume} limit`);
  }
  const blocks = ops.filter((o) => o.phase >= 0).reduce((n, o) => n + o.volume, 0);
  return {
    ops,
    stats: {
      voxels: s.count,
      commands: ops.length,
      fills: ops.filter((o) => o.kind === 'fill').length,
      setblocks: ops.filter((o) => o.kind === 'setblock').length,
      blocks,
      compression: s.count ? +(s.count / Math.max(1, ops.length)).toFixed(1) : 0,
    },
  };
}

function makeOp(b, block, phase, tileKey, strict) {
  const single = b.x1 === b.x2 && b.y1 === b.y2 && b.z1 === b.z2;
  const suffix = strict ? ' strict' : '';
  const cmd = single
    ? `setblock ${b.x1} ${b.y1} ${b.z1} ${block}${suffix}`
    : `fill ${b.x1} ${b.y1} ${b.z1} ${b.x2} ${b.y2} ${b.z2} ${block}${suffix}`;
  return { kind: single ? 'setblock' : 'fill', x1: b.x1, y1: b.y1, z1: b.z1, x2: b.x2, y2: b.y2, z2: b.z2, block, phase, tile: tileKey, volume: boxVolume(b), cmd };
}

function unitBoxes(s) {
  const out = [];
  s.forEach((x, y, z, b, id) => out.push({ x1: x, y1: y, z1: z, x2: x, y2: y, z2: z, id }));
  return out;
}

/** Split an arbitrary box into tile-aligned pieces with volume ≤ maxVolume. */
export function splitBox(box, maxVolume = 32768, tile = 64) {
  const out = [];
  const x1 = Math.min(box.x1, box.x2), x2 = Math.max(box.x1, box.x2);
  const y1 = Math.min(box.y1, box.y2), y2 = Math.max(box.y1, box.y2);
  const z1 = Math.min(box.z1, box.z2), z2 = Math.max(box.z1, box.z2);
  for (let tx = Math.floor(x1 / tile) * tile; tx <= x2; tx += tile) {
    for (let tz = Math.floor(z1 / tile) * tile; tz <= z2; tz += tile) {
      const ax = Math.max(x1, tx), bx = Math.min(x2, tx + tile - 1);
      const az = Math.max(z1, tz), bz = Math.min(z2, tz + tile - 1);
      // if even one layer of the tile is too big (small server limits), cut it into strips first
      const w = bx - ax + 1, d = bz - az + 1;
      const stripD = w * d <= maxVolume ? d : Math.max(1, Math.floor(maxVolume / w));
      const stripW = w * Math.min(d, stripD) <= maxVolume ? w : Math.max(1, Math.floor(maxVolume / stripD));
      for (let sx = ax; sx <= bx; sx += stripW) {
        for (let sz = az; sz <= bz; sz += stripD) {
          const ex = Math.min(bx, sx + stripW - 1), ez = Math.min(bz, sz + stripD - 1);
          const area = (ex - sx + 1) * (ez - sz + 1);
          const layers = Math.max(1, Math.floor(maxVolume / area));
          for (let y = y1; y <= y2; y += layers) {
            out.push({ x1: sx, y1: y, z1: sz, x2: ex, y2: Math.min(y2, y + layers - 1), z2: ez });
          }
        }
      }
    }
  }
  return out;
}

/** Serpentine (boustrophedon) order over tile keys "tx,tz" to minimise travel between tiles. */
function serpentineOrder(keys) {
  const uniq = [...new Set(keys)].map((k) => k.split(',').map(Number));
  uniq.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const rows = new Map();
  for (const [tx, tz] of uniq) {
    if (!rows.has(tz)) rows.set(tz, []);
    rows.get(tz).push(tx);
  }
  const order = new Map();
  let i = 0, flip = false;
  for (const tz of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = rows.get(tz).sort((a, b) => a - b);
    if (flip) xs.reverse();
    for (const tx of xs) order.set(`${tx},${tz}`, i++);
    flip = !flip;
  }
  return order;
}

/** Tile bounds (x1,z1,x2,z2) for a tile key. */
export function tileBounds(key, tile = 64) {
  const [tx, tz] = key.split(',').map(Number);
  return { x1: tx * tile, z1: tz * tile, x2: tx * tile + tile - 1, z2: tz * tile + tile - 1 };
}
