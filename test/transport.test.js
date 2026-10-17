import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BotTransport } from '../src/transport/bot.js';
import { translateKey, classifyKey, classifyRconText, echoedCommand } from '../src/transport/feedback.js';
import { getGamerule, withGamerules } from '../src/gamerules.js';
import { DryRunTransport } from '../src/transport/dry.js';

function chatMsg(json, text) {
  return { json, toString: () => text ?? json.text ?? '' };
}

/** A fake server+bot: executes "commands" in order and replies like Paper 1.21.11 does. */
function fakeBot({ unloadedOnce = new Set(), log = [] } = {}) {
  const bot = new EventEmitter();
  bot._client = new EventEmitter();
  bot.version = '1.21.11';
  bot.username = 'BuilderBot';
  bot.game = { gameMode: 'creative' };
  bot.creative = { startFlying() {} };
  const queue = [];
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    for (const m of queue.splice(0)) bot.emit('message', m);
  };
  const reply = (m) => { queue.push(m); if (!scheduled) { scheduled = true; setImmediate(flush); } };
  bot.chat = (raw) => {
    log.push(raw);
    const c = raw.replace(/^\/execute in \S+ run /, '/'); // gamerules are addressed to a world
    const sync = /^\/tellraw @s "(mcb:sync:[a-z0-9]+:\d+)"$/.exec(c);
    if (sync) return reply(chatMsg({ text: sync[1] }, sync[1]));
    if (c.includes('BAD')) return reply(chatMsg({ color: 'red', extra: [{ translate: 'argument.block.id.invalid', with: ['minecraft:BAD'] }, { click_event: { action: 'suggest_command', command: c } }], text: '' }, 'Unknown block type'));
    if (unloadedOnce.has(c)) { unloadedOnce.delete(c); return reply(chatMsg({ color: 'red', extra: [{ translate: 'argument.pos.unloaded' }], text: '' }, 'That position is not loaded')); }
    if (c.startsWith('/fill') && c.includes('same')) return reply(chatMsg({ color: 'red', extra: [{ translate: 'commands.fill.failed' }], text: '' }, 'No blocks were filled'));
    if (c.startsWith('/fill')) return reply(chatMsg({ translate: 'commands.fill.success', with: [1] }, 'Successfully filled 1 block(s)'));
    if (c.startsWith('/gamerule log_admin_commands')) {
      const v = c.split(' ')[2];
      return reply(chatMsg({ translate: v ? 'commands.gamerule.set' : 'commands.gamerule.query', with: ['log_admin_commands', v ?? 'true'] }, v ? `Gamerule log_admin_commands is now set to: ${v}` : 'Gamerule log_admin_commands is currently set to: true'));
    }
    if (c.startsWith('/gamerule logAdminCommands') || c.startsWith('/gamerule max_block')) return reply(chatMsg({ color: 'red', extra: [{ translate: 'command.unknown.argument' }], text: '' }, 'Incorrect argument for command'));
    // /gamemode etc: no feedback at all
  };
  return bot;
}

test('feedback helpers find nested translate keys and echoed commands', () => {
  const j = { color: 'red', extra: [{ translate: 'commands.fill.failed' }], text: '' };
  assert.equal(translateKey(j), 'commands.fill.failed');
  assert.equal(classifyKey('commands.fill.failed'), 'noop');
  assert.equal(classifyKey('commands.fill.success'), 'ok');
  assert.equal(classifyKey('argument.pos.unloaded'), 'retry');
  assert.equal(classifyKey('argument.block.id.invalid'), 'error');
  assert.equal(classifyKey('command.unknown.command'), 'error');
  assert.equal(classifyKey('commands.gamerule.query'), 'ok');
  assert.equal(classifyKey('multiplayer.player.joined'), 'info');
  assert.equal(echoedCommand({ extra: [{ click_event: { command: '/setblock 1 2 3 foo' } }] }), 'setblock 1 2 3 foo');
  assert.equal(classifyRconText('Successfully filled 9 block(s)'), 'ok');
  assert.equal(classifyRconText('No blocks were filled'), 'noop');
  assert.equal(classifyRconText('That position is not loaded'), 'retry');
  assert.equal(classifyRconText("Unknown block type 'minecraft:foo'\n...<--[HERE]"), 'error');
  assert.equal(classifyRconText('Changed the block at 1, 2, 3'), 'ok');
});

test('BotTransport.run: barriers attribute errors to batches, count noops, never desync', async () => {
  const log = [];
  const t = new BotTransport(fakeBot({ log }), { log: () => {}, opLevel: { value: 4 }, batchSize: 7, window: 3, maxRate: 100000 });
  const cmds = [];
  for (let i = 0; i < 100; i++) cmds.push(`fill ${i} 0 0 ${i} 0 0 ${i % 10 === 0 ? 'BAD' : i % 7 === 0 ? 'same' : 'stone'}`);
  cmds.splice(50, 0, 'gamemode creative'); // emits no feedback at all
  let batches = 0;
  const r = await t.run(cmds, { onBatch: () => batches++ });
  assert.equal(r.sent, cmds.length);
  assert.equal(r.errors.length, 10);
  assert.ok(r.errors.every((e) => e.key === 'argument.block.id.invalid' && e.cmd.includes('BAD')));
  assert.equal(r.noops, cmds.filter((c) => c.includes('same')).length);
  assert.equal(batches, Math.ceil(cmds.length / 7));
  assert.equal(t._queue.length, 0);
  // command order on the wire is preserved
  const sent = log.filter((c) => !c.startsWith('/tellraw')).map((c) => c.slice(1));
  assert.deepEqual(sent, cmds);
});

test('BotTransport.run retries batches that hit unloaded chunks', async () => {
  const unloaded = new Set(['/fill 3 0 0 3 0 0 stone']);
  const t = new BotTransport(fakeBot({ unloadedOnce: unloaded }), { log: () => {}, opLevel: { value: 4 }, batchSize: 4, maxRate: 100000 });
  let loads = 0;
  const cmds = Array.from({ length: 10 }, (_, i) => `fill ${i} 0 0 ${i} 0 0 stone`);
  const r = await t.run(cmds, { ensureLoaded: async () => { loads++; } });
  assert.equal(r.errors.length, 0);
  assert.equal(r.sent, 10);
  assert.equal(loads, 1);
});

test('BotTransport.command collects feedback; query parses text', async () => {
  const t = new BotTransport(fakeBot(), { log: () => {}, opLevel: { value: 4 }, maxRate: 100000 });
  const r = await t.command('fill 0 0 0 1 1 1 stone');
  assert.equal(r.errors.length, 0);
  assert.equal(r.messages[0].key, 'commands.fill.success');
  await assert.rejects(() => t.command('fill 0 0 0 0 0 0 BAD'), /Command failed/);
  const g = await getGamerule(t, 'logAdminCommands');
  assert.deepEqual(g, { name: 'log_admin_commands', value: 'true' });
});

test('withGamerules sets and restores values (in an explicitly named world)', async () => {
  const log = [];
  const t = new BotTransport(fakeBot({ log }), { log: () => {}, opLevel: { value: 4 }, maxRate: 100000 });
  await withGamerules(t, { logAdminCommands: false }, async () => {
    assert.ok(log.includes('/execute in minecraft:overworld run gamerule log_admin_commands false'), log.join('\n'));
  });
  assert.equal(log.filter((c) => /gamerule log_admin_commands \w+$/.test(c)).pop(), '/execute in minecraft:overworld run gamerule log_admin_commands true');
});

test('rate limiter caps commands per second', async () => {
  const t = new BotTransport(fakeBot(), { log: () => {}, opLevel: { value: 4 }, batchSize: 10, maxRate: 40 });
  const t0 = Date.now();
  await t.run(Array.from({ length: 60 }, (_, i) => `fill ${i} 0 0 ${i} 0 0 stone`));
  assert.ok(Date.now() - t0 >= 900, 'should take ~1s+ for 66 packets at 40/s');
});

test('dry-run transport records commands', async () => {
  const d = new DryRunTransport();
  await d.run(['fill 0 0 0 1 1 1 stone', '/setblock 0 0 0 air']);
  assert.deepEqual(d.commands, ['fill 0 0 0 1 1 1 stone', 'setblock 0 0 0 air']);
});
