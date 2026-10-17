/**
 * Building helpers shared by the built-in generators and by user JS blueprints.
 *
 *   import { materialFamily, stairs, door, gableRoof, finish } from '../../src/generators/helpers.js';
 *
 * Conventions (same as the generators): +X east, +Z south, +Y up; y = 0 is the first layer above
 * the ground; the front of a build faces SOUTH. All helpers write into a `Structure` and return it
 * (or return block-state strings), so they can be freely combined with the Structure API.
 *
 * Every block name produced here exists in Minecraft 1.21.11 (checked against minecraft-data).
 */
import { mcData, DEFAULT_MC_VERSION } from '../core/blockinfo.js';
import { parseBlock, formatBlock, blockName, isAir } from '../core/blockstate.js';

// ───────────────────────────── directions ─────────────────────────────

/** Unit vectors for the horizontal directions (and up/down). */
export const DIRS = Object.freeze({
  north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
});
export const HORIZONTAL = Object.freeze(['north', 'east', 'south', 'west']);
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
const CW = { north: 'east', east: 'south', south: 'west', west: 'north' };
const CCW = { north: 'west', west: 'south', south: 'east', east: 'north' };

/** Opposite direction (`north` → `south`). */
export const opposite = (d) => OPP[d] ?? d;
/** Direction after a clockwise quarter turn seen from above (`north` → `east`). */
export const clockwise = (d) => CW[d] ?? d;
/** Direction after a counter-clockwise quarter turn (`north` → `west`). */
export const counterClockwise = (d) => CCW[d] ?? d;
/** Horizontal direction that best matches a vector (dx, dz). */
export function dirFromDelta(dx, dz) {
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 'east' : 'west';
  return dz >= 0 ? 'south' : 'north';
}

// ───────────────────────────── block existence ─────────────────────────────

let blockNames = null;
let blockDefs = null;
function data() {
  if (blockNames === null) {
    const d = mcData(DEFAULT_MC_VERSION);
    blockNames = d ? new Set(d.blocksArray.map((b) => b.name)) : new Set();
    blockDefs = d ? d.blocksByName : {};
  }
  return blockNames;
}

/** True when a block (name, props ignored) exists in Minecraft 1.21.11. */
export function blockExists(block) {
  const n = data();
  return n.size === 0 ? true : n.has(blockName(block));
}

/** True when the block has the given block-state property (e.g. `axis`, `facing`). */
export function hasProp(block, prop) {
  data();
  const def = blockDefs?.[blockName(block)];
  return !!def?.states?.some((s) => s.name === prop);
}

const ex = (name) => (name && blockExists(name) ? name : null);

/** Return `block` with `props` merged in (only props the block actually has, unless `force`). */
export function withProps(block, props, { force = false } = {}) {
  if (block == null) return block;
  const b = parseBlock(block);
  const p = { ...b.props };
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (force || hasProp(b.name, k)) p[k] = String(v);
  }
  return formatBlock({ ...b, props: p });
}

/** Orient a log / pillar / chain-like block along an axis (no-op for blocks without `axis`). */
export const withAxis = (block, axis = 'y') => withProps(block, { axis });

// ───────────────────────────── material families ─────────────────────────────

/** Wood types that have a full set of planks/stairs/slabs/doors/… in 1.21.11. */
export const WOOD_TYPES = Object.freeze(['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped']);

const WOOD_RE = new RegExp(
  `^(?:stripped_)?(${WOOD_TYPES.join('|')})(?:_(?:planks|log|wood|stem|hyphae|stairs|slab|fence|fence_gate|door|trapdoor|button|pressure_plate|leaves|sign|wall_sign|hanging_sign|wall_hanging_sign|block|mosaic|mosaic_stairs|mosaic_slab|shelf))?$`,
);
const COPPER_RE = /^(waxed_)?(exposed_|weathered_|oxidized_)?(cut_|chiseled_)?copper(?:_(block|stairs|slab|door|trapdoor|grate|bulb))?$/;

// Names people use that are not blocks → the block they mean.
const ALIASES = {
  quartz: 'quartz_block', purpur: 'purpur_block', brick: 'bricks', stone_brick: 'stone_bricks', nether_brick: 'nether_bricks',
  red_nether_brick: 'red_nether_bricks', end_brick: 'end_stone_bricks', end_stone_brick: 'end_stone_bricks', mud_brick: 'mud_bricks',
  resin_brick: 'resin_bricks', tuff_brick: 'tuff_bricks', deepslate_brick: 'deepslate_bricks', deepslate_tile: 'deepslate_tiles',
  prismarine_brick: 'prismarine_bricks', mossy_stone_brick: 'mossy_stone_bricks', polished_blackstone_brick: 'polished_blackstone_bricks',
  cobble: 'cobblestone', mossy_cobble: 'mossy_cobblestone', smooth_quartz_block: 'smooth_quartz', concrete: 'white_concrete', wool: 'white_wool',
  planks: 'oak_planks', wood: 'oak_planks', log: 'oak_log', glass_block: 'glass',
};

const VARIANTS = {
  stone_bricks: ['mossy_stone_bricks', 'cracked_stone_bricks'],
  cobblestone: ['mossy_cobblestone'],
  deepslate_bricks: ['cracked_deepslate_bricks'],
  deepslate_tiles: ['cracked_deepslate_tiles'],
  polished_blackstone_bricks: ['cracked_polished_blackstone_bricks'],
  nether_bricks: ['cracked_nether_bricks'],
  stone: ['andesite', 'cobblestone'],
  end_stone_bricks: ['end_stone'],
  sandstone: ['smooth_sandstone'],
  red_sandstone: ['smooth_red_sandstone'],
  bricks: ['mud_bricks'],
};

const CHISELED = {
  stone_bricks: 'chiseled_stone_bricks', mossy_stone_bricks: 'chiseled_stone_bricks', quartz_block: 'chiseled_quartz_block',
  smooth_quartz: 'chiseled_quartz_block', sandstone: 'chiseled_sandstone', smooth_sandstone: 'chiseled_sandstone', cut_sandstone: 'chiseled_sandstone',
  red_sandstone: 'chiseled_red_sandstone', smooth_red_sandstone: 'chiseled_red_sandstone', deepslate: 'chiseled_deepslate',
  cobbled_deepslate: 'chiseled_deepslate', polished_deepslate: 'chiseled_deepslate', deepslate_bricks: 'chiseled_deepslate',
  deepslate_tiles: 'chiseled_deepslate', polished_blackstone: 'chiseled_polished_blackstone', blackstone: 'chiseled_polished_blackstone',
  polished_blackstone_bricks: 'chiseled_polished_blackstone', nether_bricks: 'chiseled_nether_bricks', tuff: 'chiseled_tuff',
  polished_tuff: 'chiseled_tuff', tuff_bricks: 'chiseled_tuff_bricks', resin_bricks: 'chiseled_resin_bricks',
};

const EMPTY_FAMILY = {
  kind: 'block', type: null, base: null, stairs: null, slab: null, wall: null, fence: null, fenceGate: null, door: null, trapdoor: null,
  button: null, pressurePlate: null, log: null, wood: null, planks: null, strippedLog: null, strippedWood: null, leaves: null,
  sign: null, wallSign: null, hangingSign: null, pillar: null, chiseled: null, carpet: null, pane: null, variants: [],
};

function woodFamily(w) {
  const nether = w === 'crimson' || w === 'warped';
  const bamboo = w === 'bamboo';
  return {
    ...EMPTY_FAMILY,
    kind: 'wood',
    type: w,
    base: ex(`${w}_planks`),
    planks: ex(`${w}_planks`),
    stairs: ex(`${w}_stairs`),
    slab: ex(`${w}_slab`),
    fence: ex(`${w}_fence`),
    fenceGate: ex(`${w}_fence_gate`),
    door: ex(`${w}_door`),
    trapdoor: ex(`${w}_trapdoor`),
    button: ex(`${w}_button`),
    pressurePlate: ex(`${w}_pressure_plate`),
    log: ex(bamboo ? 'bamboo_block' : nether ? `${w}_stem` : `${w}_log`),
    wood: bamboo ? null : ex(nether ? `${w}_hyphae` : `${w}_wood`),
    strippedLog: ex(bamboo ? 'stripped_bamboo_block' : nether ? `stripped_${w}_stem` : `stripped_${w}_log`),
    strippedWood: bamboo ? null : ex(nether ? `stripped_${w}_hyphae` : `stripped_${w}_wood`),
    leaves: ex(`${w}_leaves`),
    sign: ex(`${w}_sign`),
    wallSign: ex(`${w}_wall_sign`),
    hangingSign: ex(`${w}_hanging_sign`),
    variants: bamboo ? ['bamboo_mosaic'] : [],
  };
}

function copperFamily(m) {
  const [, waxed = '', age = '', cut = ''] = m;
  const pre = waxed + age;
  const base = cut === 'cut_' ? `${pre}cut_copper` : cut === 'chiseled_' ? `${pre}chiseled_copper` : age ? `${pre}copper` : `${waxed}copper_block`;
  return {
    ...EMPTY_FAMILY,
    kind: 'copper',
    type: 'copper',
    base: ex(base),
    stairs: ex(`${pre}cut_copper_stairs`),
    slab: ex(`${pre}cut_copper_slab`),
    door: ex(`${pre}copper_door`),
    trapdoor: ex(`${pre}copper_trapdoor`),
    chiseled: ex(`${pre}chiseled_copper`),
    pane: ex(`${pre}copper_bars`),
    variants: [ex(`${pre}cut_copper`), ex(`${pre}copper_grate`)].filter(Boolean),
  };
}

/** Stem used for shaped variants: stone_bricks → stone_brick, quartz_block → quartz, deepslate_tiles → deepslate_tile. */
function shapeStem(base) {
  if (base === 'bricks') return 'brick';
  if (/_bricks$|_tiles$/.test(base)) return base.slice(0, -1);
  if (/_block$/.test(base)) return base.slice(0, -6);
  return base;
}

function resolveBaseName(n) {
  if (ALIASES[n]) return ALIASES[n];
  if (blockExists(n) && !/_(stairs|slab|wall|fence|fence_gate|button|pressure_plate|door|trapdoor|carpet|pane)$/.test(n)) return n;
  const stem = n.replace(/_(stairs|slab|wall|fence_gate|fence|button|pressure_plate|door|trapdoor)$/, '');
  if (ALIASES[stem]) return ALIASES[stem];
  for (const c of [stem, `${stem}s`, `${stem}_block`, `${stem}_planks`]) if (blockExists(c)) return c;
  if (/_carpet$/.test(n)) {
    const w = n.replace(/_carpet$/, '_wool');
    if (blockExists(w)) return w;
    if (n === 'moss_carpet') return 'moss_block';
  }
  if (/_pane$/.test(n)) return n.replace(/_pane$/, '');
  return n;
}

const familyCache = new Map();

/**
 * Everything you can build from one material.
 *
 *   materialFamily('oak')            → { base:'oak_planks', stairs:'oak_stairs', slab:'oak_slab', fence:'oak_fence', door:'oak_door', log:'oak_log', … }
 *   materialFamily('stone_brick')    → { base:'stone_bricks', stairs:'stone_brick_stairs', slab:'stone_brick_slab', wall:'stone_brick_wall', … }
 *   materialFamily('quartz_block')   → { base:'quartz_block', stairs:'quartz_stairs', slab:'quartz_slab', pillar:'quartz_pillar', … }
 *   materialFamily('white_concrete') → { base:'white_concrete', stairs:null, … }
 *
 * Accepts a wood type ('dark_oak'), any block of the family ('oak_planks', 'spruce_stairs',
 * 'stone_brick_wall', 'minecraft:quartz_stairs[facing=north]') or a common alias ('quartz', 'brick').
 * Keys: kind ('wood'|'stone'|'copper'|'block'), type (wood type or null), base, stairs, slab, wall, fence,
 * fenceGate, door, trapdoor, button, pressurePlate, log, wood, planks, strippedLog, strippedWood, leaves,
 * sign, wallSign, hangingSign, pillar, chiseled, carpet, pane, variants (texture-variety blocks).
 * Entries are `null` when Minecraft has no such block.
 * @param {string} material
 */
export function materialFamily(material) {
  const key = blockName(String(material));
  const hit = familyCache.get(key);
  if (hit) return { ...hit, variants: [...hit.variants] };
  let fam;
  const w = key.match(WOOD_RE);
  const c = key.match(COPPER_RE);
  if (w) fam = woodFamily(w[1]);
  else if (c) fam = copperFamily(c);
  else {
    const base = resolveBaseName(key);
    const stem = shapeStem(base);
    const stairs = ex(`${stem}_stairs`);
    const slab = ex(`${stem}_slab`);
    fam = {
      ...EMPTY_FAMILY,
      kind: stairs || slab || ex(`${stem}_wall`) ? 'stone' : 'block',
      base: ex(base) ?? base,
      stairs,
      slab,
      wall: ex(`${stem}_wall`),
      fence: ex(`${stem}_fence`),
      door: ex(`${stem}_door`),
      trapdoor: ex(`${stem}_trapdoor`),
      button: ex(`${stem}_button`),
      pressurePlate: ex(`${stem}_pressure_plate`),
      pillar: ex(`${stem}_pillar`),
      chiseled: ex(CHISELED[base] ?? `chiseled_${base}`),
      carpet: /_wool$/.test(base) ? ex(base.replace(/_wool$/, '_carpet')) : base === 'moss_block' ? 'moss_carpet' : base === 'pale_moss_block' ? 'pale_moss_carpet' : null,
      pane: /glass$/.test(base) ? ex(`${base}_pane`) : null,
      variants: (VARIANTS[base] ?? []).filter((v) => blockExists(v)),
    };
  }
  familyCache.set(key, fam);
  return { ...fam, variants: [...fam.variants] };
}

/** Name of the stairs block for a material (or null). */
export function stairsName(material) {
  const n = blockName(String(material));
  if (/_stairs$/.test(n) && blockExists(n)) return n;
  return materialFamily(n).stairs;
}

/** Name of the slab block for a material (or null). */
export function slabName(material) {
  const n = blockName(String(material));
  if (/_slab$/.test(n) && blockExists(n)) return n;
  return materialFamily(n).slab;
}

/**
 * Stairs block-state string. Falls back to the material's full block when it has no stairs.
 *   stairs('oak', 'north')              → 'oak_stairs[facing=north,half=bottom]'
 *   stairs('stone_bricks', 'east', 'top') → 'stone_brick_stairs[facing=east,half=top]'  (upside-down)
 * `facing` = the side of the tall back (you walk UP toward it); `shape` is optional
 * (straight | inner_left | inner_right | outer_left | outer_right).
 */
export function stairs(material, facing = 'north', half = 'bottom', shape) {
  const name = stairsName(material);
  if (!name) return materialFamily(material).base ?? blockName(String(material));
  const sh = shape && shape !== 'straight' ? `,shape=${shape}` : '';
  return `${name}[facing=${facing},half=${half}${sh}]`;
}

/** Slab block-state string ('bottom' | 'top' | 'double'); falls back to the full block. */
export function slab(material, type = 'bottom') {
  const name = slabName(material);
  if (!name) return materialFamily(material).base ?? blockName(String(material));
  return `${name}[type=${type}]`;
}

/** Name of the door for a material: 'spruce' → 'spruce_door', 'iron_block' → 'iron_door'. Falls back to oak_door. */
export function doorName(material = 'oak') {
  const n = blockName(String(material));
  if (/_door$/.test(n) && blockExists(n)) return n;
  return materialFamily(n).door ?? 'oak_door';
}

// ───────────────────────────── two-block objects ─────────────────────────────

/**
 * Place a door (lower + upper half). `facing` is the Minecraft property: the direction a player
 * walking IN faces — a door with facing=south sits on the north edge of its block. For a door in a
 * south wall, `facing:'south'` gives a recessed look, `facing:'north'` puts it flush with the outside.
 * `hinge` 'left'|'right' as seen looking in the facing direction.
 * @param {import('../core/structure.js').Structure} s
 */
export function door(s, x, y, z, { facing = 'south', material = 'oak', hinge = 'left', open = false } = {}) {
  const name = doorName(material);
  const p = `facing=${facing},hinge=${hinge},open=${open ? 'true' : 'false'}`;
  s.set(x, y, z, `${name}[${p},half=lower]`);
  s.set(x, y + 1, z, `${name}[${p},half=upper]`);
  return s;
}

/**
 * Double door: two doors side by side (at x,z and the next cell along +X for north/south facing,
 * +Z for east/west) with mirrored hinges so they open as a pair.
 */
export function doubleDoor(s, x, y, z, { facing = 'south', material = 'oak', open = false } = {}) {
  const alongX = facing === 'north' || facing === 'south';
  const [x2, z2] = alongX ? [x + 1, z] : [x, z + 1];
  // "left" (looking in `facing`) is the counter-clockwise direction
  const leftDir = counterClockwise(facing);
  const secondIsLeft = (alongX && leftDir === 'east') || (!alongX && leftDir === 'south');
  door(s, x, y, z, { facing, material, open, hinge: secondIsLeft ? 'right' : 'left' });
  door(s, x2, y, z2, { facing, material, open, hinge: secondIsLeft ? 'left' : 'right' });
  return s;
}

/**
 * Place a bed: foot at (x, y, z), head one block further in the `facing` direction.
 * @param {{ facing?: 'north'|'south'|'east'|'west', color?: string }} [opts]
 */
export function bed(s, x, y, z, { facing = 'south', color = 'red' } = {}) {
  const name = ex(`${color}_bed`) ?? 'red_bed';
  const [dx, , dz] = DIRS[facing];
  s.set(x, y, z, `${name}[facing=${facing},occupied=false,part=foot]`);
  s.set(x + dx, y, z + dz, `${name}[facing=${facing},occupied=false,part=head]`);
  return s;
}

const TALL_PLANTS = new Set(['sunflower', 'lilac', 'rose_bush', 'peony', 'tall_grass', 'large_fern', 'pitcher_plant', 'tall_seagrass', 'tall_dry_grass']);

/** Place a plant; two-block-tall plants (rose_bush, sunflower, tall_grass, …) get both halves. */
export function plant(s, x, y, z, name = 'poppy') {
  const n = blockName(name);
  if (TALL_PLANTS.has(n)) {
    s.set(x, y, z, `${n}[half=lower]`);
    s.set(x, y + 1, z, `${n}[half=upper]`);
  } else s.set(x, y, z, name);
  return s;
}

// ───────────────────────────── lights ─────────────────────────────

const TORCHES = {
  torch: ['torch', 'wall_torch'], soul: ['soul_torch', 'soul_wall_torch'], copper: ['copper_torch', 'copper_wall_torch'],
  redstone: ['redstone_torch', 'redstone_wall_torch'],
};

/**
 * Torch on the floor, or on a wall when `wall` names the side of the supporting block
 * (`wall:'north'` → `wall_torch[facing=south]`, attached to the block north of it).
 * @param {{ wall?: 'north'|'south'|'east'|'west', type?: 'torch'|'soul'|'copper'|'redstone' }} [opts]
 */
export function torch(s, x, y, z, { wall, type = 'torch' } = {}) {
  const [floor, wallName] = TORCHES[type] ?? TORCHES.torch;
  if (!wall) return s.set(x, y, z, floor);
  const props = type === 'redstone' ? `facing=${opposite(wall)},lit=true` : `facing=${opposite(wall)}`;
  return s.set(x, y, z, `${wallName}[${props}]`);
}

/**
 * Lamps.
 *  - style 'post'    (default): `height-1` posts (fence) with a lantern on top at y+height-1.
 *  - style 'street': a pole (wall blocks) `height` tall with an arm of `arm` blocks toward `facing`
 *                    and a lantern hanging under the arm's end (arm 0 → lantern on top).
 *  - style 'hanging': lantern hanging at (x,y,z) with `height-1` chains above it (attach to a ceiling).
 *  - style 'wall':   bracket for a wall: a fence at y+1 (sticking out of a wall) with a lantern under it.
 *  - style 'block':  a light block (sea lantern by default).
 * @param {{ style?: string, height?: number, post?: string, light?: string, facing?: string, arm?: number }} [opts]
 */
export function lamp(s, x, y, z, { style = 'post', height = 3, post, light = 'lantern', facing = 'south', arm = 1 } = {}) {
  const hang = (b) => withProps(b, { hanging: 'true' });
  const stand = (b) => withProps(b, { hanging: 'false' });
  switch (style) {
    case 'street': {
      const pole = post ?? 'stone_brick_wall';
      const top = y + Math.max(2, height) - 1;
      s.fill(x, y, z, x, top, z, pole);
      if (arm <= 0) {
        s.set(x, top + 1, z, stand(light));
        break;
      }
      const [dx, , dz] = DIRS[facing];
      for (let i = 1; i <= arm; i++) s.set(x + dx * i, top, z + dz * i, pole);
      s.set(x + dx * arm, top - 1, z + dz * arm, hang(light));
      break;
    }
    case 'hanging':
      s.set(x, y, z, hang(light));
      for (let i = 1; i < Math.max(1, height); i++) s.set(x, y + i, z, 'iron_chain[axis=y]');
      break;
    case 'wall':
      s.set(x, y + 1, z, post ?? 'dark_oak_fence');
      s.set(x, y, z, hang(light));
      break;
    case 'block':
      s.set(x, y, z, light === 'lantern' ? 'sea_lantern' : light);
      break;
    default: {
      const p = post ?? 'dark_oak_fence';
      const h = Math.max(2, height);
      s.fill(x, y, z, x, y + h - 2, z, p);
      s.set(x, y + h - 1, z, stand(light));
    }
  }
  return s;
}

// ───────────────────────────── roofs ─────────────────────────────

function roofParts(material) {
  const fam = materialFamily(material);
  const base = fam.base ?? blockName(String(material));
  return { fam, base, hasStairs: !!fam.stairs, hasSlab: !!fam.slab };
}

/**
 * Gable roof over the rectangle x1..x2 × z1..z2 (the OUTER faces of the walls). `y` is the layer just
 * above the top of the walls. With `overhang` > 0 the eaves hang down beside the top wall course
 * (rows start at y - overhang), like a real roof. Slopes use stairs (facing up-slope); the ridge gets
 * slabs (odd span) or meets back-to-back (even span). The triangular gable ends at the end walls are
 * filled with `gableFill` (default: the roof's planks/base; pass null to leave them open).
 * Materials without stairs build a stepped roof from full blocks. `thickRake` (default true) puts
 * upside-down stairs under the gable overhang so the roof edge reads as a solid barge board.
 * @param {import('../core/structure.js').Structure} s
 * @param {{ x1:number, z1:number, x2:number, z2:number, y:number, material?:string, ridge?:'x'|'z',
 *           overhang?:number, gableFill?:string|null, rake?:number, interior?:string|null, thickRake?:boolean }} o
 * @returns {{ ridgeY:number, topY:number }} height of the ridge layer
 */
export function gableRoof(s, o) {
  const { x1, z1, x2, z2, y } = normRect(o);
  const material = o.material ?? 'oak';
  const ridge = o.ridge ?? (x2 - x1 >= z2 - z1 ? 'x' : 'z');
  const ov = Math.max(0, o.overhang ?? 1);
  const rake = Math.max(0, o.rake ?? ov);
  const { base, hasStairs } = roofParts(material);
  const gableFill = o.gableFill === undefined ? base : o.gableFill;
  // work in (u = along ridge, v = across ridge) coordinates
  const [u1, u2, v1, v2] = ridge === 'x' ? [x1, x2, z1, z2] : [z1, z2, x1, x2];
  const put = (u, yy, v, b) => (ridge === 'x' ? s.set(u, yy, v, b) : s.set(v, yy, u, b));
  const lowFacing = ridge === 'x' ? 'south' : 'east'; // stairs on the low-v slope rise toward +v
  const highFacing = ridge === 'x' ? 'north' : 'west';
  const span = v2 - v1 + 1;
  const thickRake = o.thickRake !== false && hasStairs && rake > 0;
  let ridgeY = y;
  for (let k = 0; ; k++) {
    const yy = y - ov + k;
    const va = v1 - ov + k, vb = v2 + ov - k;
    if (va > vb) break;
    ridgeY = yy;
    for (let u = u1 - rake; u <= u2 + rake; u++) {
      if (va === vb) {
        put(u, yy, va, hasStairs ? slab(material, 'bottom') : base);
      } else {
        put(u, yy, va, hasStairs ? stairs(material, lowFacing) : base);
        put(u, yy, vb, hasStairs ? stairs(material, highFacing) : base);
        // barge board: upside-down stairs under the rake overhang make the gable edge read thick
        if (thickRake && (u < u1 || u > u2)) {
          const get = (vv) => (ridge === 'x' ? s.get(u, yy - 1, vv) : s.get(vv, yy - 1, u));
          if (get(va) == null) put(u, yy - 1, va, stairs(material, highFacing, 'top'));
          if (get(vb) == null) put(u, yy - 1, vb, stairs(material, lowFacing, 'top'));
        }
      }
    }
    if (!hasStairs && va < vb) {
      // stepped roof: make each step solid down to the previous one so there are no gaps
      for (let u = u1 - rake; u <= u2 + rake; u++) { put(u, yy - 1, va, base); put(u, yy - 1, vb, base); }
    }
    // gable triangles (inside the wall planes) + optional interior fill
    if (yy >= y) {
      for (let v = Math.max(va + 1, v1); v <= Math.min(vb - 1, v2); v++) {
        if (gableFill) { put(u1, yy, v, gableFill); put(u2, yy, v, gableFill); }
        if (o.interior) for (let u = u1 + 1; u < u2; u++) put(u, yy, v, o.interior);
      }
    }
  }
  return { ridgeY, topY: ridgeY, span };
}

/**
 * Hip roof: all four sides slope. Corners become outer-corner stairs (shapes are computed like the
 * game does). The top is a short ridge of slabs (or a 2-wide stair ridge / single cap).
 * Same rectangle / `y` / `overhang` semantics as gableRoof. Returns the height of the top layer.
 */
export function hipRoof(s, o) {
  const { x1, z1, x2, z2, y } = normRect(o);
  const material = o.material ?? 'oak';
  const ov = Math.max(0, o.overhang ?? 1);
  const { base, hasStairs } = roofParts(material);
  const st = (f) => (hasStairs ? stairs(material, f) : base);
  let topY = y;
  for (let k = 0; ; k++) {
    const yy = y - ov + k;
    const xa = x1 - ov + k, xb = x2 + ov - k, za = z1 - ov + k, zb = z2 + ov - k;
    if (xa > xb || za > zb) break;
    topY = yy;
    if (o.interior && yy >= y) s.fill(xa + 1, yy, za + 1, xb - 1, yy, zb - 1, o.interior);
    if (xa === xb && za === zb) { s.set(xa, yy, za, hasStairs ? slab(material) : base); break; }
    if (za === zb) { // single row along x: hipped ends + slab ridge
      for (let x = xa; x <= xb; x++) s.set(x, yy, za, x === xa ? st('east') : x === xb ? st('west') : hasStairs ? slab(material) : base);
      break;
    }
    if (xa === xb) {
      for (let z = za; z <= zb; z++) s.set(xa, yy, z, z === za ? st('south') : z === zb ? st('north') : hasStairs ? slab(material) : base);
      break;
    }
    // corners belong to the shorter sides so short 2-wide tops still read as hips
    const cornersOnX = zb - za <= xb - xa; // true → west/east edges (running along z) are the short ones
    for (let x = xa; x <= xb; x++) {
      const corner = x === xa || x === xb;
      if (corner && cornersOnX) continue;
      s.set(x, yy, za, st('south'));
      s.set(x, yy, zb, st('north'));
    }
    for (let z = za; z <= zb; z++) {
      const corner = z === za || z === zb;
      if (corner && !cornersOnX) continue;
      s.set(xa, yy, z, st('east'));
      s.set(xb, yy, z, st('west'));
    }
    if (!hasStairs) { // stepped: fill under the ring so steps are solid
      s.fill(xa, yy - 1, za, xb, yy - 1, zb, base, { mode: 'outline' });
    }
  }
  fixStairShapes(s, { x1: x1 - ov, z1: z1 - ov, x2: x2 + ov, z2: z2 + ov, y1: y - ov, y2: topY });
  return { topY };
}

/**
 * Flat roof slab at height `y` over x1..x2 × z1..z2 with an optional parapet ring on top
 * (`parapetHeight` blocks; walls/full blocks) and a coping of slabs.
 */
export function flatRoof(s, o) {
  const { x1, z1, x2, z2, y } = normRect(o);
  const material = o.material ?? 'smooth_stone';
  const ov = Math.max(0, o.overhang ?? 0);
  s.fill(x1 - ov, y, z1 - ov, x2 + ov, y, z2 + ov, materialFamily(material).base ?? material);
  if (o.parapet === false) return { topY: y };
  const pm = o.parapetMaterial ?? material;
  const ph = Math.max(1, o.parapetHeight ?? 1);
  const pfam = materialFamily(pm);
  for (let h = 1; h <= ph; h++) s.fill(x1 - ov, y + h, z1 - ov, x2 + ov, y + h, z2 + ov, pfam.base ?? pm, { mode: 'walls' });
  if (o.coping !== false && pfam.slab) s.fill(x1 - ov, y + ph + 1, z1 - ov, x2 + ov, y + ph + 1, z2 + ov, slab(pm), { mode: 'walls' });
  return { topY: y + ph + (o.coping !== false && pfam.slab ? 1 : 0) };
}

function normRect(o) {
  const x1 = Math.min(o.x1, o.x2), x2 = Math.max(o.x1, o.x2), z1 = Math.min(o.z1, o.z2), z2 = Math.max(o.z1, o.z2);
  return { x1, x2, z1, z2, y: o.y };
}

// ───────────────────────────── walls, windows, columns ─────────────────────────────

/**
 * Windows along an axis-aligned wall run from (x1, z1) to (x2, z2) (inclusive). Windows are
 * `width` wide, `height` tall starting at `y`, separated by `gap` wall blocks and centred on the run.
 * `outside` (the exterior side, e.g. 'south') enables `sill` (upside-down stairs under each window)
 * and `shutters` (open trapdoors either side).
 * @returns {Array<{x:number,z:number,width:number}>} the window positions (first cell of each)
 */
export function windowRow(s, { x1, z1, x2, z2, y, height = 2, width = 1, gap = 2, glass = 'glass_pane', margin = 0, outside, sill, shutters } = {}) {
  const alongX = z1 === z2;
  const a = alongX ? Math.min(x1, x2) + margin : Math.min(z1, z2) + margin;
  const b = alongX ? Math.max(x1, x2) - margin : Math.max(z1, z2) - margin;
  const len = b - a + 1;
  if (len < width) return [];
  const n = Math.max(1, Math.floor((len + gap) / (width + gap)));
  const used = n * width + (n - 1) * gap;
  const start = a + Math.floor((len - used) / 2);
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = start + i * (width + gap);
    const cells = [];
    for (let w = 0; w < width; w++) cells.push(alongX ? [p + w, z1] : [x1, p + w]);
    for (const [cx, cz] of cells) for (let h = 0; h < height; h++) s.set(cx, y + h, cz, glass);
    if (outside) decorateWindow(s, cells, y, height, outside, { sill, shutters });
    out.push(alongX ? { x: p, z: z1, width } : { x: x1, z: p, width });
  }
  return out;
}

/**
 * Sill (upside-down stairs under the window, outside) and shutters (open trapdoors flat against the
 * wall on both sides) for a window whose glass cells are `cells` ([x,z] pairs) from y to y+height-1.
 */
export function decorateWindow(s, cells, y, height, outside, { sill, shutters } = {}) {
  const [ox, , oz] = DIRS[outside];
  if (sill) {
    for (const [cx, cz] of cells) {
      if (s.get(cx + ox, y - 1, cz + oz) == null) s.set(cx + ox, y - 1, cz + oz, stairs(sill, opposite(outside), 'top'));
    }
  }
  if (shutters) {
    const td = materialFamily(shutters).trapdoor ?? 'spruce_trapdoor';
    const alongX = outside === 'north' || outside === 'south';
    const sorted = cells.slice().sort((p, q) => (alongX ? p[0] - q[0] : p[1] - q[1]));
    const first = sorted[0], last = sorted[sorted.length - 1];
    const sides = alongX ? [[first[0] - 1, first[1]], [last[0] + 1, last[1]]] : [[first[0], first[1] - 1], [last[0], last[1] + 1]];
    // shutters come in pairs: only when both sides are free
    const freeSide = ([sx, sz]) => [...Array(height).keys()].every((h) => s.get(sx + ox, y + h, sz + oz) == null);
    if (sides.every(freeSide)) {
      for (const [sx, sz] of sides) {
        for (let h = 0; h < height; h++) {
          // open trapdoor lying against the wall: facing = the outside direction puts the panel on the wall side
          s.set(sx + ox, y + h, sz + oz, `${td}[facing=${outside},half=${h === 0 ? 'bottom' : 'top'},open=true]`);
        }
      }
    }
  }
  return s;
}

/**
 * A single column from y to y+height-1: optional `base` block at the bottom, `capital` at the top,
 * `shaft` in between (axis=y applied automatically for pillars/logs).
 */
export function column(s, x, y, z, height, { shaft = 'quartz_pillar', base = null, capital = null } = {}) {
  for (let i = 0; i < height; i++) {
    let b = withAxis(shaft, 'y');
    if (i === 0 && base) b = base;
    if (i === height - 1 && capital) b = capital;
    s.set(x, y + i, z, b);
  }
  return s;
}

/**
 * Columns every `spacing` blocks along an axis-aligned line (x1,z1)→(x2,z2), or around the perimeter
 * of the rectangle when both coordinates differ. Options as for `column`.
 */
export function columns(s, { x1, z1, x2, z2, y = 0, height = 4, spacing = 3, ...style } = {}) {
  const pts = [];
  if (x1 === x2 || z1 === z2) {
    const n = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1));
    for (let i = 0; i <= n; i += spacing) pts.push([x1 + Math.sign(x2 - x1) * i, z1 + Math.sign(z2 - z1) * i]);
    const last = pts[pts.length - 1];
    if (last[0] !== x2 || last[1] !== z2) pts.push([x2, z2]);
  } else {
    for (const p of rectRing(x1, z1, x2, z2)) {
      const along = p.side === 'north' || p.side === 'south' ? p.x - Math.min(x1, x2) : p.z - Math.min(z1, z2);
      if (p.corner || along % spacing === 0) pts.push([p.x, p.z]);
    }
  }
  const seen = new Set();
  for (const [x, z] of pts) {
    const k = `${x},${z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    column(s, x, y, z, height, style);
  }
  return s;
}

/**
 * Cells on the perimeter of a rectangle, clockwise from the NW corner, each with the side it
 * belongs to ('north'|'east'|'south'|'west') and whether it's a corner.
 * @returns {Array<{x:number,z:number,side:string,corner:boolean}>}
 */
export function rectRing(x1, z1, x2, z2) {
  const xa = Math.min(x1, x2), xb = Math.max(x1, x2), za = Math.min(z1, z2), zb = Math.max(z1, z2);
  const out = [];
  const corner = (x, z) => (x === xa || x === xb) && (z === za || z === zb);
  for (let x = xa; x <= xb; x++) out.push({ x, z: za, side: 'north', corner: corner(x, za) });
  for (let z = za + 1; z <= zb; z++) out.push({ x: xb, z, side: 'east', corner: corner(xb, z) });
  if (zb > za) for (let x = xb - 1; x >= xa; x--) out.push({ x, z: zb, side: 'south', corner: corner(x, zb) });
  if (xb > xa) for (let z = zb - 1; z > za; z--) out.push({ x: xa, z, side: 'west', corner: corner(xa, z) });
  return out;
}

// ───────────────────────────── furniture & details ─────────────────────────────

/** A chair: stairs whose back is behind the sitter, who looks toward `facing`. */
export function chair(s, x, y, z, { facing = 'south', material = 'oak' } = {}) {
  return s.set(x, y, z, stairs(material, opposite(facing)));
}

/** A small table: fence post with a pressure plate top (wood) or an upside-down slab-top for stone. */
export function table(s, x, y, z, { material = 'oak' } = {}) {
  const fam = materialFamily(material);
  if (fam.fence && fam.pressurePlate) {
    s.set(x, y, z, fam.fence);
    s.set(x, y + 1, z, fam.pressurePlate);
  } else {
    s.set(x, y, z, slab(material, 'top'));
  }
  return s;
}

/** Rectangle of carpet at height y. */
export function carpet(s, x1, z1, x2, z2, y, color = 'red') {
  const c = ex(`${color}_carpet`) ?? (blockExists(color) ? color : 'red_carpet');
  return s.fill(x1, y, z1, x2, y, z2, c);
}

/**
 * Chimney column at (x, z) from `y1` up to `y2` (inclusive) with a lit campfire on top for smoke
 * (`cap:'campfire'`), or a wall/slab cap.
 */
export function chimney(s, x, z, y1, y2, { block = 'bricks', cap = 'campfire' } = {}) {
  s.fill(x, y1, z, x, y2, z, block);
  if (cap === 'campfire') s.set(x, y2 + 1, z, 'campfire[facing=south,lit=true,signal_fire=false]');
  else if (cap) s.set(x, y2 + 1, z, cap);
  return s;
}

/**
 * Replace a fraction of `from` blocks with random picks from `to` (texture variety: mossy/cracked
 * bricks, etc.). Deterministic for a given rng. `chance` 0..1.
 */
export function weather(s, { from, to, chance = 0.15, rng }) {
  if (!to?.length || chance <= 0) return s;
  const fromName = blockName(from);
  const r = rng ?? Math.random;
  const hits = [];
  s.forEach((x, y, z, b) => { if (blockName(b) === fromName && b === fromName) hits.push([x, y, z]); });
  hits.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]); // stable order → deterministic
  for (const [x, y, z] of hits) if (r() < chance) s.set(x, y, z, to[Math.floor(r() * to.length)]);
  return s;
}

// ───────────────────────────── block-state post-processing ─────────────────────────────

const NON_FULL_RE = new RegExp([
  '_stairs$', '_slab$', '_fence$', '_fence_gate$', '_wall$', '_pane$', '_bars$', '_door$', '_trapdoor$', 'carpet$', 'torch$',
  'lantern$', '_sign$', '_banner$', '_button$', '_pressure_plate$', '^lever$', '_rod$', 'chain$', '^ladder$', 'vine', '_leaves$',
  '^(cave_|void_)?air$', '^water$', '^lava$', '_bed$', 'rail$', 'candle', '_head$', '_skull$', 'flower_pot$', '^potted_', 'campfire$',
  '^bell$', 'anvil$', 'cauldron$', '^hopper$', 'chest$', '^lectern$', '^grindstone$', '^stonecutter$', '^enchanting_table$',
  '^brewing_stand$', '^cake', '^scaffolding$', 'sapling$', 'grass$', 'fern$', 'bush$', 'flower$', 'tulip$', '^poppy$', '^dandelion$',
  '^allium$', '^azure_bluet$', '^oxeye_daisy$', '^cornflower$', '^lily_of_the_valley$', '^rose_bush$', '^sunflower$', '^lilac$',
  '^peony$', '^snow$', '^cactus$', '^bamboo$', '^sugar_cane$', '^conduit$', '^daylight_detector$', '^composter$', '^decorated_pot$',
  '^dragon_egg$', 'egg$', '^sea_pickle$', 'coral', '^kelp', 'seagrass$', '^dirt_path$', '^farmland$', '^chorus_', 'mushroom$',
  '_roots$', 'dripleaf', 'moss$', 'propagule$', 'petals$', 'wildflowers$', 'leaf_litter$', '^cobweb$', '^light$', '^barrier$',
  '^structure_void$', 'pumpkin$', '^melon$', 'shulker_box$', '_shelf$', '^azalea$', '^flowering_azalea$', 'lichen$', '^glass$',
  'stained_glass$', '^tinted_glass$', '^ice$', 'statue$', 'amethyst_cluster$', '_bud$', 'pointed_dripstone$',
].join('|'));
const isWallBlock = (n) => /_wall$/.test(n) && !/(sign|banner|torch|head|skull|fan)$/.test(n);
const isFenceBlock = (n) => /_fence$/.test(n);
const isPaneBlock = (n) => /_pane$|_bars$/.test(n);
const isGate = (n) => /_fence_gate$/.test(n);

/** Heuristic: block with full, sturdy side faces (used for fence/pane/wall connections). */
export function isFullBlock(block) {
  if (block == null) return false;
  const n = blockName(block);
  if (/^(glass|tinted_glass|.*_stained_glass)$/.test(n)) return true; // glass blocks are sturdy for connections
  return !NON_FULL_RE.test(n);
}

const SIDES = [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]];

function gateConnects(gate, dir) {
  const f = parseBlock(gate).props.facing ?? 'north';
  const axisF = f === 'north' || f === 'south' ? 'z' : 'x';
  const axisD = dir === 'north' || dir === 'south' ? 'z' : 'x';
  return axisF !== axisD;
}

/**
 * Set fence / glass pane / iron bars / wall connection properties from their neighbours, the way
 * the game computes them, so previews and structure-block pastes look right. The game recomputes
 * these when blocks are placed with /setblock, so this is purely cosmetic and always safe.
 * Optionally limited to a box { x1,y1,z1,x2,y2,z2 }.
 */
export function autoConnect(s, box = null) {
  const todo = [];
  s.forEach((x, y, z, b) => {
    if (box && (x < box.x1 || x > box.x2 || y < box.y1 || y > box.y2 || z < box.z1 || z > box.z2)) return;
    const n = blockName(b);
    if (isFenceBlock(n) || isPaneBlock(n) || isWallBlock(n)) todo.push([x, y, z, b, n]);
  });
  for (const [x, y, z, b, n] of todo) {
    const props = {};
    const conn = {};
    for (const [side, dx, dz] of SIDES) {
      const nb = s.get(x + dx, y, z + dz);
      let c = false;
      if (nb != null && !isAir(nb)) {
        const nn = blockName(nb);
        if (isFenceBlock(n)) {
          const nether = (q) => q === 'nether_brick_fence';
          c = (isFenceBlock(nn) && nether(nn) === nether(n)) || (isGate(nn) && gateConnects(nb, side)) || (isFullBlock(nb) && !/_leaves$/.test(nn));
        } else if (isPaneBlock(n)) {
          c = isPaneBlock(nn) || isWallBlock(nn) || (isFullBlock(nb) && !/_leaves$/.test(nn));
        } else {
          c = isWallBlock(nn) || isPaneBlock(nn) || (isGate(nn) && gateConnects(nb, side)) || (isFullBlock(nb) && !/_leaves$/.test(nn));
        }
      }
      conn[side] = c;
    }
    if (isWallBlock(n)) {
      const above = s.get(x, y + 1, z);
      const aboveFull = isFullBlock(above);
      const aboveWall = above != null && isWallBlock(blockName(above));
      for (const [side] of SIDES) props[side] = conn[side] ? (aboveFull || aboveWall ? 'tall' : 'low') : 'none';
      const straight = (conn.north && conn.south && !conn.east && !conn.west) || (conn.east && conn.west && !conn.north && !conn.south);
      let up = !straight;
      if (straight && above != null && !isAir(above) && !aboveFull && !aboveWall) up = true; // lanterns/torches on top
      props.up = up ? 'true' : 'false';
    } else {
      for (const [side] of SIDES) props[side] = conn[side] ? 'true' : 'false';
    }
    const p = parseBlock(b);
    s.set(x, y, z, formatBlock({ ...p, props: { ...p.props, ...props } }));
  }
  return s;
}

/**
 * Recompute stair `shape` (inner/outer corners) exactly like the game does from neighbouring
 * stairs, so roof corners render correctly. Optionally limited to a box.
 */
export function fixStairShapes(s, box = null) {
  const todo = [];
  s.forEach((x, y, z, b) => {
    if (box && (x < box.x1 || x > box.x2 || y < box.y1 || y > box.y2 || z < box.z1 || z > box.z2)) return;
    if (/_stairs$/.test(blockName(b))) todo.push([x, y, z, b]);
  });
  const info = (x, y, z) => {
    const b = s.get(x, y, z);
    if (b == null || !/_stairs$/.test(blockName(b))) return null;
    const p = parseBlock(b).props;
    return { facing: p.facing ?? 'north', half: p.half ?? 'bottom' };
  };
  const axis = (d) => (d === 'north' || d === 'south' ? 'z' : 'x');
  const results = [];
  for (const [x, y, z, b] of todo) {
    const me = info(x, y, z);
    const canTake = (dir) => {
      const [dx, , dz] = DIRS[dir];
      const o = info(x + dx, y, z + dz);
      return !o || o.facing !== me.facing || o.half !== me.half;
    };
    let shape = 'straight';
    const [fx, , fz] = DIRS[me.facing];
    const front = info(x + fx, y, z + fz);
    if (front && front.half === me.half && axis(front.facing) !== axis(me.facing) && canTake(opposite(front.facing))) {
      shape = front.facing === counterClockwise(me.facing) ? 'outer_left' : 'outer_right';
    } else {
      const back = info(x - fx, y, z - fz);
      if (back && back.half === me.half && axis(back.facing) !== axis(me.facing) && canTake(back.facing)) {
        shape = back.facing === counterClockwise(me.facing) ? 'inner_left' : 'inner_right';
      }
    }
    results.push([x, y, z, b, shape]);
  }
  for (const [x, y, z, b, shape] of results) {
    const p = parseBlock(b);
    const props = { ...p.props };
    if (shape === 'straight') delete props.shape; else props.shape = shape;
    s.set(x, y, z, formatBlock({ ...p, props }));
  }
  return s;
}

/** Final pass used by the generators: stair shapes + fence/pane/wall connections. */
export function finish(s) {
  fixStairShapes(s);
  autoConnect(s);
  return s;
}

/** Highest non-air block at column (x, z) between y1 and y2 (or null). */
export function topAt(s, x, z, y1 = -64, y2 = 320) {
  for (let y = y2; y >= y1; y--) {
    const b = s.get(x, y, z);
    if (b != null && !isAir(b)) return y;
  }
  return null;
}

const SPIRAL_RING = [[0, 1, 'west'], [-1, 1, 'north'], [-1, 0, 'north'], [-1, -1, 'east'], [0, -1, 'east'], [1, -1, 'south'], [1, 0, 'south'], [1, 1, 'west']];

/**
 * Spiral staircase around a 1×1 central column at (cx, cz): `steps` stairs climbing clockwise
 * (seen from above) from y0+1, one block per step, starting south of the column. Every step keeps
 * two blocks of headroom (anything non-stair above a step — floors, decks — is cleared), so call it
 * after building floors/roofs. Needs a free 3×3 shaft.
 * @returns {{ topY: number, exit: [number, number] }} y of the last step and its (dx, dz) cell
 */
export function spiralStairs(s, cx, y0, cz, { steps, material = 'stone_bricks', column = null } = {}) {
  const col = column ?? (materialFamily(material).base ?? material);
  for (let k = 1; k < steps; k++) s.set(cx, y0 + k, cz, col);
  const placed = [];
  for (let k = 0; k < steps; k++) {
    const [dx, dz, f] = SPIRAL_RING[k % 8];
    s.set(cx + dx, y0 + 1 + k, cz + dz, stairs(material, f));
    placed.push([dx, y0 + 1 + k, dz]);
  }
  for (const [dx, y, dz] of placed) {
    for (const hy of [y + 1, y + 2]) {
      const cur = s.get(cx + dx, hy, cz + dz);
      if (cur != null && !/_stairs/.test(cur)) s.set(cx + dx, hy, cz + dz, 'air');
    }
  }
  const last = placed[placed.length - 1] ?? [0, y0, 1];
  return { topY: last[1], exit: [last[0], last[2]] };
}

/** Leaves block-state that never decays. */
export const leaves = (type = 'oak') => `${/_leaves$/.test(type) ? type : `${type}_leaves`}[persistent=true]`;
