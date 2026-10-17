/**
 * Vanilla structure-block format (.nbt, gzipped) — used by structure blocks, `/place template`
 * and data packs (`data/<ns>/structure/<name>.nbt`).
 *
 *   { DataVersion, size: [x,y,z], palette: [{ Name, Properties? }] (or palettes: [[…], …]),
 *     blocks: [{ pos: [x,y,z], state: <palette index>, nbt?: {…} }], entities: [{ pos, blockPos, nbt }] }
 *
 * Positions not listed in `blocks` are "void": placing the structure leaves the world untouched
 * there. So on write, untouched voxels are simply omitted while explicit air is written as air;
 * on read, structure_void and (by default) air become untouched.
 */
import { Structure } from '../../core/structure.js';
import { isAir } from '../../core/blockstate.js';
import { placementPhase } from '../../core/blockinfo.js';
import {
  parseNbt, writeNbt, T, num, str, defaultDataVersion, attachBlockEntity, stateFromNbt, paletteCompound,
  splitNbt, blockEntityFromSnbt, isVoidOrAir, upgradeBlockState, MAX_IMPORTED_SNBT,
} from './nbt-util.js';

/** Does this parsed NBT root look like a vanilla structure file? */
export function isStructureNbt(root) {
  const v = root.value;
  return v.blocks?.type === 'list' && (v.palette?.type === 'list' || v.palettes?.type === 'list');
}

/**
 * @param {Buffer|Uint8Array} buf .nbt file contents (gzipped or raw)
 * @param {{ keepAir?: boolean, palette?: number, maxNbtLength?: number, targetDataVersion?: number }} [opts]
 *   palette: which palette to use for files with several (`palettes`, e.g. shipwrecks); default 0
 * @returns {Structure}
 */
export function readStructureNbt(buf, opts = {}) {
  return structureFromNbt(parseNbt(buf), opts);
}

/** Like readStructureNbt, for an already parsed NBT root. */
export function structureFromNbt(root, { keepAir = false, palette: paletteIndex = 0, maxNbtLength = MAX_IMPORTED_SNBT, targetDataVersion = defaultDataVersion() } = {}) {
  const v = root.value;
  if (!isStructureNbt(root)) throw new Error('Not a structure file: missing "blocks" / "palette"');
  let palette;
  if (v.palette?.type === 'list') palette = v.palette.value.value;
  else {
    const all = v.palettes.value.value;
    const p = all[paletteIndex] ?? all[0];
    palette = p ? p.value : [];
  }
  const s = new Structure({ name: 'structure' });
  const size = v.size?.type === 'list' ? v.size.value.value.slice(0, 3) : null;
  Object.assign(s.meta, { format: 'structure', dataVersion: num(v.DataVersion) ?? null });
  if (size) s.meta.size = size;
  if (str(v.author)) s.meta.author = str(v.author);
  const entities = v.entities?.type === 'list' ? v.entities.value.value.length : 0;
  if (entities) s.meta.entities = entities;

  const airId = keepAir ? s.idOf('air') : 0;
  const from = s.meta.dataVersion;
  const ids = palette.map((p) => {
    const raw = stateFromNbt(str(p.Name) ?? 'minecraft:air', p.Properties?.type === 'compound' ? p.Properties.value : null);
    const block = from ? upgradeBlockState(raw, { from, to: targetDataVersion }) : raw;
    if (isVoidOrAir(block)) return isAir(block) ? airId : 0;
    return s.idOf(block);
  });

  const stats = { kept: 0, skipped: 0 };
  let withNbt = 0;
  for (const b of v.blocks.value.value) {
    const pos = b.pos?.value?.value;
    const id = ids[num(b.state)];
    if (!pos || !id) continue;
    const [x, y, z] = pos;
    s.setId(x, y, z, id);
    if (b.nbt?.type === 'compound') {
      withNbt++;
      attachBlockEntity(s, x, y, z, b.nbt.value, stats, maxNbtLength);
    }
  }
  if (withNbt) s.meta.blockEntities = { total: withNbt, ...stats };
  return s;
}

/**
 * Write a vanilla structure file. Origin = the structure's minimum corner.
 * @param {import('../../core/structure.js').Structure} structure
 * @param {{ dataVersion?: number, onWarning?: (msg: string) => void }} [opts]
 * @returns {Buffer} gzipped NBT
 */
export function writeStructureNbt(structure, { dataVersion = defaultDataVersion(), onWarning } = {}) {
  const bounds = structure.bounds();
  if (!bounds) throw new Error('Cannot export an empty structure (it has no blocks)');
  const [mx, my, mz] = bounds.min;

  const palette = [];
  const stateIndex = new Map();
  const info = []; // per structure palette id: { state, nbt, group }
  const entries = [];
  structure.forEach((x, y, z, block, id) => {
    let inf = info[id];
    if (!inf) {
      const { state, snbt } = splitNbt(block);
      let idx = stateIndex.get(state);
      if (idx === undefined) {
        idx = palette.length;
        palette.push(paletteCompound(state));
        stateIndex.set(state, idx);
      }
      let be = null;
      if (snbt) {
        try {
          const { id: beId, data } = blockEntityFromSnbt(state, snbt);
          be = { ...data, id: T.string(beId) };
        } catch (e) {
          onWarning?.(`dropped block entity data of ${state}: ${e.message}`);
        }
      }
      // vanilla order: plain structural blocks, then attached/fluid blocks, then block entities
      inf = info[id] = { idx, be, group: be ? 3 : placementPhase(state) };
    }
    entries.push([x - mx, y - my, z - mz, inf]);
  });
  entries.sort((a, b) => a[3].group - b[3].group || a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);
  const blocks = entries.map(([x, y, z, inf]) => {
    const e = { pos: T.list('int', [x, y, z]), state: T.int(inf.idx) };
    if (inf.be) e.nbt = T.comp(inf.be);
    return e;
  });
  return writeNbt({
    DataVersion: T.int(dataVersion),
    size: T.list('int', bounds.size.slice()),
    palette: T.list('compound', palette),
    blocks: T.list('compound', blocks),
    entities: T.list('compound', []),
  }, '');
}
