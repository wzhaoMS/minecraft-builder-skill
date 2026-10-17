/**
 * Sponge Schematic (.schem) — the WorldEdit / FAWE format. Reads v1, v2 and v3; writes v2 and v3.
 *
 *   v1/v2: root compound "Schematic" { Version, DataVersion (v2), Width, Height, Length, Offset,
 *          Metadata?, PaletteMax?, Palette { "minecraft:stone": idx }, BlockData (varint bytes),
 *          BlockEntities (v2) / TileEntities (v1): [{ Pos: [I;x,y,z], Id, …data }] }
 *   v3:    root "" { Schematic { Version: 3, DataVersion, Width, Height, Length, Offset, Metadata?,
 *          Blocks { Palette, Data (varint bytes), BlockEntities: [{ Pos, Id, Data {…} }] } } }
 * Voxel index = x + z*Width + y*Width*Length. Structure coordinates are 0-based from the
 * schematic's minimum corner; the file's Offset / WorldEdit offsets are kept in `meta`.
 */
import { Structure } from '../../core/structure.js';
import { canonical, isAir } from '../../core/blockstate.js';
import {
  parseNbt, writeNbt, T, num, str, longToBig, defaultDataVersion, attachBlockEntity, splitNbt,
  blockEntityFromSnbt, denseVoxels, upgradeBlockState, MAX_IMPORTED_SNBT,
} from './nbt-util.js';

/** Descend into the nested "Schematic" compound used by v3 (and some other writers). */
function unwrap(value) {
  let v = value;
  for (let i = 0; i < 2; i++) {
    if (v.Schematic?.type === 'compound' && !v.Palette && !v.BlockData && !v.Blocks && !v.Width) v = v.Schematic.value;
  }
  return v;
}

/** Does this parsed NBT root look like a Sponge schematic? */
export function isSpongeNbt(root) {
  const v = unwrap(root.value);
  return !!(v.Palette || v.BlockData || v.Blocks?.type === 'compound' || (v.Version && v.Width && !v.Materials && v.Blocks?.type !== 'byteArray'));
}

/**
 * @param {Buffer|Uint8Array} buffer .schem file contents (gzipped or raw NBT)
 * @param {{ keepAir?: boolean, maxNbtLength?: number, targetDataVersion?: number }} [opts]
 *   keepAir: keep air as explicit 'air' (default: air → untouched);
 *   targetDataVersion: blocks renamed since the file's DataVersion are updated up to this version
 * @returns {Structure}
 */
export function readSponge(buffer, opts = {}) {
  return spongeFromNbt(parseNbt(buffer), opts);
}

/** Like readSponge, for an already parsed NBT root. */
export function spongeFromNbt(root, { keepAir = false, maxNbtLength = MAX_IMPORTED_SNBT, targetDataVersion = defaultDataVersion() } = {}) {
  const sch = unwrap(root.value);
  const blocksTag = sch.Blocks?.type === 'compound' ? sch.Blocks.value : null;
  const version = num(sch.Version) ?? (blocksTag ? 3 : sch.DataVersion ? 2 : 1);
  const W = num(sch.Width, { unsigned: true }) ?? 0;
  const H = num(sch.Height, { unsigned: true }) ?? 0;
  const L = num(sch.Length, { unsigned: true }) ?? 0;

  const s = new Structure({ name: 'schematic' });
  const md = sch.Metadata?.type === 'compound' ? sch.Metadata.value : {};
  if (str(md.Name)) s.name = str(md.Name);
  if (str(md.Author)) s.meta.author = str(md.Author);
  if (md.Date?.type === 'long') s.meta.date = Number(longToBig(md.Date.value));
  if (md.RequiredMods?.type === 'list' && md.RequiredMods.value.value.length) s.meta.requiredMods = md.RequiredMods.value.value.slice();
  Object.assign(s.meta, {
    format: 'sponge',
    formatVersion: version,
    dataVersion: num(sch.DataVersion) ?? null,
    size: [W, H, L],
  });
  if (sch.Offset?.type === 'intArray') s.meta.offset = Array.from(sch.Offset.value);
  if (num(md.WEOffsetX) !== undefined) s.meta.weOffset = [num(md.WEOffsetX), num(md.WEOffsetY), num(md.WEOffsetZ)];
  if (md.WorldEdit?.type === 'compound' && md.WorldEdit.value.Origin?.type === 'intArray') s.meta.weOrigin = Array.from(md.WorldEdit.value.Origin.value);

  const paletteTag = blocksTag ? blocksTag.Palette : sch.Palette;
  const dataTag = blocksTag ? blocksTag.Data : sch.BlockData;
  const beTag = blocksTag ? blocksTag.BlockEntities : (sch.BlockEntities ?? sch.TileEntities);
  const entities = sch.Entities?.type === 'list' ? sch.Entities.value.value.length : 0;
  if (entities) s.meta.entities = entities;

  if (!paletteTag || !dataTag) {
    if (version >= 3) return s; // v3 schematics may hold only biomes / entities
    throw new Error('Not a Sponge schematic: missing Palette/BlockData');
  }

  // palette index → structure palette id (0 = untouched)
  const pal = [];
  for (const [key, tag] of Object.entries(paletteTag.value)) pal[num(tag)] = key;
  const idMap = new Int32Array(pal.length).fill(-1);
  const airId = keepAir ? s.idOf('air') : 0;
  const from = s.meta.dataVersion ?? (version === 1 ? 1519 : null);
  for (let i = 0; i < pal.length; i++) {
    if (pal[i] === undefined) continue;
    let block;
    try {
      block = upgradeBlockState(canonical(pal[i]), { from, to: targetDataVersion });
    } catch (e) {
      throw new Error(`Bad palette entry "${pal[i]}" in schematic: ${e.message}`);
    }
    idMap[i] = isAir(block) ? airId : s.idOf(block);
  }

  const bytes = dataTag.value;
  const n = W * H * L;
  let x = 0, y = 0, z = 0, i = 0;
  for (let count = 0; count < n; count++) {
    if (i >= bytes.length) throw new Error(`Schematic block data is truncated (${count} of ${n} blocks)`);
    let v = 0, shift = 0, b;
    do {
      b = bytes[i++] & 0xff;
      v |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80 && shift < 35);
    const id = idMap[v];
    if (id === undefined || id < 0) throw new Error(`Schematic block data references palette index ${v}, which is not in the palette`);
    if (id) s.setId(x, y, z, id);
    if (++x === W) { x = 0; if (++z === L) { z = 0; y++; } }
  }

  const stats = { kept: 0, skipped: 0 };
  const bes = beTag?.type === 'list' ? beTag.value.value : [];
  for (const be of bes) {
    const pos = be.Pos?.value;
    if (!pos || pos.length < 3) continue;
    const data = be.Data?.type === 'compound' ? be.Data.value : be;
    attachBlockEntity(s, pos[0], pos[1], pos[2], data, stats, maxNbtLength);
  }
  if (bes.length) s.meta.blockEntities = { total: bes.length, ...stats };
  return s;
}

/**
 * Write a Sponge schematic. The structure's minimum corner becomes the schematic origin
 * (Offset = [0,0,0], so `//paste` puts that corner at the player); untouched voxels become air.
 * @param {import('../../core/structure.js').Structure} structure
 * @param {{ version?: 2|3, dataVersion?: number, name?: string, author?: string, date?: number,
 *           onWarning?: (msg: string) => void }} [opts]
 * @returns {Buffer} gzipped NBT
 */
export function writeSponge(structure, opts = {}) {
  const { version = 3, dataVersion = defaultDataVersion(), name = structure.name, author = structure.meta?.author, date = Date.now(), onWarning } = opts;
  if (version !== 2 && version !== 3) throw new Error(`Sponge schematic version must be 2 or 3, got ${version}`);
  const dense = denseVoxels(structure);
  if (!dense) throw new Error('Cannot export an empty structure (it has no blocks)');
  const [W, H, L] = dense.size;
  if (W > 65535 || H > 65535 || L > 65535) throw new Error(`Structure too large for a schematic (${W}×${H}×${L}, max 65535 per side)`);

  // Sponge palette: air first (untouched voxels), then the used block states (no SNBT).
  const palette = new Map([['minecraft:air', 0]]);
  const idx = new Int32Array(structure.palette.length);
  const nbtOf = [];
  for (let id = 1; id < structure.palette.length; id++) {
    if (!dense.used[id]) continue;
    const { state, snbt } = splitNbt(structure.palette[id]);
    const key = (state.includes(':') ? '' : 'minecraft:') + state;
    if (!palette.has(key)) palette.set(key, palette.size);
    idx[id] = palette.get(key);
    if (snbt) {
      try {
        nbtOf[id] = blockEntityFromSnbt(state, snbt);
      } catch (e) {
        onWarning?.(`dropped block entity data of ${state}: ${e.message}`);
      }
    }
  }

  // Varint-encode the voxels (one byte each while the palette has ≤ 128 entries).
  const n = W * H * L;
  const ids = dense.ids;
  let total = 0;
  if (palette.size <= 128) total = n;
  else for (let i = 0; i < n; i++) { const v = idx[ids[i]]; total += v < 128 ? 1 : v < 16384 ? 2 : 3; }
  const data = new Int8Array(total);
  const blockEntities = [];
  const WL = W * L;
  for (let i = 0, o = 0; i < n; i++) {
    const id = ids[i];
    let v = idx[id];
    while (v >= 128) { data[o++] = (v & 0x7f) | 0x80; v >>>= 7; }
    data[o++] = v;
    if (nbtOf[id]) {
      const pos = T.intArray([i % W, Math.floor(i / WL), Math.floor(i / W) % L]);
      const { id: beId, data: beData } = nbtOf[id];
      blockEntities.push(version === 3
        ? { Pos: pos, Id: T.string(beId), Data: T.comp(beData) }
        : { ...beData, Pos: pos, Id: T.string(beId) });
    }
  }

  const paletteTag = T.comp(Object.fromEntries([...palette].map(([k, v]) => [k, T.int(v)])));
  const metadata = { Name: T.string(name ?? 'structure'), Date: T.long(date) };
  if (author) metadata.Author = T.string(author);
  const common = {
    Version: T.int(version),
    DataVersion: T.int(dataVersion),
    Width: T.short(W),
    Height: T.short(H),
    Length: T.short(L),
    Offset: T.intArray([0, 0, 0]),
  };
  if (version === 3) {
    const schematic = {
      ...common,
      Metadata: T.comp(metadata),
      Blocks: T.comp({ Palette: paletteTag, Data: T.byteArray(data), BlockEntities: T.list('compound', blockEntities) }),
    };
    return writeNbt({ Schematic: T.comp(schematic) }, '');
  }
  const schematic = {
    ...common,
    Metadata: T.comp({ ...metadata, WEOffsetX: T.int(0), WEOffsetY: T.int(0), WEOffsetZ: T.int(0) }),
    PaletteMax: T.int(palette.size),
    Palette: paletteTag,
    BlockData: T.byteArray(data),
    BlockEntities: T.list('compound', blockEntities),
  };
  return writeNbt(schematic, 'Schematic');
}
