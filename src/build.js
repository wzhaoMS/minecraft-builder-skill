/**
 * Build orchestration:
 *   lint → place (dimension, anchor, facing) → plan → [read-only: snapshot, impact, safety checks]
 *   → execute (tile by tile, acknowledged, quiet) → verify (+ one repair pass) → report.
 *
 * Safety contract
 *  - Nothing is changed in the world until the blueprint is valid, the placement fits the world,
 *    and (with a transport that can read blocks) the undo snapshot was captured completely.
 *  - Blocks holding data undo can't restore (chests, signs, barrels…) are never overwritten
 *    without `force`.
 *  - Every operation is an absolute, idempotent state assignment (fill/setblock), so a batch can
 *    safely be re-sent after a reconnect.
 */
import { Structure } from './core/structure.js';
import { lintStructure } from './core/lint.js';
import { parseBlock, blockName, isAir } from './core/blockstate.js';
import { planBuild, placementState, tileBounds } from './compile/plan.js';
import { resolvePlacement, checkPlacementOptions } from './placement.js';
import { captureRegion, saveSnapshot, newSnapshotId } from './snapshot.js';
import { withGamerules, recoverGamerules, getGamerule } from './gamerules.js';
import { defaultProps } from './core/blockinfo.js';
import { parseSnbt } from './io/formats/nbt-util.js';

export const REPORT_SCHEMA = 'mcb.build-report/1';

export class BuildError extends Error {
  constructor(message, { code = 'BUILD_ERROR', hint, details } = {}) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

export const DIMENSIONS = {
  overworld: { id: 'minecraft:overworld', minY: -64, maxY: 319 },
  the_nether: { id: 'minecraft:the_nether', minY: 0, maxY: 255 },
  the_end: { id: 'minecraft:the_end', minY: 0, maxY: 255 },
};
export const WORLD_MIN_Y = DIMENSIONS.overworld.minY;
export const WORLD_MAX_Y = DIMENSIONS.overworld.maxY;

export function normalizeDimension(d) {
  const k = String(d).toLowerCase().replace(/^minecraft:/, '').replace(/^nether$/, 'the_nether').replace(/^end$/, 'the_end');
  if (!DIMENSIONS[k]) throw new BuildError(`Unknown dimension "${d}" (overworld | the_nether | the_end)`, { code: 'BAD_DIMENSION' });
  return k;
}

/** "the Overworld" / "the Nether" / "the End" */
export const dimensionLabel = (d) => ({ overworld: 'the Overworld', the_nether: 'the Nether', the_end: 'the End' })[d] ?? d;

/**
 * Check build options before connecting or touching the world. Throws a BuildError
 * (code BAD_OPTION / BAD_MODE / BAD_DIMENSION) describing the first problem.
 */
export function validateBuildOptions(o = {}) {
  if (o.mode != null && !['fill', 'layered', 'hand'].includes(o.mode)) throw new BuildError(`Unknown mode "${o.mode}" (fill|layered|hand)`, { code: 'BAD_MODE' });
  if (o.dimension != null) normalizeDimension(o.dimension);
  try {
    checkPlacementOptions(o);
  } catch (e) {
    throw new BuildError(e.message, { code: e.code ?? 'BAD_OPTION' });
  }
  if (o.bps != null && !(Number.isFinite(o.bps) && o.bps > 0)) throw new BuildError(`Invalid bps "${o.bps}": use a number of blocks per second above 0`, { code: 'BAD_OPTION' });
  if (o.clear != null && typeof o.clear !== 'boolean' && !(Number.isInteger(o.clear) && o.clear >= 0 && o.clear <= 64)) {
    throw new BuildError(`Invalid clear margin "${o.clear}": use a whole number of blocks from 0 to 64`, { code: 'BAD_OPTION' });
  }
  if (o.at != null && !(Array.isArray(o.at) && o.at.length === 3 && o.at.every(Number.isFinite))) throw new BuildError(`Invalid at ${JSON.stringify(o.at)}: use [x, y, z]`, { code: 'BAD_OPTION' });
}

const TILE = 64;
const RECOVERABLE = new Set(['ENDED', 'ACK_TIMEOUT', 'RCON_CLOSED', 'RCON_TIMEOUT']);

// Properties the game recomputes from neighbours or time — compared only in strict mode.
const DYNAMIC_PROPS = new Set(['north', 'south', 'east', 'west', 'up', 'down', 'distance', 'power', 'powered', 'occupied', 'attached', 'in_wall', 'snowy', 'note', 'instrument', 'triggered', 'enabled', 'has_book', 'has_record', 'lit', 'signal_fire', 'berries', 'age', 'stage', 'level', 'moisture', 'honey_level', 'bottom', 'drag', 'tilt', 'thickness', 'sculk_sensor_phase', 'dusted']);
const STAIR_SHAPE_RE = /_stairs$/;
// Defaults the game may change on its own when the property is left implicit.
const IMPLICIT_DYNAMIC = (name, k) => DYNAMIC_PROPS.has(k) || (k === 'shape' && /(_stairs|rail)$/.test(name)) || (k === 'type' && /chest$/.test(name));

// Blocks whose contents (items, text, records, bees…) an undo snapshot cannot restore.
const CONTENT_RE = /(^chest$|^trapped_chest$|^barrel$|shulker_box$|^furnace$|^blast_furnace$|^smoker$|^hopper$|^dispenser$|^dropper$|^brewing_stand$|^lectern$|^jukebox$|^chiseled_bookshelf$|^decorated_pot$|^crafter$|^beehive$|^bee_nest$|spawner$|^vault$|command_block$|_shelf$)/;
export const holdsContents = (block) => block != null && CONTENT_RE.test(blockName(block));

/**
 * Blocks the game legitimately turns into something else shortly after placement (random ticks,
 * neighbour updates). Outside strict mode these count as a match instead of being "repaired" in a
 * loop that fights the game.
 */
const NATURAL_DECAY = {
  grass_block: ['dirt'], mycelium: ['dirt'], podzol: ['dirt'], farmland: ['dirt'], dirt_path: ['dirt'],
  ice: ['water'], frosted_ice: ['water'], snow: ['air'], fire: ['air'], soul_fire: ['air'],
};
for (const c of ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']) {
  NATURAL_DECAY[`${c}_concrete_powder`] = [`${c}_concrete`];
}

const parsedCache = new Map();
function parseCached(b) {
  let p = parsedCache.get(b);
  if (!p) {
    p = parseBlock(b);
    if (parsedCache.size > 20000) parsedCache.clear();
    parsedCache.set(b, p);
  }
  return p;
}

/**
 * Does the world block `actual` satisfy the blueprint block `expected`?
 * Properties left out of `expected` mean "Minecraft's default" (bare `oak_stairs` is a north-facing
 * bottom stair), except ones the game may recompute (connections, stair shape, chest pairing…).
 * Outside strict mode, dynamic properties and natural decay (grass → dirt…) are tolerated.
 */
export function blockMatches(expected, actual, { strict = false } = {}) {
  if (actual == null) return false;
  if (isAir(expected)) return isAir(actual);
  const e = parseCached(expected), a = parseCached(actual);
  if (e.name !== a.name) return !strict && (NATURAL_DECAY[e.name]?.includes(a.name) ?? false);
  for (const [k, v] of Object.entries(e.props)) {
    if (!strict && (DYNAMIC_PROPS.has(k) || (k === 'shape' && STAIR_SHAPE_RE.test(e.name)))) continue;
    if (a.props[k] !== undefined && String(a.props[k]) !== String(v)) return false;
  }
  const defs = defaultProps(e.name);
  if (defs) {
    for (const [k, dv] of Object.entries(defs)) {
      if (k in e.props || IMPLICIT_DYNAMIC(e.name, k)) continue;
      if (a.props[k] !== undefined && String(a.props[k]) !== dv) return false;
    }
  }
  return true;
}

function unionBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])];
}

const inBox = (box, x, y, z) => !!box && x >= box[0] && x <= box[3] && y >= box[1] && y <= box[4] && z >= box[2] && z <= box[5];

// Grass-like blocks turn into dirt as soon as something solid covers them; when the blueprint
// itself covers them, dirt there is "already built" (re-placing grass would just decay again).
export const DECAYS_UNDER_COVER = new Set(['grass_block', 'mycelium', 'podzol', 'dirt_path', 'farmland']);

/**
 * `want` at x,y,z (target) is satisfied by world block `cur`, allowing for decay under cover: the
 * build's own block above it, or (where the build leaves the block above alone) whatever the world
 * already has there — another build's house, a player's wall. Block data the blueprint asks for
 * (sign text, banner patterns…) must be there too, so a changed text is never "already built".
 */
function alreadyThere(want, cur, x, y, z, target, world) {
  if (blockMatches(want, cur, { strict: true })) return nbtSatisfied(want, cur);
  if (!DECAYS_UNDER_COVER.has(blockName(want)) || blockName(cur) !== 'dirt' || !target) return false;
  const above = target.get(x, y + 1, z) ?? world?.get(x, y + 1, z);
  return above != null && !isAir(above);
}

/** Does the world block carry (at least) the NBT the wanted block specifies? */
export function nbtSatisfied(want, cur) {
  const w = nbtPart(want);
  if (!w) return true;
  const c = nbtPart(cur);
  if (!c) return false; // unknown (not readable): send it again rather than assume
  if (w === c) return true;
  try {
    return tagSubset(parseSnbt(w), parseSnbt(c));
  } catch {
    return false;
  }
}

const nbtPart = (block) => {
  const i = String(block).indexOf('{');
  return i < 0 ? null : String(block).slice(i);
};

function tagSubset(a, b) {
  if (!a || !b) return false;
  if (a.type === 'compound') {
    if (b.type !== 'compound') return false;
    return Object.entries(a.value).every(([k, v]) => tagSubset(v, b.value[k]));
  }
  if (a.type === 'list') {
    if (b.type !== 'list' || a.value.value.length !== b.value.value.length) return false;
    return a.value.value.every((v, i) => tagSubset({ type: a.value.type, value: v }, { type: b.value.type, value: b.value.value[i] }));
  }
  return JSON.stringify(a.value) === JSON.stringify(b.value);
}

/**
 * @param {object} o
 * @param {Structure} o.structure blueprint (relative coordinates)
 * @param {object} o.transport connected transport (bot | rcon | dry-run)
 * @returns {Promise<object>} report (see REPORT_SCHEMA)
 */
export async function executeBuild(o) {
  const t0 = Date.now();
  const log = o.log ?? (() => {});
  const progress = o.onProgress ?? (() => {});
  const transport = o.transport;
  const version = o.version ?? transport.version ?? undefined;
  const report = {
    schema: REPORT_SCHEMA, ok: false, status: 'failed', name: o.structure.name, transport: transport.kind,
    serverVersion: transport.version ?? null, warnings: [...(transport.notes ?? []), ...(o.notes ?? [])],
  };
  validateBuildOptions(o);

  // 1. lint (no world access yet: invalid input ⇒ zero mutations)
  const structure = o.structure.clone();
  const lint = lintStructure(structure, { version: version || undefined, fix: o.fixMultiblocks !== false });
  report.lint = { fixes: lint.fixes, warnings: lint.warnings };
  if (!lint.ok && !o.force) {
    throw new BuildError(`Blueprint has ${lint.errors.length} invalid block state(s): ` + lint.errors.map((e) => e.errors.join('; ')).join(' | '), {
      code: 'BLUEPRINT_INVALID', hint: 'Fix the block names (see suggestions) — `mcb validate` lists every problem.', details: lint.errors,
    });
  }

  // 2. dimension + placement
  let dimension = o.dimension ? normalizeDimension(o.dimension) : null;
  let pose = null;
  if (!o.at && o.near) {
    pose = await transport.playerPose(o.near);
    if (!pose) {
      throw new BuildError(`Cannot locate player "${o.near}" with the ${transport.kind} transport`, {
        code: 'NO_PLAYER',
        hint: transport.kind === 'dry-run'
          ? 'A dry run does not connect to the server, so it cannot see players: pass --at x,y,z (from `mcb where <player>`), or use `mcb plan --near <player>` for a read-only check against the live world.'
          : 'Use --at x,y,z instead.',
      });
    }
    if (pose.dimension) {
      const playerDim = String(pose.dimension).replace(/^minecraft:/, '');
      if (!dimension) dimension = normalizeDimension(pose.dimension);
      else if (playerDim !== dimension) {
        report.warnings.push(`${o.near} is in ${dimensionLabel(playerDim)}, but the build goes to ${dimensionLabel(dimension)} (dimension was given) at their coordinates`);
      }
    }
  }
  dimension ??= 'overworld';
  const dim = DIMENSIONS[dimension];
  report.dimension = dimension;
  transport.setDimension?.(dim.id);
  const placement = resolvePlacement(structure, { at: o.at, anchor: o.anchor, facing: o.facing, rotate: o.rotate, mirror: o.mirror, pose, gap: o.gap, side: o.side });
  let world = placement.world;
  const bb = placement.bbox;
  report.origin = placement.origin;
  report.facing = placement.facing;
  report.box = [...bb.min, ...bb.max];
  report.size = bb.size;

  // ground + clear
  let clearBox = null;
  if (o.ground) {
    const m = Number.isInteger(o.clear) ? o.clear : 2;
    world = world.clone();
    world.fill(bb.min[0] - m, bb.min[1] - 1, bb.min[2] - m, bb.max[0] + m, bb.min[1] - 1, bb.max[2] + m, o.ground, { mode: 'keep' });
  }
  if (o.clear) {
    const m = Number.isInteger(o.clear) ? o.clear : 2;
    clearBox = [bb.min[0] - m, bb.min[1], bb.min[2] - m, bb.max[0] + m, Math.min(dim.maxY, bb.max[1] + m), bb.max[2] + m];
  }
  // Live editing (mcb watch): blocks that were in the previous version but not in this one go
  // back to what the world had before the first build.
  const designWorld = world;
  if (o.previousWorld) {
    let restored = 0;
    o.previousWorld.forEach((x, y, z) => {
      if (designWorld.has(x, y, z)) return;
      if (world === designWorld) world = designWorld.clone();
      world.set(x, y, z, o.baseline?.get(x, y, z) ?? 'air');
      restored++;
    });
    report.restored = restored;
  }
  Object.defineProperty(report, 'world', { value: designWorld, enumerable: false });
  const wb = world.bounds();
  const modBox = unionBox([...wb.min, ...wb.max], clearBox);
  report.affectedBox = modBox;
  if (modBox[1] < dim.minY || modBox[4] > dim.maxY) {
    const msg = `Build spans y=${modBox[1]}..${modBox[4]}, outside the ${dimension} height limits (${dim.minY}..${dim.maxY})`;
    if (!o.force) throw new BuildError(msg, { code: 'OUT_OF_WORLD', hint: 'Lower/raise --at y, or pass --force to build the part that fits.' });
    report.warnings.push(msg);
  }

  // 3. plan (honour the server's /fill volume limit when we can ask for it)
  let maxVolume = o.maxVolume ?? 32768;
  if (!o.maxVolume && transport.kind !== 'dry-run') {
    const g = await getGamerule(transport, 'maxBlockModifications').catch(() => null);
    if (g && Number(g.value) > 0) maxVolume = Math.min(32768, Number(g.value));
  }
  const plan = planBuild(world, { strict: !!o.strict, clearBox, singleBlocks: o.mode === 'layered', maxVolume, tile: TILE });
  report.voxels = world.count;
  report.plan = plan.stats;
  log(`plan: ${plan.stats.voxels} blocks → ${plan.stats.commands} commands (${plan.stats.fills} fill, ${plan.stats.setblocks} setblock)`);

  if (o.dryRun) {
    report.ok = true;
    report.status = 'dry-run';
    report.commands = plan.ops.map((op) => op.cmd);
    report.durationMs = Date.now() - t0;
    return report;
  }

  transport.requireOp?.();
  const hand = o.mode === 'hand';
  if (hand && transport.kind !== 'bot') throw new BuildError('--mode hand needs the bot transport', { code: 'BAD_MODE', hint: 'Use --transport bot (or drop --mode hand).' });
  if (o.mode === 'layered' && o.bps && 'maxRate' in transport) transport.maxRate = Math.max(1, o.bps);
  const recovered = await recoverGamerules(transport, o.stateDir);
  if (recovered.length) report.warnings.push(`Restored gamerules left changed by an interrupted earlier build: ${recovered.map(([n, v]) => `${n}=${v}`).join(', ')}`);

  // The effective target state of every position this build touches (clear box → air).
  const target = new Structure({ name: `${structure.name}-after` });
  if (clearBox) target.fill(clearBox[0], clearBox[1], clearBox[2], clearBox[3], clearBox[4], clearBox[5], 'air');
  world.forEach((x, y, z, b) => target.set(x, y, z, placementState(b)));
  Object.defineProperty(report, 'target', { value: target, enumerable: false });

  const errors = [];
  let totalBlocks = 0;
  // Move the bot into the target dimension first: gamerules are per world on Paper, and the quiet
  // setting must apply where the commands will run.
  if (transport.kind === 'bot' && !o.planOnly) {
    await transport.loadArea({ x1: modBox[0], z1: modBox[2], x2: Math.min(modBox[3], modBox[0] + 63), z2: Math.min(modBox[5], modBox[2] + 63) }, { topY: modBox[4] });
  }
  // Everything below runs with command echo to operators muted (send_command_feedback=false),
  // restored afterwards — also on Ctrl+C and, via the journal, after a crash.
  await withGamerules(transport, o.quiet === false ? {} : { sendCommandFeedback: false }, async () => {
    // 4. read-only phase: snapshot (undo), impact, container guard — nothing has been changed yet
    let snapshot = null;
    const wantUndo = o.undo !== false && !o.planOnly;
    // the snapshot also keeps the ground layer under the build: grass there turns to dirt while
    // covered, and undo puts it back
    const snapBox = [modBox[0], Math.max(dim.minY, modBox[1] - 1), modBox[2], modBox[3], modBox[4], modBox[5]];
    if (transport.canRead) {
      const volume = (snapBox[3] - snapBox[0] + 1) * (snapBox[4] - snapBox[1] + 1) * (snapBox[5] - snapBox[2] + 1);
      const maxSnap = o.maxSnapshot ?? 32_000_000;
      if (volume > maxSnap) {
        if (wantUndo) {
          throw new BuildError(`Area too large to snapshot for undo (${volume} blocks > ${maxSnap}) — nothing was changed`, {
            code: 'SNAPSHOT_TOO_LARGE', hint: 'Split the build into parts, or pass --no-undo --force to build without an undo snapshot and without the container check.',
          });
        }
        if (!o.force && !o.planOnly) {
          // without a scan nothing protects chests and other containers in the area: that needs an explicit opt-in
          throw new BuildError(`Area too large to check for chests and other containers (${volume} blocks > ${maxSnap}) — nothing was changed`, {
            code: 'SCAN_TOO_LARGE', hint: 'Split the build into parts, or pass --force to build without the container check.',
          });
        }
        report.warnings.push(`Area too large to scan (${volume} blocks): no undo snapshot and no container check`);
      } else {
        progress({ stage: 'snapshot', done: 0, total: 1 });
        await settle(transport, 300);
        const cap = await captureRegion(transport, snapBox, { onProgress: (d, n) => progress({ stage: 'snapshot', done: d, total: n }) });
        if (cap.unknown && !o.planOnly && !o.force) {
          throw new BuildError(`Could not read ${cap.unknown} blocks of the build area (chunks not loaded) — nothing was changed`, {
            code: 'SNAPSHOT_INCOMPLETE', hint: 'Retry; check the area is inside the world border. --force builds anyway (no undo for those blocks, no container check there).',
          });
        }
        snapshot = cap.structure;
        Object.defineProperty(report, 'snapshot', { value: snapshot, enumerable: false });
        Object.defineProperty(report, 'snapshotBox', { value: snapBox, enumerable: false });
      }
    } else {
      report.undo = { available: false, reason: `the ${transport.kind} transport cannot read blocks (use the bot transport for undo/verify)` };
      report.warnings.push(`No container check or undo snapshot: the ${transport.kind} transport cannot read blocks`);
    }

    let ops = plan.ops;
    if (snapshot && !o.noSkip) {
      const before = ops.length;
      // Build ops run after the clear, so judge them against the post-clear state.
      ops = ops.filter((op) => !opAlreadySatisfied(op, snapshot, op.phase < 0 ? () => false : (x, y, z) => inBox(clearBox, x, y, z), op.phase < 0 ? null : target));
      report.skipped = before - ops.length;
    }

    if (snapshot) {
      // impact: which existing blocks get replaced — and are any of them data-holding?
      const replaced = {};
      const candidates = [];
      const changed = new Structure({ name: `${structure.name}-changes` });
      target.forEach((x, y, z, want) => {
        const cur = snapshot.get(x, y, z);
        if (cur == null) return;
        if (holdsContents(cur)) candidates.push([x, y, z, cur]);
        const cleared = inBox(clearBox, x, y, z) && !isAir(cur);
        if (!cleared && alreadyThere(want, cur, x, y, z, target, snapshot)) return;
        changed.set(x, y, z, want);
        if (!isAir(cur)) replaced[blockName(cur)] = (replaced[blockName(cur)] ?? 0) + 1;
      });
      Object.defineProperty(report, 'changed', { value: changed, enumerable: false });
      // Any container inside a box that will actually be sent is at risk: /fill and /setblock
      // rewrite the block entity even when the block itself stays the same, and a clear destroys a
      // chest even when the blueprint puts a chest back in the same place.
      const containers = [];
      if (candidates.length) {
        const covered = candidates.length * ops.length <= 2e7
          ? ([x, y, z]) => ops.some((op) => x >= op.x1 && x <= op.x2 && y >= op.y1 && y <= op.y2 && z >= op.z1 && z <= op.z2)
          : (() => {
            const want = new Set(candidates.map(([x, y, z]) => `${x},${y},${z}`));
            const hit = new Set();
            for (const op of ops) {
              for (let y = op.y1; y <= op.y2; y++) for (let z = op.z1; z <= op.z2; z++) for (let x = op.x1; x <= op.x2; x++) {
                const k = `${x},${y},${z}`;
                if (want.has(k)) hit.add(k);
              }
            }
            return ([x, y, z]) => hit.has(`${x},${y},${z}`);
          })();
        for (const c of candidates) if (covered(c)) containers.push({ pos: c.slice(0, 3), block: blockName(c[3]) });
      }
      report.impact = {
        changes: changed.count,
        replacedBlocks: Object.values(replaced).reduce((a, b) => a + b, 0),
        replaced: Object.fromEntries(Object.entries(replaced).sort((a, b) => b[1] - a[1]).slice(0, 15)),
        containers: containers.slice(0, 10),
        containerCount: containers.length,
      };
      if (containers.length && !o.force && !o.planOnly) {
        throw new BuildError(`The build would destroy ${containers.length} block(s) holding items/text that undo cannot restore (e.g. ${containers.slice(0, 3).map((c) => `${c.block} at ${c.pos.join(',')}`).join('; ')}) — nothing was changed`, {
          code: 'CONTAINERS_AT_RISK', hint: 'Move the build (--at/--facing), empty those blocks first, or pass --force if they can be destroyed.', details: containers,
        });
      }
      if (o.stateDir && wantUndo && o.saveUndo !== false) {
        if (!changed.count) {
          report.undo = { available: false, reason: 'nothing to undo: the area already matches the blueprint' };
        } else {
          let id = o.undoId ?? newSnapshotId(structure.name);
          const snap = {
            id, name: structure.name, box: snapBox, structure: snapshot, after: changed,
            meta: { origin: placement.origin, facing: placement.facing, dimension, server: transport.serverKey ?? null, groundLayer: snapBox[1] < modBox[1] },
          };
          let file;
          try {
            file = saveSnapshot(o.stateDir, snap, { overwrite: !!o.undoId });
          } catch (e) {
            if (e.code !== 'EEXIST' || o.undoId) throw e;
            snap.id = id = newSnapshotId(structure.name); // practically impossible id clash: never overwrite, pick another
            file = saveSnapshot(o.stateDir, snap);
          }
          report.undo = { available: true, id, file };
          log(`undo snapshot saved: ${id}`);
        }
      }
    }
    if (!report.undo) {
      report.undo = {
        available: false,
        reason: o.planOnly
          ? (o.undo === false ? 'plan is read-only; the build will run without undo (--no-undo)' : 'plan is read-only; the build will save an undo snapshot')
          : wantUndo ? 'snapshot not taken' : 'disabled (--no-undo)',
      };
    }
    if (o.planOnly) {
      report.ok = true;
      report.status = 'planned';
      report.commandsToSend = ops.length;
      report.estimatedSeconds = Math.max(1, Math.round(ops.length / (transport.kind === 'rcon' ? 60 : 200)));
      return;
    }
    // last read-only moment: callers that keep their own undo record (watch) persist it now, so a
    // build that dies half-way can still be undone
    if (o.beforeChanges) await o.beforeChanges(report);

    // 5. execute, grouped by phase + tile
    totalBlocks = ops.reduce((n, op) => n + op.volume, 0);
    let doneBlocks = 0, doneCmds = 0, noops = 0;
    const groups = [];
    for (const op of ops) {
      const g = groups[groups.length - 1];
      if (g && g.phase === op.phase && g.tile === op.tile) g.ops.push(op);
      else groups.push({ phase: op.phase, tile: op.tile, ops: [op] });
    }
    const tBuild = Date.now();
    const runGroup = async (g) => {
      const tb = tileBounds(g.tile, TILE);
      const area = { x1: Math.max(tb.x1, modBox[0]), z1: Math.max(tb.z1, modBox[2]), x2: Math.min(tb.x2, modBox[3]), z2: Math.min(tb.z2, modBox[5]) };
      const topY = g.ops.reduce((m, op) => (op.y2 > m ? op.y2 : m), -Infinity);
      const ensureLoaded = () => transport.loadArea(area, { topY });
      await ensureLoaded();
      const vols = g.ops.map((op) => op.volume);
      let prevDone = 0;
      const r = await transport.run(g.ops.map((op) => op.cmd), {
        ensureLoaded,
        weights: vols,
        onBatch: (done) => {
          for (let i = prevDone; i < done; i++) doneBlocks += vols[i];
          doneCmds += done - prevDone;
          prevDone = done;
          const elapsed = Date.now() - tBuild;
          progress({ stage: 'build', done: Math.min(doneCmds, ops.length), total: ops.length, blocksDone: Math.min(doneBlocks, totalBlocks), blocksTotal: totalBlocks, etaMs: doneBlocks ? Math.max(0, Math.round((elapsed / doneBlocks) * (totalBlocks - doneBlocks))) : null });
        },
      });
      noops += r.noops;
      errors.push(...r.errors);
    };
    for (const g of groups) {
      if (hand && g.phase >= 0) continue; // hand mode only runs the clear ops here
      for (let attempt = 0; ; attempt++) {
        try {
          await runGroup(g);
          break;
        } catch (e) {
          // Kicked / timed out / server hiccup: rejoin and redo this group (absolute fills are idempotent).
          if (!RECOVERABLE.has(e.code) || typeof transport.reconnect !== 'function' || attempt >= 3) throw e;
          log(`connection lost (${e.message}) — reconnecting (attempt ${attempt + 1}/3)…`);
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          await transport.reconnect();
          transport.setDimension?.(dim.id);
          report.reconnects = (report.reconnects ?? 0) + 1;
        }
      }
    }
    if (hand) {
      const { handPlace } = await import('./handplace.js');
      report.hand = await handPlace(transport, world, { bps: o.bps ?? 8, onProgress: progress, log });
      errors.push(...(report.hand.errors ?? []));
      delete report.hand.errors;
      doneCmds = ops.length;
    }
    report.buildMs = Date.now() - tBuild;
    report.commandsSent = doneCmds;
    report.noops = noops;
    report.errors = summarizeErrors(errors);
    report.errorCount = errors.length;

    // 6. verify + repair
    if (o.verify && transport.canRead) {
      report.verify = await verifyAndRepair(transport, world, { repair: o.repair !== false, strict: !!o.strict, progress, log });
    } else if (o.verify) {
      report.warnings.push(`Verification needs a bot connection (the ${transport.kind} transport cannot read blocks)`);
    }
    await transport.releaseAreas?.();
  }, { journalDir: o.stateDir, handleSignals: o.handleSignals !== false });

  if (o.planOnly) {
    report.durationMs = Date.now() - t0;
    return report;
  }
  const verified = !report.verify || (report.verify.remaining === 0 && report.verify.unreadable === 0);
  report.ok = errors.length === 0 && verified;
  report.status = report.ok ? 'complete' : 'partial';
  report.durationMs = Date.now() - t0;
  report.blocksPerSecond = report.buildMs ? Math.round((totalBlocks / report.buildMs) * 1000) : null;
  return report;
}

function opAlreadySatisfied(op, snapshot, inClear, target) {
  const want = op.block;
  for (let y = op.y1; y <= op.y2; y++) {
    for (let z = op.z1; z <= op.z2; z++) {
      for (let x = op.x1; x <= op.x2; x++) {
        const cur = inClear(x, y, z) ? 'air' : snapshot.get(x, y, z);
        if (cur == null || !alreadyThere(want, cur, x, y, z, target, snapshot)) return false;
      }
    }
  }
  return true;
}

/** Wait until `ms` have passed since the transport last sent a command (lets block updates arrive). */
async function settle(transport, ms) {
  const since = Date.now() - (transport.lastSendAt ?? 0);
  if (since < ms) await new Promise((r) => setTimeout(r, ms - since));
}

function summarizeErrors(errors) {
  const byKey = new Map();
  for (const e of errors) {
    const k = e.key ?? e.text?.split('\n')[0] ?? 'error';
    if (!byKey.has(k)) byKey.set(k, { key: e.key, message: e.text?.split('\n')[0], hint: e.hint, count: 0, examples: [] });
    const g = byKey.get(k);
    g.count++;
    if (g.examples.length < 3 && e.cmd) g.examples.push(e.cmd);
  }
  return [...byKey.values()];
}

/**
 * Compare the world against the expected structure (absolute coords) and optionally fix
 * mismatches with one /setblock pass. Unreadable blocks (chunk not available) are reported
 * separately and never counted as matches.
 */
export async function verifyAndRepair(transport, world, { repair = true, strict = false, progress = () => {}, log = () => {} } = {}) {
  // Block-change packets are flushed at the end of a server tick, after the command feedback that
  // acknowledged them — give the client a moment so we don't read stale blocks.
  await settle(transport, 400);
  const T = transport.readTileSize ?? TILE;
  const tileKeyOf = (x, z) => `${Math.floor(x / T)},${Math.floor(z / T)}`;
  const groupByTile = (positions) => {
    const byTile = new Map();
    for (const p of positions) {
      const k = tileKeyOf(p[0], p[2]);
      if (!byTile.has(k)) byTile.set(k, []);
      byTile.get(k).push(p);
    }
    return byTile;
  };
  const check = async (positions, stage = 'verify') => {
    const mismatches = [];
    const unreadable = [];
    const byTile = groupByTile(positions);
    let i = 0;
    for (const [k, list] of byTile) {
      const tb = tileBounds(k, T);
      const topY = list.reduce((m, p) => (p[1] > m ? p[1] : m), -Infinity);
      await transport.loadArea(tb, { topY });
      for (const [x, y, z, expected] of list) {
        let actual = transport.readBlock(x, y, z);
        if (actual === undefined) {
          await transport.waitForArea?.(tb, 5000);
          actual = transport.readBlock(x, y, z);
        }
        if (actual === undefined) unreadable.push({ pos: [x, y, z], expected });
        else if (!blockMatches(expected, actual, { strict })) mismatches.push({ pos: [x, y, z], expected, actual });
      }
      progress({ stage, done: ++i, total: byTile.size });
    }
    return { mismatches, unreadable };
  };
  const all = [];
  world.forEach((x, y, z, b) => all.push([x, y, z, placementState(b)]));
  let { mismatches, unreadable } = await check(all);
  if (mismatches.length) {
    await new Promise((r) => setTimeout(r, 800));
    // re-read the mismatches to rule out stale reads; anything that became unreadable stays unreadable
    const re = await check(mismatches.map((m) => [...m.pos, m.expected]), 'recheck');
    mismatches = re.mismatches;
    unreadable = unreadable.concat(re.unreadable);
  }
  const result = {
    checked: all.length - unreadable.length, matched: all.length - unreadable.length - mismatches.length,
    mismatches: mismatches.length, unreadable: unreadable.length, repaired: 0, remaining: mismatches.length,
    examples: mismatches.slice(0, 10),
  };
  if (repair && mismatches.length) {
    log(`verify: ${mismatches.length} mismatching blocks — repairing`);
    const late = (b) => Number(/torch|door|bed|sign|banner|lantern|rail|carpet|button|lever|ladder|vine/.test(blockName(b)));
    const repairErrors = [];
    // Repair tile by tile: the bot must be near a position for the server to have it loaded.
    for (const [k, list] of groupByTile(mismatches.map((m) => [...m.pos, m.expected]))) {
      list.sort((a, b) => late(a[3]) - late(b[3]) || a[1] - b[1]);
      const tb = tileBounds(k, T);
      const topY = list.reduce((m, p) => (p[1] > m ? p[1] : m), -Infinity);
      const ensureLoaded = () => transport.loadArea(tb, { topY });
      await ensureLoaded();
      const r = await transport.run(list.map(([x, y, z, b]) => `setblock ${x} ${y} ${z} ${b}`), { ensureLoaded });
      repairErrors.push(...r.errors);
    }
    await settle(transport, 600);
    const again = await check(mismatches.map((m) => [...m.pos, m.expected]), 'recheck');
    result.repaired = mismatches.length - again.mismatches.length - again.unreadable.length;
    result.remaining = again.mismatches.length;
    result.unreadable += again.unreadable.length;
    result.matched += result.repaired;
    result.examples = again.mismatches.slice(0, 10);
    if (repairErrors.length) result.repairErrors = summarizeErrors(repairErrors);
  }
  return result;
}

export { Structure };
