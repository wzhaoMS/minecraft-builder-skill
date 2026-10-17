/**
 * Classifies server feedback for commands sent by a bot (JSON chat components with translate keys)
 * or over RCON (plain English text).
 */

/** First translate key found depth-first in a chat component. */
export function translateKey(json) {
  if (!json || typeof json !== 'object') return null;
  if (typeof json.translate === 'string') return json.translate;
  for (const k of ['extra', 'with']) {
    if (Array.isArray(json[k])) {
      for (const c of json[k]) {
        const t = translateKey(c);
        if (t) return t;
      }
    }
  }
  return null;
}

/** The command echoed in an error's click_event (present for parse errors). */
export function echoedCommand(json) {
  if (!json || typeof json !== 'object') return null;
  const ce = json.click_event ?? json.clickEvent;
  if (ce && typeof ce.command === 'string') return ce.command.replace(/^\//, '');
  for (const k of ['extra', 'with']) {
    if (Array.isArray(json[k])) {
      for (const c of json[k]) {
        const t = echoedCommand(c);
        if (t) return t;
      }
    }
  }
  return null;
}

// Results that mean "nothing changed because it was already like that" — fine for idempotent builds.
const NOOP_KEYS = new Set(['commands.fill.failed', 'commands.setblock.failed', 'commands.clone.failed']);
const RETRY_KEYS = new Set(['argument.pos.unloaded']);

/**
 * @returns {'ok'|'noop'|'retry'|'error'|'info'}
 */
export function classifyKey(key) {
  if (!key) return 'info';
  if (NOOP_KEYS.has(key)) return 'noop';
  if (RETRY_KEYS.has(key)) return 'retry';
  if (/\.success|^commands\.[a-z_]+\.(set|query|added|removed|single|multiple|passed)/.test(key) || key.startsWith('commands.gamerule.')) return 'ok';
  if (key.startsWith('argument.') || key.startsWith('command.') || key.startsWith('parsing.') || key.startsWith('permissions.') ||
      /\.(failed|toobig|invalid|unknown|notfound|error)/.test(key) || key.includes('.failed') || key.includes('toobig')) return 'error';
  return 'info';
}

/** Human explanation + fix for common error keys. */
export function explainKey(key, text = '') {
  switch (key) {
    case 'command.unknown.command':
      return 'Unknown command — the bot is probably NOT an operator. Fix: run `op <botname>` in the server console (or `mcb server op <name>`).';
    case 'argument.pos.unloaded':
      return 'Target chunks are not loaded. The builder teleports the bot near each tile; for RCON it uses /forceload.';
    case 'argument.block.id.invalid':
      return `Invalid block id. ${text} Run \`mcb validate <blueprint>\` to find typos.`;
    case 'argument.block.property.invalid':
    case 'argument.block.property.unknown':
      return `Invalid block property. ${text}`;
    case 'commands.fill.toobig':
      return 'Fill volume exceeds the server limit (gamerule max_block_modifications). Lower --max-volume.';
    case 'argument.pos.outofworld':
      return 'Position outside the world height limits (-64..319 in the overworld).';
    case 'argument.entity.notfound.player':
      return 'Player not found (is the player online? names are case-sensitive).';
    default:
      return text;
  }
}

const RCON_NOOP = /^(No blocks were filled|Could not set the block)/i;
const RCON_RETRY = /That position is not loaded/i;
const RCON_ERROR = /(Unknown or incomplete command|Incorrect argument|Unknown block|does not (have|accept)|Expected |Invalid |Too many blocks|out of this world|Cannot |No player was found|No entity was found|<--\[HERE\])/i;

/** @returns {'ok'|'noop'|'retry'|'error'} */
export function classifyRconText(text) {
  if (RCON_NOOP.test(text)) return 'noop';
  if (RCON_RETRY.test(text)) return 'retry';
  if (RCON_ERROR.test(text)) return 'error';
  return 'ok';
}
