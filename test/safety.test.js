/**
 * Regression tests for the safety contract (snapshot-or-abort, container guard, conflict-aware
 * undo, gamerule journal) and for review findings — run against an in-memory server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SimTransport } from './helpers/sim.js';
import { Structure } from '../src/core/structure.js';
import { executeBuild, verifyAndRepair, blockMatches } from '../src/build.js';
import { undoBuild } from '../src/undo.js';
import { listSnapshots, saveSnapshot, newSnapshotId } from '../src/snapshot.js';
import { withGamerules, recoverGamerules } from '../src/gamerules.js';
import { normalizeServerKey } from '../src/connect.js';
import { splitBox, planBuild } from '../src/compile/plan.js';
import { parseArgs } from '../src/cli/args.js';
import { resolveConfig } from '../src/config.js';
import { lintStructure } from '../src/core/lint.js';
import { suggestBlocks, renamedFor, twoBlockInfo } from '../src/core/blockinfo.js';
import { transformBlock } from '../src/core/transform.js';
import { parseBlock } from '../src/core/blockstate.js';
import { runGenerator } from '../src/generators/index.js';
import { fromJson } from '../src/io/blueprint.js';
import { invalidEnvelope } from '../src/mcp/server.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mcb-safety-'));
const quiet = { log: () => {} };

function hut() {
  const s = new Structure({ name: 'hut' });
  s.fill(0, 0, 0, 4, 0, 4, 'stone_bricks');
  s.fill(0, 1, 0, 4, 2, 4, 'oak_planks', { mode: 'walls' });
  return s;
}

// ───────────────────────────── container guard ─────────────────────────────

test('a clear destroys a chest even when the blueprint puts the same chest back → refused, nothing changed', async () => {
  const sim = new SimTransport({ blocks: { '12,0,12': 'chest[facing=north]' } });
  const s = new Structure({ name: 'c' });
  s.fill(0, 0, 0, 4, 0, 4, 'stone');
  s.set(2, 0, 2, 'chest[facing=north]');
  await assert.rejects(
    () => executeBuild({ structure: s, transport: sim, at: [10, 0, 10], clear: 1, ...quiet }),
    (e) => e.code === 'CONTAINERS_AT_RISK',
  );
  assert.equal(sim.worldEdits.length, 0, 'no world edits after a refusal');
});

test('--no-undo still runs the container check', async () => {
  const sim = new SimTransport({ blocks: { '1,0,1': 'barrel' } });
  await assert.rejects(
    () => executeBuild({ structure: hut(), transport: sim, at: [0, 0, 0], undo: false, ...quiet }),
    (e) => e.code === 'CONTAINERS_AT_RISK',
  );
  assert.equal(sim.worldEdits.length, 0);
});

test('a build that leaves a container untouched is allowed; --force overrides the guard', async () => {
  const sim = new SimTransport({ blocks: { '20,0,20': 'chest' } });
  const r = await executeBuild({ structure: hut(), transport: sim, at: [0, 0, 0], ...quiet });
  assert.equal(r.ok, true);
  assert.equal(r.impact.containerCount, 0);
  const sim2 = new SimTransport({ blocks: { '1,0,1': 'chest' } });
  const f = await executeBuild({ structure: hut(), transport: sim2, at: [0, 0, 0], force: true, ...quiet });
  assert.equal(f.ok, true);
  assert.equal(f.impact.containerCount, 1);
});

// ───────────────────────────── snapshots + undo ─────────────────────────────

test('build → undo restores exactly what the build changed; a no-op rebuild saves no snapshot', async () => {
  const dir = tmp();
  const sim = new SimTransport({ blocks: { '0,0,0': 'stone_bricks', '2,0,2': 'dirt' } });
  const r = await executeBuild({ structure: hut(), transport: sim, at: [0, 0, 0], verify: true, stateDir: dir, ...quiet });
  assert.equal(r.ok, true);
  assert.equal(r.verify.remaining, 0);
  assert.ok(r.undo.available);
  // (0,0,0) already was stone_bricks: not a change
  assert.equal(r.impact.changes, hut().count - 1);
  const again = await executeBuild({ structure: hut(), transport: sim, at: [0, 0, 0], stateDir: dir, ...quiet });
  assert.equal(again.commandsSent, 0);
  assert.equal(again.undo.available, false);
  assert.match(again.undo.reason, /nothing to undo/);
  assert.equal(listSnapshots(dir).length, 1);
  const u = await undoBuild(sim, r.undo.file, { stateDir: dir, ...quiet });
  assert.equal(u.ok, true);
  assert.equal(u.restored, hut().count - 1, 'only changed blocks are restored');
  assert.equal(sim.get(0, 0, 0), 'stone_bricks');
  assert.equal(sim.get(2, 0, 2), 'dirt');
  assert.equal(sim.get(1, 1, 0), 'air');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('undo skips blocks edited since the build and blocks it cannot read (snapshot kept for a retry)', async () => {
  const dir = tmp();
  const sim = new SimTransport();
  const r = await executeBuild({ structure: hut(), transport: sim, at: [0, 0, 0], stateDir: dir, ...quiet });
  sim.world.set('0,1,0', 'gold_block'); // a player edit after the build
  sim.unreadable = (x, y, z) => x === 4 && y === 2 && z === 4;
  const u = await undoBuild(sim, r.undo.file, { stateDir: dir, ...quiet });
  assert.equal(u.ok, false);
  assert.equal(u.conflicts, 1);
  assert.equal(u.unreadable, 1);
  assert.equal(sim.get(0, 1, 0), 'gold_block', 'the edit survives');
  assert.match(sim.get(4, 2, 4), /^oak_planks/, 'the unreadable block is left alone');
  assert.equal(sim.get(1, 1, 0), 'air', 'everything else is restored');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('undo refuses a snapshot taken on another server unless anyServer', async () => {
  const dir = tmp();
  const sim = new SimTransport({ serverKey: 'localhost:25565' });
  const r = await executeBuild({ structure: hut(), transport: sim, at: [0, 0, 0], stateDir: dir, ...quiet });
  const other = new SimTransport({ serverKey: 'mc.example.com:25565' });
  await assert.rejects(() => undoBuild(other, r.undo.file, { stateDir: dir, ...quiet }), (e) => e.code === 'SERVER_MISMATCH');
  sim.serverKey = '127.0.0.1:25565'; // same server, other spelling
  const u = await undoBuild(sim, r.undo.file, { stateDir: dir, ...quiet });
  assert.equal(u.ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('snapshot ids are unique and never overwrite each other', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newSnapshotId('same name')));
  assert.equal(ids.size, 200);
  const dir = tmp();
  const snap = { id: 'fixed', name: 'x', box: [0, 0, 0, 0, 0, 0], structure: new Structure().set(0, 0, 0, 'stone') };
  saveSnapshot(dir, snap);
  assert.throws(() => saveSnapshot(dir, snap), /EEXIST/);
  assert.doesNotThrow(() => saveSnapshot(dir, snap, { overwrite: true }));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('server keys: loopback spellings are the same server', () => {
  assert.equal(normalizeServerKey('localhost:25565'), '127.0.0.1:25565');
  assert.equal(normalizeServerKey('LOCALHOST'), '127.0.0.1:25565');
  assert.equal(normalizeServerKey('[::1]:25566'), '127.0.0.1:25566');
  assert.equal(normalizeServerKey('Play.Example.com:25565'), 'play.example.com:25565');
  assert.notEqual(normalizeServerKey('127.0.0.1:25565'), normalizeServerKey('127.0.0.1:25566'));
});

// ───────────────────────────── verify ─────────────────────────────

test('verify: a block that turns unreadable on the re-check is reported, not silently dropped', async () => {
  const sim = new SimTransport();
  const s = new Structure().fill(0, 0, 0, 2, 0, 0, 'stone');
  await executeBuild({ structure: s, transport: sim, at: [0, 0, 0], undo: false, ...quiet });
  sim.world.set('1,0,0', 'dirt');
  let reads = 0;
  sim.unreadable = (x, y, z) => x === 1 && ++reads > 1; // readable on the first pass only
  const v = await verifyAndRepair(sim, s, { repair: false });
  assert.equal(v.mismatches, 0);
  assert.equal(v.unreadable, 1);
});

// ───────────────────────────── gamerules ─────────────────────────────

test('a gamerule that fails to restore stays journaled and is restored on the next run', async () => {
  const dir = tmp();
  const sim = new SimTransport();
  sim.failRule = (name, value) => name === 'send_command_feedback' && value === 'true';
  await withGamerules(sim, { sendCommandFeedback: false }, async () => {}, { journalDir: dir });
  assert.equal(sim.rules.send_command_feedback, 'false');
  const journal = fs.readdirSync(dir).filter((f) => f.startsWith('gamerules-pending'));
  assert.equal(journal.length, 1, 'journal kept');
  sim.failRule = null;
  const fixed = await recoverGamerules(sim, dir);
  assert.deepEqual(fixed.map(([n, v]) => [n, v]), [['send_command_feedback', 'true']]);
  assert.equal(sim.rules.send_command_feedback, 'true');
  assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('gamerules-pending')).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the journaled original survives a second run that starts while a rule is still changed', async () => {
  const dir = tmp();
  const sim = new SimTransport();
  // run 1 "crashes": the rule is muted and the restore never happens
  sim.failRule = (name, value) => value === 'true';
  await withGamerules(sim, { sendCommandFeedback: false }, async () => {}, { journalDir: dir });
  // run 2: recovery still fails at the start, succeeds at the end → must restore the ORIGINAL (true)
  await withGamerules(sim, { sendCommandFeedback: false }, async () => { sim.failRule = null; }, { journalDir: dir });
  assert.equal(sim.rules.send_command_feedback, 'true');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gamerules are changed in the dimension being built in', async () => {
  const sim = new SimTransport();
  sim.setDimension('minecraft:the_nether');
  await withGamerules(sim, { sendCommandFeedback: false }, async () => {}, {});
  assert.ok(sim.commands.includes('execute in minecraft:the_nether run gamerule send_command_feedback false'), sim.commands.join('\n'));
  assert.ok(sim.commands.includes('execute in minecraft:the_nether run gamerule send_command_feedback true'));
});

// ───────────────────────────── planner / structure ─────────────────────────────

test('splitBox keeps every piece within the volume limit, even below one tile layer', () => {
  for (const max of [100, 1000, 4096, 32768]) {
    const box = { x1: -5, y1: 0, z1: 3, x2: 70, y2: 9, z2: 90 };
    const parts = splitBox(box, max);
    let total = 0;
    for (const p of parts) {
      const v = (p.x2 - p.x1 + 1) * (p.y2 - p.y1 + 1) * (p.z2 - p.z1 + 1);
      assert.ok(v <= max, `${v} > ${max}`);
      total += v;
    }
    assert.equal(total, 76 * 10 * 88, 'pieces cover the box exactly once');
  }
  const s = new Structure().fill(0, 0, 0, 63, 3, 63, 'stone');
  const plan = planBuild(s, { maxVolume: 50, clearBox: [0, 0, 0, 63, 3, 63] });
  assert.ok(plan.ops.every((op) => op.volume <= 50));
});

test('structures work at coordinates far beyond ±2,097,152 and reject out-of-range ones', () => {
  const s = new Structure();
  s.set(3_000_000, 5, -29_999_999, 'stone');
  s.set(3_000_001, -64, -29_999_999, 'dirt');
  assert.equal(s.get(3_000_000, 5, -29_999_999), 'stone');
  assert.deepEqual(s.bounds().min, [3_000_000, -64, -29_999_999]);
  const cmds = planBuild(s).ops.map((o) => o.cmd).join('\n');
  assert.match(cmds, /3000000 5 -29999999/);
  assert.throws(() => s.set(40_000_000, 0, 0, 'stone'), RangeError);
  assert.equal(s.get(40_000_000, 0, 0) ?? null, null);
});

// ───────────────────────────── CLI/config parsing ─────────────────────────────

test('boolean flags parse strictly: --force=false is false, nonsense is an error', () => {
  const B = ['force', 'verify'];
  assert.equal(parseArgs(['build', 'x', '--force=false'], { booleans: B }).force, false);
  assert.equal(parseArgs(['build', 'x', '--force=1'], { booleans: B }).force, true);
  assert.equal(parseArgs(['build', 'x', '--no-verify'], { booleans: B }).verify, false);
  assert.throws(() => parseArgs(['--verify=maybe'], { booleans: B }), (e) => e.code === 'BAD_FLAG');
});

test('an explicit --config that does not exist is an error, never a silent fallback', () => {
  assert.throws(() => resolveConfig({ config: path.join(os.tmpdir(), 'definitely-missing-mcb.json') }), (e) => e.code === 'CONFIG_NOT_FOUND');
});

// ───────────────────────────── block knowledge ─────────────────────────────

test('blocks renamed between versions are translated (chain → iron_chain) and suggested', () => {
  assert.equal(renamedFor('chain', '1.21.11'), 'iron_chain');
  assert.equal(suggestBlocks('chain', '1.21.11')[0], 'iron_chain');
  const s = new Structure().fill(0, 0, 0, 0, 2, 0, 'chain[axis=y]');
  const lint = lintStructure(s, { version: '1.21.11' });
  assert.equal(lint.ok, true, JSON.stringify(lint.errors));
  assert.equal(s.get(0, 1, 0), 'iron_chain[axis=y]');
  assert.ok(lint.fixes.some((f) => /chain → iron_chain/.test(f.message)));
});

test('gravity blocks: no warning on terrain below y=0, warning when floating', () => {
  const ground = new Structure().fill(0, -1, 0, 3, -1, 3, 'gravel');
  ground.set(0, -3, 0, 'stone'); // a deeper part makes min y < -1
  assert.equal(lintStructure(ground).warnings.filter((w) => /Gravity/.test(w.message)).length, 0);
  const floating = new Structure().set(0, 3, 0, 'sand').set(0, 0, 0, 'stone');
  assert.equal(lintStructure(floating).warnings.filter((w) => /Gravity/.test(w.message)).length, 1);
});

test('two-block plants come from block data (tall_grass yes, tall_dry_grass no)', () => {
  assert.equal(twoBlockInfo('tall_grass')?.prop, 'half');
  assert.equal(twoBlockInfo('tall_dry_grass'), null);
  assert.equal(twoBlockInfo('oak_trapdoor'), null);
  assert.equal(twoBlockInfo('red_bed')?.prop, 'part');
});

test('bare blocks rotate from their default facing and match the defaults the game reports', () => {
  assert.equal(parseBlock(transformBlock('oak_stairs', { rotate: 90 })).props.facing, 'east');
  assert.equal(parseBlock(transformBlock('chest', { rotate: 180 })).props.facing, 'south');
  assert.equal(blockMatches('oak_stairs', 'oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]'), true);
  assert.equal(blockMatches('oak_stairs', 'oak_stairs[facing=south,half=bottom,shape=straight,waterlogged=false]'), false);
  assert.equal(blockMatches('chest', 'chest[facing=north,type=left,waterlogged=false]'), true, 'chest pairing is dynamic');
});

test('the same seed gives the same generator output from the CLI (string) and JSON/JS (number)', () => {
  const a = runGenerator('tree', { type: 'birch', seed: '2' });
  const b = runGenerator('tree', { type: 'birch', seed: 2 });
  assert.deepEqual(a.bounds(), b.bounds());
  assert.equal(a.count, b.count);
});

test('parts: at = north-west corner after turning; facing west = rotate 90', async () => {
  const part = { palette: { P: 'oak_planks', D: 'oak_door[facing=south]' }, layers: [['PPP', 'P.P', 'PDP']] };
  const west = await fromJson({ parts: [{ ...part, at: [10, 0, 20], facing: 'west' }] });
  const rot = await fromJson({ parts: [{ ...part, at: [10, 0, 20], rotate: 90 }] });
  assert.deepEqual(west.bounds().min, [10, 0, 20]);
  assert.deepEqual(rot.bounds().min, [10, 0, 20]);
  let door = null;
  west.forEach((x, y, z, b) => { if (b.startsWith('oak_door')) door = b; });
  assert.match(door, /facing=west/);
  await assert.rejects(() => fromJson({ parts: [{ ...part, facing: 'up' }] }), /facing must be/);
});

// ───────────────────────────── MCP ─────────────────────────────

test('MCP: malformed JSON-RPC envelopes are rejected', () => {
  assert.equal(invalidEnvelope(null), -32600);
  assert.equal(invalidEnvelope([]), -32600);
  assert.equal(invalidEnvelope({ jsonrpc: '2.0', id: null, method: 'ping' }), -32600);
  assert.equal(invalidEnvelope({ jsonrpc: '1.0', id: 1, method: 'ping' }), -32600);
  assert.equal(invalidEnvelope({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: null }), -32602);
  assert.equal(invalidEnvelope({ jsonrpc: '2.0', id: 1, method: 'ping' }), 0);
  assert.equal(invalidEnvelope({ jsonrpc: '2.0', method: 'notifications/initialized' }), 0);
});
