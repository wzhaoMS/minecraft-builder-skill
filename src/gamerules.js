/**
 * Version-tolerant gamerules. Minecraft 1.21.11 renamed rules to snake_case
 * (doDaylightCycle → advance_time, sendCommandFeedback → send_command_feedback, …) and the old
 * names now error, so we try the new name first and fall back to the legacy one.
 *
 * Quiet builds: every successful command an operator runs is echoed to all OTHER operators'
 * chat ("[BuilderBot: Changed the block at …]") unless `send_command_feedback` is false
 * (`log_admin_commands` only controls the server log). Builds therefore switch
 * send_command_feedback off while they run and restore it afterwards — also on Ctrl+C, and,
 * via a small journal file, on the next run after a crash.
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeServerKey } from './connect.js';

export const GAMERULES = {
  logAdminCommands: ['log_admin_commands', 'logAdminCommands'],
  sendCommandFeedback: ['send_command_feedback', 'sendCommandFeedback'],
  commandBlockOutput: ['command_block_output', 'commandBlockOutput'],
  doDaylightCycle: ['advance_time', 'doDaylightCycle'],
  doWeatherCycle: ['advance_weather', 'doWeatherCycle'],
  doMobSpawning: ['spawn_mobs', 'doMobSpawning'],
  maxBlockModifications: ['max_block_modifications', 'commandModificationBlockLimit'],
  maxCommandChainLength: ['max_command_sequence_length', 'maxCommandChainLength'],
};

const resolved = new WeakMap(); // transport → { key: name }
const INT_RULES = new Set(['maxBlockModifications', 'maxCommandChainLength']);

/** @returns {Promise<{ name: string, value: string } | null>} */
export async function getGamerule(transport, key) {
  const names = GAMERULES[key] ?? [key];
  const cache = resolved.get(transport) ?? {};
  const order = cache[key] ? [cache[key], ...names.filter((n) => n !== cache[key])] : names;
  for (const name of order) {
    const r = await transport.query(inDimension(transport, `gamerule ${name}`));
    const m = /currently set to:\s*(\S+)/i.exec(r.text);
    let value = m ? m[1] : null;
    if (value == null && !r.errors?.length && transport.queryResult) {
      // no output but no error: a bot can't see command output while send_command_feedback is off
      const v = await transport.queryResult(inDimension(transport, `gamerule ${name}`)).catch(() => null);
      if (v?.ok) value = INT_RULES.has(key) || !(key in GAMERULES) ? String(v.value) : String(v.value !== 0);
    }
    if (value != null) {
      cache[key] = name;
      resolved.set(transport, cache);
      return { name, value };
    }
  }
  return null;
}

export async function setGamerule(transport, key, value) {
  const cur = await getGamerule(transport, key);
  if (!cur) return null;
  await transport.command(inDimension(transport, `gamerule ${cur.name} ${value}`), { allowErrors: true });
  return cur;
}

const JOURNAL = 'gamerules-pending.json';

/** One journal per server, so a shared state directory never mixes up two servers' rules. */
function journalPath(journalDir, transport) {
  const key = transport.serverKey ? normalizeServerKey(transport.serverKey).replace(/[^a-z0-9.-]+/gi, '_') : null;
  return path.join(journalDir, key ? `gamerules-pending-${key}.json` : JOURNAL);
}

/** Paper keeps gamerules per world: address the world being built in, not the console's overworld. */
function inDimension(transport, cmd, dim = transport.dimension) {
  return dim && dim !== 'minecraft:overworld' ? `execute in ${dim} run ${cmd}` : cmd;
}

function readJournal(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { server: data.server ?? null, rules: Array.isArray(data.rules) ? data.rules : [] };
  } catch {
    return null;
  }
}

function writeJournal(file, data) {
  if (!data.rules.length) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...data, at: new Date().toISOString() }));
}

async function applyRule(transport, [name, value, dim]) {
  try {
    const r = await transport.command(inDimension(transport, `gamerule ${name} ${value}`, dim ?? null), { allowErrors: true });
    return !r.errors?.length;
  } catch {
    return false;
  }
}

const sameServer = (a, b) => !a || !b || normalizeServerKey(a) === normalizeServerKey(b);

/** Restore gamerules left changed by a crashed/killed earlier run (same server). Rules that fail to restore stay journaled. */
export async function recoverGamerules(transport, journalDir) {
  if (!journalDir || transport.kind === 'dry-run') return [];
  const done = [];
  for (const file of new Set([journalPath(journalDir, transport), path.join(journalDir, JOURNAL)])) {
    if (!fs.existsSync(file)) continue;
    const data = readJournal(file);
    if (!data) { fs.rmSync(file, { force: true }); continue; }
    if (!sameServer(data.server, transport.serverKey)) continue;
    const failed = [];
    for (const rule of data.rules) (await applyRule(transport, rule) ? done : failed).push(rule);
    writeJournal(file, { server: data.server, rules: failed });
  }
  return done;
}

/**
 * Temporarily set gamerules while `fn` runs, restoring previous values afterwards (even on error,
 * Ctrl+C, or — through the journal in `journalDir` — a crash).
 * @param {Record<string, string|boolean|number>} settings e.g. { sendCommandFeedback: false }
 */
export async function withGamerules(transport, settings, fn, { journalDir = null } = {}) {
  const restore = [];
  const journal = journalDir ? journalPath(journalDir, transport) : null;
  const dim = transport.dimension ?? null;
  if (transport.kind !== 'dry-run') {
    if (journal) await recoverGamerules(transport, journalDir);
    for (const [key, value] of Object.entries(settings)) {
      try {
        const cur = await getGamerule(transport, key);
        if (cur && String(cur.value) !== String(value)) {
          const prev = journal ? readJournal(journal) : null;
          const keep = prev && sameServer(prev.server, transport.serverKey) ? prev.rules : [];
          const same = ([n, , d]) => n === cur.name && (d ?? null) === dim;
          // an earlier crashed run may already have changed this rule: its journaled value is the real original
          const original = keep.find(same);
          restore.push([cur.name, original ? original[1] : cur.value, dim]);
          if (journal) writeJournal(journal, { server: transport.serverKey ?? null, rules: [...keep.filter((r) => !same(r)), restore.at(-1)] });
          await transport.command(inDimension(transport, `gamerule ${cur.name} ${value}`, dim), { allowErrors: true });
        }
      } catch {
        // non-fatal: building still works, players may just see command echo
      }
    }
  }
  let restored = false;
  const restoreAll = async () => {
    if (restored) return;
    restored = true;
    const failed = [];
    for (const rule of restore) if (!(await applyRule(transport, rule))) failed.push(rule);
    if (journal && restore.length) {
      // keep anything we could not restore (and other runs' entries) so the next run retries it
      const prev = readJournal(journal);
      const others = (prev?.rules ?? []).filter(([n, , d]) => !restore.some(([rn, , rd]) => rn === n && (rd ?? null) === (d ?? null)));
      writeJournal(journal, { server: transport.serverKey ?? null, rules: [...others, ...failed] });
    }
    // retry whatever an earlier interrupted run left behind (its restore may have failed at the start)
    if (journal && fs.existsSync(journal) && !failed.length) await recoverGamerules(transport, journalDir).catch(() => {});
    if (failed.length) transport.log?.(`warning: could not restore gamerule(s) ${failed.map(([n, v]) => `${n}=${v}`).join(', ')} — they will be retried on the next run`);
  };
  const onSignal = () => { restoreAll().finally(() => process.exit(130)); };
  if (restore.length) { process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal); }
  try {
    return await fn();
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await restoreAll();
  }
}
