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

test('undo also puts back grass that turned to dirt under the build', async () => {
  const dir = tmp();
  const blocks = {};
  for (let x = -1; x <= 5; x++) for (let z = -1; z <= 5; z++) blocks[`${x},-1,${z}`] = 'grass_block';
  const sim = new SimTransport({ blocks });
  const r = await executeBuild({ structure: hut(), transport: sim, at: [0, 0, 0], stateDir: dir, ...quiet });
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) sim.world.set(`${x},-1,${z}`, 'dirt'); // the game's decay
  sim.world.set('5,-1,5', 'dirt'); // outside the build's footprint
  const u = await undoBuild(sim, r.undo.file, { stateDir: dir, ...quiet });
  assert.equal(u.ok, true);
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) assert.match(sim.get(x, -1, z), /^grass_block/, `${x},-1,${z}`);
  assert.equal(sim.get(5, -1, 5), 'dirt', 'outside the build area nothing is touched');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('undo leaves decayed ground alone where something still covers it', async () => {
  const dir = tmp();
  const blocks = {};
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) blocks[`${x},-1,${z}`] = 'grass_block';
  const sim = new SimTransport({ blocks });
  const pen = new Structure({ name: 'pen' }).fill(0, 0, 0, 4, 1, 4, 'oak_fence', { mode: 'walls' }); // inside left untouched
  const r = await executeBuild({ structure: pen, transport: sim, at: [0, 0, 0], stateDir: dir, ...quiet });
  sim.world.set('2,0,2', 'stone'); // a player builds inside the pen afterwards
  sim.world.set('2,-1,2', 'dirt');
  sim.world.set('0,-1,0', 'dirt'); // under a fence corner
  const u = await undoBuild(sim, r.undo.file, { stateDir: dir, ...quiet });
  assert.equal(u.ok, true, JSON.stringify(u.conflictExamples));
  assert.equal(sim.get(2, -1, 2), 'dirt', 'still covered by the player block → left as dirt');
  assert.equal(sim.get(2, 0, 2), 'stone', "the player's block is not the build's: untouched");
  assert.match(sim.get(0, -1, 0), /^grass_block/, 'uncovered by the undo → grass again');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a rebuild does not count grass/path decay under other blocks as a change', async () => {
  const sim = new SimTransport({ blocks: { '0,-1,0': 'dirt', '0,0,0': 'stone', '1,-1,0': 'dirt' } });
  const s = new Structure().set(0, -1, 0, 'dirt_path').set(1, -1, 0, 'dirt_path').set(3, 0, 0, 'lantern');
  const plan = await executeBuild({ structure: s, transport: sim, at: [0, 0, 0], planOnly: true, ...quiet });
  assert.equal(plan.impact.changes, 2, 'the covered path cell is not a change');
  assert.match(plan.undo.reason, /read-only/);
});

test('house corner flowers get their own patch of grass', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = runGenerator('house', { seed });
    s.forEach((x, y, z, b) => {
      if (/\[half=lower\]/.test(b) && /(rose_bush|lilac|peony)/.test(b)) assert.equal(s.get(x, y - 1, z), 'grass_block', `seed ${seed} at ${x},${y},${z}`);
    });
  }
});

test('undo only restores ground the build itself covered (player-made dirt elsewhere stays)', async () => {
  const dir = tmp();
  const blocks = {};
  for (let x = 0; x <= 4; x++) blocks[`${x},-1,0`] = 'grass_block';
  const sim = new SimTransport({ blocks });
  const pillars = new Structure({ name: 'pillars' }).fill(0, 0, 0, 0, 2, 0, 'stone').fill(4, 0, 0, 4, 2, 0, 'stone');
  const r = await executeBuild({ structure: pillars, transport: sim, at: [0, 0, 0], stateDir: dir, ...quiet });
  sim.world.set('0,-1,0', 'dirt'); // decayed under a pillar
  sim.world.set('2,-1,0', 'dirt'); // a player dug the open gap between the pillars
  const u = await undoBuild(sim, r.undo.file, { stateDir: dir, ...quiet });
  assert.equal(u.ok, true);
  assert.match(sim.get(0, -1, 0), /^grass_block/);
  assert.equal(sim.get(2, -1, 0), 'dirt', "the player's edit in the gap is not the build's doing");
  fs.rmSync(dir, { recursive: true, force: true });
});

test('callers can persist their own undo record before the first world edit (watch)', async () => {
  const sim = new SimTransport();
  let editsAtHook = -1, hadChanges = false;
  await executeBuild({
    structure: hut(), transport: sim, at: [0, 0, 0], saveUndo: false, ...quiet,
    beforeChanges: (rep) => { editsAtHook = sim.worldEdits.length; hadChanges = rep.changed.count > 0 && !!rep.snapshot; },
  });
  assert.equal(editsAtHook, 0);
  assert.equal(hadChanges, true);
});

test('gamerule commands always name their world (a bot may stand in another one)', async () => {
  const sim = new SimTransport();
  await withGamerules(sim, { sendCommandFeedback: false }, async () => {}, {});
  assert.ok(sim.commands.includes('execute in minecraft:overworld run gamerule send_command_feedback false'), sim.commands.join('\n'));
  const bot = new SimTransport();
  Object.defineProperty(bot, 'currentDimension', { value: 'minecraft:the_end' });
  await withGamerules(bot, { sendCommandFeedback: false }, async () => {}, {});
  assert.ok(bot.commands.includes('execute in minecraft:the_end run gamerule send_command_feedback true'));
});

test('a build too big to scan for containers needs --force even with --no-undo', async () => {
  const sim = new SimTransport({ blocks: { '1,0,1': 'chest' } });
  await assert.rejects(
    () => executeBuild({ structure: hut(), transport: sim, at: [0, 0, 0], undo: false, maxSnapshot: 10, ...quiet }),
    (e) => e.code === 'SCAN_TOO_LARGE',
  );
  assert.equal(sim.worldEdits.length, 0);
  const r = await executeBuild({ structure: hut(), transport: sim, at: [0, 0, 0], undo: false, maxSnapshot: 10, force: true, ...quiet });
  assert.equal(r.ok, true);
});

test('server identity: only a process carrying our launch token counts as our server', async () => {
  const { isOurServer, processCommandLine } = await import('../src/server/manage.js');
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)', '--', '-Dmcb.server=tok-123'], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 300));
    assert.match(processCommandLine(child.pid) ?? '', /tok-123/);
    assert.equal(isOurServer(child.pid, 'tok-123'), true);
    assert.equal(isOurServer(child.pid, 'other-token'), false);
    assert.equal(isOurServer(child.pid, null), null, 'no token → unknown, never "ours"');
  } finally {
    child.kill();
  }
});

test('undo recognises every state a watch session may have left (interrupted removal)', async () => {
  const dir = tmp();
  const sim = new SimTransport();
  sim.world.set('0,0,0', 'stone'); // revision A placed stone; revision B wanted it gone but died first
  const { encodeSnapshot } = await import('../src/snapshot.js');
  const before = new Structure().set(0, 0, 0, 'air');
  const file = path.join(dir, 'w.json.gz');
  fs.writeFileSync(file, encodeSnapshot({
    id: 'w', name: 'w', box: [0, 0, 0, 0, 0, 0], structure: before,
    after: new Structure().set(0, 0, 0, 'air'), afterAlt: [new Structure().set(0, 0, 0, 'stone')],
    meta: { watch: true },
  }));
  const u = await undoBuild(sim, file, { ...quiet });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(sim.get(0, 0, 0), 'air', 'the stone the interrupted session left is removed');
  sim.world.set('0,0,0', 'stone');
  const f = await undoBuild(sim, file, { force: true, ...quiet });
  assert.equal(f.ok, true);
  assert.equal(sim.get(0, 0, 0), 'air', 'also without reading (--force)');
  sim.world.set('0,0,0', 'gold_block'); // not something the session ever placed → a conflict
  const c = await undoBuild(sim, file, { ...quiet });
  assert.equal(c.conflicts, 1);
  assert.equal(sim.get(0, 0, 0), 'gold_block');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ground under unreadable cover is left alone', async () => {
  const dir = tmp();
  const sim = new SimTransport({ blocks: { '0,-1,0': 'grass_block' } });
  const r = await executeBuild({ structure: new Structure().set(0, 0, 0, 'stone'), transport: sim, at: [0, 0, 0], stateDir: dir, ...quiet });
  sim.world.set('0,-1,0', 'dirt');
  sim.unreadable = (x, y, z) => x === 0 && y === 0 && z === 0; // the cover can't be read
  const u = await undoBuild(sim, r.undo.file, { stateDir: dir, ...quiet });
  assert.equal(u.ok, false);
  assert.equal(u.unreadable, 1);
  assert.equal(sim.get(0, -1, 0), 'dirt', 'no grass under a block that may still be there');
  assert.equal(fs.readdirSync(path.join(dir, 'undo')).filter((f) => f.endsWith('.tmp')).length, 0, 'no temp files left');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('watch session: originals are taken when the session first changes a block (player edits in between survive)', async () => {
  const { WatchSession } = await import('../src/watch.js');
  const dir = tmp();
  const sim = new SimTransport();
  const session = new WatchSession();
  const run = (s) => executeBuild({
    structure: s, transport: sim, ...session.buildOptions({ at: [0, 0, 0], stateDir: dir }), saveUndo: false, ...quiet,
    beforeChanges: (rep) => { if (session.record(rep)) saveSnapshot(dir, session.snapshot({ id: 'w', name: 'w' }), { overwrite: true }); },
  });
  await run(new Structure().set(0, 0, 0, 'stone').set(2, 0, 0, 'stone')); // (1,0,0) lies in the box, untouched
  sim.world.set('1,0,0', 'gold_block'); // a player builds there afterwards
  await run(new Structure().set(0, 0, 0, 'stone').set(1, 0, 0, 'stone').set(2, 0, 0, 'stone'));
  assert.equal(sim.get(1, 0, 0), 'stone');
  await run(new Structure().set(0, 0, 0, 'stone')); // later version drops two blocks again
  assert.equal(sim.get(1, 0, 0), 'gold_block', 'dropped block goes back to what was there before the session changed it');
  assert.equal(sim.get(2, 0, 0), 'air');
  await run(new Structure().set(0, 0, 0, 'stone').set(1, 0, 0, 'stone'));
  const u = await undoBuild(sim, path.join(dir, 'undo', 'w.json.gz'), { stateDir: dir, ...quiet });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(sim.get(1, 0, 0), 'gold_block', "the player's gold survives the undo");
  assert.equal(sim.get(0, 0, 0), 'air');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('watch session: a player edit under an earlier block is an original too, not a stale ground backup', async () => {
  const { WatchSession } = await import('../src/watch.js');
  const dir = tmp();
  const sim = new SimTransport();
  const session = new WatchSession();
  const run = (s) => executeBuild({
    structure: s, transport: sim, ...session.buildOptions({ at: [0, 0, 0], stateDir: dir }), saveUndo: false, ...quiet,
    beforeChanges: (rep) => { if (session.record(rep)) saveSnapshot(dir, session.snapshot({ id: 'g', name: 'g' }), { overwrite: true }); },
  });
  await run(new Structure().set(0, 1, 0, 'stone')); // (0,0,0) below it is remembered as "ground" (air)
  sim.world.set('0,0,0', 'gold_block'); // then a player puts gold there
  await run(new Structure().set(0, 1, 0, 'stone').set(0, 0, 0, 'stone'));
  await run(new Structure().set(0, 1, 0, 'stone')); // the design drops (0,0,0) again
  assert.equal(sim.get(0, 0, 0), 'gold_block');
  await run(new Structure().set(0, 1, 0, 'stone').set(0, 0, 0, 'stone'));
  const u = await undoBuild(sim, path.join(dir, 'undo', 'g.json.gz'), { stateDir: dir, ...quiet });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(sim.get(0, 0, 0), 'gold_block');
  assert.equal(sim.get(0, 1, 0), 'air');
  // and a restarted session reads the same split back from its snapshot
  const { decodeSnapshot } = await import('../src/snapshot.js');
  const again = WatchSession.fromSnapshot(decodeSnapshot(fs.readFileSync(path.join(dir, 'undo', 'g.json.gz'))));
  assert.equal(again.baseline.get(0, 0, 0), 'gold_block');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('undo drains liquids before taking their container down, and puts grass back last', async () => {
  const dir = tmp();
  const blocks = { '1,-1,1': 'grass_block' };
  const sim = new SimTransport({ blocks });
  const pool = new Structure({ name: 'pool' }).fill(0, 0, 0, 2, 1, 2, 'stone_bricks', { mode: 'walls' }).set(1, 0, 1, 'water').set(1, -1, 1, 'stone');
  const r = await executeBuild({ structure: pool, transport: sim, at: [0, 0, 0], stateDir: dir, ...quiet });
  const mark = sim.commands.length;
  const u = await undoBuild(sim, r.undo.file, { stateDir: dir, ...quiet });
  assert.equal(u.ok, true);
  const edits = sim.commands.slice(mark).filter((c) => /^(fill|setblock) /.test(c));
  assert.match(edits[0], /^setblock 1 0 1 air/, `liquid first: ${edits[0]}`);
  assert.match(edits.at(-1), /^setblock 1 -1 1 grass_block/, `grass last: ${edits.at(-1)}`);
  assert.match(sim.get(1, -1, 1), /^grass_block/);
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
  for (const [str, num] of [['2e3', 2000], ['+2', 2], [' 7 ', 7]]) {
    assert.equal(runGenerator('tree', { type: 'oak', seed: str }).count, runGenerator('tree', { type: 'oak', seed: num }).count, str);
  }
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
  // a part whose own blocks start away from 0,0 still lands with its corner at `at` (y offsets kept)
  const offset = new Structure().set(5, -1, 7, 'stone').set(6, 0, 8, 'stone');
  assert.deepEqual(new Structure().place(offset, 10, 0, 20).bounds().min, [10, -1, 20]);
});

test('JSON blueprints and configs written with a UTF-8 BOM (PowerShell 5) load fine', async () => {
  const dir = tmp();
  const bp = path.join(dir, 'bom.json');
  fs.writeFileSync(bp, '\uFEFF' + JSON.stringify({ palette: { X: 'stone' }, layers: [['XX']] }));
  const { loadBlueprint } = await import('../src/io/blueprint.js');
  assert.equal((await loadBlueprint(bp)).count, 2);
  const cf = path.join(dir, 'mcb.config.json');
  fs.writeFileSync(cf, '\uFEFF' + JSON.stringify({ maxRate: 123 }));
  assert.equal(resolveConfig({ config: cf }).maxRate, 123);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generator style presets fill unset params; explicit params win', () => {
  const med = runGenerator('house', { style: 'medieval' });
  assert.ok(med.blockCounts().white_terracotta > 0);
  const own = runGenerator('house', { style: 'medieval', wall: 'bricks' });
  assert.equal(own.blockCounts().white_terracotta ?? 0, 0);
  assert.ok(own.blockCounts().bricks > 0);
  assert.throws(() => runGenerator('house', { style: 'gothic' }), /style/);
});

test('chunk readiness: only real chunk data in the current dimension counts', async () => {
  const { EventEmitter } = await import('node:events');
  const { trackChunks } = await import('../src/transport/bot.js');
  const bot = new EventEmitter();
  bot._client = new EventEmitter();
  bot.world = {}; // mineflayer reuses one World object across dimensions
  bot.game = { dimension: 'overworld' };
  const t = trackChunks(bot);
  bot._client.emit('update_light', { chunkX: 1, chunkZ: 1 }); // placeholder column: not data
  assert.equal(t.has(bot.world, 1, 1), false);
  bot._client.emit('map_chunk', { x: 1, z: 1 });
  assert.equal(t.has(bot.world, 1, 1), true);
  // to the Nether: mineflayer unloads the columns internally (world events), dimension changes
  bot.game.dimension = 'the_nether';
  bot.emit('chunkColumnUnload', { x: 16, z: 16 });
  assert.equal(t.has(bot.world, 1, 1), false);
  bot._client.emit('map_chunk', { x: 1, z: 1 });
  assert.equal(t.has(bot.world, 1, 1), true);
  // back to the overworld before any overworld chunk arrived
  bot.game.dimension = 'overworld';
  assert.equal(t.has(bot.world, 1, 1), false);
  bot._client.emit('map_chunk', { x: 1, z: 1 });
  bot._client.emit('unload_chunk', { chunkX: 1, chunkZ: 1 });
  assert.equal(t.has(bot.world, 1, 1), false);
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
