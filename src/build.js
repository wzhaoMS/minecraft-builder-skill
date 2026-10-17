/**
 * Build orchestration: lint → place → snapshot (undo) → plan → execute (tile by tile, acknowledged)
 * → verify (+repair) → report.
 */
import { Structure } from './core/structure.js';
import { lintStructure } from './core/lint.js';
import { parseBlock, blockName, isAir } from './core/blockstate.js';
import { planBuild, placementState, tileBounds } from './compile/plan.js';
import { resolvePlacement } from './placement.js';
import { captureRegion, saveSnapshot, newSnapshotId } from './snapshot.js';
import { withGamerules } from './gamerules.js';

export class BuildError extends Error {
  constructor(message, { hint, details } = {}) {
    super(message);
    this.hint = hint;
    this.details = details;
  }
}

export const WORLD_MIN_Y = -64;
export const WORLD_MAX_Y = 319;
const TILE = 64;
const RECOVERABLE = new Set(['ENDED', 'ACK_TIMEOUT', 'RCON_CLOSED', 'RCON_TIMEOUT']);

// Properties the game recomputes from neighbours — not meaningful to compare after a normal build.
const DYNAMIC_PROPS = new Set(['north', 'south', 'east', 'west', 'up', 'down', 'distance', 'power', 'powered', 'waterlogged', 'occupied', 'attached', 'in_wall', 'snowy', 'note', 'triggered', 'enabled', 'has_book', 'has_record', 'lit', 'signal_fire', 'berries', 'age', 'stage', 'level', 'moisture']);
const STAIR_SHAPE_RE = /_stairs$/;

/** Does the world block `actual` satisfy the blueprint block `expected`? */
export function blockMatches(expected, actual, { strict = false } = {}) {
  if (actual == null) return false;
  if (isAir(expected)) return isAir(actual);
  const e = parseBlock(expected), a = parseBlock(actual);
  if (e.name !== a.name) return false;
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

/**
 * @param {object} o
 * @param {Structure} o.structure blueprint (relative coordinates)
 * @param {object} o.transport connected transport (bot | rcon | dry-run)
 * @returns {Promise<object>} report
 */
export async function executeBuild(o) {
  const t0 = Date.now();
  const log = o.log ?? (() => {});
  const progress = o.onProgress ?? (() => {});
  const transport = o.transport;
  const version = o.version ?? transport.version ?? undefined;
  const report = { ok: false, name: o.structure.name, transport: transport.kind, serverVersion: transport.version ?? null, warnings: [] };

  // 1. lint
  const structure = o.structure.clone();
  const lint = lintStructure(structure, { version: version || undefined, fix: o.fixMultiblocks !== false });
  report.lint = { fixes: lint.fixes, warnings: lint.warnings };
  if (!lint.ok && !o.force) {
    throw new BuildError(`Blueprint has ${lint.errors.length} invalid block state(s): ` + lint.errors.map((e) => e.errors.join('; ')).join(' | '), {
      hint: 'Fix the block names (see suggestions) or pass --force to try anyway.',
      details: lint.errors,
    });
  }

  // 2. placement
  let pose = null;
  if (!o.at && o.near) {
    pose = await transport.playerPose(o.near);
    if (!pose) throw new BuildError(`Cannot locate player "${o.near}" with the ${transport.kind} transport`, { hint: 'Use --at x,y,z instead.' });
  }
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
    clearBox = [bb.min[0] - m, bb.min[1], bb.min[2] - m, bb.max[0] + m, Math.min(WORLD_MAX_Y, bb.max[1] + m), bb.max[2] + m];
  }
  // Live editing (mcb watch): blocks that were in the previous version but not in this one go back
  // to what the world had before the first build.
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
  if (modBox[1] < WORLD_MIN_Y || modBox[4] > WORLD_MAX_Y) {
    const msg = `Build spans y=${modBox[1]}..${modBox[4]}, outside the world height (${WORLD_MIN_Y}..${WORLD_MAX_Y})`;
    if (!o.force) throw new BuildError(msg, { hint: 'Lower/raise --at y, or pass --force to build the part that fits.' });
    report.warnings.push(msg);
  }

  // 3. plan
  const plan = planBuild(world, { strict: !!o.strict, clearBox, singleBlocks: o.mode === 'layered', maxVolume: o.maxVolume ?? 32768, tile: TILE });
  if (o.mode && !['fill', 'layered', 'hand'].includes(o.mode)) throw new BuildError(`Unknown --mode "${o.mode}" (fill|layered|hand)`);
  report.voxels = world.count;
  report.plan = plan.stats;
  log(`plan: ${plan.stats.voxels} blocks → ${plan.stats.commands} commands (${plan.stats.fills} fill, ${plan.stats.setblocks} setblock)`);

  if (o.dryRun) {
    report.ok = true;
    report.dryRun = true;
    report.commands = plan.ops.map((op) => op.cmd);
    report.durationMs = Date.now() - t0;
    return report;
  }

  transport.requireOp?.();
  const hand = o.mode === 'hand';
  if (hand && transport.kind !== 'bot') throw new BuildError('--mode hand needs the bot transport', { hint: 'Use --transport bot (or drop --mode hand).' });
  if (o.mode === 'layered' && o.bps && 'maxRate' in transport) transport.maxRate = Math.max(1, o.bps);

  // Everything below runs with op command echo muted (teleports and fills would otherwise be
  // broadcast to every operator's chat), restored afterwards — also on Ctrl+C.
  const errors = [];
  let totalBlocks = 0;
  await withGamerules(transport, o.quiet === false ? {} : { logAdminCommands: false }, async () => {
    // 4. snapshot (undo) + skip what already matches
    let snapshot = null;
    if (transport.canRead && o.undo !== false) {
      const volume = (modBox[3] - modBox[0] + 1) * (modBox[4] - modBox[1] + 1) * (modBox[5] - modBox[2] + 1);
      if (volume > (o.maxSnapshot ?? 8_000_000)) {
        report.warnings.push(`Area too large to snapshot (${volume} blocks) — undo disabled for this build`);
      } else {
        progress({ stage: 'snapshot', done: 0, total: 1 });
        await settle(transport, 300);
        const cap = await captureRegion(transport, modBox, { onProgress: (d, n) => progress({ stage: 'snapshot', done: d, total: n }) });
        snapshot = cap.structure;
        Object.defineProperty(report, 'snapshot', { value: snapshot, enumerable: false });
        if (cap.unknown) report.warnings.push(`${cap.unknown} blocks could not be read for the undo snapshot`);
        if (o.stateDir && o.saveUndo !== false) {
          const id = newSnapshotId(structure.name);
          const file = saveSnapshot(o.stateDir, { id, name: structure.name, box: modBox, structure: snapshot, meta: { origin: placement.origin, facing: placement.facing } });
          report.undo = { id, file };
          log(`undo snapshot saved: ${id}`);
        }
      }
    }
    let ops = plan.ops;
    if (snapshot && !o.noSkip) {
      const before = ops.length;
      // Build ops run after the clear, so judge them against the post-clear state.
      const inClear = clearBox
        ? (x, y, z) => x >= clearBox[0] && x <= clearBox[3] && y >= clearBox[1] && y <= clearBox[4] && z >= clearBox[2] && z <= clearBox[5]
        : () => false;
      ops = ops.filter((op) => !opAlreadySatisfied(op, snapshot, op.phase < 0 ? () => false : inClear));
      report.skipped = before - ops.length;
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
      const topY = Math.max(...g.ops.map((op) => op.y2));
      const ensureLoaded = () => transport.loadArea(area, { topY });
      await ensureLoaded();
      const vols = g.ops.map((op) => op.volume);
      let prevDone = 0;
      const r = await transport.run(g.ops.map((op) => op.cmd), {
        ensureLoaded,
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
          // Kicked / timed out / server hiccup: rejoin and redo this group (fills are idempotent).
          if (!RECOVERABLE.has(e.code) || typeof transport.reconnect !== 'function' || attempt >= 3) throw e;
          log(`connection lost (${e.message}) — reconnecting (attempt ${attempt + 1}/3)…`);
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          await transport.reconnect();
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
  });

  report.ok = errors.length === 0 && (!report.verify || report.verify.remaining === 0);
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
 * Compare the world against the expected structure (absolute coords); optionally fix mismatches
 * with /setblock and re-check them.
 */
export async function verifyAndRepair(transport, world, { repair = true, strict = false, progress = () => {}, log = () => {} } = {}) {
  // Block-change packets are flushed at the end of a server tick, after the command feedback that
  // acknowledged them — give the client a moment so we don't read stale blocks.
  await settle(transport, 400);
  const check = async (positions) => {
    const mismatches = [];
    const byTile = new Map();
    for (const p of positions) {
      const k = `${Math.floor(p[0] / TILE)},${Math.floor(p[2] / TILE)}`;
      if (!byTile.has(k)) byTile.set(k, []);
      byTile.get(k).push(p);
    }
    let i = 0;
    for (const [k, list] of byTile) {
      const tb = tileBounds(k, TILE);
      const topY = Math.max(...list.map((p) => p[1]));
      await transport.loadArea(tb, { topY });
      for (const [x, y, z, expected] of list) {
        let actual = transport.readBlock(x, y, z);
        if (actual === undefined) {
          await transport.waitForArea?.(tb, 5000);
          actual = transport.readBlock(x, y, z);
        }
        if (!blockMatches(expected, actual, { strict })) mismatches.push({ pos: [x, y, z], expected, actual: actual ?? 'unloaded' });
      }
      progress({ stage: 'verify', done: ++i, total: byTile.size });
    }
    return mismatches;
  };
  const all = [];
  world.forEach((x, y, z, b) => all.push([x, y, z, placementState(b)]));
  let mismatches = await check(all);
  if (mismatches.length) {
    await new Promise((r) => setTimeout(r, 800));
    mismatches = await check(mismatches.map((m) => [...m.pos, m.expected])); // rule out stale reads
  }
  const result = { checked: all.length, mismatches: mismatches.length, repaired: 0, remaining: mismatches.length, examples: mismatches.slice(0, 10) };
  if (repair && mismatches.length) {
    log(`verify: ${mismatches.length} mismatching blocks — repairing`);
    const cmds = mismatches.map((m) => `setblock ${m.pos[0]} ${m.pos[1]} ${m.pos[2]} ${m.expected}`);
    // repair attachables last
    const late = (c) => Number(/torch|door|bed|sign|banner|lantern|rail|carpet|button|lever|ladder|vine/.test(blockName(c.split(' ')[4])));
    cmds.sort((a, b) => late(a) - late(b));
    await transport.run(cmds, {});
    await settle(transport, 600);
    const again = await check(mismatches.map((m) => [...m.pos, m.expected]));
    result.repaired = mismatches.length - again.length;
    result.remaining = again.length;
    result.examples = again.slice(0, 10);
  }
  return result;
}

export { Structure };
