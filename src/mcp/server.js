/**
 * Minimal MCP (Model Context Protocol) server over stdio — exposes mcb to MCP clients
 * (Claude Desktop, VS Code / GitHub Copilot agent mode, …) as tools, with preview images
 * returned inline. No SDK dependency: JSON-RPC 2.0, newline-delimited.
 *
 *   { "mcpServers": { "minecraft": { "command": "node", "args": ["<repo>/bin/mcb.js", "mcp"] } } }
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { resolveConfig, stateDir } from '../config.js';
import { openTransport } from '../connect.js';
import { loadBlueprint, fromJson } from '../io/blueprint.js';
import { lintStructure } from '../core/lint.js';
import { executeBuild } from '../build.js';
import { listSnapshots, captureRegion } from '../snapshot.js';
import { parseCoords } from '../cli/args.js';
import { DEFAULT_MC_VERSION } from '../core/blockinfo.js';

const PROTOCOL_VERSION = '2025-06-18';
const PKG = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const blueprintSchema = {
  description: 'A blueprint: a file path (.json/.mjs/.schem/.nbt/.litematic), "gen:<generator>", or an inline JSON blueprint object (palette/layers/fills/blocks/parts/generator).',
  anyOf: [{ type: 'string' }, { type: 'object' }],
};

const buildProperties = {
  blueprint: blueprintSchema,
  params: { type: 'object' },
  at: { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 },
  near: { type: 'string', description: 'Player name: build next to them (default: in front of them), front facing them' },
  side: { type: 'string', enum: ['north', 'east', 'south', 'west'], description: 'With near: which side of the player to build on (default: the way they look)' },
  gap: { type: 'integer', minimum: 0, description: 'With near: blocks between the player and the build (default 3)' },
  facing: { type: 'string', enum: ['north', 'east', 'south', 'west'] },
  anchor: { type: 'string', enum: ['corner', 'center', 'origin'] },
  dimension: { type: 'string', enum: ['overworld', 'the_nether', 'the_end'] },
  clear: { type: 'boolean', description: 'Empty the area (+2 blocks margin) first' },
  ground: { type: 'string', description: 'Block for a foundation layer under the footprint' },
  verify: { type: 'boolean', default: true },
  force: { type: 'boolean', description: 'Allow overwriting chests and other blocks whose contents undo cannot restore' },
  dryRun: { type: 'boolean' },
  mode: { type: 'string', enum: ['fill', 'layered', 'hand'] },
};

export const TOOLS = [
  {
    name: 'mc_generators',
    description: 'List the built-in structure generators and their parameters (house, castle, tower, tree, text, pixelart, city, …).',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Only this generator' } } },
  },
  {
    name: 'mc_preview',
    description: 'Render a blueprint to a PNG (iso view from the south-east, top view with north up, south and east elevations) and return it with size/block counts. Always look at this before building. Colors are approximate.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint: blueprintSchema,
        params: { type: 'object', description: 'Generator / JS blueprint params' },
        view: { type: 'string', enum: ['sheet', 'iso', 'iso-nw', 'iso-ne', 'iso-sw', 'top', 'south', 'north', 'east', 'west'], default: 'sheet' },
        cutY: { type: 'integer', description: 'Hide everything above this y (floor plans / interiors)' },
      },
      required: ['blueprint'],
    },
  },
  {
    name: 'mc_validate',
    description: 'Validate a blueprint: block names/states for the server version (with suggestions), auto-fixes (door halves, bed heads), support warnings.',
    inputSchema: { type: 'object', properties: { blueprint: blueprintSchema, params: { type: 'object' } }, required: ['blueprint'] },
  },
  {
    name: 'mc_plan',
    description: 'Read-only: resolve where a build would land and report what it would replace (existing blocks, containers), how many commands it needs and whether undo is available. Changes nothing.',
    inputSchema: { type: 'object', properties: buildProperties, required: ['blueprint'] },
  },
  {
    name: 'mc_build',
    description: 'Build a blueprint in the running world. Give either at=[x,y,z] (north-west footprint corner, y = feet level) or near=<player> (in front of them, or on `side` of them at `gap` blocks; front facing them). The blueprint front faces south; facing rotates it. Returns a report with world bounds, verify results and an undo id.',
    inputSchema: { type: 'object', properties: buildProperties, required: ['blueprint'] },
  },
  {
    name: 'mc_undo',
    description: 'Undo a build (default: the most recent): restores what it changed, leaving blocks edited since alone (force=true restores them too). list=true lists undo snapshots. Prefer passing the id from the build report.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, list: { type: 'boolean' }, force: { type: 'boolean' }, anyServer: { type: 'boolean', description: 'Allow undoing a snapshot taken on a different server address' } } },
  },
  {
    name: 'mc_where',
    description: 'Position and facing of an online player (or the list of online players).',
    inputSchema: { type: 'object', properties: { player: { type: 'string' } } },
  },
  {
    name: 'mc_command',
    description: 'Run raw server commands (no leading slash), e.g. ["time set noon", "weather clear"]. Returns each output.',
    inputSchema: { type: 'object', properties: { commands: { type: 'array', items: { type: 'string' } } }, required: ['commands'] },
  },
  {
    name: 'mc_snapshot',
    description: 'Copy a region of the world into an inline JSON blueprint (and a preview image) — to inspect what is actually built or to duplicate it elsewhere.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'array', items: { type: 'integer' } }, to: { type: 'array', items: { type: 'integer' } }, keepAir: { type: 'boolean' },
        dimension: { type: 'string', enum: ['overworld', 'the_nether', 'the_end'], default: 'overworld' },
      },
      required: ['from', 'to'],
    },
  },
];

async function loadAny(blueprint, params = {}) {
  if (blueprint && typeof blueprint === 'object') return fromJson(blueprint, { params, file: '<inline>' });
  const s = String(blueprint).trim();
  if (s.startsWith('{')) return fromJson(JSON.parse(s), { params, file: '<inline>' });
  return loadBlueprint(s, { params });
}

/** Tools that talk to the server (serialized); the rest are pure and run concurrently. */
const USES_SERVER = new Set(['mc_build', 'mc_plan', 'mc_undo', 'mc_where', 'mc_command', 'mc_snapshot']);

/** JSON-RPC 2.0 envelope check → error code or 0. */
export function invalidEnvelope(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return -32600;
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return -32600;
  if ('id' in msg && !(typeof msg.id === 'string' || (typeof msg.id === 'number' && Number.isFinite(msg.id)))) return -32600;
  if ('params' in msg && (msg.params === null || typeof msg.params !== 'object')) return -32602;
  return 0;
}

export function createServer({ flags = {}, log = () => {} } = {}) {
  let transport = null;
  let connecting = null;
  const cfg = resolveConfig(flags);
  // one connection, opened once even when several tool calls arrive together
  const getTransport = async () => {
    if (transport && !transport.closed) return transport;
    connecting ??= openTransport(cfg, { log }).then((t) => { transport = t; return t; }).finally(() => { connecting = null; });
    return connecting;
  };
  // tools that use the server run one at a time: two builds (or a build and an undo) interleaving
  // their commands, gamerule changes and snapshots would corrupt each other
  let queue = Promise.resolve();
  const exclusive = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  // compact JSON: tool results go straight into a model's context, where whitespace costs tokens
  const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] });

  const handlers = {
    async mc_generators({ name } = {}) {
      const { listGenerators } = await import('../generators/index.js');
      const list = listGenerators().filter((g) => !name || g.name === name).map((g) => ({ name: g.name, description: g.description, params: g.params }));
      return text(list);
    },
    async mc_preview({ blueprint, params, view = 'sheet', cutY }) {
      const s = await loadAny(blueprint, params);
      const lint = lintStructure(s, { version: cfg.version ?? DEFAULT_MC_VERSION });
      const { renderPreview } = await import('../render/preview.js');
      const r = renderPreview(s, { view, title: s.name, cutaway: Number.isFinite(cutY) ? { y: cutY } : undefined });
      const b = s.bounds();
      return {
        content: [
          { type: 'image', data: r.png.toString('base64'), mimeType: 'image/png' },
          { type: 'text', text: JSON.stringify({ name: s.name, size: b?.size, bounds: b ? { min: b.min, max: b.max } : null, blocks: s.count, view, warnings: lint.warnings.map((w) => w.message), errors: lint.errors.flatMap((e) => e.errors) }) },
        ],
      };
    },
    async mc_validate({ blueprint, params }) {
      const s = await loadAny(blueprint, params);
      const lint = lintStructure(s, { version: cfg.version ?? DEFAULT_MC_VERSION });
      return text({ ok: lint.ok, blocks: s.count, size: s.bounds()?.size, errors: lint.errors, warnings: lint.warnings, fixes: lint.fixes });
    },
    async mc_build(a) {
      const s = await loadAny(a.blueprint, a.params);
      let tr;
      if (a.dryRun) {
        const { DryRunTransport } = await import('../transport/dry.js');
        tr = new DryRunTransport();
      } else {
        tr = await getTransport();
      }
      const near = a.near ?? (a.at ? undefined : cfg.player ?? undefined);
      const report = await executeBuild({
        structure: s, transport: tr, at: a.at ?? (a.dryRun && !near ? [0, 0, 0] : undefined), near, side: a.side, gap: a.gap, facing: a.facing, anchor: a.anchor,
        clear: !!a.clear, ground: a.ground, verify: a.verify !== false, dryRun: !!a.dryRun, mode: a.mode ?? 'fill',
        dimension: a.dimension, force: !!a.force, planOnly: !!a.planOnly,
        stateDir: stateDir(cfg), version: cfg.version ?? tr.version, log,
      });
      if (report.commands) report.commands = report.commands.slice(0, 200);
      return text(report);
    },
    async mc_plan(a) {
      return handlers.mc_build({ ...a, planOnly: true, dryRun: false });
    },
    async mc_undo({ id, list, force, anyServer } = {}) {
      const snaps = listSnapshots(stateDir(cfg));
      if (list) return text(snaps.map((s) => ({ id: s.id, time: new Date(s.mtime).toISOString() })));
      const { findSnapshot, undoBuild, markApplied } = await import('../undo.js');
      const snap = findSnapshot(stateDir(cfg), id);
      const r = await undoBuild(await getTransport(), snap.file, { force: !!force, anyServer: !!anyServer, log, stateDir: stateDir(cfg) });
      if (r.ok) markApplied(snap.file); // incomplete undos keep their snapshot so they can be retried
      return text({
        ok: r.ok, id: r.id, restored: r.restored, conflicts: r.conflicts, unreadable: r.unreadable, conflictExamples: r.conflictExamples,
        errors: r.build?.errors ?? [], hint: r.hint,
      });
    },
    async mc_where({ player } = {}) {
      const t = await getTransport();
      if (!player) {
        const { onlinePlayers } = await import('../connect.js');
        return text({ players: await onlinePlayers(t) });
      }
      const p = await t.playerPose(player);
      const { yawToDir } = await import('../placement.js');
      return text({ player, block: [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)], pos: [p.x, p.y, p.z], yaw: p.yaw, facing: yawToDir(p.yaw), dimension: p.dimension });
    },
    async mc_command({ commands }) {
      const t = await getTransport();
      const out = [];
      for (const c of commands) {
        const r = await t.query(String(c).replace(/^\//, ''));
        out.push({ command: c, output: r.text, ok: !r.errors.length });
      }
      return text(out);
    },
    async mc_snapshot({ from, to, keepAir, dimension }) {
      const a = parseCoords(from), b = parseCoords(to);
      const box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
      const vol = (box[3] - box[0] + 1) * (box[4] - box[1] + 1) * (box[5] - box[2] + 1);
      if (vol > 200_000) throw new Error(`Region too large for an inline snapshot (${vol} blocks > 200000); use the CLI: mcb snapshot -o file.schem`);
      const t = await getTransport();
      const { normalizeDimension, DIMENSIONS } = await import('../build.js');
      t.setDimension?.(DIMENSIONS[normalizeDimension(dimension ?? 'overworld')].id);
      const { withGamerules } = await import('../gamerules.js');
      const cap = await withGamerules(t, { sendCommandFeedback: false }, () => captureRegion(t, box), { journalDir: stateDir(cfg) });
      let s = cap.structure;
      if (!keepAir) s.replace('air', null);
      s = s.translated(-box[0], -box[1], -box[2]);
      s.name = 'snapshot';
      const { structureToJson } = await import('../io/formats/index.js');
      const { renderPreview } = await import('../render/preview.js');
      const r = renderPreview(s, { view: 'sheet', title: `snapshot ${box.join(',')}` });
      return {
        content: [
          { type: 'image', data: r.png.toString('base64'), mimeType: 'image/png' },
          { type: 'text', text: JSON.stringify(structureToJson(s)) },
        ],
      };
    },
  };

  async function handle(msg) {
    const { id, method, params } = msg;
    if (method === 'initialize') {
      return {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'minecraft-builder', version: PKG.version },
        instructions: 'Build things in Minecraft Java Edition. Workflow: mc_where (find the player) → mc_generators or an inline JSON blueprint → mc_validate → mc_preview (look at the image) → mc_plan (read-only: where it lands, what it replaces) → mc_build (near a player — optionally side/gap — or at coordinates; verify is on) → tell the user the undo id; mc_undo {id} reverts exactly that build. Blueprint fronts face south (facing turns them); y=0 is the first layer above the ground. Build separate parts of a scene with separate mc_build calls so each can be undone alone.',
      };
    }
    if (method === 'ping') return {};
    if (method === 'tools/list') return { tools: TOOLS };
    if (method === 'tools/call') {
      const name = params?.name;
      const fn = typeof name === 'string' && Object.hasOwn(handlers, name) ? handlers[name] : null;
      if (!fn) throw Object.assign(new Error(`Unknown tool ${name}`), { rpcCode: -32602 });
      const args = params.arguments ?? {};
      if (typeof args !== 'object' || Array.isArray(args)) throw Object.assign(new Error('Tool arguments must be an object'), { rpcCode: -32602 });
      const offline = !USES_SERVER.has(name) || (name === 'mc_build' && args.dryRun) || (name === 'mc_undo' && args.list);
      try {
        return await (offline ? fn(args) : exclusive(() => fn(args)));
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: `${e.message}${e.hint ? `\nhint: ${e.hint}` : ''}` }] };
      }
    }
    if (id === undefined) return undefined; // notification (e.g. notifications/initialized)
    throw Object.assign(new Error(`Method not found: ${method}`), { rpcCode: -32601 });
  }

  return {
    handle,
    async close() { if (transport) await transport.close(); },
  };
}

/** Run the server on stdin/stdout. */
export async function runStdio(flags = {}) {
  // stdout is the JSON-RPC channel: route any stray console output to stderr.
  const util = await import('node:util');
  console.log = console.info = console.warn = console.debug = (...a) => process.stderr.write(util.format(...a) + '\n');
  const log = (m) => process.stderr.write(`[mcb-mcp] ${m}\n`);
  const server = createServer({ flags, log });
  const rl = readline.createInterface({ input: process.stdin });
  const send = (obj) => { try { process.stdout.write(JSON.stringify(obj) + '\n'); } catch { /* client went away */ } };
  const pending = new Set();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    const bad = invalidEnvelope(msg);
    if (bad) {
      // responses (no method) from the client are ignored; malformed requests get an error
      const isResponse = msg && typeof msg === 'object' && !Array.isArray(msg) && !('method' in msg) && ('result' in msg || 'error' in msg);
      if (!isResponse) {
        const id = msg && typeof msg === 'object' && (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : null;
        send({ jsonrpc: '2.0', id, error: { code: bad, message: bad === -32602 ? 'Invalid params' : 'Invalid Request' } });
      }
      return;
    }
    const p = (async () => {
      try {
        const result = await server.handle(msg);
        if (msg.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: msg.id, result });
      } catch (e) {
        if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: e.rpcCode ?? -32603, message: e.message } });
      }
    })().catch(() => {});
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  await new Promise((resolve) => rl.once('close', resolve));
  await Promise.allSettled([...pending]);
  await server.close();
}
