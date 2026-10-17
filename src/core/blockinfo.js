/**
 * Block classification used by the planner (placement order), validator and renderer.
 * Uses minecraft-data when available for the target version, with name heuristics as a fallback
 * so everything keeps working for unknown / future blocks.
 */
import { createRequire } from 'node:module';
import { blockName } from './blockstate.js';

const require = createRequire(import.meta.url);

export const DEFAULT_MC_VERSION = '1.21.11';

const mcDataCache = new Map();
/** minecraft-data for a version (or null if unsupported). */
export function mcData(version = DEFAULT_MC_VERSION) {
  if (mcDataCache.has(version)) return mcDataCache.get(version);
  let d = null;
  try {
    d = require('minecraft-data')(version) ?? null;
  } catch {
    d = null;
  }
  mcDataCache.set(version, d);
  return d;
}

const blockClassCache = new Map();
const defaultPropsCache = new Map();
/**
 * Property values Minecraft uses when a state string omits them (e.g. `oak_stairs` →
 * { facing: 'north', half: 'bottom', shape: 'straight', waterlogged: 'false' }). null if unknown.
 */
export function defaultProps(name, version = DEFAULT_MC_VERSION) {
  const key = `${version}|${name}`;
  if (defaultPropsCache.has(key)) return defaultPropsCache.get(key);
  let out = null;
  const def = mcData(version)?.blocksByName?.[name];
  if (def && def.states?.length) {
    try {
      let Block = blockClassCache.get(version);
      if (!Block) { Block = require('prismarine-block')(version); blockClassCache.set(version, Block); }
      const props = Block.fromStateId(def.defaultState, 0).getProperties();
      out = {};
      for (const [k, v] of Object.entries(props)) out[k] = String(v);
    } catch {
      out = null;
    }
  } else if (def) {
    out = {};
  }
  defaultPropsCache.set(key, out);
  return out;
}

export const FLUIDS = new Set(['water', 'lava', 'bubble_column']);

// Blocks that need a supporting neighbour (or are multi-block) — placed after all solid blocks.
const ATTACH_RE = new RegExp(
  [
    'door$', '_bed$', '^ladder$', '^lantern$', '^soul_lantern$', 'copper_lantern$', '^lever$', '_button$', 'carpet$', 'torch$', 'rail$', '^bell$',
    'candle$', '^sea_pickle$', '^cocoa$', '^tripwire', 'amethyst_bud$', '^amethyst_cluster$', '^pointed_dripstone$',
    '^scaffolding$', '^cactus$', '^sugar_cane$', '^bamboo$', '^kelp', 'seagrass$', 'coral_fan$', 'coral_wall_fan$',
    '^lily_pad$', '^snow$', 'vine', 'lichen$', '_vein$', '^chorus_', '^frogspawn$', '^turtle_egg$', 'dripleaf',
    '^spore_blossom$', '^hanging_roots$', 'hanging_moss$', '^flower_pot$', '^potted_', 'pressure_plate$', '_sign$',
    '_banner$', '^redstone_wire$', '^repeater$', '^comparator$', 'sapling$', '_flower$', '^short_grass$', '^tall_grass$',
    '^fern$', '^large_fern$', '^(brown|red)_mushroom$', '_fungus$', '^(crimson|warped)_roots$', '_sprouts$', '^dead_bush$', 'bush$', '^wheat$',
    '^carrots$', '^potatoes$', '^beetroots$', '^(attached_)?(pumpkin|melon)_stem$', '^nether_wart$', '^sweet_berry_bush$', 'tulip$', '^poppy$',
    '^dandelion$', '^allium$', '^azure_bluet$', '^oxeye_daisy$', '^cornflower$', '^lily_of_the_valley$', '^wither_rose$',
    '^sunflower$', '^lilac$', '^rose_bush$', '^peony$', '^pitcher_', '^torchflower', '^pink_petals$', '^wildflowers$',
    '^leaf_litter$', '^glow_berries$', '^cave_vines', '^twisting_vines', '^weeping_vines', '^small_dripleaf$',
    '^big_dripleaf', 'skull$', '_head$', 'wall_skull$', 'wall_head$', '^end_rod$', '^lightning_rod$', '^chain$',
    '^iron_chain$', '_chain$', '^item_frame$', '^tripwire$', '^firefly_bush$', '^cactus_flower$', '^resin_clump$',
    '^short_dry_grass$', '^tall_dry_grass$', '^eyeblossom', '^open_eyeblossom$', '^closed_eyeblossom$',
  ].join('|'),
);

const GRAVITY_RE = /(^sand$|^red_sand$|^gravel$|_concrete_powder$|anvil$|^dragon_egg$|^suspicious_sand$|^suspicious_gravel$)/;

/** 0 = structural, 1 = attached / support-dependent, 2 = fluid. */
export function placementPhase(block) {
  const n = blockName(block);
  if (FLUIDS.has(n)) return 2;
  if (ATTACH_RE.test(n)) return 1;
  return 0;
}

export const isGravityBlock = (block) => GRAVITY_RE.test(blockName(block));
export const isLeaves = (block) => /_leaves$/.test(blockName(block));

/** Blocks made of two halves (from the block's states when known): name → { prop, lower, upper, axis } */
export function twoBlockInfo(block, version = DEFAULT_MC_VERSION) {
  const n = blockName(block);
  const def = mcData(version)?.blocksByName?.[n];
  if (def) {
    const states = def.states ?? [];
    const half = states.find((s) => s.name === 'half');
    if (half?.values?.includes('upper') && half.values.includes('lower')) return { prop: 'half', lower: 'lower', upper: 'upper', axis: 'y' };
    const part = states.find((s) => s.name === 'part');
    if (part?.values?.includes('head') && part.values.includes('foot')) return { prop: 'part', lower: 'foot', upper: 'head', axis: 'facing' };
    return null;
  }
  if (/door$/.test(n) && !/trapdoor$/.test(n)) return { prop: 'half', lower: 'lower', upper: 'upper', axis: 'y' };
  if (/^(sunflower|lilac|rose_bush|peony|tall_grass|large_fern|tall_seagrass|pitcher_plant|small_dripleaf)$/.test(n)) {
    return { prop: 'half', lower: 'lower', upper: 'upper', axis: 'y' };
  }
  if (/_bed$/.test(n)) return { prop: 'part', lower: 'foot', upper: 'head', axis: 'facing' };
  return null;
}

/** Levenshtein distance (small strings). */
function lev(a, b) {
  const m = a.length, n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

/** Closest known block names for a typo (names containing the word rank first: chain → iron_chain). */
export function suggestBlocks(name, version = DEFAULT_MC_VERSION, max = 3) {
  const d = mcData(version);
  if (!d) return [];
  const renamed = renamedFor(name, version);
  const scored = [];
  for (const b of d.blocksArray) {
    let s = lev(name, b.name);
    if (b.name.endsWith(`_${name}`) || b.name.startsWith(`${name}_`)) s = Math.min(s, 1) - 1;
    else if (b.name.includes(name) || name.includes(b.name)) s -= 2;
    scored.push([s, b.name]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length);
  const out = scored.slice(0, max).filter(([s]) => s <= Math.max(3, name.length / 2)).map(([, n]) => n);
  return renamed ? [renamed, ...out.filter((n) => n !== renamed)].slice(0, max) : out;
}

/** Blocks renamed between Minecraft versions: [older name, newer name]. */
const RENAMES = [['grass_path', 'dirt_path'], ['grass', 'short_grass'], ['chain', 'iron_chain']];

/** The name `name` has in `version` when it was renamed (either direction), else null. */
export function renamedFor(name, version = DEFAULT_MC_VERSION) {
  const d = mcData(version);
  if (!d || d.blocksByName[name]) return null;
  for (const [older, newer] of RENAMES) {
    if (name === older && d.blocksByName[newer]) return newer;
    if (name === newer && d.blocksByName[older]) return older;
  }
  return null;
}

/** Common non-block (item) names agents use by mistake → the block to use instead. */
export const ITEM_TO_BLOCK = {
  redstone: 'redstone_wire', string: 'tripwire', sign: 'oak_sign', door: 'oak_door', bed: 'red_bed',
  wheat_seeds: 'wheat', carrot: 'carrots', potato: 'potatoes', beetroot_seeds: 'beetroots', sugar: 'sugar_cane',
  glass_panes: 'glass_pane', wood: 'oak_planks', planks: 'oak_planks', log: 'oak_log', leaves: 'oak_leaves',
  grass: 'short_grass', concrete: 'white_concrete', wool: 'white_wool', terracotta: 'terracotta',
  stone_brick: 'stone_bricks', brick: 'bricks', nether_brick: 'nether_bricks', torch_wall: 'wall_torch',
  water_bucket: 'water', lava_bucket: 'lava', melon_slice: 'melon', snowball: 'snow_block',
};

/**
 * Validate one block state against minecraft-data.
 * @returns {{ ok: boolean, errors: string[], suggestions?: string[] }}
 */
export function validateBlockState(parsed, version = DEFAULT_MC_VERSION) {
  const d = mcData(version);
  if (!d) return { ok: true, errors: [] };
  const errors = [];
  const def = d.blocksByName[parsed.name];
  if (!def) {
    const sugg = ITEM_TO_BLOCK[parsed.name] ? [ITEM_TO_BLOCK[parsed.name]] : suggestBlocks(parsed.name, version);
    errors.push(`Unknown block "${parsed.name}" for Minecraft ${version}` + (sugg.length ? ` — did you mean ${sugg.map((s) => `"${s}"`).join(', ')}?` : ''));
    return { ok: false, errors, suggestions: sugg };
  }
  const states = new Map((def.states || []).map((s) => [s.name, s]));
  for (const [k, v] of Object.entries(parsed.props)) {
    const st = states.get(k);
    if (!st) {
      const valid = [...states.keys()];
      errors.push(`Block "${parsed.name}" has no property "${k}"` + (valid.length ? ` (valid: ${valid.join(', ')})` : ' (it has no properties)'));
      continue;
    }
    const values = st.type === 'bool' ? ['true', 'false'] : (st.values || []).map(String);
    if (values.length && !values.includes(String(v))) {
      errors.push(`Block "${parsed.name}" property "${k}" cannot be "${v}" (valid: ${values.join(', ')})`);
    }
  }
  return { ok: errors.length === 0, errors };
}
