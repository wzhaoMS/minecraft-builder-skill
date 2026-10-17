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
  try {
    return await connectBot(botCfg);
  } catch (e) {
    if (cfg.rconPassword && ['KICKED', 'ENDED', 'CONNECT_TIMEOUT'].includes(e.code)) {
      log(`bot could not join (${e.message}) — falling back to RCON`);
      return connectRcon({ host: cfg.host, rconPort: cfg.rconPort, rconPassword: cfg.rconPassword, version: cfg.version, log });
    }
    throw e;
  }
}
