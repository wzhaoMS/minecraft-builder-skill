/**
 * mcb — Minecraft builder CLI for AI agents and humans.
 * Every command supports --json (single JSON object on stdout; logs go to stderr).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs, parseCoords, parseParams } from './args.js';
import { resolveConfig, writeConfigFile, stateDir, CONFIG_FILE } from '../config.js';
import { loadBlueprint } from '../io/blueprint.js';
import { lintStructure } from '../core/lint.js';
import { planBuild } from '../compile/plan.js';
import { executeBuild, validateBuildOptions, dimensionLabel, normalizeDimension } from '../build.js';
import { openTransport, onlinePlayers } from '../connect.js';
import { listSnapshots, captureRegion, dropUnbuildableData } from '../snapshot.js';
import { DEFAULT_MC_VERSION } from '../core/blockinfo.js';

const require = createRequire(import.meta.url);
const PKG = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const BOOLEANS = ['json', 'quiet', 'help', 'verify', 'strict', 'dryRun', 'force', 'acceptEula', 'fawe', 'installJava', 'list', 'noAir', 'all', 'yes', 'repair', 'undo', 'lan', 'echo', 'anyServer', 'newSession'];

export const HELP = `mcb ${PKG.version} — build anything in Minecraft Java Edition (for AI agents and humans)

USAGE  mcb <command> [args] [--flags]          (all commands accept --json)

DESIGN
  generators                         List built-in generators and their params
  info <blueprint> [-p k=v]          Size, block counts, command plan, lint warnings
  validate <blueprint>               Check block names/states against Minecraft (exit 1 on errors)
  preview <blueprint> [-o out.png] [--view sheet|iso|iso-nw|top|south|north|east|west] [--size <max px>] [--cut <y>]
  export <blueprint> -o <file.schem|.nbt|.json|.mcfunction|.png>   |   --datapack <dir> [--name n] [--at x,y,z]
  generate <generator> [-p k=v]... -o <file>           Run a generator and save the result

BUILD (needs a running server)
  plan <blueprint> (--at x,y,z | --near <player>) [build flags]   Read-only: where it lands, what it replaces, cost
  build <blueprint> (--at x,y,z | --near <player>) [--facing north|east|south|west] [--rotate 90]
        [--mirror x|z] [--anchor corner|center|origin] [--clear [margin]] [--ground <block>]
        [--verify] [--strict] [--mode fill|layered|hand] [--bps 20] [--dimension overworld|the_nether|the_end]
        [--no-undo] [--force] [--echo] [--dry-run] [-p k=v]
  undo [id|file] [--list] [--force] [--any-server]   Restore what a build changed (skips blocks edited since, unless --force)
  watch <blueprint> (--at x,y,z | --near <player>)   Rebuild live whenever the file is saved (only changes are sent)
  snapshot --from x,y,z --to x,y,z -o <file.json|.schem> [--render out.png]   Copy a region into a blueprint
  where [player]                     Player position and facing (or list players)
  cmd "<command>" ["<command>"...]   Run raw commands (no leading slash needed)

SERVER
  doctor                             Diagnose Node/Java/server/bot/op problems with fixes
  mcp                                Run as an MCP server on stdio (tools: mc_preview, mc_build, mc_undo, …)
  server setup [--dir ../mc-server] [--mc-version ${DEFAULT_MC_VERSION}] [--port 25565] --accept-eula
               [--op <you>] [--fawe] [--install-java] [--world flat|normal] [--lan]
  server start|stop|status|logs [--dir <server dir>]
  server op <name>

CONNECTION FLAGS (precedence: flags > MCB_* env vars > mcb.config.json > defaults)
  --host 127.0.0.1 --port 25565 --username BuilderBot --auth offline|microsoft --version <auto>
  --transport auto|bot|rcon --rcon-port 25575 --rcon-password <pw> --config <file>
  env: MCB_HOST MCB_PORT MCB_USERNAME MCB_AUTH MCB_VERSION MCB_TRANSPORT MCB_RCON_PORT MCB_RCON_PASSWORD
       MCB_PLAYER MCB_CONFIG MCB_DEBUG
  mcb.config.json is found in the current directory or its parents; undo snapshots live in .mcb/
  next to it (or in the current directory when there is none).

BLUEPRINTS  .json (palette + ASCII layers / fills / blocks / generator / parts), .js/.mjs modules,
            .schem .schematic .nbt .litematic, or gen:<name>. Front faces SOUTH (+Z); --facing turns it.
Details for one command: mcb <command> --help
Docs: SKILL.md, docs/  •  https://github.com/wzhaoMS/minecraft-builder-skill`;

const HELP_FOOTER = 'Connection flags (--host --port --rcon-port --rcon-password --config --transport --username) work on every command.\nAll commands accept --json. General help: mcb --help';

const PLACEMENT_HELP = `WHERE IT GOES (pick one)
  --at x,y,z            y = the level the player's feet are at (blueprint y=0 = first layer above ground).
                        x,z = the footprint's north-west corner (--anchor corner, default),
                        its centre (--anchor center) or blueprint (0,0,0) (--anchor origin).
                        ~ is relative to --near's player: --at ~5,~,~-3
  --near <player>       next to a player, front facing them: in front of them by default,
                        --side north|east|south|west to put it on another side,
                        --gap <n> blocks between them and the build (default 3)
  --facing <dir>        turn the build so its front (built facing south) faces dir
  --rotate 90|180|270   extra clockwise turn; --mirror x|z
  --dimension overworld|the_nether|the_end   (default: the --near player's, else the overworld)`;

const COMMAND_HELP = {
  build: `mcb build <blueprint> (--at x,y,z | --near <player>) [options]
Build a blueprint in the running world: validate → snapshot (undo) → check what it replaces →
send merged /fill commands → optionally verify. Nothing changes if any check fails.

${PLACEMENT_HELP}

WHAT HAPPENS
  --verify              read every block back afterwards and repair mismatches once
  --clear [margin]      empty the area (+margin, default 2) first — trees, terrain, old builds
  --ground <block>      lay a foundation layer under the footprint
  --mode fill|layered|hand   fill (fast, default) · layered (one block at a time, --bps) · hand
                        (the bot places blocks visibly)
  --strict              exact block states, no neighbour updates
  --force               allow destroying chests and other containers (and other refusals)
  --no-undo             skip the undo snapshot (the container check still runs)
  --echo                keep op command echo on (it is muted during builds by default)
  --dry-run             print the commands without connecting (needs --at)
  -p key=value          generator / JS blueprint parameters (repeatable), --params '{json}'

Prints an undo command; --json prints a mcb.build-report/1 object.`,
  plan: `mcb plan <blueprint> (--at x,y,z | --near <player>) [build options]
Read-only: where the build would land (world box, facing, dimension), how many existing blocks it
would replace (by type), whether it would destroy chests or other containers, and how many commands it needs.
Takes the same options as build.

${PLACEMENT_HELP}`,
  watch: `mcb watch <blueprint file> (--at x,y,z | --near <player>) [build options]
Build, then rebuild every time the file is saved: only differences are sent and blocks you removed
from the design are put back to what the world had before. Stop with Ctrl+C (or by ending the
process). One undo id covers the whole session (printed at the start); restarting watch on the same
file with the same placement continues that session (--new-session starts over).
It holds the bot account while running: other bot commands (snapshot, build…) log the same bot in
and kick it — it rejoins on the next save, but run them one at a time (or with RCON) when you can.
--json prints one JSON object per line (events: session, rebuild, error, watching, stopped).

${PLACEMENT_HELP}`,
  undo: `mcb undo [id | snapshot file] [--list] [--force] [--any-server]
Restore what a build (or a whole watch session) changed. Pass the id the build printed — plain
\`mcb undo\` takes the newest snapshot in this undo store (.mcb/undo next to the config).
Blocks edited since the build (or unreadable) are left alone and listed; --force restores them too.
Grass/paths that decayed under the build are put back. --any-server allows a snapshot taken on
another server address (same world). --list shows the snapshots in this store.`,
  preview: `mcb preview <blueprint> [-o out.png] [--view sheet|iso|iso-nw|iso-ne|iso-sw|top|south|north|east|west]
             [--facing <dir>] [--cut <y>] [--size <max px>] [-p key=value]
Render a PNG: the sheet has an iso view from the south-east, a top view (north up) and the south
(front) and east elevations. --facing shows it turned the way build --facing will place it,
--cut hides everything above y (floor plans, interiors). Unknown blocks are listed.`,
  snapshot: `mcb snapshot --from x,y,z --to x,y,z -o <file.json|.schem|.nbt|.litematic> [--render out.png]
             [--dimension overworld|the_nether|the_end] [--no-air]
Copy a region of the world into a blueprint file (bot transport). Use it to look at what is really
built (--render) or to duplicate something elsewhere.`,
  export: `mcb export <blueprint> -o <file.schem|.nbt|.litematic|.json|.mcfunction|.png> [-p key=value]
mcb export <blueprint> --datapack <world>/datapacks --name <name> [--at x,y,z]
.schem: WorldEdit — put it in config/worldedit/schematics (single player) or plugins/WorldEdit/schematics,
  //schem load <name>, stand where the north-west bottom corner goes, //paste (-a keeps existing blocks:
  cells the blueprint leaves untouched are saved as air).
Data pack: open the world with cheats on, /reload, stand at the north-west bottom corner (or pass
  --at for fixed coordinates), /function mcb:<name>; /function mcb:<name>/cancel stops it. No undo.`,
  info: `mcb info <blueprint> [-p key=value] [--all]
Size (W×H×D), bounds, block counts (solid and air), an estimate of commands/time, lint results.
Sizes include extras like eaves and foundations below y=0 — use them to lay out several parts.`,
  validate: `mcb validate <blueprint> [-p key=value]
Check every block state against the Minecraft data (with suggestions), complete doors/beds, translate
renamed blocks, and warn about unsupported torches/plants and floating sand. Exit code 1 on errors.`,
  generators: `mcb generators [name] [--all]
List the built-in generators, or one generator's parameters (type, default, range, description).
Use them as gen:<name> with -p key=value, e.g. mcb preview gen:house -p style=medieval.`,
  where: `mcb where [player]
A player's position (block and exact), facing and dimension — or the list of online players.`,
  doctor: `mcb doctor [connection flags]
Check Node, dependencies, config, the server (and where its address came from), RCON, the bot's
login and operator status, with a fix for every problem. Also restores gamerules an interrupted
build left changed.`,
  server: `mcb server setup [--dir ../mc-server] [--mc-version <v>] [--port 25565] --accept-eula [--op <you>]
                 [--fawe] [--install-java] [--world flat|normal] [--lan]
mcb server start|stop|status|logs [--dir <server dir>]
mcb server op <name>
A local Paper server for building. setup writes mcb.config.json so later commands need no flags.`,
  cmd: `mcb cmd "<command>" ["<command>" …]
Run raw server commands (no leading slash) and print their output.`,
  mcp: `mcb mcp
Run as an MCP server on stdio (tools mc_preview, mc_plan, mc_build, mc_undo, mc_snapshot, …).
See docs/mcp.md for client configuration.`,
  generate: `mcb generate <generator> [-p key=value]… -o <file>
Run a generator and save the result as a blueprint/structure file.`,
};

class Output {
  constructor(flags) {
    this.json = !!flags.json;
    this.quiet = !!flags.quiet;
    this.tty = process.stderr.isTTY;
    this._lastProgress = 0;
  }
  log(msg) { if (!this.quiet) process.stderr.write(`${msg}\n`); }
  print(msg) { if (!this.json) process.stdout.write(`${msg}\n`); }
  result(obj) { if (this.json) process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
  /** One compact JSON object per line (long-running commands like watch: NDJSON on stdout). */
  event(obj) { if (this.json) process.stdout.write(JSON.stringify(obj) + '\n'); }
  progress(p) {
    if (this.quiet) return;
    const now = Date.now();
    const pct = p.total ? Math.floor((p.done / p.total) * 100) : 0;
    const label = p.stage === 'build' && p.blocksTotal
      ? `building ${pct}% (${p.blocksDone}/${p.blocksTotal} blocks${p.etaMs != null ? `, ~${Math.ceil(p.etaMs / 1000)}s left` : ''})`
      : `${p.stage} ${pct}%`;
    if (this.tty) {
      process.stderr.write(`\r${label}`.padEnd(70));
      if (p.done >= p.total) process.stderr.write('\n');
    } else if (now - this._lastProgress > 5000 || p.done >= p.total) {
      this._lastProgress = now;
      process.stderr.write(`${label}\n`);
    }
  }
}

function fmtBox(b) {
  return `${b.min.join(',')} → ${b.max.join(',')}`;
}

/** Resolved config; problems in mcb.config.json (unknown keys…) are printed as warnings. */
function configFor(flags, out) {
  const cfg = resolveConfig(flags);
  for (const w of cfg._warnings ?? []) out.log(`warning: ${w}`);
  return cfg;
}

async function loadWithParams(src, flags) {
  if (!src) throw Object.assign(new Error('Missing blueprint argument'), { hint: 'e.g. `mcb info examples/blueprints/cottage.json` or `mcb preview gen:house`', exitCode: 2 });
  const params = parseParams(flags.param, flags.params);
  return loadBlueprint(src, { params });
}

// ───────────────────────────── commands ─────────────────────────────

async function cmdGenerators(flags, out) {
  const { listGenerators } = await import('../generators/index.js');
  const list = listGenerators().map((g) => ({
    name: g.name,
    description: g.description,
    params: Object.fromEntries(Object.entries(g.params || {}).map(([k, s]) => [k, { type: s.type, default: s.default, ...(s.values ? { values: s.values } : {}), ...(s.min !== undefined ? { min: s.min } : {}), ...(s.max !== undefined ? { max: s.max } : {}), description: s.description }])),
  }));
  out.result({ ok: true, generators: list });
  for (const g of list) {
    if (flags._[1] && g.name !== flags._[1]) continue;
    out.print(`${g.name.padEnd(12)} ${g.description}`);
    if (flags._[1] || flags.all) {
      for (const [k, s] of Object.entries(g.params)) {
        const extra = s.values ? ` (${s.values.join('|')})` : s.min !== undefined || s.max !== undefined ? ` [${s.min ?? ''}..${s.max ?? ''}]` : '';
        out.print(`    ${k.padEnd(16)} ${String(s.type).padEnd(7)} default=${JSON.stringify(s.default)}${extra}  ${s.description ?? ''}`);
      }
    }
  }
  if (!flags._[1] && !flags.all) out.print('\nShow params: mcb generators <name>   (or --all). Use: mcb preview gen:<name> -p key=value');
  return 0;
}

async function cmdInfo(flags, out) {
  const s = await loadWithParams(flags._[1], flags);
  const lint = lintStructure(s, { version: flags.version || DEFAULT_MC_VERSION });
  const b = s.bounds();
  const plan = b ? planBuild(s, {}).stats : null;
  const counts = s.blockCounts();
  const air = (counts.air ?? 0) + (counts.cave_air ?? 0) + (counts.void_air ?? 0);
  const res = {
    ok: lint.ok, name: s.name, size: b?.size ?? [0, 0, 0], bounds: b ? { min: b.min, max: b.max } : null, blocks: s.count,
    solidBlocks: s.count - air, airBlocks: air,
    palette: Object.keys(counts).length, counts, plan,
    estimatedSeconds: plan ? Math.max(1, Math.round(plan.commands / 150)) : 0,
    lint: { errors: lint.errors, warnings: lint.warnings, fixes: lint.fixes },
  };
  out.result(res);
  out.print(`${s.name}: ${res.size.join('×')} (W×H×D), ${s.count} blocks (${s.count - air} solid${air ? ` + ${air} air that clears space` : ''}), ${res.palette} block types`);
  if (b) out.print(`bounds ${fmtBox(b)}   plan: ≈${plan.commands} commands (${plan.fills} fill, ${plan.setblocks} setblock; exact count depends on where it lands), ~${res.estimatedSeconds}s to build`);
  const top = Object.entries(counts).slice(0, flags.all ? undefined : 12);
  for (const [blk, n] of top) out.print(`  ${String(n).padStart(7)}  ${blk}`);
  if (Object.keys(counts).length > top.length) out.print(`  … ${Object.keys(counts).length - top.length} more (--all lists them)`);
  printLint(lint, out);
  return lint.ok ? 0 : 1;
}

function printLint(lint, out) {
  for (const e of lint.errors) out.print(`✗ ${e.errors.join('; ')}  (${e.count}× e.g. at ${e.at.join(',')})`);
  for (const w of lint.warnings) out.print(`⚠ ${w.message} (${w.count}× e.g. ${w.examples.map((p) => p.join(',')).join(' ')})`);
  for (const f of lint.fixes) out.print(`✓ auto-fix: ${f.message} (${f.count}×)`);
}

async function cmdValidate(flags, out) {
  const s = await loadWithParams(flags._[1], flags);
  const lint = lintStructure(s, { version: flags.version || DEFAULT_MC_VERSION });
  const air = airCount(s);
  out.result({ ok: lint.ok, errors: lint.errors, warnings: lint.warnings, fixes: lint.fixes, blocks: s.count, solidBlocks: s.count - air, airBlocks: air });
  const what = `${s.count} blocks (${s.count - air} solid${air ? ` + ${air} air` : ''})`;
  if (lint.ok && !lint.warnings.length) out.print(`✓ ${s.name}: ${what}, all block states valid for Minecraft ${flags.version || DEFAULT_MC_VERSION}`);
  else if (lint.ok) out.print(`✓ ${s.name}: ${what}, valid with warnings:`);
  printLint(lint, out);
  return lint.ok ? 0 : 1;
}

function airCount(s) {
  const c = s.blockCounts();
  return (c.air ?? 0) + (c.cave_air ?? 0) + (c.void_air ?? 0);
}

async function cmdPreview(flags, out) {
  let s = await loadWithParams(flags._[1], flags);
  const lint = lintStructure(s, { version: flags.version || DEFAULT_MC_VERSION });
  let front = 'south';
  if (flags.facing && flags.facing !== true) {
    // show it the way `build --facing` will place it; the sheet then shows that front and side
    const { turnsForFacing } = await import('../placement.js');
    const name = s.name;
    s = s.transformed({ rotate: turnsForFacing(flags.facing) * 90 });
    s.name = `${name} (facing ${flags.facing})`;
    front = String(flags.facing).toLowerCase();
  }
  const { renderPreview } = await import('../render/preview.js');
  const view = flags.view ?? 'sheet';
  const file = flags.out && flags.out !== true ? flags.out : `${(s.name || 'preview').replace(/[^\w.-]+/g, '_')}${view === 'sheet' ? '' : '-' + view}.png`;
  const r = renderPreview(s, {
    view, maxSize: flags.size ? Number(flags.size) : undefined, title: s.name, front,
    cutaway: flags.cut !== undefined && flags.cut !== true ? { y: Number(flags.cut) } : undefined,
  });
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, r.png);
  const b = s.bounds();
  const air = airCount(s);
  out.result({ ok: lint.ok, file: path.resolve(file), view, width: r.width, height: r.height, size: b?.size, blocks: s.count, solidBlocks: s.count - air, errors: lint.errors });
  out.print(`wrote ${path.resolve(file)} (${r.width}×${r.height} px, view=${view}) — ${b ? b.size.join('×') : 'empty'}, ${s.count} blocks (${s.count - air} solid)`);
  // the image renders unknown blocks too, so say so — a build would refuse them
  for (const e of lint.errors) out.print(`✗ ${e.errors.join('; ')}  (${e.count}× e.g. at ${e.at.join(',')})`);
  return 0;
}

async function cmdExport(flags, out) {
  const s = await loadWithParams(flags._[1], flags);
  lintStructure(s, { version: flags.version || DEFAULT_MC_VERSION });
  if (flags.datapack) {
    const { writeDatapack } = await import('../io/datapack.js');
    const name = (flags.name ?? s.name ?? 'build').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    const at = flags.at ? parseCoords(flags.at) : undefined;
    const r = await writeDatapack(s, { outDir: flags.datapack, name, mode: at ? 'absolute' : 'relative', at, strict: !!flags.strict });
    out.result({ ok: true, ...r });
    out.print(`wrote data pack → ${path.resolve(flags.datapack)}`);
    if (r.instructions) out.print(r.instructions);
    return 0;
  }
  const file = flags.out;
  if (!file || file === true) throw Object.assign(new Error('export needs -o <file> or --datapack <dir>'), { exitCode: 2 });
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return cmdPreview({ ...flags, out: file }, out);
  if (ext === '.mcfunction') {
    const { writeMcfunction } = await import('../io/datapack.js');
    const at = flags.at ? parseCoords(flags.at) : undefined;
    fs.writeFileSync(file, writeMcfunction(s, { mode: at ? 'absolute' : 'relative', at, strict: !!flags.strict }));
  } else {
    const { writeStructureFile } = await import('../io/formats/index.js');
    await writeStructureFile(s, file, {});
  }
  out.result({ ok: true, file: path.resolve(file), blocks: s.count });
  out.print(`wrote ${path.resolve(file)} (${s.count} blocks)`);
  return 0;
}

async function cmdGenerate(flags, out) {
  const name = flags._[1];
  if (!name) throw Object.assign(new Error('Usage: mcb generate <generator> [-p k=v] -o <file>'), { exitCode: 2 });
  const src = name.startsWith('gen:') ? name : `gen:${name}`;
  if (!flags.out || flags.out === true) return cmdInfo({ ...flags, _: ['info', src] }, out);
  return cmdExport({ ...flags, _: ['export', src] }, out);
}

function buildOptsFromFlags(flags, cfg) {
  // a flag given without a value (`--gap`) parses as true: make it fail validation instead of meaning 1
  const num = (v) => (v === undefined ? undefined : v === true ? NaN : Number(v));
  return {
    at: undefined,
    near: flags.near && flags.near !== true ? flags.near : undefined,
    side: flags.side && flags.side !== true ? flags.side : undefined,
    facing: flags.facing,
    rotate: flags.rotate,
    mirror: flags.mirror,
    anchor: flags.anchor,
    gap: num(flags.gap),
    clear: flags.clear === undefined || flags.clear === false ? false : flags.clear === true ? true : Number(flags.clear),
    ground: flags.ground && flags.ground !== true ? flags.ground : undefined,
    verify: !!flags.verify,
    repair: flags.repair !== false,
    strict: !!flags.strict,
    mode: flags.mode ?? 'fill',
    bps: num(flags.bps),
    undo: flags.undo !== false,
    dryRun: !!flags.dryRun,
    force: !!flags.force,
    dimension: flags.dimension && flags.dimension !== true ? flags.dimension : undefined,
    stateDir: stateDir(cfg),
    quiet: flags.echo === true ? false : undefined,
  };
}

async function cmdBuild(flags, out, { planOnly = false } = {}) {
  const cfg = configFor(flags, out);
  const s = await loadWithParams(flags._[1], flags);
  const o = buildOptsFromFlags(flags, cfg);
  o.planOnly = planOnly;
  if (!flags.at && !o.near && cfg.player) o.near = cfg.player;
  if (!flags.at && !o.near && !o.dryRun) {
    throw Object.assign(new Error('Where should it go? Pass --at x,y,z or --near <player>'), {
      code: 'PLACEMENT_REQUIRED', hint: 'Find coordinates with `mcb where <player>` (F3 in game), or set "player" in mcb.config.json.', exitCode: 2,
    });
  }
  checkBuildFlags(flags, o, cfg);
  const transport = await openTransport(cfg, { dryRun: o.dryRun, log: (m) => out.log(m) });
  try {
    if (flags.at && !o.at) await resolveRelativeAt(flags, o, cfg, transport);
    else if (o.dryRun && !o.near && !o.at) {
      o.at = [0, 0, 0];
    }
    out.log(`${planOnly ? 'planning' : 'building'} "${s.name}" via ${transport.kind}${transport.version ? ` (server ${transport.version})` : ''}…`);
    const report = await executeBuild({
      structure: s, transport, ...o, version: cfg.version ?? transport.version,
      log: (m) => out.log(m), onProgress: (p) => out.progress(p),
    });
    if (report.undo?.available) report.undo.command = `${selfCommand()} undo ${report.undo.id}${configFlag(flags)}`;
    if (o.dryRun && !flags.json) {
      for (const c of report.commands) out.print(c);
      out.log(`dry run: ${report.plan.commands} commands for ${report.voxels} blocks`);
      return 0;
    }
    if (o.dryRun) report.commands = report.commands.slice(0, flags.limit ? Number(flags.limit) : 2000);
    out.result(report);
    if (planOnly) printPlan(report, out);
    else printReport(report, out);
    return report.ok ? 0 : 3;
  } finally {
    await transport.close();
  }
}

function printPlan(r, out) {
  out.print(`plan for "${r.name}" in ${dimensionLabel(r.dimension)}: ${r.size.join('×')} at ${r.box.slice(0, 3).join(',')} → ${r.box.slice(3).join(',')} (${facingNote(r)})`);
  out.print(`  ${r.voxels} blocks → ${r.plan.commands} commands; ${r.commandsToSend ?? r.plan.commands} needed now${r.skipped ? ` (${r.skipped} already in place)` : ''}, ~${r.estimatedSeconds ?? '?'}s`);
  if (r.impact) {
    const top = Object.entries(r.impact.replaced).slice(0, 6).map(([b, n]) => `${n} ${b}`).join(', ');
    out.print(`  changes ${r.impact.changes} blocks; replaces ${r.impact.replacedBlocks} existing non-air blocks${top ? ` (${top})` : ''}`);
    if (r.impact.containerCount) out.print(`  ⚠ would destroy ${r.impact.containerCount} container/sign block(s), e.g. ${r.impact.containers.slice(0, 3).map((c) => `${c.block} at ${c.pos.join(',')}`).join('; ')} — build will refuse without --force`);
  } else {
    out.print('  (impact unknown: connect with the bot transport to read the area)');
  }
  for (const w of r.lint?.warnings ?? []) out.print(`  ⚠ ${w.message} (${w.count}×)`);
  for (const w of r.warnings ?? []) out.print(`  ⚠ ${w}`);
}

/** "turned so its front faces east" / "not turned: its south side is the front" */
function facingNote(r) {
  return r.facing && r.facing !== 'south' ? `turned so its front faces ${r.facing}` : 'not turned: its south side is the front';
}

/** Usage problems in build/plan/watch flags fail before connecting (exit 2). Absolute --at is parsed here. */
function checkBuildFlags(flags, o, cfg) {
  try {
    validateBuildOptions(o);
  } catch (e) {
    throw Object.assign(e, { exitCode: 2 });
  }
  if (flags.at === true) throw Object.assign(new Error('--at needs coordinates: --at x,y,z'), { exitCode: 2, code: 'BAD_COORDS' });
  if (!flags.at) return;
  if (!String(flags.at).includes('~')) o.at = parseCoords(flags.at, null, '--at');
  else if (!(o.near ?? cfg.player)) throw Object.assign(new Error('Relative --at (~) needs --near <player> (or "player" in config)'), { exitCode: 2, code: 'PLACEMENT_REQUIRED' });
  else parseCoords(flags.at, [0, 0, 0], '--at'); // syntax check only
}

/** --at with ~: relative to the --near (or config) player, in that player's dimension. */
async function resolveRelativeAt(flags, o, cfg, transport) {
  const who = o.near ?? cfg.player;
  const pose = await poseOf(transport, who);
  o.at = parseCoords(flags.at, [pose.x, pose.y, pose.z], '--at');
  if (!pose.dimension) return;
  const playerDim = String(pose.dimension).replace(/^minecraft:/, '');
  if (!o.dimension) o.dimension = pose.dimension;
  else if (normalizeDimension(o.dimension) !== playerDim) {
    (o.notes ??= []).push(`${who} is in ${dimensionLabel(playerDim)}, but the build goes to ${dimensionLabel(normalizeDimension(o.dimension))} (--dimension) at coordinates relative to them`);
  }
}

async function poseOf(transport, player) {
  if (!player) throw Object.assign(new Error('Relative --at (~) needs --near <player> (or "player" in config)'), { exitCode: 2 });
  const p = await transport.playerPose(player);
  if (!p) {
    throw Object.assign(new Error(`Cannot locate player "${player}" with the ${transport.kind} transport`), {
      code: 'NO_PLAYER', hint: transport.kind === 'dry-run' ? 'A dry run has no server connection: use absolute --at x,y,z (get them with `mcb where <player>`).' : 'Use --at x,y,z instead.',
    });
  }
  return p;
}

function printReport(r, out) {
  const secs = (r.durationMs / 1000).toFixed(1);
  out.print(`${r.ok ? '✓' : '✗'} ${r.name}: ${r.voxels} blocks at ${r.box.slice(0, 3).join(',')} → ${r.box.slice(3).join(',')} (${facingNote(r)})`);
  out.print(`  ${r.commandsSent ?? r.plan.commands}/${r.plan.commands} commands sent (${r.skipped ? `${r.skipped} skipped as already built, ` : ''}${r.noops ?? 0} no-ops) in ${secs}s${r.blocksPerSecond ? `, ${r.blocksPerSecond} blocks/s` : ''}`);
  if (r.hand) out.print(`  hand mode: ${r.hand.placedByHand} placed by hand, ${r.hand.setblock} via /setblock, ${r.hand.corrected} state fixes`);
  for (const f of r.lint?.fixes ?? []) out.print(`  ✓ auto-fix: ${f.message} (${f.count}×)`);
  for (const w of r.lint?.warnings ?? []) out.print(`  ⚠ ${w.message} (${w.count}×)`);
  for (const w of r.warnings ?? []) out.print(`  ⚠ ${w}`);
  for (const e of r.errors ?? []) out.print(`  ✗ ${e.count}× ${e.message}${e.hint ? ` — ${e.hint}` : ''}${e.examples?.length ? `\n      e.g. /${e.examples[0]}` : ''}`);
  if (r.verify) {
    const v = r.verify;
    out.print(`  verify: ${v.checked} checked, ${v.matched} match, ${v.mismatches} mismatched → ${v.repaired} repaired, ${v.remaining} remaining${v.dataMismatches ? `, ${v.dataMismatches} with other block data` : ''}${v.unreadable ? `, ${v.unreadable} unreadable` : ''}`);
    for (const m of v.examples ?? []) out.print(`    at ${m.pos.join(',')}: expected ${m.expected}, found ${m.actual}`);
  }
  if (r.impact?.replacedBlocks) out.print(`  replaced ${r.impact.replacedBlocks} existing blocks (${Object.entries(r.impact.replaced).slice(0, 4).map(([b, n]) => `${n} ${b}`).join(', ')})`);
  if (r.undo?.available) out.print(`  undo: ${r.undo.command ?? `mcb undo ${r.undo.id}`}`);
  else if (r.undo) out.print(`  undo: not available — ${r.undo.reason}`);
  if (r.reconnects) out.print(`  reconnected ${r.reconnects}× during the build`);
}

async function cmdWatch(flags, out) {
  const cfg = configFor(flags, out);
  const file = flags._[1];
  if (!file || !fs.existsSync(file)) throw Object.assign(new Error('Usage: mcb watch <blueprint file> (--at x,y,z | --near <player>) [build flags]'), { exitCode: 2 });
  const o = buildOptsFromFlags(flags, cfg);
  if (!flags.at && !o.near && cfg.player) o.near = cfg.player;
  if (!flags.at && !o.near) throw Object.assign(new Error('Where should it go? Pass --at x,y,z or --near <player>'), { exitCode: 2 });
  if (o.mode === 'hand') o.mode = 'fill';
  const fileAbs = path.resolve(file);
  // the same file + the same placement request continues the previous session (its blocks are
  // updated in place and one undo id covers everything), unless --new-session
  const request = JSON.stringify({ at: flags.at ?? null, near: o.near ?? null, side: o.side ?? null, facing: o.facing ?? null, anchor: o.anchor ?? null, rotate: o.rotate ?? null, mirror: o.mirror ?? null, dimension: o.dimension ?? null, gap: o.gap ?? null });
  checkBuildFlags(flags, o, cfg);
  const transport = await openTransport(cfg, { log: (m) => out.log(m) });
  const { saveSnapshot, newSnapshotId, decodeSnapshot } = await import('../snapshot.js');
  if (flags.at && !o.at) await resolveRelativeAt(flags, o, cfg, transport);
  const { WatchSession } = await import('../watch.js');
  let session = new WatchSession();
  let undoId = null, undoNoted = false;
  let busy = null, again = false, stopping = false, n = 0;
  const shownWarnings = new Set();
  const undoCommand = () => `${selfCommand()} undo ${undoId}${configFlag(flags)}`;

  if (o.undo && o.stateDir && !flags.newSession) {
    for (const snap of listSnapshots(o.stateDir).filter((sn) => /-watch-/.test(sn.id))) {
      let data;
      try { data = decodeSnapshot(fs.readFileSync(snap.file)); } catch { continue; }
      if (data.meta?.file !== fileAbs || data.meta?.request !== request || !data.meta?.placement) continue;
      if (data.meta.server && transport.serverKey && data.meta.server !== transport.serverKey) continue;
      undoId = data.id ?? snap.id;
      session = WatchSession.fromSnapshot(data);
      out.log(`continuing watch session ${undoId} from ${new Date(snap.mtime).toLocaleString()} (same file and place; --new-session starts over)`);
      break;
    }
  }

  // one snapshot for the whole session, rewritten (atomically) before every rebuild changes
  // anything: `mcb undo <id>` reverts all of it, even after a crash half-way through a rebuild
  const beforeChanges = (report) => {
    const changed = session.record(report, { clear: o.clear });
    if (!changed || !o.undo || !o.stateDir) return;
    undoId ??= newSnapshotId(`watch-${report.name}`);
    saveSnapshot(o.stateDir, session.snapshot({
      id: undoId, name: report.name,
      meta: { origin: report.origin, facing: report.facing, dimension: report.dimension, server: transport.serverKey ?? null, groundLayer: !!report.snapshotBox, file: fileAbs, request },
    }), { overwrite: true });
    if (!undoNoted) {
      out.print(`undo everything this session built with: ${undoCommand()}`);
      out.event({ schema: 'mcb.watch-event/1', event: 'session', undo: { id: undoId, command: undoCommand() } });
      undoNoted = true;
    }
  };
  const once = async () => {
    n++;
    for (let attempt = 0; ; attempt++) {
      try {
        // another command logging in as the same bot kicks this one: rejoin instead of giving up
        if (transport.closed && transport.reconnect) { out.log('bot was disconnected — reconnecting…'); await transport.reconnect(); }
        const s = await loadWithParams(file, flags);
        const report = await executeBuild({
          structure: s, transport, ...session.buildOptions(o), saveUndo: false, beforeChanges, handleSignals: false,
          version: cfg.version ?? transport.version, log: (m) => out.log(m), onProgress: (p) => out.progress(p),
        });
        out.print(`[${new Date().toLocaleTimeString()}] #${n} ${report.ok ? '✓' : '✗'} ${report.voxels} blocks, ${report.commandsSent} commands${report.skipped ? ` (${report.skipped} unchanged)` : ''}${report.restored ? `, ${report.restored} removed` : ''}${report.errorCount ? `, ${report.errorCount} errors` : ''}${report.verify ? `, verify ${report.verify.remaining ? `${report.verify.remaining} wrong` : 'ok'}` : ''}`);
        for (const e of report.errors ?? []) out.print(`  ✗ ${e.count}× ${e.message}`);
        for (const wm of report.warnings ?? []) if (!shownWarnings.has(wm)) { shownWarnings.add(wm); out.print(`  ⚠ ${wm}`); }
        out.event({
          schema: 'mcb.watch-event/1', event: 'rebuild', n, ok: report.ok, voxels: report.voxels, commandsSent: report.commandsSent,
          skipped: report.skipped ?? 0, removed: report.restored ?? 0, box: report.box, errors: report.errors, verify: report.verify ?? null,
          warnings: report.warnings ?? [], undo: undoId ? { id: undoId, command: undoCommand() } : null,
        });
        return;
      } catch (e) {
        if (e.code === 'ENDED' && attempt === 0 && transport.reconnect) continue;
        out.print(`✗ ${e.message}${e.hint ? `\n  hint: ${e.hint}` : ''}`);
        out.event({ schema: 'mcb.watch-event/1', event: 'error', n, code: e.code ?? null, message: e.message, hint: e.hint ?? null });
        return;
      }
    }
  };
  const rebuild = () => {
    if (stopping) return busy;
    if (busy) { again = true; return busy; }
    busy = (async () => {
      try {
        do { again = false; await once(); } while (again && !stopping);
      } finally {
        busy = null;
      }
    })();
    return busy;
  };
  // Ctrl+C handling is in place before the first build: the first press lets the running rebuild
  // finish (so gamerules are restored and its undo record is complete), a second one quits at once
  const stopRequested = new Promise((resolve) => {
    const onStop = () => {
      stopping = true;
      if (busy) out.log('stopping after the current rebuild… (Ctrl+C again to quit now)');
      process.once('SIGINT', () => process.exit(130));
      resolve();
    };
    process.once('SIGINT', onStop);
    process.once('SIGTERM', onStop);
  });
  await rebuild();
  let timer = null;
  let watcher = null;
  if (!stopping) {
    out.print(`watching ${fileAbs} — save it to rebuild (Ctrl+C to stop)`);
    out.event({ schema: 'mcb.watch-event/1', event: 'watching', file: fileAbs, undo: undoId ? { id: undoId, command: undoCommand() } : null });
    watcher = fs.watch(fileAbs, () => {
      clearTimeout(timer);
      timer = setTimeout(rebuild, 300);
    });
  }
  await stopRequested;
  clearTimeout(timer);
  watcher?.close();
  if (busy) await busy;
  out.event({ schema: 'mcb.watch-event/1', event: 'stopped', undo: undoId ? { id: undoId, command: undoCommand() } : null });
  await transport.close();
  return 0;
}
async function cmdUndo(flags, out) {
  const cfg = configFor(flags, out);
  const dir = stateDir(cfg);
  const snaps = listSnapshots(dir);
  if (flags.list) {
    const list = snaps.map((s) => ({ id: s.id, file: s.file, time: new Date(s.mtime).toISOString() }));
    out.result({ ok: true, snapshots: list });
    if (!list.length) out.print('no undo snapshots');
    for (const s of list) out.print(`${s.id}   ${s.time}`);
    return 0;
  }
  const want = flags._[1];
  const { findSnapshot, undoBuild, markApplied } = await import('../undo.js');
  const snap = want && /\.json\.gz$/i.test(String(want)) && fs.existsSync(want)
    ? { id: path.basename(String(want)).replace(/\.json\.gz$/i, ''), file: path.resolve(String(want)) }
    : findSnapshot(dir, want);
  const transport = await openTransport(cfg, { log: (m) => out.log(m) });
  try {
    out.log(`undoing ${snap.id}${want ? '' : ' (the most recent build)'}…`);
    const r = await undoBuild(transport, snap.file, {
      force: !!flags.force, anyServer: !!flags.anyServer, log: (m) => out.log(m), onProgress: (p) => out.progress(p), stateDir: dir,
    });
    // only a complete undo retires the snapshot; otherwise it stays so the undo can be retried
    if (r.ok) markApplied(snap.file);
    out.result({ schema: 'mcb.undo-report/1', ...r });
    out.print(`${r.ok ? '✓' : '⚠'} undo ${snap.id}: restored ${r.restored} blocks${r.build ? ` in ${(r.build.durationMs / 1000).toFixed(1)}s` : ''}`);
    if (r.conflicts) {
      out.print(`  ⚠ ${r.conflicts} block(s) were changed after the build and were left alone (use --force to restore them too):`);
      for (const c of r.conflictExamples.slice(0, 5)) out.print(`    at ${c.pos.join(',')}: now ${c.found} (build had set ${c.expected})`);
    }
    if (r.unreadable) out.print(`  ⚠ ${r.unreadable} block(s) could not be read and were left alone — run the undo again (or --force)`);
    for (const e of r.build?.errors ?? []) out.print(`  ✗ ${e.count}× ${e.message}`);
    if (r.failedAt && r.hint) out.print(`  ${r.hint}`);
    if (!r.ok) out.print(`  the snapshot was kept: re-run \`${selfCommand()} undo ${snap.id}${configFlag(flags)}\` to retry`);
    return r.ok ? 0 : 3;
  } finally {
    await transport.close();
  }
}

/** ` --config <file>` when the user chose a config explicitly, so printed follow-up commands hit the same server and undo store. */
function configFlag(flags) {
  const f = flags.config && flags.config !== true ? flags.config : process.env.MCB_CONFIG;
  if (!f) return '';
  const p = path.resolve(String(f));
  return ` --config ${/\s/.test(p) ? `"${p}"` : p}`;
}

/** How to run this CLI again from the current directory (`node bin/mcb.js`), for printed follow-up commands. */
function selfCommand() {
  const script = process.argv[1] ? path.resolve(process.argv[1]) : null;
  if (!script) return 'mcb';
  const rel = path.relative(process.cwd(), script);
  const shown = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : script;
  return `node ${/\s/.test(shown) ? `"${shown}"` : shown}`;
}

async function cmdPlan(flags, out) {
  return cmdBuild(flags, out, { planOnly: true });
}

async function cmdSnapshot(flags, out) {
  const cfg = configFor(flags, out);
  if (!flags.from || !flags.to) throw Object.assign(new Error('snapshot needs --from x,y,z --to x,y,z'), { exitCode: 2 });
  const a = parseCoords(flags.from, null, '--from'), b = parseCoords(flags.to, null, '--to');
  const box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
  const transport = await openTransport(cfg, { prefer: 'bot', log: (m) => out.log(m) });
  try {
    const { withGamerules } = await import('../gamerules.js');
    if (flags.dimension && flags.dimension !== true) {
      const { normalizeDimension, DIMENSIONS } = await import('../build.js');
      transport.setDimension?.(DIMENSIONS[normalizeDimension(flags.dimension)].id);
    }
    const cap = await withGamerules(transport, { sendCommandFeedback: false }, () =>
      captureRegion(transport, box, { onProgress: (d, n) => out.progress({ stage: 'snapshot', done: d, total: n }) }), { journalDir: stateDir(cfg) });
    let s = cap.structure;
    if (flags.noAir || flags.air === false) s.replace('air', null);
    s = s.translated(-box[0], -box[1], -box[2]);
    s.name = flags.name ?? path.basename(String(flags.out ?? 'snapshot'), path.extname(String(flags.out ?? '')));
    const file = flags.out && flags.out !== true ? flags.out : `${s.name}.json`;
    // .schem/.nbt/.litematic carry block data natively; a .json blueprint is built with commands,
    // which can't carry very long data (decorated heads, many-pattern banners)
    const dropped = /\.json$/i.test(file) ? dropUnbuildableData(s) : 0;
    if (dropped) out.log(`warning: ${dropped} block(s) had block data (head skins, banner patterns, sign text) too long to rebuild with a command — saved without it (.schem keeps it)`);
    if (cap.lostData?.length) out.log(`warning: the block data of ${cap.lostData.length} block(s) could not be read and was left out`);
    const { writeStructureFile } = await import('../io/formats/index.js');
    await writeStructureFile(s, file, {});
    let render = null;
    if (flags.render) {
      const { renderPreview } = await import('../render/preview.js');
      const r = renderPreview(s, { view: 'sheet', title: s.name });
      fs.writeFileSync(flags.render, r.png);
      render = path.resolve(flags.render);
    }
    out.result({ ok: true, file: path.resolve(file), blocks: s.count, size: s.bounds()?.size, unknown: cap.unknown, render });
    out.print(`wrote ${path.resolve(file)} (${s.count} blocks${cap.unknown ? `, ${cap.unknown} unreadable` : ''})${render ? ` + ${render}` : ''}`);
    return 0;
  } finally {
    await transport.close();
  }
}

async function cmdWhere(flags, out) {
  const cfg = configFor(flags, out);
  const transport = await openTransport(cfg, { log: (m) => out.log(m) });
  try {
    const name = flags._[1] ?? cfg.player;
    if (!name) {
      const players = await onlinePlayers(transport);
      out.result({ ok: true, players });
      out.print(players.length ? `online: ${players.join(', ')}` : 'no other players online');
      return 0;
    }
    const p = await transport.playerPose(name);
    const { yawToDir } = await import('../placement.js');
    const facing = yawToDir(p.yaw);
    const block = [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
    out.result({ ok: true, player: name, pos: [p.x, p.y, p.z], block, yaw: p.yaw, pitch: p.pitch, facing, dimension: p.dimension });
    out.print(`${name} at ${block.join(',')} (exact ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) in ${p.dimension ?? 'the overworld'}, facing ${facing} (yaw ${p.yaw.toFixed(0)})`);
    out.print(`build in front of them:  mcb build <blueprint> --near ${name}`);
    return 0;
  } finally {
    await transport.close();
  }
}

async function cmdCmd(flags, out) {
  const cfg = configFor(flags, out);
  const cmds = flags._.slice(1);
  if (!cmds.length) throw Object.assign(new Error('Usage: mcb cmd "time set noon" ["weather clear" …]'), { exitCode: 2 });
  const transport = await openTransport(cfg, { log: (m) => out.log(m) });
  const results = [];
  try {
    for (const c of cmds) {
      const r = await transport.query(c.replace(/^\//, ''));
      results.push({ command: c, output: r.text, ok: !r.errors.length });
      out.print(`/${c.replace(/^\//, '')} → ${r.text || '(no output)'}`);
    }
  } finally {
    await transport.close();
  }
  out.result({ ok: results.every((r) => r.ok), results });
  return results.every((r) => r.ok) ? 0 : 1;
}

async function cmdDoctor(flags, out) {
  const cfg = configFor(flags, out);
  const checks = [];
  const add = (name, status, detail, fix) => {
    checks.push({ name, status, detail, ...(fix ? { fix } : {}) });
    out.print(`${status === 'ok' ? '✓' : status === 'warn' ? '⚠' : '✗'} ${name}: ${detail}${fix ? `\n    fix: ${fix}` : ''}`);
  };
  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 22 ? 'ok' : 'fail', `v${process.versions.node}`, major >= 22 ? null : 'Install Node.js 22 or newer (https://nodejs.org)');
  try {
    require.resolve('mineflayer');
    add('dependencies', 'ok', 'npm packages installed');
  } catch {
    add('dependencies', 'fail', 'mineflayer not installed', 'Run `npm install` in the repo');
  }
  add('config', cfg._file ? (cfg._warnings?.length ? 'warn' : 'ok') : 'warn', cfg._file ? `${cfg._file}${cfg._warnings?.length ? ` — ${cfg._warnings.map((w) => w.replace(/^[^:]+: /, '')).join('; ')}` : ''}` : `no ${CONFIG_FILE} in ${process.cwd()} or its parents (using defaults/env/flags)`, cfg._file ? (cfg._warnings?.length ? 'Fix or remove the unknown keys' : null) : 'Pass --host/--port (or --config <file>), or run `mcb server setup --accept-eula` which writes one');
  add('target', 'ok', `${cfg.host}:${cfg.port} as ${cfg.username} (${cfg.auth}), transport=${cfg.transport}; undo snapshots in ${path.join(stateDir(cfg), 'undo')}`);
  const { findJava, javaInstallHint } = await import('../server/java.js');
  if (cfg.serverDir || flags.dir) {
    const java = findJava(21, cfg.serverDir ?? flags.dir);
    add('java', java ? 'ok' : 'warn', java ? `Java ${java.version} (${java.path})` : 'Java 21+ not found (only needed to run a local server)', java ? null : javaInstallHint(21));
  }
  const { pingServer } = await import('../server/manage.js');
  const ping = await pingServer(cfg.host, cfg.port);
  if (!ping) {
    const src = cfg._sources ?? {};
    const how = `probed ${cfg.host}:${cfg.port} (host from ${src.host ?? 'default'}, port from ${src.port ?? 'default'})`;
    add('server', 'fail', `nothing answering — ${how}`, cfg.serverDir
      ? '`mcb server start`'
      : 'If your server runs elsewhere, point mcb at it: --host <host> --port <port> [--rcon-port <p> --rcon-password <pw>] (or put them in mcb.config.json / MCB_HOST, MCB_PORT). '
        + 'No server yet? Create a local one: `mcb server setup --accept-eula && mcb server start`.');
  } else {
    const supported = (() => {
      try { return require('minecraft-protocol/src/version.js').supportedVersions; } catch { return []; }
    })();
    const v = String(ping.version ?? '').replace(/^(Paper|Spigot|Purpur|Folia)\s+/i, '');
    const ok = !supported.length || supported.some((s) => v.includes(s));
    add('server', ok ? 'ok' : 'warn', `${ping.version} (protocol ${ping.protocol}), ${ping.players}/${ping.max} players`, ok ? null : `mineflayer supports: ${supported.slice(-6).join(', ')}. Use RCON transport for other versions.`);
  }
  if (cfg.rconPassword) {
    try {
      const { connectRcon } = await import('../transport/rcon.js');
      const t = await connectRcon({ host: cfg.host, rconPort: cfg.rconPort, rconPassword: cfg.rconPassword });
      const r = await t.query('list');
      add('rcon', 'ok', `connected (${r.text.trim().slice(0, 60)})`);
      await t.close();
    } catch (e) {
      add('rcon', 'fail', e.message, e.hint);
    }
  } else {
    add('rcon', 'warn', 'not configured (optional, fastest transport)', 'enable-rcon=true + rcon.password in server.properties, then --rcon-password');
  }
  if (ping && flags.bot !== false) {
    try {
      const { connectBot } = await import('../transport/bot.js');
      const t = await connectBot({ host: cfg.host, port: cfg.port, username: cfg.username, auth: cfg.auth, version: cfg.version || undefined, connectTimeoutMs: 20000 });
      add('bot', 'ok', `${t.username} joined (server ${t.version})`);
      add('op', t.isOp ? 'ok' : 'fail', t.isOp ? 'bot is an operator' : 'bot is NOT an operator', t.isOp ? null : `In the server console: op ${t.username}   (or: mcb server op ${t.username})`);
      if (t.isOp) {
        // an interrupted build may have left command feedback muted: put it back now
        t.serverKey = (await import('../connect.js')).normalizeServerKey(`${cfg.host}:${cfg.port}`);
        const { recoverGamerules } = await import('../gamerules.js');
        const fixed = await recoverGamerules(t, stateDir(cfg)).catch(() => []);
        if (fixed.length) add('gamerules', 'ok', `restored ${fixed.map(([n, v]) => `${n}=${v}`).join(', ')} left changed by an interrupted build`);
      }
      await t.close();
    } catch (e) {
      add('bot', 'fail', e.message, e.hint);
    }
  }
  const failed = checks.filter((c) => c.status === 'fail');
  out.result({ ok: failed.length === 0, checks });
  out.print(failed.length ? `\n${failed.length} problem(s) found.` : '\nAll good — try: mcb build gen:house --near <you> --verify');
  return failed.length ? 1 : 0;
}

async function cmdServer(flags, out) {
  const sub = flags._[1];
  const cfg = configFor(flags, out);
  const dir = path.resolve(flags.dir ?? cfg.serverDir ?? path.join(process.cwd(), '..', 'mc-server'));
  const m = await import('../server/manage.js');
  const log = (msg) => out.log(msg);
  switch (sub) {
    case 'setup': {
      const ops = flags.op && flags.op !== true ? String(flags.op).split(',') : [];
      const summary = await m.setupServer({
        dir, mcVersion: flags.mcVersion, port: flags.port ? Number(flags.port) : undefined, rconPort: flags.rconPort ? Number(flags.rconPort) : undefined,
        rconPassword: flags.rconPassword, acceptEula: !!flags.acceptEula, fawe: !!flags.fawe, installJava: !!flags.installJava,
        world: flags.world, botName: cfg.username, ops, lan: flags.lan === undefined ? undefined : flags.lan !== false && flags.lan !== 'false',
        onlineMode: flags.onlineMode === undefined ? undefined : flags.onlineMode === true || flags.onlineMode === 'true', log,
      });
      const cfgFile = path.resolve(flags.configOut ?? cfg._file ?? CONFIG_FILE);
      writeConfigFile(cfgFile, {
        host: '127.0.0.1', port: summary.port, username: cfg.username, auth: 'offline', transport: 'auto',
        rconPort: summary.rconPort, rconPassword: summary.rconPassword,
        serverDir: path.relative(path.dirname(cfgFile), dir) || '.', ...(ops[0] ? { player: ops[0] } : {}),
      });
      out.result({ ok: summary.eula === 'accepted' && !summary.java?.missing, ...summary, config: cfgFile });
      out.print(`server ready in ${dir}: Paper ${summary.paper.version} build ${summary.paper.build}, port ${summary.port}, RCON ${summary.rconPort}`);
      out.print(`config written: ${cfgFile}`);
      if (summary.eula !== 'accepted') out.print('✗ EULA not accepted — read https://aka.ms/MinecraftEULA and re-run with --accept-eula');
      if (summary.java?.missing) out.print(`✗ Java ${summary.java.needed}+ missing — ${summary.java.hint}`);
      if (summary.eula === 'accepted' && !summary.java?.missing) out.print('next: mcb server start   then join Multiplayer → localhost' + (summary.port !== 25565 ? `:${summary.port}` : ''));
      return summary.eula === 'accepted' && !summary.java?.missing ? 0 : 1;
    }
    case 'start': {
      const r = await m.startServer({ dir, memory: flags.memory, log, wait: flags.wait !== false });
      out.result({ ok: true, ...r });
      out.print(r.already ? `already running (pid ${r.pid})` : `running: pid ${r.pid}, port ${r.port}${r.version ? `, ${r.version}` : ''}`);
      return 0;
    }
    case 'stop': {
      const r = await m.stopServer({ dir, log });
      out.result({ ok: true, ...r });
      out.print('server stopped');
      return 0;
    }
    case 'status': {
      const r = await m.serverStatus({ dir, host: cfg.host, port: cfg.port });
      out.result({ ok: r.running, ...r });
      out.print(r.running ? `running at ${cfg.host}:${cfg.port}: ${r.ping.version}, ${r.ping.players}/${r.ping.max} players${r.pid ? ` (pid ${r.pid})` : ''}` : `not running at ${cfg.host}:${cfg.port}`);
      return r.running ? 0 : 1;
    }
    case 'logs': {
      const r = m.tailLog(dir, Number(flags.lines ?? 40));
      out.result({ ok: !!r.file, ...r });
      out.print(r.file ? r.lines.join('\n') : `no logs in ${dir}`);
      return r.file ? 0 : 1;
    }
    case 'op': {
      const name = flags._[2];
      if (!name) throw Object.assign(new Error('Usage: mcb server op <name>'), { exitCode: 2 });
      const t = await openTransport(cfg, { prefer: 'rcon', log });
      try {
        const r = await t.query(`op ${name}`);
        out.result({ ok: true, output: r.text });
        out.print(r.text);
      } finally {
        await t.close();
      }
      return 0;
    }
    default:
      throw Object.assign(new Error(`Unknown server subcommand "${sub ?? ''}" (setup|start|stop|status|logs|op)`), { exitCode: 2 });
  }
}

async function cmdMcp(flags) {
  const { runStdio } = await import('../mcp/server.js');
  await runStdio(flags);
  return 0;
}

const COMMANDS = {
  generators: cmdGenerators, gens: cmdGenerators, info: cmdInfo, validate: cmdValidate, preview: cmdPreview,
  export: cmdExport, generate: cmdGenerate, plan: cmdPlan, build: cmdBuild, watch: cmdWatch, undo: cmdUndo, snapshot: cmdSnapshot, where: cmdWhere,
  cmd: cmdCmd, doctor: cmdDoctor, server: cmdServer, mcp: cmdMcp,
};

export async function main(argv) {
  let flags;
  try {
    flags = parseArgs(argv, { booleans: BOOLEANS });
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    if (argv.includes('--json')) process.stdout.write(JSON.stringify({ schema: 'mcb.error/1', ok: false, error: e.message, code: e.code }, null, 2) + '\n');
    return e.exitCode ?? 2;
  }
  const out = new Output(flags);
  const cmd = flags._[0];
  const topic = cmd === 'help' ? flags._[1] : cmd;
  if (!cmd || flags.help || cmd === 'help') {
    process.stdout.write((topic && COMMAND_HELP[topic] ? `${COMMAND_HELP[topic].trim()}\n\n${HELP_FOOTER}` : HELP) + '\n');
    return cmd || flags.help ? 0 : 2;
  }
  if (cmd === 'version' || cmd === '--version') {
    process.stdout.write(`${PKG.version}\n`);
    return 0;
  }
  const fn = COMMANDS[cmd];
  if (!fn) {
    process.stderr.write(`Unknown command "${cmd}". Run \`mcb --help\`.\n`);
    return 2;
  }
  try {
    return await fn(flags, out);
  } catch (e) {
    const code = e.exitCode ?? 1;
    if (flags.json) process.stdout.write(JSON.stringify({ schema: 'mcb.error/1', ok: false, error: e.message, hint: e.hint, code: e.code ?? 'ERROR', details: e.details }, null, 2) + '\n');
    process.stderr.write(`error: ${e.message}\n`);
    if (e.hint) process.stderr.write(`hint: ${e.hint}\n`);
    if (process.env.MCB_DEBUG) process.stderr.write(`${e.stack}\n`);
    return code;
  }
}
