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

/** @returns {Promise<{ name: string, value: string } | null>} */
export async function getGamerule(transport, key) {
  const names = GAMERULES[key] ?? [key];
  const cache = resolved.get(transport) ?? {};
  const order = cache[key] ? [cache[key], ...names.filter((n) => n !== cache[key])] : names;
  for (const name of order) {
    const r = await transport.query(`gamerule ${name}`);
    const m = /currently set to:\s*(\S+)/i.exec(r.text);
    if (m) {
      cache[key] = name;
      resolved.set(transport, cache);
      return { name, value: m[1] };
    }
  }
  return null;
}

export async function setGamerule(transport, key, value) {
  const cur = await getGamerule(transport, key);
  if (!cur) return null;
  await transport.command(`gamerule ${cur.name} ${value}`, { allowErrors: true });
  return cur;
}

const JOURNAL = 'gamerules-pending.json';

/** Restore gamerules left changed by a crashed/killed earlier run (same server). */
export async function recoverGamerules(transport, journalDir) {
  if (!journalDir || transport.kind === 'dry-run') return [];
  const file = path.join(journalDir, JOURNAL);
  if (!fs.existsSync(file)) return [];
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fs.rmSync(file, { force: true }); return []; }
  if (data.server && transport.serverKey && data.server !== transport.serverKey) return [];
  for (const [name, value] of data.rules ?? []) {
    try { await transport.command(`gamerule ${name} ${value}`, { allowErrors: true }); } catch { /* ignore */ }
  }
  fs.rmSync(file, { force: true });
  return data.rules ?? [];
}

/**
 * Temporarily set gamerules while `fn` runs, restoring previous values afterwards (even on error,
 * Ctrl+C, or — through the journal in `journalDir` — a crash).
 * @param {Record<string, string|boolean|number>} settings e.g. { sendCommandFeedback: false }
 */
export async function withGamerules(transport, settings, fn, { journalDir = null } = {}) {
  const restore = [];
  const journal = journalDir ? path.join(journalDir, JOURNAL) : null;
  if (transport.kind !== 'dry-run') {
    for (const [key, value] of Object.entries(settings)) {
      try {
        const cur = await getGamerule(transport, key);
        if (cur && String(cur.value) !== String(value)) {
          restore.push([cur.name, cur.value]);
          if (journal) {
            fs.mkdirSync(journalDir, { recursive: true });
            fs.writeFileSync(journal, JSON.stringify({ server: transport.serverKey ?? null, rules: restore, at: new Date().toISOString() }));
          }
          await transport.command(`gamerule ${cur.name} ${value}`, { allowErrors: true });
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
    for (const [name, value] of restore) {
      try { await transport.command(`gamerule ${name} ${value}`, { allowErrors: true }); } catch { /* ignore */ }
    }
    if (journal && restore.length) fs.rmSync(journal, { force: true });
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
