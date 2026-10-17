/**
 * End-to-end tests against a REAL Minecraft server. Skipped unless MCB_E2E=1.
 *
 *   MCB_E2E=1 MCB_PORT=25566 MCB_RCON_PORT=25575 MCB_RCON_PASSWORD=… node --test test/e2e
 *
 * The server must be offline-mode with the bot ("BuilderBot", or MCB_USERNAME) as operator.
 * Uses the area around x=1000..1200, z=1000..1100 (flat world assumed: ground at y=-61).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from '../../src/config.js';
import { openTransport } from '../../src/connect.js';
import { executeBuild, verifyAndRepair } from '../../src/build.js';
import { fromJson } from '../../src/io/blueprint.js';
import { listSnapshots, decodeSnapshot } from '../../src/snapshot.js';
import { getGamerule } from '../../src/gamerules.js';
import { connectBot } from '../../src/transport/bot.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const enabled = process.env.MCB_E2E === '1';
const Y = Number(process.env.MCB_E2E_Y ?? -60);
const cfg = resolveConfig({});
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'mcb-e2e-'));
let bot = null;
let rcon = null;

const tower = () => fromJson({
  name: 'e2e-tower',
  palette: { S: 'stone_bricks', G: 'glass', D: 'oak_door[facing=south]', T: 'wall_torch[facing=south]', L: 'oak_leaves', _: 'air', W: 'oak_stairs[facing=north]' },
  fills: [{ from: [0, 0, 0], to: [6, 8, 6], block: 'S', mode: 'hollow' }],
  blocks: [[3, 1, 6, 'D'], [2, 3, 7, 'T'], [3, 9, 3, 'L'], [3, 4, 0, 'G'], [0, 4, 3, 'G'], [1, 9, 1, 'W']],
});

before(async () => {
  if (!enabled) return;
  bot = await openTransport({ ...cfg, transport: 'bot' }, { log: () => {} });
  if (cfg.rconPassword) rcon = await openTransport({ ...cfg, transport: 'rcon' }, { log: () => {} });
});

after(async () => {
  await bot?.close();
  await rcon?.close();
  fs.rmSync(state, { recursive: true, force: true });
});

test('bot build → verify 100% → undo restores the original blocks', { skip: !enabled }, async () => {
  const s = await tower();
  const at = [1000, Y, 1000];
  const before = await getGamerule(bot, 'logAdminCommands');
  const r = await executeBuild({ structure: s, transport: bot, at, verify: true, clear: 1, stateDir: state });
  assert.equal(r.errorCount, 0, JSON.stringify(r.errors));
  assert.equal(r.verify.remaining, 0, JSON.stringify(r.verify.examples));
  assert.ok(r.undo?.id, 'undo snapshot saved');
  assert.ok(r.lint.fixes.some((f) => /oak_door/.test(f.message)), 'door upper half auto-completed');
  // gamerule restored to what it was before the build
  const g = await getGamerule(bot, 'logAdminCommands');
  assert.equal(g.value, before.value);
  // undo
  const snap = decodeSnapshot(fs.readFileSync(listSnapshots(state)[0].file));
  const u = await executeBuild({ structure: snap.structure, transport: bot, at: [0, 0, 0], anchor: 'origin', strict: true, undo: false, force: true, fixMultiblocks: false });
  assert.equal(u.errorCount, 0);
  const v = await verifyAndRepair(bot, snap.structure, { repair: false, strict: false });
  assert.equal(v.mismatches, 0, JSON.stringify(v.examples));
});

test('rebuilding an identical structure skips everything already in place', { skip: !enabled }, async () => {
  const s = await tower();
  const at = [1020, Y, 1000];
  await executeBuild({ structure: s, transport: bot, at, stateDir: state });
  const again = await executeBuild({ structure: s, transport: bot, at, stateDir: state });
  assert.equal(again.commandsSent, 0, `expected 0 commands on rebuild, sent ${again.commandsSent}`);
});

test('rcon build (with facing) is verified through the bot', { skip: !enabled || !cfg.rconPassword }, async () => {
  const s = await tower();
  const r = await executeBuild({ structure: s, transport: rcon, at: [1040, Y, 1000], facing: 'west' });
  assert.equal(r.errorCount, 0, JSON.stringify(r.errors));
  const placed = (await import('../../src/placement.js')).resolvePlacement(s, { at: [1040, Y, 1000], facing: 'west' }).world;
  const { lintStructure } = await import('../../src/core/lint.js');
  lintStructure(placed);
  const v = await verifyAndRepair(bot, placed, { repair: false });
  assert.equal(v.mismatches, 0, JSON.stringify(v.examples));
});

test('--near places the build in front of a player, facing them', { skip: !enabled }, async () => {
  const alice = await connectBot({ host: cfg.host, port: cfg.port, username: 'E2EAlice', auth: cfg.auth });
  try {
    await bot.command('tp E2EAlice 1100 ' + Y + ' 1050 180 0'); // looking north
    await new Promise((r) => setTimeout(r, 500));
    const s = await tower();
    const r = await executeBuild({ structure: s, transport: bot, near: 'E2EAlice', gap: 2, stateDir: state, verify: true });
    assert.equal(r.facing, 'south');
    assert.ok(r.box[5] < 1050 && r.box[5] >= 1046, `north of the player: ${r.box}`);
    assert.ok(r.box[0] <= 1100 && r.box[3] >= 1100, 'centred on the player');
    assert.equal(r.verify.remaining, 0);
  } finally {
    await alice.close();
  }
});

test('a non-op bot gets an actionable NOT_OP error', { skip: !enabled || !cfg.rconPassword }, async () => {
  await rcon.command('deop E2ENoOp', { allowErrors: true });
  const t = await connectBot({ host: cfg.host, port: cfg.port, username: 'E2ENoOp', auth: cfg.auth });
  try {
    assert.equal(t.isOp, false);
    const s = await tower();
    await assert.rejects(() => executeBuild({ structure: s, transport: t, at: [1060, Y, 1000], undo: false }), (e) => e.code === 'NOT_OP' && /op E2ENoOp/.test(e.hint));
  } finally {
    await t.close();
  }
});

test('a build survives the bot being kicked mid-way (auto-reconnect)', { skip: !enabled || !cfg.rconPassword }, async () => {
  const { Structure } = await import('../../src/core/structure.js');
  const { createRng } = await import('../../src/core/rng.js');
  const rng = createRng(7);
  const s = new Structure({ name: 'e2e-noise' });
  const blocks = ['stone', 'andesite', 'diorite', 'granite', 'cobblestone'];
  for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) for (let y = 0; y < 6; y++) s.set(x, y, z, rng.pick(blocks));
  const kicker = setTimeout(() => { rcon.command('kick BuilderBot e2e reconnect test', { allowErrors: true }).catch(() => {}); }, 1500);
  try {
    const r = await executeBuild({ structure: s, transport: bot, at: [1150, Y, 1000], undo: false, verify: true });
    assert.ok((r.reconnects ?? 0) >= 1, 'should have reconnected at least once');
    assert.equal(r.verify.remaining, 0, JSON.stringify(r.verify.examples));
  } finally {
    clearTimeout(kicker);
  }
});

test('CLI: mcb build --json prints a machine-readable report', { skip: !enabled }, () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/mcb.js'), 'build', path.join(ROOT, 'examples/blueprints/cottage.json'), '--at', `1080,${Y},1000`, '--verify', '--json', '--transport', 'bot'], {
    cwd: state, encoding: 'utf8', env: { ...process.env }, timeout: 120000,
  });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.verify.remaining, 0);
  assert.deepEqual(report.size, [11, 11, 9]);
});
