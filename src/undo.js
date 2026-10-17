/**
 * Undo: restore what a build changed, from its snapshot.
 *
 * A snapshot stores the world before the build (whole affected box) and the state the build set
 * (`after`). Undo only touches positions the build changed, and — when it can read the world —
 * skips positions that were edited since (conflicts), reporting them instead of overwriting.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Structure } from './core/structure.js';
import { decodeSnapshot, captureRegion, listSnapshots } from './snapshot.js';
import { executeBuild, blockMatches, nbtSatisfied, BuildError, normalizeDimension, DIMENSIONS, DECAYS_UNDER_COVER } from './build.js';
import { blockName, isAir } from './core/blockstate.js';
import { withGamerules } from './gamerules.js';
import { normalizeServerKey } from './connect.js';

export function findSnapshot(stateDir, id) {
  const snaps = listSnapshots(stateDir);
  const snap = id ? snaps.find((s) => s.id === id || s.id.startsWith(id)) : snaps[0];
  if (!snap) {
    throw new BuildError(id ? `No undo snapshot "${id}"` : 'Nothing to undo', { code: 'NO_SNAPSHOT', hint: 'List snapshots with `mcb undo --list`.' });
  }
  return snap;
}

/**
 * @returns {Promise<object>} report: { ok, id, restored, conflicts, unreadable, conflictExamples, build }
 */
export async function undoBuild(transport, snapFile, { force = false, anyServer = false, log = () => {}, onProgress, stateDir = null } = {}) {
  const data = decodeSnapshot(fs.readFileSync(snapFile));
  const id = path.basename(snapFile).replace(/\.json\.gz$/, '');
  const taken = data.meta?.server ? normalizeServerKey(data.meta.server) : null;
  const here = transport.serverKey ? normalizeServerKey(transport.serverKey) : null;
  if (taken && here && taken !== here && !anyServer) {
    throw new BuildError(`Snapshot ${id} was taken on ${taken}, but you are connected to ${here}`, {
      code: 'SERVER_MISMATCH', hint: 'Connect to the server the build ran on, or pass --any-server if it is the same world under another address.',
    });
  }
  const dimension = data.meta?.dimension ? normalizeDimension(data.meta.dimension) : 'overworld';
  transport.setDimension?.(DIMENSIONS[dimension].id);
  const restore = new Structure({ name: `undo ${data.name ?? id}` });
  const ground = new Structure({ name: `undo ${data.name ?? id} (ground)` });
  const conflicts = [];
  let unreadable = 0;
  if (!data.after) {
    // v1 snapshot: no record of what the build set — restore the whole box.
    data.structure.forEach((x, y, z, b) => restore.set(x, y, z, b));
  } else {
    let current = null;
    if (transport.canRead && !force) {
      current = (await withGamerules(transport, { sendCommandFeedback: false }, () => captureRegion(transport, data.box), { journalDir: stateDir })).structure;
    } else if (!force) {
      throw new BuildError('Undo needs the bot transport to check for edits made since the build', {
        code: 'UNDO_NEEDS_READ', hint: 'Use --transport bot, or pass --force to restore without checking.',
      });
    }
    // states this build may have left at a position: `after`, plus — for watch sessions — every
    // other state an earlier (possibly interrupted) revision placed there
    const alts = data.afterAlt ?? [];
    const ownedStates = (x, y, z, after) => {
      const out = [after];
      for (const s of alts) { const b = s.get(x, y, z); if (b != null) out.push(b); }
      return out;
    };
    data.after.forEach((x, y, z, after) => {
      const before = data.structure.get(x, y, z);
      if (before == null) return;
      const owned = ownedStates(x, y, z, after);
      // nothing this build placed here differs from the original: nothing to undo
      if (owned.every((b) => sameBlock(b, before))) return;
      if (current) {
        const now = current.get(x, y, z);
        if (now == null) {
          // could not read it: we cannot tell whether someone edited it since, so leave it alone
          unreadable++;
          return;
        }
        if (sameBlock(before, now)) return; // already as it was
        if (!owned.some((b) => blockMatches(b, now) && nbtSatisfied(b, now))) {
          conflicts.push({ pos: [x, y, z], expected: after, found: now });
          return;
        }
      }
      // grass/paths go back in the last pass, after everything above them is gone: put back under a
      // block that is about to be removed, grass can still decay into dirt in the meantime
      (DECAYS_UNDER_COVER.has(blockName(before)) ? ground : restore).set(x, y, z, before);
    });
    // grass/paths the build covered turned into dirt: put the original ground back where the undo
    // uncovers it (a second pass, once the blocks above are gone). Any layer counts — a build with
    // foundations covers grass inside its own box — but only cells the build itself covered:
    // dirt anywhere else is somebody else's doing.
    if (current) {
      data.structure.forEach((x, y, z, before) => {
        if (!DECAYS_UNDER_COVER.has(blockName(before))) return;
        // the build's own changed blocks are handled above; blocks it left as they were (it placed
        // grass on grass) can still have decayed under its other blocks
        const ownedHere = [data.after.get(x, y, z), ...alts.map((s) => s.get(x, y, z))].filter((b) => b != null);
        if (ownedHere.some((b) => !blockMatches(b, before, { strict: true }))) return;
        const ownedAbove = [data.after.get(x, y + 1, z), ...alts.map((s) => s.get(x, y + 1, z))].filter((b) => b != null);
        if (!ownedAbove.some((b) => !isAir(b))) return;
        const now = current.get(x, y, z);
        if (now == null) { unreadable++; return; }
        // still grass (it may decay while the undo runs) or already dirt: anything else is a player's edit
        if (blockName(now) !== 'dirt' && !blockMatches(before, now, { strict: true })) return;
        const above = restore.get(x, y + 1, z) ?? current.get(x, y + 1, z);
        // only when the cell is known to end up uncovered (unreadable cover ≠ no cover)
        if (above != null && isAir(above)) ground.set(x, y, z, before);
      });
    }
  }
  const run = (structure, { strict = true } = {}) => executeBuild({
    structure, transport, at: [0, 0, 0], anchor: 'origin', strict, undo: false, force: true,
    fixMultiblocks: false, dimension, log, onProgress, stateDir,
  });
  // Liquids go first: removing a basin's walls before its water would let the water run out into
  // the surroundings (where it is not the build's to clean up).
  const liquid = new Structure({ name: `${restore.name} (liquids)` });
  restore.forEach((x, y, z, b) => {
    const placed = [data.after?.get(x, y, z), ...(data.afterAlt ?? []).map((s) => s.get(x, y, z))];
    if (placed.some((p) => p != null && isLiquidLike(p))) liquid.set(x, y, z, b);
  });
  let build = null, groundBuild = null;
  if (liquid.count) {
    // with block updates (not strict): removing a source must tell the water it fed to drain away,
    // otherwise orphaned falling/flowing water stays forever
    await run(liquid, { strict: false });
    // let the flowing water/lava the sources fed drain away before their basin is taken down
    let lava = false;
    liquid.forEach((x, y, z) => { if (blockName(data.after?.get(x, y, z) ?? '') === 'lava') lava = true; });
    await new Promise((r) => setTimeout(r, lava ? 6000 : 2500));
  }
  if (restore.count) build = await run(restore);
  if (ground.count) groundBuild = await run(ground);
  // the restore runs are not undoable builds of their own; don't confuse readers with their undo status
  if (build) delete build.undo;
  const hints = [];
  if (conflicts.length) hints.push('Some blocks were changed after the build and were left as they are; re-run with --force to restore them too.');
  if (unreadable) hints.push('Some blocks could not be read (chunks not loaded) and were left as they are; re-run, or pass --force to restore them without checking.');
  return {
    ok: (!build || build.ok) && (!groundBuild || groundBuild.ok) && conflicts.length === 0 && unreadable === 0,
    id,
    restored: restore.count + ground.count,
    conflicts: conflicts.length,
    unreadable,
    conflictExamples: conflicts.slice(0, 10),
    hint: hints.length ? hints.join(' ') : undefined,
    build,
    ...(groundBuild ? { ground: { restored: ground.count, ok: groundBuild.ok } } : {}),
  };
}

/** Same block state and the same block data (sign text…) as far as both sides know it. */
function sameBlock(a, b) {
  return blockMatches(a, b, { strict: true }) && nbtSatisfied(a, b) && nbtSatisfied(b, a);
}

/** Water/lava (incl. bubble columns and waterlogged blocks): states that can run out when their container goes. */
function isLiquidLike(block) {
  const n = blockName(block);
  return n === 'water' || n === 'lava' || n === 'bubble_column' || /waterlogged=true/.test(String(block));
}

/** Move an applied snapshot out of the way so the next `undo` targets the previous build. */
export function markApplied(snapFile) {
  const applied = path.join(path.dirname(snapFile), 'applied');
  fs.mkdirSync(applied, { recursive: true });
  fs.renameSync(snapFile, path.join(applied, path.basename(snapFile)));
}
