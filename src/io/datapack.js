/**
 * Data pack export — lets a single-player user build a structure with no bot, server or mods:
 * copy the pack into `saves/<world>/datapacks/`, `/reload`, stand where the build's north-west
 * bottom corner should be and run `/function mcb:<name>`.
 *
 * Pack layout (Java 1.21+ uses the singular `function` folder), all ids under <ns>:<name>/…:
 *   <outDir>/<name>/pack.mcmeta, README.txt
 *   data/<ns>/function/<name>.mcfunction         entry point: /function <ns>:<name>
 *   data/<ns>/function/<name>/boot               waits until the origin marker entity is loaded
 *   data/<ns>/function/<name>/part_NNN           step N: note which of its chunks were already
 *                                                force-loaded, force-load them, start waiting
 *   data/<ns>/function/<name>/part_NNN_wait      re-checks every tick until the chunks are loaded
 *   data/<ns>/function/<name>/part_NNN_body      ≤ maxCommands /fill + /setblock, then next step
 *   data/<ns>/function/<name>/part_NNN_release   un-force-loads the step's chunks (only those it added)
 *   data/<ns>/function/<name>/{finish,cancel,timeout}
 *
 * How a build runs: the entry function summons a marker entity at the start position (tag
 * `<ns>_origin_<name>`) and force-loads its chunk. Steps run one tick apart; scheduled functions run
 * as the server at world spawn, so every step re-anchors with `execute at <marker>` (which also
 * supplies the dimension). Splitting into steps keeps every tick far below
 * max_command_sequence_length (65536) and the game responsive, and force-loading only one step's
 * chunks at a time lets builds of any size run without a player nearby. Chunks that were already
 * force-loaded before (by the player or another pack) stay force-loaded: their state is kept in
 * `storage <ns>:<name> f`. A watchdog (`timeout`, re-armed by every step) cancels the build if a
 * step's chunks don't load within timeoutTicks (5 minutes).
 *
 * Relative mode: structure coordinates are offsets from the start position (`~dx ~dy ~dz`; y = 0 is
 * the block at the player's feet). Absolute mode: the structure is placed with its origin at `at`
 * in the dimension the function is run in.
 */
import fs from 'node:fs';
import path from 'node:path';
import { planBuild } from '../compile/plan.js';

/** Data pack format of Minecraft 1.21 / 1.21.1 — the oldest supported (first with `function/`). */
export const PACK_FORMAT = 48;
/** Data pack format (major) of Minecraft 1.21.11 (94.1), verified on a 1.21.11 server. */
export const MAX_PACK_FORMAT = 94;
/** Data pack format of 1.21.5, the first version with `/fill … strict` and `/setblock … strict`. */
export const STRICT_PACK_FORMAT = 71;
/** Packs whose range reaches below this format must also declare pack_format + supported_formats. */
const NEW_META_FORMAT = 82;

export const DATAPACK_DEFAULTS = Object.freeze({
  maxCommands: 10000, // /fill + /setblock commands per step (one step per tick)
  maxBlocks: 131072, //  blocks changed per step (keeps each tick short)
  maxChunks: 144, //     chunks force-loaded per step
  timeoutTicks: 6000, // give up when a step's chunks don't load within this many ticks
});

const NAME_RE = /^[a-z0-9_]+$/;
const NS_RE = /^[a-z0-9_.-]+$/;

/** Sanitise a build name for function ids / tags: lower-case [a-z0-9_]. */
export function datapackName(name) {
  const n = String(name ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return n || 'build';
}

function toVec(at) {
  if (at == null) return [0, 0, 0];
  const v = Array.isArray(at) ? at : [at.x, at.y, at.z];
  if (v.length !== 3 || !v.every(Number.isInteger)) throw new Error(`"at" must be [x, y, z] integers, got ${JSON.stringify(at)}`);
  return v;
}

/** Rewrite the coordinates of a planned /fill or /setblock to `~dx ~dy ~dz` form. */
function relativize(op) {
  const n = op.kind === 'fill' ? 6 : 3;
  const parts = op.cmd.split(' ');
  for (let i = 1; i <= n; i++) {
    if (!/^-?\d+$/.test(parts[i] ?? '')) throw new Error(`Unexpected command format from the planner: ${op.cmd}`);
    parts[i] = `~${parts[i]}`;
  }
  return parts.join(' ');
}

/** Plan a structure into commands for the given placement mode. */
function planCommands(structure, { mode = 'relative', at, strict = false } = {}) {
  if (mode !== 'relative' && mode !== 'absolute') throw new Error(`mode must be "relative" or "absolute", got "${mode}"`);
  const off = mode === 'absolute' ? toVec(at) : [0, 0, 0];
  const world = off.some((v) => v !== 0) ? structure.translated(off[0], off[1], off[2]) : structure;
  const { ops, stats } = planBuild(world, { strict });
  const rel = mode === 'relative';
  for (const op of ops) op.text = rel ? relativize(op) : op.cmd;
  return { ops, stats, rel, offset: off };
}

const chunkSpanWorst = (a, b) => Math.floor((b - a + 1 + 14) / 16) + 1;
const chunkSpanExact = (a, b) => Math.floor(b / 16) - Math.floor(a / 16) + 1;

function chunkCount(box, rel) {
  const span = rel ? chunkSpanWorst : chunkSpanExact;
  return span(box.x1, box.x2) * span(box.z1, box.z2);
}

/** Split planned ops (already in placement order) into steps. */
export function splitIntoParts(ops, { maxCommands = DATAPACK_DEFAULTS.maxCommands, maxBlocks = DATAPACK_DEFAULTS.maxBlocks, maxChunks = DATAPACK_DEFAULTS.maxChunks, relative = true } = {}) {
  const parts = [];
  let cur = null;
  for (const op of ops) {
    if (cur) {
      const box = {
        x1: Math.min(cur.box.x1, op.x1), y1: Math.min(cur.box.y1, op.y1), z1: Math.min(cur.box.z1, op.z1),
        x2: Math.max(cur.box.x2, op.x2), y2: Math.max(cur.box.y2, op.y2), z2: Math.max(cur.box.z2, op.z2),
      };
      if (cur.ops.length >= maxCommands || cur.blocks + op.volume > maxBlocks || chunkCount(box, relative) > maxChunks) {
        parts.push(cur);
        cur = null;
      } else {
        cur.box = box;
      }
    }
    if (!cur) cur = { ops: [], blocks: 0, box: { x1: op.x1, y1: op.y1, z1: op.z1, x2: op.x2, y2: op.y2, z2: op.z2 } };
    cur.ops.push(op);
    cur.blocks += op.volume;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Rectangles (x1, z1, x2, z2) covering a box, each ≤ 240 blocks per side (≤ 256 chunks for /forceload). */
function forceloadRects(box) {
  const out = [];
  for (let x = box.x1; x <= box.x2; x += 240) {
    for (let z = box.z1; z <= box.z2; z += 240) out.push([x, z, Math.min(box.x2, x + 239), Math.min(box.z2, z + 239)]);
  }
  return out;
}

/** Sample coordinates ≤ 16 apart incl. both ends: every chunk overlapping [a, b] contains one. */
function samples(a, b) {
  const out = [];
  for (let v = a; v < b; v += 16) out.push(v);
  out.push(b);
  return out;
}

const pad = (i) => String(i).padStart(3, '0');
const text = (s, color) => JSON.stringify({ text: s, color });

function packMeta({ description, minFormat, maxFormat }) {
  const pack = { description };
  if (minFormat < NEW_META_FORMAT) {
    pack.pack_format = minFormat;
    pack.supported_formats = [minFormat, maxFormat];
  }
  pack.min_format = minFormat;
  pack.max_format = maxFormat;
  return JSON.stringify({ pack }, null, 2).replace(/\[\s+(\d+),\s+(\d+)\s+\]/, '[$1, $2]') + '\n';
}

/**
 * Build the data pack contents in memory.
 * @param {import('../core/structure.js').Structure} structure
 * @param {{ namespace?: string, name?: string, mode?: 'relative'|'absolute', at?: number[],
 *           packFormat?: number, maxFormat?: number, description?: string, strict?: boolean,
 *           maxCommands?: number, maxBlocks?: number, maxChunks?: number, timeoutTicks?: number }} [opts]
 * @returns {{ name: string, namespace: string, functionId: string, files: { path: string, content: string }[],
 *             parts: number, commands: number, blocks: number, mode: string, packFormat: object, bounds: object }}
 */
export function buildDatapack(structure, opts = {}) {
  const ns = opts.namespace ?? 'mcb';
  if (!NS_RE.test(ns)) throw new Error(`Invalid namespace "${ns}" (use lower-case letters, digits, _ . -)`);
  const name = datapackName(opts.name ?? structure.name);
  if (!NAME_RE.test(name)) throw new Error(`Invalid name "${name}"`);
  const mode = opts.mode ?? (opts.at ? 'absolute' : 'relative');
  const strict = !!opts.strict;
  const minFormat = opts.packFormat ?? (strict ? STRICT_PACK_FORMAT : PACK_FORMAT);
  const maxFormat = Math.max(opts.maxFormat ?? MAX_PACK_FORMAT, minFormat);
  const timeoutTicks = opts.timeoutTicks ?? DATAPACK_DEFAULTS.timeoutTicks;

  const { ops, stats, rel, offset } = planCommands(structure, { mode, at: opts.at, strict });
  if (!ops.length) throw new Error('Cannot export an empty structure (it has no blocks)');
  const parts = splitIntoParts(ops, {
    maxCommands: opts.maxCommands ?? DATAPACK_DEFAULTS.maxCommands,
    maxBlocks: opts.maxBlocks ?? DATAPACK_DEFAULTS.maxBlocks,
    maxChunks: opts.maxChunks ?? DATAPACK_DEFAULTS.maxChunks,
    relative: rel,
  });

  const fn = (p) => `${ns}:${name}/${p}`;
  const functionId = `${ns}:${name}`;
  const tag = `${ns}_origin_${name}`;
  const ptag = `${ns}_builder_${name}`;
  const S = `${ns}:${name}`; // command storage holding the build state under key "f"
  const M = `@e[type=marker,tag=${tag},limit=1]`;
  const ALL = `@e[type=marker,tag=${tag}]`;
  const c = (v) => (rel ? `~${v}` : String(v));
  const totalBlocks = stats.blocks;
  const b = structure.bounds();
  const wb = { min: b.min.map((v, i) => v + offset[i]), max: b.max.map((v, i) => v + offset[i]) };
  const fdir = `data/${ns}/function/${name}`;
  const files = [];
  const add = (p, lines) => files.push({ path: p, content: lines.join('\n') + '\n' });
  const where = rel
    ? `relative to the start position: x ${wb.min[0]}..${wb.max[0]}, y ${wb.min[1]}..${wb.max[1]}, z ${wb.min[2]}..${wb.max[2]}`
    : `at x ${wb.min[0]}..${wb.max[0]}, y ${wb.min[1]}..${wb.max[1]}, z ${wb.min[2]}..${wb.max[2]}`;

  files.push({
    path: 'pack.mcmeta',
    content: packMeta({ description: opts.description ?? `mcb build "${name}" - /function ${functionId}`, minFormat, maxFormat }),
  });

  add(`data/${ns}/function/${name}.mcfunction`, [
    `# ${name}: ${totalBlocks} blocks, ${ops.length} commands in ${parts.length} step(s), ${where}.`,
    `# Generated by mcb (minecraft-builder-skill). ${rel
      ? 'Run it standing where the north-west bottom corner of the build should be (x = east, z = south, y = up).'
      : 'Run it from anywhere in the dimension to build in.'}`,
    `# Stop a running build with /function ${fn('cancel')}`,
    `function ${fn('cancel')}`,
    `tag @s add ${ptag}`,
    `execute store success storage ${S} f.o byte 1 run forceload query ~ ~`,
    `data modify storage ${S} f.dim set value "minecraft:overworld"`,
    `execute if dimension minecraft:the_nether run data modify storage ${S} f.dim set value "minecraft:the_nether"`,
    `execute if dimension minecraft:the_end run data modify storage ${S} f.dim set value "minecraft:the_end"`,
    'forceload add ~ ~',
    `summon marker ~ ~ ~ {Tags:["${tag}"]}`,
    `tellraw @s ${text(`[mcb] Building ${name}: ${totalBlocks} blocks in ${parts.length} step(s)...`, 'gray')}`,
    `schedule function ${fn('timeout')} ${timeoutTicks}t`,
    `function ${fn('boot')}`,
  ]);
  add(`${fdir}/boot.mcfunction`, [
    '# wait until the origin marker is loaded (it is not yet when started away from players), note its position',
    `execute unless entity ${M} run schedule function ${fn('boot')} 1t`,
    ...['x', 'y', 'z'].map((a, i) => `execute if entity ${M} store result storage ${S} f.${a} int 1 run data get entity ${M} Pos[${i}]`),
    `execute if entity ${M} run function ${fn('part_000')}`,
  ]);

  let done = 0;
  parts.forEach((part, i) => {
    const id = pad(i);
    const rects = forceloadRects(part.box);
    const pts = [];
    for (const z of samples(part.box.z1, part.box.z2)) for (const x of samples(part.box.x1, part.box.x2)) pts.push([x, z]);
    add(`${fdir}/part_${id}.mcfunction`, [
      `# step ${i + 1}/${parts.length}: remember which of its chunks were force-loaded already, force-load them, wait`,
      `data modify storage ${S} f.step set value ${i}`,
      ...pts.map(([x, z], k) => `execute at ${M} store success storage ${S} f.c${k} byte 1 run forceload query ${c(x)} ${c(z)}`),
      ...rects.map((r) => `execute at ${M} run forceload add ${r.map(c).join(' ')}`),
      `function ${fn(`part_${id}_wait`)}`,
    ]);
    add(`${fdir}/part_${id}_wait.mcfunction`, [
      `# step ${i + 1}/${parts.length}: build once all its chunks are loaded (re-checked every tick)`,
      `schedule function ${fn(`part_${id}_wait`)} 1t`,
      `execute at ${M} ${pts.map(([x, z]) => `if loaded ${c(x)} ${c(part.box.y1)} ${c(z)}`).join(' ')} run function ${fn(`part_${id}_body`)}`,
    ]);
    add(`${fdir}/part_${id}_release.mcfunction`, [
      `# step ${i + 1}/${parts.length}: un-force-load the chunks this step force-loaded (runs at the origin marker)`,
      ...pts.map(([x, z], k) => `execute unless data storage ${S} {f:{c${k}:1b}} run forceload remove ${c(x)} ${c(z)}`),
    ]);
    done += part.blocks;
    const last = i === parts.length - 1;
    add(`${fdir}/part_${id}_body.mcfunction`, [
      `# step ${i + 1}/${parts.length}: ${part.ops.length} commands, ${part.blocks} blocks (runs at the origin marker)`,
      `schedule clear ${fn(`part_${id}_wait`)}`,
      ...part.ops.map((op) => op.text),
      `function ${fn(`part_${id}_release`)}`,
      `title @a[tag=${ptag}] actionbar ${text(`[mcb] ${name}: ${Math.floor((100 * done) / Math.max(1, totalBlocks))}% (step ${i + 1}/${parts.length})`, 'gray')}`,
      ...(last
        ? [`function ${fn('finish')}`]
        : [`schedule function ${fn('timeout')} ${timeoutTicks}t`, `schedule function ${fn(`part_${pad(i + 1)}`)} 1t`]),
    ]);
  });

  add(`${fdir}/finish.mcfunction`, [
    '# build finished: remove the marker and the origin force-load',
    `schedule clear ${fn('timeout')}`,
    `execute at ${ALL} unless data storage ${S} {f:{o:1b}} run forceload remove ~ ~`,
    `kill ${ALL}`,
    `data remove storage ${S} f`,
    `tellraw @a[tag=${ptag}] ${text(`[mcb] ${name}: done - ${totalBlocks} blocks placed.`, 'green')}`,
    `tag @a[tag=${ptag}] remove ${ptag}`,
  ]);
  add(`${fdir}/release_here.mcfunction`, [
    '# un-force-load what the current step and the start added (run at the origin)',
    ...parts.map((_, i) => `execute if data storage ${S} {f:{step:${i}}} run function ${fn(`part_${pad(i)}_release`)}`),
    `execute unless data storage ${S} {f:{o:1b}} run forceload remove ~ ~`,
  ]);
  add(`${fdir}/release_orphan.mcfunction`, [
    '# the marker entity is gone (e.g. /kill @e): release the force-loads from the saved start position',
    `$execute in $(dim) positioned $(x) $(y) $(z) run function ${fn('release_here')}`,
  ]);
  add(`${fdir}/cancel.mcfunction`, [
    `# stop a running build of ${name} and clean up (marker entity, force-loaded chunks)`,
    `execute if data storage ${S} f run tellraw @a[tag=${ptag}] ${text(`[mcb] ${name}: build stopped.`, 'yellow')}`,
    `schedule clear ${fn('timeout')}`,
    `schedule clear ${fn('boot')}`,
    ...parts.flatMap((_, i) => [`schedule clear ${fn(`part_${pad(i)}`)}`, `schedule clear ${fn(`part_${pad(i)}_wait`)}`]),
    `execute at ${M} run function ${fn('release_here')}`,
    `execute unless entity ${M} if data storage ${S} f.x run function ${fn('release_orphan')} with storage ${S} f`,
    `kill ${ALL}`,
    `data remove storage ${S} f`,
    `tag @a[tag=${ptag}] remove ${ptag}`,
  ]);
  add(`${fdir}/timeout.mcfunction`, [
    `# watchdog: a step's chunks did not load within ${timeoutTicks / 20} s`,
    `tellraw @a[tag=${ptag}] ${text(`[mcb] ${name}: gave up - chunks did not load within ${timeoutTicks / 20} s. Run /function ${functionId} again.`, 'red')}`,
    `function ${fn('cancel')}`,
  ]);

  const secs = Math.max(1, Math.ceil(parts.length / 20));
  files.push({ path: 'README.txt', content: readme({ name, functionId, fn, rel, where, totalBlocks, ops, parts, secs, strict, minFormat }) });

  return {
    name, namespace: ns, functionId, files, mode,
    parts: parts.length, commands: ops.length, blocks: totalBlocks,
    bounds: wb,
    packFormat: { pack_format: minFormat < NEW_META_FORMAT ? minFormat : undefined, min_format: minFormat, max_format: maxFormat },
  };
}

function readme({ name, functionId, fn, rel, where, totalBlocks, ops, parts, secs, strict, minFormat }) {
  const versions = strict || minFormat >= STRICT_PACK_FORMAT ? '1.21.5 - 1.21.11' : '1.21 - 1.21.11';
  return [
    `${name} - Minecraft Java Edition data pack generated by mcb (minecraft-builder-skill)`,
    '',
    `Builds ${totalBlocks} blocks (${where}) with ${ops.length} commands in ${parts.length} step(s), about ${secs} s.`,
    `Works with Minecraft Java ${versions}.`,
    '',
    'How to use (single-player):',
    `  1. Copy this "${name}" folder into  .minecraft/saves/<YourWorld>/datapacks/`,
    '     (Windows: %APPDATA%\\.minecraft\\saves\\<YourWorld>\\datapacks\\ ; macOS: ~/Library/Application Support/minecraft/saves/...)',
    '  2. Open the world with cheats allowed (or "Open to LAN" with "Allow Cheats: ON").',
    '  3. Run:  /reload',
    rel
      ? `  4. Stand where the north-west bottom corner of the build should go (the build grows east (+x), south (+z) and up from your feet) and run:\n       /function ${functionId}`
      : `  4. In the dimension to build in, run:  /function ${functionId}`,
    `  5. The build appears over the next seconds. To stop it:  /function ${fn('cancel')}`,
    '',
    'While it runs it force-loads the chunks it is building in (one step at a time) and keeps an invisible marker',
    'entity at the start position; both are removed when it finishes (chunks that were force-loaded before stay',
    'force-loaded). You can delete the pack folder once the build is done - the blocks stay.',
    '',
  ].join('\n');
}

/**
 * Write the data pack to `<outDir>/<name>/`.
 * @param {import('../core/structure.js').Structure} structure
 * @param {{ outDir: string } & Parameters<typeof buildDatapack>[1]} opts
 * @returns {{ packDir: string, files: string[], functionId: string, instructions: string, parts: number,
 *             commands: number, blocks: number, mode: string, packFormat: object }}
 */
export function writeDatapack(structure, opts = {}) {
  if (!opts.outDir) throw new Error('writeDatapack needs { outDir } (e.g. <.minecraft>/saves/<World>/datapacks)');
  const dp = buildDatapack(structure, opts);
  const packDir = path.resolve(opts.outDir, dp.name);
  // Remove stale steps from a previous export of the same build.
  fs.rmSync(path.join(packDir, 'data', dp.namespace, 'function', dp.name), { recursive: true, force: true });
  const files = [];
  for (const f of dp.files) {
    const full = path.join(packDir, ...f.path.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.content);
    files.push(full);
  }
  const instructions = [
    `Data pack "${dp.name}" (${dp.blocks} blocks, ${dp.parts} step(s)) written to ${packDir}`,
    `In Minecraft (cheats on): copy the "${dp.name}" folder into saves/<World>/datapacks/ if it isn't there yet, run /reload, then`,
    dp.mode === 'relative'
      ? `stand where the build's north-west bottom corner should be and run /function ${dp.functionId}`
      : `run /function ${dp.functionId} (builds at fixed coordinates in the current dimension)`,
    `Stop a running build with /function ${dp.functionId}/cancel.`,
  ].join('\n');
  return {
    packDir, files, functionId: dp.functionId, instructions,
    name: dp.name, namespace: dp.namespace, mode: dp.mode, parts: dp.parts, commands: dp.commands, blocks: dp.blocks,
    bounds: dp.bounds, packFormat: dp.packFormat,
  };
}

/**
 * A single function with all the commands (no step splitting / chunk loading) — for small builds
 * near the player. Relative mode uses `~dx ~dy ~dz` coordinates.
 * @param {import('../core/structure.js').Structure} structure
 * @param {{ mode?: 'relative'|'absolute', at?: number[], strict?: boolean, maxCommands?: number }} [opts]
 * @returns {string}
 */
export function writeMcfunction(structure, opts = {}) {
  const mode = opts.mode ?? (opts.at ? 'absolute' : 'relative');
  const maxCommands = opts.maxCommands ?? 65536;
  const { ops, stats, rel } = planCommands(structure, { mode, at: opts.at, strict: !!opts.strict });
  if (!ops.length) throw new Error('Cannot export an empty structure (it has no blocks)');
  if (ops.length > maxCommands) {
    throw new Error(`Too many commands for one function (${ops.length} > ${maxCommands}, the max_command_sequence_length gamerule) — export a data pack instead (mcb export … --datapack <dir>)`);
  }
  const header = [
    `# ${structure.name ?? 'structure'}: ${stats.blocks} blocks in ${ops.length} commands. Generated by mcb (minecraft-builder-skill).`,
    rel
      ? '# Relative coordinates: run it standing where the north-west bottom corner should be (x = east, z = south, y = up).'
      : '# Absolute coordinates: run it in the dimension to build in.',
    '# All chunks of the build must be loaded (stay close by); for big builds export a data pack instead.',
  ];
  return [...header, ...ops.map((op) => op.text)].join('\n') + '\n';
}
