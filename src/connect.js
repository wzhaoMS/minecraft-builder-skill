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
