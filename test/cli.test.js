import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCoords, parseParams } from '../src/cli/args.js';
import { resolveConfig } from '../src/config.js';
import { offlineUuid, readProperties, writeProperties } from '../src/server/manage.js';
import { parseJavaVersion } from '../src/server/java.js';
import { encodeSnapshot, decodeSnapshot } from '../src/snapshot.js';
import { Structure } from '../src/core/structure.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mcb = (args, opts = {}) => spawnSync(process.execPath, [path.join(ROOT, 'bin/mcb.js'), ...args], { encoding: 'utf8', cwd: opts.cwd ?? ROOT, env: { ...process.env, MCB_CONFIG: '', ...opts.env }, timeout: 60000 });

test('parseArgs: positionals, values, booleans, negation, params, aliases, optional numbers', () => {
  const a = parseArgs(['build', 'x.json', '--at', '-10,64,5', '--verify', '--no-undo', '-p', 'w=3', '--param=h=4', '-o', 'out.png', '--clear', '--facing=east'], { booleans: ['verify'] });
  assert.deepEqual(a._, ['build', 'x.json']);
  assert.equal(a.at, '-10,64,5');
  assert.equal(a.verify, true);
  assert.equal(a.undo, false);
  assert.deepEqual(a.param, ['w=3', 'h=4']);
  assert.equal(a.out, 'out.png');
  assert.equal(a.clear, true);
  assert.equal(a.facing, 'east');
  assert.equal(parseArgs(['--clear', '3']).clear, '3');
  assert.deepEqual(parseArgs(['build', '--clear', 'house.json'])._, ['build', 'house.json']);
  assert.equal(parseArgs(['--dry-run']).dryRun, true);
});

test('parseCoords / parseParams', () => {
  assert.deepEqual(parseCoords('1,2,3'), [1, 2, 3]);
  assert.deepEqual(parseCoords('1 -2 3.7'), [1, -2, 3]);
  assert.deepEqual(parseCoords('~5,~,~-2', [10.5, 64, 20.2]), [15, 64, 18]);
  assert.throws(() => parseCoords('1,2'), /x,y,z/);
  assert.throws(() => parseCoords('~,1,2'), /reference/);
  assert.deepEqual(parseParams(['a=1', 'b=x=y'], '{"c":true}'), { c: true, a: '1', b: 'x=y' });
  assert.throws(() => parseParams(['oops']), /key=value/);
});

test('resolveConfig precedence: flags > env > file > defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcb-cfg-'));
  const file = path.join(dir, 'mcb.config.json');
  fs.writeFileSync(file, JSON.stringify({ port: 25570, host: 'example.org', serverDir: 'srv', rconPassword: 'f' }));
  const saved = { ...process.env };
  try {
    process.env.MCB_PORT = '25580';
    delete process.env.MCB_HOST;
    const c = resolveConfig({ config: file, username: 'Bob' });
    assert.equal(c.port, 25580);
    assert.equal(c.host, 'example.org');
    assert.equal(c.username, 'Bob');
    assert.equal(c.auth, 'offline');
    assert.equal(c.serverDir, path.join(dir, 'srv'));
    assert.equal(c._sources.port, 'env');
    assert.equal(c._sources.username, 'flag');
    assert.equal(c._sources.host, 'config');
  } finally {
    process.env = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('offline UUIDs match what Paper computes', () => {
  assert.equal(offlineUuid('BuilderBot'), 'aca92e88-7ccc-3881-a428-de1cb0f4eb55');
  assert.equal(offlineUuid('E2EAlice'), 'edaaa658-5133-3539-bbdf-9c20bde91965');
});

test('server.properties read/write keeps other keys and escapes colons', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcb-props-'));
  const f = path.join(dir, 'server.properties');
  fs.writeFileSync(f, '#c\nmotd=hi\nlevel-type=minecraft\\:normal\n');
  writeProperties(f, { 'server-port': 25570, 'level-type': 'minecraft:flat' });
  const p = readProperties(f);
  assert.equal(p.get('motd'), 'hi');
  assert.equal(p.get('server-port'), '25570');
  assert.equal(p.get('level-type'), 'minecraft:flat');
  assert.match(fs.readFileSync(f, 'utf8'), /level-type=minecraft\\:flat/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseJavaVersion handles old and new formats', () => {
  assert.equal(parseJavaVersion('openjdk version "21.0.12.1" 2026-08-18 LTS'), 21);
  assert.equal(parseJavaVersion('java version "1.8.0_402"'), 8);
  assert.equal(parseJavaVersion('openjdk version "25" 2025-09-16'), 25);
  assert.equal(parseJavaVersion('garbage'), null);
});

test('snapshot encode/decode round-trips explicit air and unknown cells', () => {
  const s = new Structure().fill(0, 0, 0, 3, 2, 3, 'stone').set(1, 1, 1, 'air').set(2, 2, 2, 'oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]');
  s.set(3, 2, 3, null);
  const buf = encodeSnapshot({ id: 't', name: 't', box: [0, 0, 0, 3, 2, 3], structure: s });
  const d = decodeSnapshot(buf);
  let same = d.structure.count === s.count;
  s.forEach((x, y, z, b) => { if (d.structure.get(x, y, z) !== b) same = false; });
  assert.ok(same);
  assert.equal(d.structure.get(3, 2, 3), null);
});

test('CLI: help, unknown command, info --json, validate errors, dry-run build', () => {
  const h = mcb(['--help']);
  assert.equal(h.status, 0);
  assert.match(h.stdout, /USAGE/);
  const bh = mcb(['build', '--help']);
  assert.equal(bh.status, 0);
  assert.match(bh.stdout, /--anchor corner/);
  assert.match(bh.stdout, /--side north\|east\|south\|west/);
  assert.match(mcb(['help', 'watch']).stdout, /One undo id covers the whole session/);
  assert.equal(mcb(['frobnicate']).status, 2);
  const info = mcb(['info', 'examples/blueprints/cottage.json', '--json']);
  assert.equal(info.status, 0, info.stderr);
  const j = JSON.parse(info.stdout);
  assert.deepEqual(j.size, [11, 11, 9]);
  assert.ok(j.plan.commands > 0 && j.plan.commands < j.blocks);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcb-cli-'));
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ palette: { X: 'oak_plank' }, layers: [['XX']] }));
  const v = mcb(['validate', bad, '--json']);
  assert.equal(v.status, 1);
  assert.match(JSON.parse(v.stdout).errors[0].errors[0], /oak_planks/);
  const dry = mcb(['build', 'examples/blueprints/cottage.json', '--dry-run', '--at', '0,64,0', '--facing', 'west', '--json']);
  assert.equal(dry.status, 0, dry.stderr);
  const r = JSON.parse(dry.stdout);
  assert.equal(r.facing, 'west');
  assert.ok(r.commands.some((c) => /oak_door\[.*facing=west/.test(c)));
  const noAt = mcb(['build', path.join(ROOT, 'examples/blueprints/cottage.json')], { cwd: dir });
  assert.equal(noAt.status, 2);
  assert.match(noAt.stderr, /--at x,y,z or --near/);
  fs.rmSync(dir, { recursive: true, force: true });
});
