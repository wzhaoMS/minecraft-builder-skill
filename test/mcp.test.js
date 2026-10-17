import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer, TOOLS } from '../src/mcp/server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const shed = {
  name: 'mini',
  palette: { P: 'oak_planks', D: 'oak_door[facing=south]', _: 'air' },
  layers: [['PPP', 'P_P', 'PDP'], ['PPP', 'P_P', 'P.P']],
};

test('MCP handler: initialize, tools/list, validate and dry-run build with an inline blueprint', async () => {
  const srv = createServer({ flags: {} });
  const init = await srv.handle({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.serverInfo.name, 'minecraft-builder');
  assert.ok(init.capabilities.tools);
  const list = await srv.handle({ id: 2, method: 'tools/list' });
  assert.deepEqual(list.tools.map((t) => t.name), TOOLS.map((t) => t.name));
  for (const t of list.tools) assert.equal(t.inputSchema.type, 'object');
  const v = await srv.handle({ id: 3, method: 'tools/call', params: { name: 'mc_validate', arguments: { blueprint: shed } } });
  const vr = JSON.parse(v.content[0].text);
  assert.equal(vr.ok, true);
  assert.ok(vr.fixes.some((f) => /oak_door/.test(f.message)));
  const b = await srv.handle({ id: 4, method: 'tools/call', params: { name: 'mc_build', arguments: { blueprint: JSON.stringify(shed), dryRun: true, at: [10, 64, 10], facing: 'east' } } });
  const br = JSON.parse(b.content[0].text);
  assert.equal(br.ok, true);
  assert.equal(br.facing, 'east');
  assert.ok(br.commands.length > 0);
  const bad = await srv.handle({ id: 5, method: 'tools/call', params: { name: 'mc_validate', arguments: { blueprint: { layers: [['Q']] } } } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /not in the palette/);
  assert.equal(await srv.handle({ method: 'notifications/initialized' }), undefined);
  await assert.rejects(() => srv.handle({ id: 6, method: 'nope' }), /Method not found/);
  await srv.close();
});

test('MCP stdio: newline-delimited JSON-RPC over a child process', async () => {
  const child = spawn(process.execPath, [path.join(ROOT, 'bin/mcb.js'), 'mcp'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, MCB_CONFIG: '' } });
  const lines = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
  });
  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mc_validate', arguments: { blueprint: shed } } });
  const t0 = Date.now();
  while (lines.length < 3 && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 50));
  child.stdin.end();
  await new Promise((r) => child.once('exit', r));
  assert.equal(lines.length, 3, 'three responses (the notification gets none)');
  assert.deepEqual(lines.map((l) => l.id).sort(), [1, 2, 3]);
  assert.ok(lines.every((l) => l.jsonrpc === '2.0' && l.result));
});
