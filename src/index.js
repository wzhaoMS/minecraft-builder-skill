/**
 * Library API — for agents/humans writing their own build scripts.
 *
 *   import { connect, Structure, runGenerator } from './src/index.js';
 *   const mc = await connect();                 // reads mcb.config.json / MCB_* env / defaults
 *   const s = new Structure({ name: 'gate' });
 *   s.fill(0, 0, 0, 6, 4, 0, 'stone_bricks').clear(2, 0, 0, 4, 2, 0);
 *   const report = await mc.build(s, { near: 'Steve', verify: true });
 *   await mc.close();
 */
import { resolveConfig, stateDir } from './config.js';
import { openTransport } from './connect.js';
import { executeBuild } from './build.js';
import { loadBlueprint } from './io/blueprint.js';
import { Structure } from './core/structure.js';

export { Structure } from './core/structure.js';
export { parseBlock, formatBlock, canonical, blockName, withProps, isAir } from './core/blockstate.js';
export { transformBlock, transformPoint, transformDir, toQuarterTurns } from './core/transform.js';
export { createRng } from './core/rng.js';
export { lintStructure } from './core/lint.js';
export { validateBlockState, suggestBlocks, mcData } from './core/blockinfo.js';
export { loadBlueprint, fromJson } from './io/blueprint.js';
export { planBuild } from './compile/plan.js';
export { greedyBoxes } from './compile/greedy.js';
export { executeBuild, verifyAndRepair, blockMatches } from './build.js';
export { resolvePlacement, yawToDir } from './placement.js';
export { openTransport } from './connect.js';
export { resolveConfig } from './config.js';
export { captureRegion } from './snapshot.js';
export { getGamerule, setGamerule, withGamerules } from './gamerules.js';

/** Lazy re-exports of the heavier modules (generators, renderer, file formats). */
export const generators = () => import('./generators/index.js');
export const render = () => import('./render/preview.js');
export const formats = () => import('./io/formats/index.js');

export async function runGenerator(name, params = {}) {
  return (await import('./generators/index.js')).runGenerator(name, params);
}

export async function renderPreview(structure, opts = {}) {
  return (await import('./render/preview.js')).renderPreview(structure, opts);
}

/**
 * Connect to the configured server and get a small session object.
 * @param {object} [flags] same keys as the CLI flags (host, port, username, transport, rconPassword…)
 */
export async function connect(flags = {}) {
  const cfg = resolveConfig(flags);
  const transport = await openTransport(cfg, { log: flags.log ?? (() => {}) });
  return {
    transport,
    config: cfg,
    /** Build a Structure, a blueprint path, or "gen:<name>". Options as in `mcb build`. */
    async build(what, opts = {}) {
      const structure = what instanceof Structure ? what : await loadBlueprint(what, { params: opts.params ?? {} });
      return executeBuild({ structure, transport, stateDir: stateDir(cfg), version: cfg.version ?? transport.version, ...opts });
    },
    /** Run one command; returns { text, errors }. */
    command: (cmd) => transport.query(cmd.replace(/^\//, '')),
    /** Run many commands (acknowledged, rate-limited). */
    run: (cmds) => transport.run(cmds.map((c) => c.replace(/^\//, ''))),
    /** Player position/facing: { x, y, z, yaw, pitch }. */
    where: (player) => transport.playerPose(player),
    close: () => transport.close(),
  };
}
