/**
 * Minimal MCP (Model Context Protocol) server over stdio — exposes mcb to MCP clients
 * (Claude Desktop, VS Code / GitHub Copilot agent mode, …) as tools, with preview images
 * returned inline. No SDK dependency: JSON-RPC 2.0, newline-delimited.
 *
 *   { "mcpServers": { "minecraft": { "command": "node", "args": ["<repo>/bin/mcb.js", "mcp"] } } }
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { resolveConfig, stateDir } from '../config.js';
import { openTransport } from '../connect.js';
import { loadBlueprint, fromJson } from '../io/blueprint.js';
import { lintStructure } from '../core/lint.js';
import { executeBuild } from '../build.js';
import { listSnapshots, decodeSnapshot, captureRegion } from '../snapshot.js';
import { parseCoords } from '../cli/args.js';
import { DEFAULT_MC_VERSION } from '../core/blockinfo.js';

const PROTOCOL_VERSION = '2025-06-18';
const PKG = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const blueprintSchema = {
  description: 'A blueprint: a file path (.json/.mjs/.schem/.nbt/.litematic), "gen:<generator>", or an inline JSON blueprint object (palette/layers/fills/blocks/parts/generator).',
  anyOf: [{ type: 'string' }, { type: 'object' }],
};

export const TOOLS = [
  {
    name: 'mc_generators',
    description: 'List the built-in structure generators and their parameters (house, castle, tower, tree, text, pixelart, city, …).',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Only this generator' } } },
  },
  {
    name: 'mc_preview',
    description: 'Render a blueprint to a PNG (iso view from the south-east, top view with north up, south and east elevations) and return it with size/block counts. Always look at this before building.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint: blueprintSchema,
        params: { type: 'object', description: 'Generator / JS blueprint params' },
        view: { type: 'string', enum: ['sheet', 'iso', 'iso-nw', 'top', 'south', 'north', 'east', 'west'], default: 'sheet' },
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
    name: 'mc_build',
    description: 'Build a blueprint in the running world. Give either at=[x,y,z] (north-west footprint corner, y = feet level) or near=<player>. The blueprint front faces south; facing rotates it. Returns a report with world bounds, verify results and an undo id.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint: blueprintSchema,
        params: { type: 'object' },
        at: { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 },
        near: { type: 'string', description: 'Player name: build in front of them, facing them' },
        facing: { type: 'string', enum: ['north', 'east', 'south', 'west'] },
        anchor: { type: 'string', enum: ['corner', 'center', 'origin'] },
        clear: { type: 'boolean', description: 'Empty the area (+2 blocks margin) first' },
        ground: { type: 'string', description: 'Block for a foundation layer under the footprint' },
        verify: { type: 'boolean', default: true },
        dryRun: { type: 'boolean' },
        mode: { type: 'string', enum: ['fill', 'layered', 'hand'] },
      },
      required: ['blueprint'],
    },
  },
  {
    name: 'mc_undo',
    description: 'Undo a build (default: the most recent), restoring the blocks that were there before. list=true lists undo snapshots.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, list: { type: 'boolean' } } },
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
      properties: { from: { type: 'array', items: { type: 'integer' } }, to: { type: 'array', items: { type: 'integer' } }, keepAir: { type: 'boolean' } },
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

export function createServer({ flags = {}, log = () => {} } = {}) {
  let transport = null;
  const cfg = resolveConfig(flags);
  const getTransport = async () => {
    if (transport && !transport.closed) return transport;
    transport = await openTransport(cfg, { log });
    return transport;
  };

  const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });

  const handlers = {
    async mc_generators({ name } = {}) {
      const { listGenerators } = await import('../generators/index.js');
      const list = listGenerators().filter((g) => !name || g.name === name).map((g) => ({ name: g.name, description: g.description, params: g.params }));
      return text(list);
    },
    async mc_preview({ blueprint, params, view = 'sheet' }) {
      const s = await loadAny(blueprint, params);
      const lint = lintStructure(s, { version: cfg.version ?? DEFAULT_MC_VERSION });
      const { renderPreview } = await import('../render/preview.js');
      const r = renderPreview(s, { view, title: s.name });
      const b = s.bounds();
      return {
        content: [
          { type: 'image', data: r.png.toString('base64'), mimeType: 'image/png' },
          { type: 'text', text: JSON.stringify({ name: s.name, size: b?.size, blocks: s.count, view, warnings: lint.warnings.map((w) => w.message), errors: lint.errors.flatMap((e) => e.errors) }, null, 2) },
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
        structure: s, transport: tr, at: a.at ?? (a.dryRun && !near ? [0, 0, 0] : undefined), near, facing: a.facing, anchor: a.anchor,
        clear: !!a.clear, ground: a.ground, verify: a.verify !== false, dryRun: !!a.dryRun, mode: a.mode ?? 'fill',
        stateDir: stateDir(cfg), version: cfg.version ?? tr.version, log,
      });
      if (report.commands) report.commands = report.commands.slice(0, 200);
      return text(report);
    },
    async mc_undo({ id, list } = {}) {
      const snaps = listSnapshots(stateDir(cfg));
      if (list) return text(snaps.map((s) => ({ id: s.id, time: new Date(s.mtime).toISOString() })));
      const snap = id ? snaps.find((s) => s.id === id || s.id.startsWith(id)) : snaps[0];
      if (!snap) throw new Error('Nothing to undo');
      const data = decodeSnapshot(fs.readFileSync(snap.file));
      const report = await executeBuild({ structure: data.structure, transport: await getTransport(), at: [0, 0, 0], anchor: 'origin', strict: true, undo: false, fixMultiblocks: false, force: true, log });
      const applied = path.join(path.dirname(snap.file), 'applied');
      fs.mkdirSync(applied, { recursive: true });
      fs.renameSync(snap.file, path.join(applied, path.basename(snap.file)));
      return text({ ok: report.ok, id: snap.id, restoredBlocks: data.structure.count });
    },
    async mc_where({ player } = {}) {
      const t = await getTransport();
      if (!player) return text((await t.query('list')).text);
      const p = await t.playerPose(player);
      const { yawToDir } = await import('../placement.js');
      return text({ player, block: [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)], pos: [p.x, p.y, p.z], yaw: p.yaw, facing: yawToDir(p.yaw) });
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
    async mc_snapshot({ from, to, keepAir }) {
      const a = parseCoords(from), b = parseCoords(to);
      const box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
      const vol = (box[3] - box[0] + 1) * (box[4] - box[1] + 1) * (box[5] - box[2] + 1);
      if (vol > 200_000) throw new Error(`Region too large for an inline snapshot (${vol} blocks > 200000); use the CLI: mcb snapshot -o file.schem`);
      const t = await getTransport();
      const { withGamerules } = await import('../gamerules.js');
      const cap = await withGamerules(t, { logAdminCommands: false }, () => captureRegion(t, box));
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
        instructions: 'Build things in Minecraft Java Edition. Workflow: mc_generators / write an inline JSON blueprint → mc_validate → mc_preview (look at the image) → mc_build (near the player or at coordinates, verify on) → mc_undo if needed. Blueprint fronts face south; y=0 is the first layer above the ground.',
      };
    }
    if (method === 'ping') return {};
    if (method === 'tools/list') return { tools: TOOLS };
    if (method === 'tools/call') {
      const fn = handlers[params?.name];
      if (!fn) throw Object.assign(new Error(`Unknown tool ${params?.name}`), { rpcCode: -32602 });
      try {
        return await fn(params.arguments ?? {});
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
  const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  const pending = new Set();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    const p = (async () => {
      try {
        const result = await server.handle(msg);
        if (msg.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: msg.id, result });
      } catch (e) {
        if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: e.rpcCode ?? -32603, message: e.message } });
      }
    })();
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  await new Promise((resolve) => rl.once('close', resolve));
  await Promise.allSettled([...pending]);
  await server.close();
}
