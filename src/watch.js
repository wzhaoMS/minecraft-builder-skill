/**
 * State of a `mcb watch` session: where it builds, what the world looked like before the session
 * first changed each block, and every state it has placed — so one undo snapshot can revert the
 * whole session, even after interrupted rebuilds or a restart.
 */
import { Structure } from './core/structure.js';

export class WatchSession {
  constructor({ maxStates = 16 } = {}) {
    this.maxStates = maxStates;
    this.placement = null; // { origin, facing, dimension, cleared } — fixed by the first build that reached the world
    this.placed = new Structure(); // every position the session has changed at least once
    this.baseline = new Structure(); // original block at each position the session changed
    // the cell under each changed position as first seen — only to repair grass decay on undo; kept
    // apart from the originals so a later edit there by a player is never "restored" away
    this.ground = new Structure();
    this.owned = new Map(); // "x,y,z" → states the session placed or was about to place, newest last
    this.unionBox = null;
  }

  /** Continue a session from its saved snapshot (decodeSnapshot output). */
  static fromSnapshot(data, opts) {
    const s = new WatchSession(opts);
    s.unionBox = data.box;
    s.placement = data.meta?.placement ?? null;
    const layers = [data.after, ...(data.afterAlt ?? [])].filter(Boolean);
    for (let i = layers.length - 1; i >= 0; i--) { // oldest layer first
      layers[i].forEach((x, y, z, b) => {
        const k = `${x},${y},${z}`;
        s.owned.set(k, [...(s.owned.get(k) ?? []), b]);
        if (!s.placed.has(x, y, z)) s.placed.set(x, y, z, b);
      });
    }
    // the saved "before" holds originals at changed positions and ground backups elsewhere
    data.structure.forEach((x, y, z, b) => (s.owned.has(`${x},${y},${z}`) ? s.baseline : s.ground).set(x, y, z, b));
    return s;
  }

  /** executeBuild options that keep later revisions in the same place, restoring removed blocks. */
  buildOptions(o) {
    if (!this.placement) return { ...o };
    return {
      ...o, at: this.placement.origin, anchor: 'origin', facing: this.placement.facing, near: undefined, side: undefined,
      rotate: undefined, clear: false, dimension: this.placement.dimension,
      previousWorld: this.placed, baseline: this.placement.cleared ? null : this.baseline,
    };
  }

  /**
   * Record a revision at its last read-only moment (executeBuild's beforeChanges hook). Originals
   * are taken when the session first CHANGES a block, from that revision's snapshot — not when a
   * block merely lies inside an earlier revision's box, so edits players make in between survive
   * an undo.
   */
  record(report, { clear = false } = {}) {
    if (report.snapshot && report.changed) {
      report.changed.forEach((x, y, z) => {
        if (!this.baseline.has(x, y, z)) {
          const v = report.snapshot.get(x, y, z);
          if (v != null) this.baseline.set(x, y, z, v);
        }
        if (!this.ground.has(x, y - 1, z)) {
          const g = report.snapshot.get(x, y - 1, z);
          if (g != null) this.ground.set(x, y - 1, z, g);
        }
      });
    }
    this.placement ??= { origin: report.origin, facing: report.facing, dimension: report.dimension, cleared: !!clear };
    if (!report.changed) {
      // no reads (RCON): we can't tell what changed, so treat every design position as ours
      report.world.forEach((x, y, z, b) => this.placed.set(x, y, z, b));
      return false;
    }
    report.changed.forEach((x, y, z, b) => {
      // positions the session has actually changed: only these are put back when a later version
      // of the design drops them (blocks that already matched were never ours to remove)
      this.placed.set(x, y, z, b);
      const k = `${x},${y},${z}`;
      const list = (this.owned.get(k) ?? []).filter((st) => st !== b);
      list.push(b);
      if (list.length > this.maxStates) list.shift();
      this.owned.set(k, list);
    });
    const b = report.snapshotBox ?? report.affectedBox;
    const u = this.unionBox;
    this.unionBox = u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.min(u[2], b[2]), Math.max(u[3], b[3]), Math.max(u[4], b[4]), Math.max(u[5], b[5])] : [...b];
    return this.owned.size > 0;
  }

  /** The session's undo snapshot (for saveSnapshot). */
  snapshot({ id, name, meta = {} }) {
    const after = new Structure();
    const afterAlt = [];
    for (const [k, list] of this.owned) {
      const [x, y, z] = k.split(',').map(Number);
      after.set(x, y, z, list[list.length - 1]);
      for (let i = list.length - 2, layer = 0; i >= 0; i--, layer++) (afterAlt[layer] ??= new Structure()).set(x, y, z, list[i]);
    }
    // "before": originals at changed positions; ground backups only where nothing was changed
    const before = this.baseline.clone();
    this.ground.forEach((x, y, z, b) => { if (!before.has(x, y, z) && !this.owned.has(`${x},${y},${z}`)) before.set(x, y, z, b); });
    return { id, name, box: this.unionBox, structure: before, after, afterAlt, meta: { ...meta, watch: true, placement: this.placement } };
  }
}
