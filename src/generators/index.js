/**
 * Built-in generators. Importing this module registers them all; use the re-exported registry
 * functions to list / run them:
 *
 *   import { runGenerator, listGenerators } from './src/generators/index.js';
 *   const s = runGenerator('house', { width: 9, roofStyle: 'hip', seed: 7 });
 */
import { registerGenerator } from './registry.js';
import { blockExists, materialFamily } from './helpers.js';
import sphere from './sphere.js';
import dome from './dome.js';
import cylinder from './cylinder.js';
import cone from './cone.js';
import box from './box.js';
import arch from './arch.js';
import pyramid from './pyramid.js';
import wall from './wall.js';
import house from './house.js';
import tower from './tower.js';
import castle from './castle.js';
import skyscraper from './skyscraper.js';
import tree from './tree.js';
import road from './road.js';
import bridge from './bridge.js';
import text from './text.js';
import pixelart from './pixelart.js';
import fountain from './fountain.js';
import city from './city.js';
import lamppost from './lamppost.js';
import bench from './bench.js';
import obelisk from './obelisk.js';
import lighthouse from './lighthouse.js';
import windmill from './windmill.js';

const ALL = [
  sphere, dome, cylinder, cone, box, arch, pyramid, wall, house, tower, castle, skyscraper, tree, road, bridge, text, pixelart, city,
  fountain, lamppost, bench, obelisk, lighthouse, windmill,
];

/**
 * Block params also accept material names that are not blocks themselves: 'spruce' → spruce_planks,
 * 'quartz' → quartz_block, 'stone_brick' → stone_bricks.
 */
function normalizeBlockParams(gen, p) {
  let out = p;
  for (const [k, spec] of Object.entries(gen.params || {})) {
    const v = p[k];
    if (spec.type !== 'block' || !v || blockExists(v)) continue;
    const base = materialFamily(v).base;
    if (base && blockExists(base)) {
      if (out === p) out = { ...p };
      out[k] = base;
    }
  }
  return out;
}

for (const g of ALL) registerGenerator({ ...g, build: (s, p, ctx) => g.build(s, normalizeBlockParams(g, p), ctx) });

export { getGenerator, listGenerators, runGenerator, resolveParams, makeContext, registerGenerator } from './registry.js';
