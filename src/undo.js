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
import { executeBuild, blockMatches, BuildError, normalizeDimension, DIMENSIONS, DECAYS_UNDER_COVER } from './build.js';
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
    data.after.forEach((x, y, z, after) => {
      const before = data.structure.get(x, y, z);
      if (before == null) return;
      if (blockMatches(after, before, { strict: true })) return; // the build did not change this block
      if (current) {
        const now = current.get(x, y, z);
        if (now == null) {
          // could not read it: we cannot tell whether someone edited it since, so leave it alone
          unreadable++;
          return;
        }
        if (!blockMatches(after, now) && !blockMatches(before, now, { strict: true })) {
          conflicts.push({ pos: [x, y, z], expected: after, found: now });
          return;
        }
      }
      restore.set(x, y, z, before);
    });
    // grass/paths under the build turned into dirt while covered: put the original ground back
    // where the undo uncovers it (a second pass, once the blocks above are gone)
    if (current && data.meta?.groundLayer) {
      const [x1, gy, z1, x2, , z2] = data.box;
      for (let x = x1; x <= x2; x++) {
        for (let z = z1; z <= z2; z++) {
          if (data.after.get(x, gy, z) != null) continue;
          const before = data.structure.get(x, gy, z);
          const now = current.get(x, gy, z);
          const above = restore.get(x, gy + 1, z) ?? current.get(x, gy + 1, z);
          if (before && now && DECAYS_UNDER_COVER.has(blockName(before)) && blockName(now) === 'dirt' && (above == null || isAir(above))) {
            ground.set(x, gy, z, before);
          }
        }
      }
    }
  }
  const run = (structure) => executeBuild({
    structure, transport, at: [0, 0, 0], anchor: 'origin', strict: true, undo: false, force: true,
    fixMultiblocks: false, dimension, log, onProgress, stateDir,
  });
  let build = null, groundBuild = null;
  if (restore.count) build = await run(restore);
  if (ground.count) groundBuild = await run(ground);
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

/** Move an applied snapshot out of the way so the next `undo` targets the previous build. */
export function markApplied(snapFile) {
  const applied = path.join(path.dirname(snapFile), 'applied');
  fs.mkdirSync(applied, { recursive: true });
  fs.renameSync(snapFile, path.join(applied, path.basename(snapFile)));
}
