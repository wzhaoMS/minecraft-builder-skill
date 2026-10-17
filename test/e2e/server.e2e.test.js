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
import { undoBuild } from '../../src/undo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const enabled = process.env.MCB_E2E === '1';
const Y = Number(process.env.MCB_E2E_Y ?? -60);
const cfg = resolveConfig({});
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'mcb-e2e-'));
let bot = null;
let rcon = null;

/** The CLI test logs in as the same bot name, which kicks the shared session: notice that and rejoin. */
async function ensureBot() {
  await new Promise((r) => setTimeout(r, 1500));
  if (bot.closed) await bot.reconnect();
}

const tower = () => fromJson({
  name: 'e2e-tower',
  palette: { S: 'stone_bricks', G: 'glass', D: 'oak_door[facing=south]', T: 'wall_torch[facing=south]', L: 'oak_leaves', _: 'air', W: 'oak_stairs[facing=north]' },
  fills: [{ from: [0, 0, 0], to: [6, 8, 6], block: 'S', mode: 'hollow' }],
  blocks: [[3, 1, 6, 'D'], [2, 3, 7, 'T'], [3, 9, 3, 'L'], [3, 4, 0, 'G'], [0, 4, 3, 'G'], [1, 9, 1, 'W']],
});

before(async () => {
  if (!enabled) return;
  bot = await openTransport({ ...cfg, transport: 'bot' }, { log: () => {} });
  if (cfg.rconPassword) {
    rcon = await openTransport({ ...cfg, transport: 'rcon' }, { log: () => {} });
    // start from a known state even if an earlier, killed run left command feedback muted
    await rcon.command('gamerule send_command_feedback true', { allowErrors: true });
  }
});

after(async () => {
  await bot?.close();
  await rcon?.close();
  fs.rmSync(state, { recursive: true, force: true });
});

test('bot build → verify 100% → undo restores the original blocks', { skip: !enabled }, async () => {
  const s = await tower();
  const at = [1000, Y, 1000];
  const before = await getGamerule(bot, 'sendCommandFeedback');
  const r = await executeBuild({ structure: s, transport: bot, at, verify: true, clear: 1, stateDir: state });
  assert.equal(r.errorCount, 0, JSON.stringify(r.errors));
  assert.equal(r.status, 'complete');
  assert.equal(r.verify.remaining, 0, JSON.stringify(r.verify.examples));
  assert.equal(r.verify.unreadable, 0);
  assert.ok(r.undo?.id, 'undo snapshot saved');
  assert.ok(r.lint.fixes.some((f) => /oak_door/.test(f.message)), 'door upper half auto-completed');
  // command echo was muted during the build and restored afterwards
  const g = await getGamerule(bot, 'sendCommandFeedback');
  assert.equal(g.value, before.value);
  assert.ok(!fs.readdirSync(state).some((f) => f.startsWith('gamerules-pending')), 'journal removed after restore');
  // undo (only what the build changed, checking for later edits)
  const snapFile = listSnapshots(state)[0].file;
  const snap = decodeSnapshot(fs.readFileSync(snapFile));
  const u = await undoBuild(bot, snapFile, { stateDir: state });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(u.conflicts, 0);
  const v = await verifyAndRepair(bot, snap.structure, { repair: false, strict: false });
  assert.equal(v.mismatches, 0, JSON.stringify(v.examples));
});

test('undo leaves blocks edited after the build alone and reports them', { skip: !enabled || !cfg.rconPassword }, async () => {
  const s = await tower();
  const at = [1000, Y, 1060];
  await rcon.loadArea({ x1: 996, z1: 1056, x2: 1010, z2: 1070 });
  await rcon.command(`fill 996 ${Y} 1056 1010 ${Y + 12} 1070 air`); // fresh area on every run
  const r = await executeBuild({ structure: s, transport: bot, at, stateDir: state });
  assert.ok(r.undo?.id);
  // a "player" edits one wall block after the build
  await rcon.loadArea({ x1: 1000, z1: 1060, x2: 1006, z2: 1066 });
  await rcon.command(`setblock 1000 ${Y + 3} 1060 gold_block`);
  const snapFile = listSnapshots(state).find((x) => x.id === r.undo.id).file;
  const u = await undoBuild(bot, snapFile, { stateDir: state });
  assert.equal(u.conflicts, 1, JSON.stringify(u.conflictExamples));
  assert.deepEqual(u.conflictExamples[0].pos, [1000, Y + 3, 1060]);
  assert.match(u.conflictExamples[0].found, /gold_block/);
  const still = (await rcon.query(`execute if block 1000 ${Y + 3} 1060 gold_block`)).text;
  assert.match(still, /passed/i, 'the edited block was not overwritten');
  const other = (await rcon.query(`execute if block 1001 ${Y + 3} 1060 air`)).text;
  assert.match(other, /passed/i, 'the rest was restored');
});

test('builds refuse to destroy chests/signs (nothing changes) unless forced', { skip: !enabled || !cfg.rconPassword }, async () => {
  await rcon.loadArea({ x1: 1096, z1: 1056, x2: 1110, z2: 1070 });
  await rcon.command(`fill 1096 ${Y} 1056 1110 ${Y + 12} 1070 air`); // fresh area on every run
  await rcon.command(`setblock 1102 ${Y + 1} 1062 chest[facing=north]`);
  const s = await tower();
  await assert.rejects(
    () => executeBuild({ structure: s, transport: bot, at: [1100, Y, 1060], stateDir: state }),
    (e) => e.code === 'CONTAINERS_AT_RISK' && /chest at 1102/.test(e.message),
  );
  assert.match((await rcon.query(`execute if block 1100 ${Y} 1060 air`)).text, /passed/i, 'no block was changed');
  assert.match((await rcon.query(`execute if block 1102 ${Y + 1} 1062 chest`)).text, /passed/i);
  const plan = await executeBuild({ structure: s, transport: bot, at: [1100, Y, 1060], planOnly: true, stateDir: state });
  assert.equal(plan.status, 'planned');
  assert.equal(plan.impact.containerCount, 1);
  const forced = await executeBuild({ structure: s, transport: bot, at: [1100, Y, 1060], force: true, stateDir: state });
  assert.equal(forced.errorCount, 0);
});

test('verify catches a wrong block; an asymmetric rotated build across chunk borders at negative coords is exact', { skip: !enabled || !cfg.rconPassword }, async () => {
  const s = await fromJson({
    name: 'asym',
    palette: { S: 'stone_bricks', R: 'red_concrete', B: 'blue_concrete', T: 'oak_stairs[facing=east]', L: 'oak_log[axis=x]' },
    fills: [{ from: [0, 0, 0], to: [20, 0, 6], block: 'S' }],
    blocks: [[20, 1, 0, 'R'], [0, 1, 6, 'B'], [5, 1, 3, 'T'], [10, 1, 3, 'L']],
  });
  // crosses the x = -1000/-992 and z = -16 chunk borders, rotated 90°
  const r = await executeBuild({ structure: s, transport: bot, at: [-1005, Y, -20], facing: 'west', verify: true, stateDir: state });
  assert.equal(r.verify.remaining, 0, JSON.stringify(r.verify.examples));
  const placed = (await import('../../src/placement.js')).resolvePlacement(s, { at: [-1005, Y, -20], facing: 'west' }).world;
  let stairs = null, log = null;
  placed.forEach((x, y, z, b) => { if (b.startsWith('oak_stairs')) stairs = b; if (b.startsWith('oak_log')) log = b; });
  assert.equal(stairs, 'oak_stairs[facing=south]');
  assert.equal(log, 'oak_log[axis=z]');
  // tamper with one block → verify without repair reports exactly that block
  let anyPos = null;
  placed.forEach((x, y, z, b) => { if (!anyPos && b === 'stone_bricks') anyPos = [x, y, z]; });
  await rcon.loadArea({ x1: anyPos[0], z1: anyPos[2], x2: anyPos[0], z2: anyPos[2] });
  await rcon.command(`setblock ${anyPos.join(' ')} dirt`);
  const v = await verifyAndRepair(bot, placed, { repair: false });
  assert.equal(v.mismatches, 1);
  assert.deepEqual(v.examples[0].pos, anyPos);
});

test('rcon builds release every forceload ticket they added', { skip: !enabled || !cfg.rconPassword }, async () => {
  const q = async () => (await rcon.query('forceload query')).text.replace(/\s+/g, ' ');
  await rcon.releaseAreas();
  const before = await q();
  const s = await tower();
  await executeBuild({ structure: s, transport: rcon, at: [1180, Y, 1180], undo: false });
  await rcon.releaseAreas();
  assert.equal(await q(), before);
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

test('the bot still reads player poses and gamerules while send_command_feedback is off', { skip: !enabled || !cfg.rconPassword }, async () => {
  const alice = await connectBot({ host: cfg.host, port: cfg.port, username: 'E2EAlice', auth: cfg.auth });
  try {
    await rcon.command('gamerule send_command_feedback false');
    await bot.command(`tp E2EAlice 1100 ${Y} 1050 90 0`, { allowErrors: true });
    await new Promise((r) => setTimeout(r, 400));
    const p = await bot.playerPose('E2EAlice');
    assert.equal(Math.floor(p.x), 1100);
    assert.equal(Math.round(p.yaw), 90);
    assert.equal(p.dimension, 'minecraft:overworld');
    const g = await getGamerule(bot, 'sendCommandFeedback');
    assert.equal(g?.value, 'false');
    assert.ok((await bot.listPlayers()).includes('E2EAlice'));
  } finally {
    await rcon.command('gamerule send_command_feedback true', { allowErrors: true });
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
  // kick the bot once the build is under way (after the read-only scan)
  let kicked = false;
  const onProgress = (p) => {
    if (kicked || p.stage !== 'build' || !p.done) return;
    kicked = true;
    rcon.command('kick BuilderBot e2e reconnect test', { allowErrors: true }).catch(() => {});
  };
  const r = await executeBuild({ structure: s, transport: bot, at: [1150, Y, 1000], undo: false, verify: true, noSkip: true, onProgress });
  assert.ok(kicked, 'the kick was sent mid-build');
  assert.ok((r.reconnects ?? 0) >= 1, 'should have reconnected at least once');
  assert.equal(r.verify.remaining, 0, JSON.stringify(r.verify.examples));
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

test('nether builds mute and restore command feedback in the nether itself, and undo there', { skip: !enabled || !cfg.rconPassword }, async () => {
  await ensureBot();
  const feedback = async (dim) => /currently set to: (\w+)/.exec((await rcon.query(`execute in ${dim} run gamerule send_command_feedback`)).text)?.[1];
  const before = { nether: await feedback('minecraft:the_nether'), overworld: await feedback('minecraft:overworld') };
  const s = await tower();
  const r = await executeBuild({ structure: s, transport: bot, at: [96, 100, 96], dimension: 'the_nether', clear: 1, verify: true, stateDir: state, force: true });
  assert.equal(r.dimension, 'the_nether');
  assert.equal(r.verify.remaining, 0, JSON.stringify(r.verify.examples));
  assert.deepEqual({ nether: await feedback('minecraft:the_nether'), overworld: await feedback('minecraft:overworld') }, before);
  const u = await undoBuild(bot, r.undo.file, { stateDir: state });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.deepEqual({ nether: await feedback('minecraft:the_nether'), overworld: await feedback('minecraft:overworld') }, before);
  assert.ok(!fs.readdirSync(state).some((f) => f.startsWith('gamerules-pending')), 'nothing left in the journal');
});
test('a bot that logs in somewhere else (the Nether) still reads the overworld by default', { skip: !enabled || !cfg.rconPassword }, async () => {
  await rcon.command(`execute in minecraft:the_nether run tp ${cfg.username} 0 80 0`, { allowErrors: true });
  const fresh = await openTransport({ ...cfg, transport: 'bot' }, { log: () => {} });
  try {
    const { captureRegion } = await import('../../src/snapshot.js');
    const cap = await captureRegion(fresh, [1300, -61, 1300, 1304, -61, 1304]);
    assert.equal(cap.unknown, 0);
    assert.deepEqual(Object.keys(cap.structure.blockCounts()), ['grass_block[snowy=false]']);
  } finally {
    await fresh.close();
    await ensureBot();
  }
});