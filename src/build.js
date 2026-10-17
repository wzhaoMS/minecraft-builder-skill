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
import { resolvePlacement } from './placement.js';
import { captureRegion, saveSnapshot, newSnapshotId } from './snapshot.js';
import { withGamerules, recoverGamerules, getGamerule } from './gamerules.js';

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

const TILE = 64;
const RECOVERABLE = new Set(['ENDED', 'ACK_TIMEOUT', 'RCON_CLOSED', 'RCON_TIMEOUT']);

// Properties the game recomputes from neighbours or time — compared only in strict mode.
const DYNAMIC_PROPS = new Set(['north', 'south', 'east', 'west', 'up', 'down', 'distance', 'power', 'powered', 'occupied', 'attached', 'in_wall', 'snowy', 'note', 'triggered', 'enabled', 'has_book', 'has_record', 'lit', 'signal_fire', 'berries', 'age', 'stage', 'level', 'moisture', 'honey_level', 'bottom']);
const STAIR_SHAPE_RE = /_stairs$/;

// Blocks whose contents (items, text, records, bees…) an undo snapshot cannot restore.
const CONTENT_RE = /(^chest$|^trapped_chest$|^barrel$|shulker_box$|^furnace$|^blast_furnace$|^smoker$|^hopper$|^dispenser$|^dropper$|^brewing_stand$|^lectern$|_sign$|^jukebox$|^chiseled_bookshelf$|^decorated_pot$|^crafter$|^beehive$|^bee_nest$|spawner$|^vault$|command_block$|_shelf$)/;
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

/** Does the world block `actual` satisfy the blueprint block `expected`? */
export function blockMatches(expected, actual, { strict = false } = {}) {
  if (actual == null) return false;
  if (isAir(expected)) return isAir(actual);
  const e = parseBlock(expected), a = parseBlock(actual);
  if (e.name !== a.name) return !strict && (NATURAL_DECAY[e.name]?.includes(a.name) ?? false);
  for (const [k, v] of Object.entries(e.props)) {
    if (!strict && (DYNAMIC_PROPS.has(k) || (k === 'shape' && STAIR_SHAPE_RE.test(e.name)))) continue;
    if (a.props[k] !== undefined && String(a.props[k]) !== String(v)) return false;
  }
  return true;
}

function unionBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])];
}

const inBox = (box, x, y, z) => !!box && x >= box[0] && x <= box[3] && y >= box[1] && y <= box[4] && z >= box[2] && z <= box[5];

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
    serverVersion: transport.version ?? null, warnings: [],
  };
  if (o.mode && !['fill', 'layered', 'hand'].includes(o.mode)) throw new BuildError(`Unknown --mode "${o.mode}" (fill|layered|hand)`, { code: 'BAD_MODE' });

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
    if (!pose) throw new BuildError(`Cannot locate player "${o.near}" with the ${transport.kind} transport`, { code: 'NO_PLAYER', hint: 'Use --at x,y,z instead.' });
    if (!dimension && pose.dimension) dimension = normalizeDimension(pose.dimension);
  }
  dimension ??= 'overworld';
  const dim = DIMENSIONS[dimension];
  report.dimension = dimension;
  transport.setDimension?.(dim.id);
  const placement = resolvePlacement(structure, { at: o.at, anchor: o.anchor, facing: o.facing, rotate: o.rotate, mirror: o.mirror, pose, gap: o.gap });
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

  const errors = [];
  let totalBlocks = 0;
  // Everything below runs with command echo to operators muted (send_command_feedback=false),
  // restored afterwards — also on Ctrl+C and, via the journal, after a crash.
  await withGamerules(transport, o.quiet === false ? {} : { sendCommandFeedback: false }, async () => {
    // 4. read-only phase: snapshot, impact, safety checks
    let snapshot = null;
    if (transport.canRead && (o.undo !== false || o.planOnly)) {
      const volume = (modBox[3] - modBox[0] + 1) * (modBox[4] - modBox[1] + 1) * (modBox[5] - modBox[2] + 1);
      const maxSnap = o.maxSnapshot ?? 32_000_000;
      if (volume > maxSnap) {
        throw new BuildError(`Area too large to snapshot for undo (${volume} blocks > ${maxSnap})`, {
          code: 'SNAPSHOT_TOO_LARGE', hint: 'Split the build into parts, or pass --no-undo to build without an undo snapshot.',
        });
      }
      progress({ stage: 'snapshot', done: 0, total: 1 });
      await settle(transport, 300);
      const cap = await captureRegion(transport, modBox, { onProgress: (d, n) => progress({ stage: 'snapshot', done: d, total: n }) });
      if (cap.unknown && !o.planOnly) {
        throw new BuildError(`Could not read ${cap.unknown} blocks of the build area (chunks not loaded) — nothing was changed`, {
          code: 'SNAPSHOT_INCOMPLETE', hint: 'Retry; check the area is inside the world border, or pass --no-undo.',
        });
      }
      snapshot = cap.structure;
      Object.defineProperty(report, 'snapshot', { value: snapshot, enumerable: false });
      // impact: what existing blocks will be replaced, and are any of them data-holding?
      const replaced = {};
      const containers = [];
      let changes = 0;
      target.forEach((x, y, z, want) => {
        const cur = snapshot.get(x, y, z);
        if (cur == null || blockMatches(want, cur, { strict: true })) return;
        changes++;
        if (!isAir(cur)) replaced[blockName(cur)] = (replaced[blockName(cur)] ?? 0) + 1;
        if (holdsContents(cur)) containers.push({ pos: [x, y, z], block: blockName(cur) });
      });
      report.impact = {
        changes,
        replacedBlocks: Object.values(replaced).reduce((a, b) => a + b, 0),
        replaced: Object.fromEntries(Object.entries(replaced).sort((a, b) => b[1] - a[1]).slice(0, 15)),
        containers: containers.slice(0, 10),
        containerCount: containers.length,
      };
      if (containers.length && !o.force && !o.planOnly) {
        throw new BuildError(`The build would overwrite ${containers.length} block(s) holding items/text that undo cannot restore (e.g. ${containers.slice(0, 3).map((c) => `${c.block} at ${c.pos.join(',')}`).join('; ')}) — nothing was changed`, {
          code: 'CONTAINERS_AT_RISK', hint: 'Move the build (--at/--facing), empty those blocks first, or pass --force if they can be destroyed.', details: containers,
        });
      }
      if (o.stateDir && o.undo !== false && o.saveUndo !== false && !o.planOnly) {
        const id = newSnapshotId(structure.name);
        const file = saveSnapshot(o.stateDir, {
          id, name: structure.name, box: modBox, structure: snapshot, after: target,
          meta: { origin: placement.origin, facing: placement.facing, dimension, server: transport.serverKey ?? null },
        });
        report.undo = { available: true, id, file };
        log(`undo snapshot saved: ${id}`);
      }
    } else if (!transport.canRead) {
      report.undo = { available: false, reason: `the ${transport.kind} transport cannot read blocks (use the bot transport for undo/verify)` };
    } else {
      report.undo = { available: false, reason: 'disabled (--no-undo)' };
    }

    let ops = plan.ops;
    if (snapshot && !o.noSkip) {
      const before = ops.length;
      // Build ops run after the clear, so judge them against the post-clear state.
      ops = ops.filter((op) => !opAlreadySatisfied(op, snapshot, op.phase < 0 ? () => false : (x, y, z) => inBox(clearBox, x, y, z)));
      report.skipped = before - ops.length;
    }
    if (o.planOnly) {
      report.ok = true;
      report.status = 'planned';
      report.commandsToSend = ops.length;
      report.estimatedSeconds = Math.max(1, Math.round(ops.length / (transport.kind === 'rcon' ? 60 : 200)));
      return;
    }

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
  }, { journalDir: o.stateDir });

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

function opAlreadySatisfied(op, snapshot, inClear) {
  const want = op.block;
  for (let y = op.y1; y <= op.y2; y++) {
    for (let z = op.z1; z <= op.z2; z++) {
      for (let x = op.x1; x <= op.x2; x++) {
        const cur = inClear(x, y, z) ? 'air' : snapshot.get(x, y, z);
        if (cur == null || !blockMatches(want, cur, { strict: true })) return false;
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
    ({ mismatches } = await check(mismatches.map((m) => [...m.pos, m.expected]), 'recheck')); // rule out stale reads
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
