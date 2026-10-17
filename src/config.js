/**
 * Configuration resolution. Precedence: CLI flags > environment (MCB_*) > mcb.config.json > defaults.
 *
 * mcb.config.json is looked up in the current directory and then in its parents (or --config path).
 * `mcb server setup` writes one next to your server so later commands "just work".
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = Object.freeze({
  host: '127.0.0.1',
  port: 25565,
  username: 'BuilderBot',
  auth: 'offline',
  version: null, // auto-detect
  transport: 'auto', // auto | bot | rcon
  rconPort: 25575,
  rconPassword: null,
  serverDir: null,
  player: null,
  maxRate: 250,
});

const ENV = {
  host: 'MCB_HOST', port: 'MCB_PORT', username: 'MCB_USERNAME', auth: 'MCB_AUTH', version: 'MCB_VERSION',
  transport: 'MCB_TRANSPORT', rconPort: 'MCB_RCON_PORT', rconPassword: 'MCB_RCON_PASSWORD', serverDir: 'MCB_SERVER_DIR',
  player: 'MCB_PLAYER', maxRate: 'MCB_MAX_RATE',
};

export const CONFIG_FILE = 'mcb.config.json';

export function findConfigFile(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const f = path.join(dir, CONFIG_FILE);
    if (fs.existsSync(f)) return f;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readConfigFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (data.serverDir && !path.isAbsolute(data.serverDir)) data.serverDir = path.resolve(path.dirname(file), data.serverDir);
    return data;
  } catch (e) {
    throw new Error(`Cannot read ${file}: ${e.message}`);
  }
}

/**
 * @param {object} flags parsed CLI flags (camelCase keys)
 * @returns {object} resolved config with `_sources` describing where values came from
 */
export function resolveConfig(flags = {}) {
  const explicit = flags.config ? path.resolve(flags.config) : (process.env.MCB_CONFIG || null);
  if (explicit && !fs.existsSync(explicit)) {
    // an explicitly chosen config that can't be read must never fall back to another server
    throw Object.assign(new Error(`Config file not found: ${explicit}`), {
      code: 'CONFIG_NOT_FOUND', hint: 'Fix the --config path / MCB_CONFIG, or remove it to use mcb.config.json discovery.',
    });
  }
  const file = explicit ?? findConfigFile();
  const fromFile = file && fs.existsSync(file) ? readConfigFile(file) : {};
  const cfg = { ...DEFAULTS };
  const sources = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (flags[k] !== undefined && flags[k] !== null) { cfg[k] = flags[k]; sources[k] = 'flag'; continue; }
    const env = process.env[ENV[k]];
    if (env !== undefined && env !== '') { cfg[k] = env; sources[k] = 'env'; continue; }
    if (fromFile[k] !== undefined && fromFile[k] !== null) { cfg[k] = fromFile[k]; sources[k] = 'config'; continue; }
    sources[k] = 'default';
  }
  cfg.port = Number(cfg.port);
  cfg.rconPort = Number(cfg.rconPort);
  cfg.maxRate = Number(cfg.maxRate);
  if (cfg.version === 'auto' || cfg.version === '') cfg.version = null;
  cfg._file = file && fs.existsSync(file) ? file : null;
  cfg._sources = sources;
  return cfg;
}

export function writeConfigFile(file, data) {
  const existing = fs.existsSync(file) ? readConfigFile(file) : {};
  const merged = { ...existing, ...data };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  return merged;
}

/** Directory for mcb state (undo snapshots, logs): ./.mcb next to the config file or cwd. */
export function stateDir(cfg) {
  const base = cfg?._file ? path.dirname(cfg._file) : process.cwd();
  return path.join(base, '.mcb');
}
