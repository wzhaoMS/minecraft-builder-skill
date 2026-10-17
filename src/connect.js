/**
 * Open the transport described by the resolved config.
 *   transport=bot   mineflayer bot (needs op; can read blocks → verify/undo/snapshot)
 *   transport=rcon  server console over RCON (fastest; no reads)
 *   transport=auto  bot, falling back to RCON when the bot can't join and RCON is configured
 */
import { connectBot } from './transport/bot.js';
import { connectRcon } from './transport/rcon.js';
import { DryRunTransport } from './transport/dry.js';

export async function openTransport(cfg, { dryRun = false, log = () => {}, prefer = null } = {}) {
  const t = await open(cfg, { dryRun, log, prefer });
  t.serverKey = normalizeServerKey(`${cfg.host}:${cfg.port}`);
  return t;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '']);

/** Online player names: the bot's tab list, or parsed from /list over RCON. */
export async function onlinePlayers(transport) {
  if (transport.listPlayers) return transport.listPlayers();
  const r = await transport.query('list');
  const m = /online:\s*(.*)$/is.exec(r.text ?? '');
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

const DIM_LABEL = { overworld: 'the Overworld', the_nether: 'the Nether', the_end: 'the End' };

/**
 * A build at absolute coordinates without a dimension goes to the overworld. If the player it is
 * for (`who`, or else everyone online) is in another dimension, return a warning saying so.
 */
export async function otherDimensionNote(transport, who = null, { flag = '--dimension' } = {}) {
  if (!transport.playerPose) return null;
  const names = who ? [who] : (await onlinePlayers(transport).catch(() => [])).filter((n) => n !== transport.username).slice(0, 5);
  if (!names.length) return null;
  const dims = [];
  for (const n of names) {
    const pose = await transport.playerPose(n).catch(() => null);
    if (pose?.dimension) dims.push(String(pose.dimension).replace(/^minecraft:/, ''));
  }
  if (!dims.length || dims.some((d) => d === 'overworld' || d !== dims[0])) return null;
  const subject = who ? `${who} is` : names.length > 1 ? `Everyone online (${names.join(', ')}) is` : `${names[0]} (online) is`;
  return `${subject} in ${DIM_LABEL[dims[0]] ?? dims[0]}, but coordinates without ${flag} are in the Overworld — add ${flag} ${dims[0]} if the build should go there`;
}

/** `host:port` with loopback spellings unified, so snapshots/journals match regardless of how the server was addressed. */
export function normalizeServerKey(key) {
  const s = String(key).trim().toLowerCase();
  const i = s.lastIndexOf(':');
  const host = i > 0 && !s.endsWith(']') ? s.slice(0, i) : s;
  const port = i > 0 && !s.endsWith(']') ? s.slice(i + 1) : '25565';
  return `${LOOPBACK.has(host) ? '127.0.0.1' : host}:${port}`;
}

async function open(cfg, { dryRun, log, prefer }) {
  if (dryRun) return new DryRunTransport({ version: cfg.version, log });
  const kind = prefer ?? cfg.transport ?? 'auto';
  const botCfg = {
    host: cfg.host, port: cfg.port, username: cfg.username, auth: cfg.auth, version: cfg.version || undefined,
    maxRate: cfg.maxRate, log,
  };
  if (kind === 'rcon') {
    if (!cfg.rconPassword) {
      throw Object.assign(new Error('RCON transport selected but no RCON password configured'), {
        hint: 'Pass --rcon-password (or set it in mcb.config.json / MCB_RCON_PASSWORD).',
      });
    }
    return connectRcon({ host: cfg.host, rconPort: cfg.rconPort, rconPassword: cfg.rconPassword, version: cfg.version, log });
  }
  if (kind === 'bot') return connectBot(botCfg);
  let bot;
  try {
    bot = await connectBot(botCfg);
  } catch (e) {
    if (cfg.rconPassword && ['KICKED', 'ENDED', 'CONNECT_TIMEOUT'].includes(e.code)) {
      log(`bot could not join (${e.message}) — falling back to RCON`);
      const r = await connectRcon({ host: cfg.host, rconPort: cfg.rconPort, rconPassword: cfg.rconPassword, version: cfg.version, log });
      r.notes = [`The bot could not join (${e.message}), so this ran over RCON: no undo snapshot or verify.`];
      return r;
    }
    throw e;
  }
  if (bot.isOp === false && cfg.rconPassword) {
    // a non-op bot can't build at all; the console can — but without reads (verify/undo)
    log(`${bot.username} is not an operator — building over RCON instead (no undo/verify; \`mcb server op ${bot.username}\` enables them)`);
    await bot.close();
    const r = await connectRcon({ host: cfg.host, rconPort: cfg.rconPort, rconPassword: cfg.rconPassword, version: cfg.version, log });
    r.notes = [`${bot.username} is not an operator, so this ran over RCON without undo or verify — run \`mcb server op ${bot.username}\` to get them back.`];
    return r;
  }
  return bot;
}
