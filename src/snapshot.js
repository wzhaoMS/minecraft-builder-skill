/**
 * World snapshots for undo / verification: read a box of blocks through a bot and store it as a
 * compact gzip JSON (palette + run-length encoded dense array, order y → z → x).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Structure } from './core/structure.js';
import { splitBox } from './compile/plan.js';

/** Blocks whose block-entity data the server shares with clients (text, patterns, profiles, sherds). */
const CLIENT_BLOCK_ENTITY = /^[a-z0-9_:]*(_sign|_banner|_skull|_head|decorated_pot)(\[|$)/;

/**
 * Read every block in `box` ([x1,y1,z1,x2,y2,z2]) via a transport that can read (bot).
 * @returns {Promise<{ structure: Structure, unknown: number }>}
 */
export async function captureRegion(transport, box, { tile = transport.readTileSize ?? 64, onProgress } = {}) {
  if (!transport.canRead) throw new Error(`The ${transport.kind} transport cannot read blocks (use the bot transport)`);
  // reading far-away areas means flying the bot there (/tp): that needs operator rights
  transport.requireOp?.();
  const [x1, y1, z1, x2, y2, z2] = box;
  const s = new Structure({ name: 'snapshot' });
  let unknown = 0;
  const tiles = splitBox({ x1, y1, z1, x2, y2, z2 }, Number.MAX_SAFE_INTEGER, tile);
  let done = 0;
  for (const t of tiles) {
    await transport.loadArea({ x1: t.x1, z1: t.z1, x2: t.x2, z2: t.z2 }, { topY: y2 });
    await transport.syncWorld?.(); // include changes made by others up to now
    let waited = false;
    for (let y = t.y1; y <= t.y2; y++) {
      for (let z = t.z1; z <= t.z2; z++) {
        for (let x = t.x1; x <= t.x2; x++) {
          let b = transport.readBlock(x, y, z);
          if (b === undefined && !waited) {
            // give missing chunks one chance per tile, then count the rest as unknown
            waited = true;
            await transport.waitForArea?.({ x1: t.x1, z1: t.z1, x2: t.x2, z2: t.z2 }, 5000);
            b = transport.readBlock(x, y, z);
          }
          if (b === undefined) { unknown++; continue; }
          if (b === 'cave_air' || b === 'void_air') b = 'air';
          // keep what the client knows of block entities (sign text, banners, heads) with the block
          else if (transport.readBlockEntitySnbt && CLIENT_BLOCK_ENTITY.test(b) && !b.startsWith('piston_head')) {
            const nbt = transport.readBlockEntitySnbt(x, y, z);
            if (nbt) b += nbt;
          }
          s.set(x, y, z, b);
        }
      }
    }
    done++;
    onProgress?.(done, tiles.length);
  }
  return { structure: s, unknown };
}

function rleEncode(structure, box, palette, pidx) {
  const [x1, y1, z1, x2, y2, z2] = box;
  const rle = [];
  let last = -1, run = 0;
  for (let y = y1; y <= y2; y++) {
    for (let z = z1; z <= z2; z++) {
      for (let x = x1; x <= x2; x++) {
        const b = structure.get(x, y, z);
        let i = 0;
        if (b != null) {
          i = pidx.get(b);
          if (i === undefined) { i = palette.length; palette.push(b); pidx.set(b, i); }
        }
        if (i === last) run++;
        else { if (run) rle.push(run, last); last = i; run = 1; }
      }
    }
  }
  if (run) rle.push(run, last);
  return rle;
}

function rleDecode(rle, box, ids, s) {
  const [x1, y1, z1, x2, , z2] = box;
  let x = x1, y = y1, z = z1;
  for (let i = 0; i < rle.length; i += 2) {
    const n = rle[i], id = ids[rle[i + 1]];
    for (let k = 0; k < n; k++) {
      if (id) s.setId(x, y, z, id);
      if (++x > x2) { x = x1; if (++z > z2) { z = z1; y++; } }
    }
  }
  return s;
}

/**
 * Encode a snapshot: `structure` = world blocks before the build (whole box),
 * `after` = what the build set (null where it didn't touch) — lets undo restore only what the
 * build changed and detect edits made since. `afterAlt` (optional, watch sessions): further
 * layers of states the session may have left at a position (earlier, possibly interrupted
 * revisions), so undo also recognises those as its own.
 */
export function encodeSnapshot({ id, name, box, structure, after = null, afterAlt = [], meta = {} }) {
  const palette = [null];
  const pidx = new Map();
  const rle = rleEncode(structure, box, palette, pidx);
  const afterRle = after ? rleEncode(after, box, palette, pidx) : null;
  const altRle = afterAlt.filter((s) => s?.count).map((s) => rleEncode(s, box, palette, pidx));
  const json = JSON.stringify({
    format: 'mcb-snapshot', version: 2, id, name, createdAt: new Date().toISOString(), box, palette, rle, after: afterRle,
    ...(altRle.length ? { afterAlt: altRle } : {}), meta,
  });
  return zlib.gzipSync(json);
}

export function decodeSnapshot(buf) {
  const data = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  if (data.format !== 'mcb-snapshot') throw new Error('Not an mcb snapshot');
  const s = new Structure({ name: data.name ?? 'snapshot' });
  const ids = data.palette.map((b) => (b == null ? 0 : s.idOf(b)));
  rleDecode(data.rle, data.box, ids, s);
  const layer = (rle, label) => {
    const out = new Structure({ name: `${data.name ?? 'snapshot'}-${label}` });
    const lids = data.palette.map((b) => (b == null ? 0 : out.idOf(b)));
    return rleDecode(rle, data.box, lids, out);
  };
  const after = data.after ? layer(data.after, 'after') : null;
  const afterAlt = (data.afterAlt ?? []).map((rle, i) => layer(rle, `alt${i}`));
  return { ...data, structure: s, after, afterAlt };
}

export function snapshotDir(stateDir) {
  return path.join(stateDir, 'undo');
}

export function saveSnapshot(stateDir, snap, { overwrite = false } = {}) {
  const dir = snapshotDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${snap.id}.json.gz`);
  const exists = () => Object.assign(new Error(`EEXIST: snapshot ${snap.id} already exists`), { code: 'EEXIST' });
  if (!overwrite && fs.existsSync(file)) throw exists();
  // write a temp file, then publish it in one step: a crash mid-write never leaves a torn snapshot.
  // Overwrites (watch) replace atomically via rename; new snapshots are hard-linked into place,
  // which fails instead of clobbering if the name appeared in the meantime.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, encodeSnapshot(snap));
    if (overwrite) {
      fs.renameSync(tmp, file);
    } else {
      try {
        fs.linkSync(tmp, file);
      } catch (e) {
        if (e.code === 'EEXIST') throw exists();
        if (!NO_HARDLINKS.has(e.code)) throw e;
        // filesystem without hard links: an exclusive copy still never clobbers
        try {
          fs.copyFileSync(tmp, file, fs.constants.COPYFILE_EXCL);
        } catch (e2) {
          throw e2.code === 'EEXIST' ? exists() : e2;
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return file;
}

const NO_HARDLINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EMLINK']);

/** Snapshots newest first: [{ id, file, mtime }] */
export function listSnapshots(stateDir) {
  const dir = snapshotDir(stateDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json.gz'))
    .map((f) => {
      const file = path.join(dir, f);
      return { id: f.replace(/\.json\.gz$/, ''), file, mtime: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime || (a.id < b.id ? 1 : -1));
}

export function newSnapshotId(name = 'build') {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const rand = crypto.randomBytes(4).readUInt32BE(0).toString(36).padStart(7, '0');
  return `${ts}-${String(name).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40)}-${rand}`;
}
