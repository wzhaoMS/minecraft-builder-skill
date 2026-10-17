/**
 * Litematica schematics (.litematic). Read: all regions merged into one Structure. Write: one region.
 *
 *   { MinecraftDataVersion, Version, SubVersion?, Metadata { Name, Author, Description, EnclosingSize,
 *     RegionCount, TotalBlocks, TotalVolume, TimeCreated, TimeModified, … },
 *     Regions { <name>: { Position {x,y,z}, Size {x,y,z}, BlockStatePalette [{ Name, Properties? }],
 *                         BlockStates (long[]), TileEntities [{ x, y, z, …data }], Entities, … } } }
 *
 * BlockStates packs palette indices with bits = max(2, ceil(log2(paletteSize))) per entry as one
 * continuous little-endian bit stream: entries may SPAN two longs (Litematica's own layout, not the
 * padded 1.16+ chunk layout). Entry index = x + z*sizeX + y*sizeX*sizeZ within the region box.
 * A negative Size means the region extends from Position in the negative direction; the box's
 * minimum corner is then Position + Size + 1. Region positions are relative to the schematic
 * origin; the merged Structure is shifted so the enclosing box starts at (0,0,0).
 */
import { Structure } from '../../core/structure.js';
import { isAir } from '../../core/blockstate.js';
import {
  parseNbt, writeNbt, T, num, str, longToBig, defaultDataVersion, attachBlockEntity, stateFromNbt,
  paletteCompound, splitNbt, blockEntityFromSnbt, denseVoxels, upgradeBlockState, MAX_IMPORTED_SNBT,
} from './nbt-util.js';

/** Does this parsed NBT root look like a Litematica schematic? */
export function isLitematicNbt(root) {
  return root.value.Regions?.type === 'compound';
}

const vec = (tag) => {
  const v = tag?.type === 'compound' ? tag.value : {};
  return [num(v.x) ?? 0, num(v.y) ?? 0, num(v.z) ?? 0];
};

/** Bits per entry used by Litematica for a palette of `size` entries. */
export function litematicBits(size) {
  return Math.max(2, 32 - Math.clz32(Math.max(1, size) - 1));
}

/** Unpack `count` entries of `bits` bits from a long array ([hi, lo] pairs, spanning layout). */
export function unpackSpanning(longs, bits, count) {
  const words = new Uint32Array(longs.length * 2);
  for (let i = 0; i < longs.length; i++) {
    words[2 * i] = longs[i][1] >>> 0;
    words[2 * i + 1] = longs[i][0] >>> 0;
  }
  const mask = bits >= 32 ? 0xffffffff : (2 ** bits) - 1;
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const bit = i * bits;
    const w = Math.floor(bit / 32);
    const o = bit % 32;
    let v = words[w] >>> o;
    if (o + bits > 32) v |= words[w + 1] << (32 - o);
    out[i] = (v & mask) >>> 0;
  }
  return out;
}

/** Inverse of unpackSpanning → long array ([hi, lo] pairs). */
export function packSpanning(values, bits) {
  const nLongs = Math.ceil((values.length * bits) / 64);
  const words = new Uint32Array(nLongs * 2 + 1);
  for (let i = 0; i < values.length; i++) {
    const v = values[i] >>> 0;
    const bit = i * bits;
    const w = Math.floor(bit / 32);
    const o = bit % 32;
    words[w] = (words[w] | (v << o)) >>> 0;
    if (o + bits > 32) words[w + 1] = (words[w + 1] | (v >>> (32 - o))) >>> 0;
  }
  const longs = new Array(nLongs);
  for (let i = 0; i < nLongs; i++) longs[i] = [words[2 * i + 1] | 0, words[2 * i] | 0];
  return longs;
}

/**
 * @param {Buffer|Uint8Array} buf .litematic file contents
 * @param {{ keepAir?: boolean, maxNbtLength?: number, targetDataVersion?: number }} [opts]
 * @returns {Structure}
 */
export function readLitematic(buf, opts = {}) {
  return litematicFromNbt(parseNbt(buf), opts);
}

/** Like readLitematic, for an already parsed NBT root. */
export function litematicFromNbt(root, { keepAir = false, maxNbtLength = MAX_IMPORTED_SNBT, targetDataVersion = defaultDataVersion() } = {}) {
  const v = root.value;
  if (!isLitematicNbt(root)) throw new Error('Not a Litematica schematic: missing "Regions"');
  const md = v.Metadata?.type === 'compound' ? v.Metadata.value : {};
  const s = new Structure({ name: str(md.Name) || 'litematic', description: str(md.Description) ?? '' });
  if (str(md.Author)) s.meta.author = str(md.Author);
  if (md.TimeCreated?.type === 'long') s.meta.date = Number(longToBig(md.TimeCreated.value));
  Object.assign(s.meta, {
    format: 'litematic',
    formatVersion: num(v.Version) ?? null,
    dataVersion: num(v.MinecraftDataVersion) ?? null,
  });

  // region boxes (minimum corner + absolute size)
  const regions = [];
  for (const [name, tag] of Object.entries(v.Regions.value)) {
    if (tag.type !== 'compound') continue;
    const r = tag.value;
    const pos = vec(r.Position), size = vec(r.Size);
    const min = pos.map((p, i) => (size[i] < 0 ? p + size[i] + 1 : p));
    regions.push({ name, r, pos, size, min, abs: size.map(Math.abs) });
  }
  const origin = regions.length ? [0, 1, 2].map((i) => Math.min(...regions.map((g) => g.min[i]))) : [0, 0, 0];
  const encl = regions.length ? [0, 1, 2].map((i) => Math.max(...regions.map((g) => g.min[i] + g.abs[i])) - origin[i]) : [0, 0, 0];
  s.meta.size = encl;
  s.meta.regions = regions.map((g) => ({ name: g.name, position: g.pos, size: g.size }));

  const airId = keepAir ? s.idOf('air') : 0;
  const stats = { kept: 0, skipped: 0 };
  let beTotal = 0, entities = 0;
  for (const g of regions) {
    const [sx, sy, sz] = g.abs;
    const volume = sx * sy * sz;
    if (!volume) continue;
    const palTag = g.r.BlockStatePalette;
    const pal = palTag?.type === 'list' ? palTag.value.value : [];
    if (!pal.length) continue;
    const ids = pal.map((p) => {
      const raw = stateFromNbt(str(p.Name) ?? 'minecraft:air', p.Properties?.type === 'compound' ? p.Properties.value : null);
      const block = s.meta.dataVersion ? upgradeBlockState(raw, { from: s.meta.dataVersion, to: targetDataVersion }) : raw;
      return isAir(block) ? airId : s.idOf(block);
    });
    const longs = g.r.BlockStates?.type === 'longArray' ? g.r.BlockStates.value : [];
    let bits = litematicBits(pal.length);
    if (Math.ceil((volume * bits) / 64) !== longs.length) {
      // Tolerate writers that size entries differently: infer bits from the array length.
      const alt = [...Array(32).keys()].map((b) => b + 1).find((b) => Math.ceil((volume * b) / 64) === longs.length && 2 ** b >= pal.length);
      if (!alt) throw new Error(`Litematica region "${g.name}": BlockStates has ${longs.length} longs, expected ${Math.ceil((volume * bits) / 64)}`);
      bits = alt;
    }
    const values = unpackSpanning(longs, bits, volume);
    const [ox, oy, oz] = [g.min[0] - origin[0], g.min[1] - origin[1], g.min[2] - origin[2]];
    const layer = sx * sz;
    for (let i = 0; i < volume; i++) {
      const id = ids[values[i]];
      if (!id) continue;
      s.setId(ox + (i % sx), oy + Math.floor(i / layer), oz + (Math.floor(i / sx) % sz), id);
    }
    const tes = g.r.TileEntities?.type === 'list' ? g.r.TileEntities.value.value : [];
    for (const te of tes) {
      beTotal++;
      const [x, y, z] = [num(te.x), num(te.y), num(te.z)];
      if ([x, y, z].some((c) => c === undefined)) continue;
      attachBlockEntity(s, ox + x, oy + y, oz + z, te, stats, maxNbtLength);
    }
    if (g.r.Entities?.type === 'list') entities += g.r.Entities.value.value.length;
  }
  if (beTotal) s.meta.blockEntities = { total: beTotal, ...stats };
  if (entities) s.meta.entities = entities;
  return s;
}

/**
 * Write a single-region Litematica schematic (origin = the structure's minimum corner;
 * untouched voxels become air).
 * @param {import('../../core/structure.js').Structure} structure
 * @param {{ dataVersion?: number, name?: string, author?: string, description?: string, date?: number,
 *           regionName?: string, onWarning?: (msg: string) => void }} [opts]
 * @returns {Buffer} gzipped NBT
 */
export function writeLitematic(structure, opts = {}) {
  const {
    dataVersion = defaultDataVersion(), name = structure.name, author = structure.meta?.author ?? 'mcb',
    description = structure.description ?? '', date = Date.now(), regionName = name || 'main', onWarning,
  } = opts;
  const dense = denseVoxels(structure);
  if (!dense) throw new Error('Cannot export an empty structure (it has no blocks)');
  const [W, H, L] = dense.size;
  const n = W * H * L;

  const palette = [paletteCompound('air')];
  const stateIndex = new Map([['air', 0]]);
  const idx = new Uint32Array(structure.palette.length);
  const beOf = [];
  let nonAir = 0;
  for (let id = 1; id < structure.palette.length; id++) {
    if (!dense.used[id]) continue;
    const { state, snbt } = splitNbt(structure.palette[id]);
    if (!stateIndex.has(state)) {
      stateIndex.set(state, palette.length);
      palette.push(paletteCompound(state));
    }
    idx[id] = stateIndex.get(state);
    if (snbt) {
      try {
        const { id: beId, data } = blockEntityFromSnbt(state, snbt);
        beOf[id] = { ...data, id: T.string(beId) };
      } catch (e) {
        onWarning?.(`dropped block entity data of ${state}: ${e.message}`);
      }
    }
  }
  const values = new Uint32Array(n);
  const tileEntities = [];
  const WL = W * L;
  for (let i = 0; i < n; i++) {
    const id = dense.ids[i];
    const v = idx[id];
    values[i] = v;
    if (v !== 0) nonAir++;
    if (beOf[id]) tileEntities.push({ x: T.int(i % W), y: T.int(Math.floor(i / WL)), z: T.int(Math.floor(i / W) % L), ...beOf[id] });
  }
  const bits = litematicBits(palette.length);
  const xyz = (x, y, z) => T.comp({ x: T.int(x), y: T.int(y), z: T.int(z) });
  const region = {
    Position: xyz(0, 0, 0),
    Size: xyz(W, H, L),
    BlockStatePalette: T.list('compound', palette),
    BlockStates: T.longArray(packSpanning(values, bits)),
    TileEntities: T.list('compound', tileEntities),
    Entities: T.list('compound', []),
    PendingBlockTicks: T.list('compound', []),
    PendingFluidTicks: T.list('compound', []),
  };
  const metadata = {
    Name: T.string(name ?? 'structure'),
    Author: T.string(author),
    Description: T.string(description),
    RegionCount: T.int(1),
    TotalVolume: T.int(n),
    TotalBlocks: T.int(nonAir),
    TimeCreated: T.long(date),
    TimeModified: T.long(date),
    EnclosingSize: xyz(W, H, L),
  };
  return writeNbt({
    MinecraftDataVersion: T.int(dataVersion),
    Version: T.int(6),
    SubVersion: T.int(1),
    Metadata: T.comp(metadata),
    Regions: T.comp({ [regionName]: T.comp(region) }),
  }, '');
}
