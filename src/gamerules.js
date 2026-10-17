/**
 * Version-tolerant gamerules. Minecraft 1.21.11 renamed rules to snake_case
 * (doDaylightCycle → advance_time, logAdminCommands → log_admin_commands, …); old names now error.
 * We try the new name first and fall back to the legacy one.
 */
export const GAMERULES = {
  logAdminCommands: ['log_admin_commands', 'logAdminCommands'],
  sendCommandFeedback: ['send_command_feedback', 'sendCommandFeedback'],
  commandBlockOutput: ['command_block_output', 'commandBlockOutput'],
  doDaylightCycle: ['advance_time', 'doDaylightCycle'],
  doWeatherCycle: ['advance_weather', 'doWeatherCycle'],
  doMobSpawning: ['spawn_mobs', 'doMobSpawning'],
  maxBlockModifications: ['max_block_modifications', 'commandModificationBlockLimit'],
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

/**
 * Temporarily set gamerules while `fn` runs, restoring previous values afterwards (even on error).
 * @param {Record<string, string|boolean|number>} settings e.g. { logAdminCommands: false }
 */
export async function withGamerules(transport, settings, fn) {
  const restore = [];
  if (transport.kind !== 'dry-run') {
    for (const [key, value] of Object.entries(settings)) {
      try {
        const cur = await getGamerule(transport, key);
        if (cur && String(cur.value) !== String(value)) {
          await transport.command(`gamerule ${cur.name} ${value}`, { allowErrors: true });
          restore.push([cur.name, cur.value]);
        }
      } catch {
        // non-fatal
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
  };
  // Ctrl+C mid-build must not leave the server with changed gamerules.
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
