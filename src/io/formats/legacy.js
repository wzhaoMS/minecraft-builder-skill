/**
 * MCEdit / Schematica `.schematic` (pre-1.13 numeric block ids), read through prismarine-schematic,
 * which maps id:data to 1.13 block states using WorldEdit's legacy table. Names that changed after
 * 1.13 are then updated to their modern equivalents (grass → short_grass, sign → oak_sign, …).
 * Tile entities / entities are not imported.
 */
import { createRequire } from 'node:module';
import { Structure } from '../../core/structure.js';
import { canonical, isAir } from '../../core/blockstate.js';
import { inflate, upgradeBlockState, defaultDataVersion } from './nbt-util.js';

const require = createRequire(import.meta.url);
let lib = null;
const schematicLib = () => (lib ??= require('prismarine-schematic'));

/** DataVersion of 1.13.2, the block-state version prismarine-schematic maps legacy ids to. */
const LEGACY_STATES_DV = 1631;

/** Update a 1.13 block state (name + props) to current names / property values. */
export function modernizeLegacyState(name, props, targetDataVersion = defaultDataVersion()) {
  const p = {};
  for (const [k, v] of Object.entries(props || {})) p[k] = String(v);
  // prismarine-schematic resolves properties missing from the legacy table to their first value
  // (true for booleans): nothing was waterlogged before 1.13, and powered isn't stored for these.
  if ('waterlogged' in p) p.waterlogged = 'false';
  if ((name === 'note_block' || name === 'iron_trapdoor') && 'powered' in p) p.powered = 'false';
  const keys = Object.keys(p);
  const block = canonical(keys.length ? `${name}[${keys.map((k) => `${k}=${p[k]}`).join(',')}]` : name);
  return upgradeBlockState(block, { from: LEGACY_STATES_DV, to: targetDataVersion });
}

/**
 * @param {Buffer|Uint8Array} buf .schematic file contents (MCEdit format, gzipped)
 * @param {{ keepAir?: boolean, targetDataVersion?: number }} [opts]
 * @returns {Promise<Structure>}
 */
export async function readLegacySchematic(buf, { keepAir = false, targetDataVersion = defaultDataVersion() } = {}) {
  const { Schematic } = schematicLib();
  // Decompress up front so prismarine-schematic parses synchronously, and silence its console.log
  // warnings (unknown ids) so they can't corrupt --json output; they are returned in meta.warnings.
  const raw = inflate(buf);
  const warnings = [];
  const log = console.log;
  console.log = (...a) => { if (warnings.length < 50) warnings.push(a.join(' ')); };
  let schem;
  try {
    schem = await Schematic.read(raw);
  } catch (e) {
    throw new Error(`Could not read MCEdit schematic: ${e.message}`);
  } finally {
    console.log = log;
  }
  const { x: W, y: H, z: L } = schem.size;
  const s = new Structure({ name: 'schematic' });
  const airId = keepAir ? s.idOf('air') : 0;
  const ids = schem.palette.map((stateId) => {
    const b = schem.Block.fromStateId(stateId, 0);
    if (!b || !b.name) return 0;
    const block = modernizeLegacyState(b.name, b.getProperties(), targetDataVersion);
    return isAir(block) ? airId : s.idOf(block);
  });
  const blocks = schem.blocks;
  const WL = W * L;
  for (let i = 0; i < blocks.length; i++) {
    const id = ids[blocks[i]];
    if (id) s.setId(i % W, Math.floor(i / WL), Math.floor(i / W) % L, id);
  }
  Object.assign(s.meta, {
    format: 'mcedit',
    size: [W, H, L],
    offset: [schem.offset.x, schem.offset.y, schem.offset.z],
    sourceVersion: schem.version,
  });
  if (warnings.length) s.meta.warnings = warnings;
  return s;
}
