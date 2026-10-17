/**
 * Mineflayer transport: sends commands as an operator bot, with acknowledged, rate-limited batches.
 *
 * Reliability model
 *  - After every batch of commands we send `/tellraw @s "mcb:sync:<nonce>:<n>"`. The server runs a
 *    player's commands in order, so receiving that message means every earlier command has run.
 *    Errors that arrive before it belong to that batch (not every command emits feedback, so a FIFO
 *    of per-command replies would desync — barriers don't).
 *  - At most `window` batches are in flight and the send rate is capped (Paper kicks above
 *    500 packets/s averaged over 7 s).
 *  - "That position is not loaded" errors trigger a chunk wait + batch retry (fills are idempotent).
 */
import { createRequire } from 'node:module';
import { translateKey, classifyKey, echoedCommand, explainKey } from './feedback.js';
import { formatBlock } from '../core/blockstate.js';

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Resolve once: require() re-runs module resolution (filesystem stats) on every call, which is
// ruinous inside per-block loops.
let VecClass = null;
const Vec3 = () => (VecClass ??= require('vec3').Vec3);

export class TransportError extends Error {
  constructor(message, { code, hint } = {}) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

/**
 * @param {{ host?: string, port?: number, username?: string, auth?: string, version?: string|false,
 *           connectTimeoutMs?: number, log?: Function }} cfg
 */
export async function connectBot(cfg = {}) {
  const { bot, opLevel } = await spawnBot(cfg);
  const t = new BotTransport(bot, { ...cfg, log: cfg.log ?? (() => {}), opLevel });
  await t._init();
  return t;
}

/** Create a mineflayer bot and wait until it has spawned (with actionable errors). */
async function spawnBot(cfg) {
  // Paper throttles reconnects from one address (connection-throttle, 4 s) and a stale session of
  // the same name can bounce the first attempt: wait and retry those instead of giving up.
  for (let attempt = 0; ; attempt++) {
    try {
      return await spawnBotOnce(cfg);
    } catch (e) {
      if (e.code !== 'KICKED' || !e.transient || attempt >= 2) throw e;
      const wait = attempt === 0 ? 2500 : 5000;
      (cfg.log ?? (() => {}))(`join refused (${e.message.replace(/^Kicked while joining: /, '')}) — retrying in ${wait / 1000} s`);
      await sleep(wait);
    }
  }
}

async function spawnBotOnce(cfg) {
  const mineflayer = require('mineflayer');
  const log = cfg.log ?? (() => {});
  const opts = {
    host: cfg.host ?? '127.0.0.1',
    port: Number(cfg.port ?? 25565),
    username: cfg.username ?? 'BuilderBot',
    auth: cfg.auth ?? 'offline',
    hideErrors: true,
    checkTimeoutInterval: 60_000,
  };
  if (cfg.version) opts.version = cfg.version;
  log(`connecting to ${opts.host}:${opts.port} as ${opts.username} (${opts.auth})…`);
  const bot = mineflayer.createBot(opts);
  bot.__mcbChunks = trackChunks(bot);
  const opLevel = { value: null };
  bot._client.on('entity_status', (p) => {
    if (bot.entity && p.entityId === bot.entity.id && p.entityStatus >= 24 && p.entityStatus <= 28) {
      opLevel.value = p.entityStatus - 24;
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new TransportError(`Timed out connecting to ${opts.host}:${opts.port}`, {
      code: 'CONNECT_TIMEOUT', hint: 'Is the server running? Check with `mcb doctor` / `mcb server status`.',
    })), cfg.connectTimeoutMs ?? 30_000);
    const done = (err) => {
      clearTimeout(timer);
      bot.removeListener('spawn', onSpawn);
      bot.removeListener('kicked', onKick);
      bot.removeListener('error', onError);
      bot.removeListener('end', onEnd);
      if (err) { try { bot.end(); } catch { /* ignore */ } reject(err); } else resolve();
    };
    const onSpawn = () => done();
    const onKick = (reason) => {
      const text = kickText(reason) || 'no reason given';
      let hint = '';
      if (/whitelist/i.test(text)) hint = `Whitelist the bot: run \`whitelist add ${opts.username}\` in the server console.`;
      else if (/outdated|incompatible|version/i.test(text)) hint = 'Version mismatch — omit --version to auto-detect, or use a server version mineflayer supports.';
      else if (/authenticat|premium|online/i.test(text)) hint = 'Server is in online-mode: use --auth microsoft or set online-mode=false for a local build server.';
      else if (/banned/i.test(text)) hint = `The bot is banned: run \`pardon ${opts.username}\` in the server console.`;
      const transient = /throttl|wait before|duplicate_login|logged in from another location|no reason given/i.test(text);
      done(Object.assign(new TransportError(`Kicked while joining: ${text}`, { code: 'KICKED', hint }), { transient }));
    };
    const onError = (err) => {
      const hint = err.code === 'ECONNREFUSED'
        ? 'Nothing is listening there. Start the server (`mcb server start`) or check host/port.'
        : /unsupported protocol version|not supported/i.test(err.message) ? 'Unsupported server version for mineflayer (max 26.1).' : '';
      done(new TransportError(`Connection error: ${err.message}`, { code: err.code ?? 'CONNECT_ERROR', hint }));
    };
    const onEnd = (reason) => done(new TransportError(`Disconnected while joining (${reason})`, { code: 'ENDED' }));
    bot.once('spawn', onSpawn);
    bot.once('kicked', onKick);
    bot.once('error', onError);
    bot.once('end', onEnd);
  });
  return { bot, opLevel };
}

/**
 * Remember which chunk columns arrived with real block data, per world object. mineflayer also
 * creates empty placeholder columns when a light update precedes the chunk; those must not be
 * read as "all air" (that would corrupt undo snapshots and blind the container check).
 */
function trackChunks(bot) {
  let world = null;
  const loaded = new Set();
  const sync = (w) => { if (w !== world) { loaded.clear(); world = w; } };
  const add = (cx, cz) => { sync(bot.world); loaded.add(`${cx},${cz}`); };
  // mineflayer's own handlers were registered first, so the column is in bot.world by now
  bot._client.on('map_chunk', (p) => add(p.x, p.z));
  bot._client.on('map_chunk_bulk', (p) => { for (const m of p.meta ?? []) add(m.x, m.z); });
  bot._client.on('unload_chunk', (p) => { sync(bot.world); loaded.delete(`${p.chunkX},${p.chunkZ}`); });
  return {
    has(w, cx, cz) {
      sync(w);
      return loaded.has(`${cx},${cz}`);
    },
  };
}

function kickText(reason) {
  if (typeof reason === 'string') {
    try { return flattenText(JSON.parse(reason)); } catch { return reason; }
  }
  return flattenText(simplifyNbt(reason));
}

/** prismarine-nbt tagged value ({ type, value }) → plain JS (1.20.3+ sends text components as NBT). */
function simplifyNbt(v) {
  if (!v || typeof v !== 'object' || !('type' in v) || !('value' in v)) return v;
  if (v.type === 'compound') return Object.fromEntries(Object.entries(v.value).map(([k, x]) => [k, simplifyNbt(x)]));
  if (v.type === 'list') return (v.value?.value ?? []).map((x) => simplifyNbt({ type: v.value.type, value: x }));
  return v.value;
}

function flattenText(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(flattenText).join('');
  let s = (c.text ?? '') + (c.translate ?? '');
  if (c.with) s += ' ' + c.with.map(flattenText).join(' ');
  if (c.extra) s += c.extra.map(flattenText).join('');
  return s;
}

export class BotTransport {
  constructor(bot, cfg) {
    this.kind = 'bot';
    this.canRead = true;
    this.bot = bot;
    this.cfg = cfg;
    this.log = cfg.log;
    this.opLevel = cfg.opLevel;
    this.maxRate = cfg.maxRate ?? 250; // commands per second
    this.batchSize = cfg.batchSize ?? 48;
    this.window = cfg.window ?? 3;
    this.nonce = Math.random().toString(36).slice(2, 8);
    this.seq = 0;
    this.closed = false;
    this.endReason = null;
    // the world reads and teleports refer to; builds set it explicitly. Default: the overworld —
    // never "wherever the bot happens to be" (it logs in where it last was, e.g. the Nether)
    this.dimension = 'minecraft:overworld';
    this.isOp = cfg.opLevel?.value != null ? cfg.opLevel.value >= 2 : undefined;
    /** Ordered queue of unacknowledged sends: feedback goes to the oldest entry. */
    this._queue = [];
    this._sentTimes = [];
    this._attach(bot);
  }

  _attach(bot) {
    const onMessage = (msg) => this._onMessage(msg);
    const onEnd = (reason) => { this.closed = true; this.endReason = reason; this._failAll(new TransportError(`Bot disconnected (${reason})`, { code: 'ENDED' })); };
    const onKicked = (reason) => { this.endReason = kickText(reason); };
    const onError = () => {};
    // Columns that arrived with real block data. mineflayer also creates EMPTY placeholder columns
    // when a light update comes before the chunk itself — reading those would report air.
    // (The tracker is installed when the bot is created, so it has seen every chunk since login.)
    this._chunkTracker = bot.__mcbChunks ?? null;
    bot.on('message', onMessage);
    bot.on('end', onEnd);
    bot.on('kicked', onKicked);
    bot.on('error', onError);
    this._detach = () => {
      bot.removeListener('message', onMessage);
      bot.removeListener('end', onEnd);
      bot.removeListener('kicked', onKicked);
      bot.removeListener('error', onError);
    };
  }

  /** Has the chunk column containing block x,z arrived with real data (not a light-only placeholder)? */
  hasChunk(x, z) {
    // a bot still standing in another world (it logs in where it last was) has no data for ours
    const here = this.currentDimension;
    if (here && this.dimension && here !== this.dimension) return false;
    const t = this._chunkTracker;
    if (!t) return !!this.bot.world?.getColumn?.(x >> 4, z >> 4);
    return t.has(this.bot.world, x >> 4, z >> 4);
  }

  /** Re-join after a disconnect (kick, timeout, server restart) and continue with the same object. */
  async reconnect() {
    this._detach?.();
    try { this.bot.end(); } catch { /* already gone */ }
    this._failAll(new TransportError('Reconnecting', { code: 'ENDED' }));
    const { bot, opLevel } = await spawnBot(this.cfg);
    this.bot = bot;
    this.opLevel = opLevel;
    this.cfg.opLevel = opLevel;
    this.closed = false;
    this.endReason = null;
    this.isOp = opLevel.value != null ? opLevel.value >= 2 : undefined;
    this._attach(bot);
    await this._init();
  }

  get version() { return this.bot.version; }
  get username() { return this.bot.username; }
  /** The world the bot is standing in right now, e.g. "minecraft:the_nether" (null if unknown). */
  get currentDimension() {
    const d = this.bot.game?.dimension;
    if (!d) return null;
    return String(d).includes(':') ? String(d) : `minecraft:${d}`;
  }

  async _init() {
    // The server sends the player's permission level (entity_status 24..28) right after login.
    const t0 = Date.now();
    while (this.opLevel.value == null && Date.now() - t0 < 2000) await sleep(50);
    if (this.opLevel.value != null) {
      this.isOp = this.opLevel.value >= 2;
    } else {
      // Fallback: an op-only query (acknowledged with a whisper-to-self barrier that works for everyone).
      this.isOp = undefined;
      const r = await this.command('gamerule max_block_modifications', { allowErrors: true, timeoutMs: 8000 }).catch(() => null);
      this.isOp = !!r && !r.errors.some((e) => /^command\.unknown/.test(e.key ?? ''));
    }
    if (this.isOp && this.cfg.init !== false) {
      if (this.bot.game.gameMode !== 'creative') await this.command('gamemode creative', { allowErrors: true });
      try { this.bot.creative?.startFlying(); } catch { /* not in creative yet */ }
    }
  }

  /** Barrier command: /tellraw needs op; /msg to yourself works for every player. */
  _barrierCommand(n) {
    const token = `mcb:sync:${this.nonce}:${n}`;
    return this.isOp ? `tellraw @s "${token}"` : `msg ${this.bot.username} ${token}`;
  }

  requireOp() {
    if (!this.isOp) {
      throw new TransportError(`Bot "${this.username}" is not a server operator, so it cannot run /fill or /setblock.`, {
        code: 'NOT_OP',
        hint: `In the server console run: op ${this.username}   (or: mcb server op ${this.username})`,
      });
    }
  }

  _onMessage(msg) {
    const json = msg?.json ?? msg;
    const text = typeof msg?.toString === 'function' ? msg.toString() : String(msg);
    const m = /mcb:sync:([a-z0-9]+):(\d+)/.exec(text);
    if (m) {
      if (m[1] !== this.nonce) return;
      const n = Number(m[2]);
      // Messages are ordered: this barrier acknowledges its entry and any older ones.
      while (this._queue.length && this._queue[0].n <= n) this._queue.shift().resolve();
      return;
    }
    const key = translateKey(json);
    const entry = { key, kind: classifyKey(key), text, cmd: echoedCommand(json), json };
    if (this._queue.length) this._queue[0].collected.push(entry);
  }

  _failAll(err) {
    for (const e of this._queue.splice(0)) e.reject(err);
  }

  async _throttle() {
    // sliding-window rate limit: at most maxRate commands in any 1 s window
    const now = Date.now();
    while (this._sentTimes.length && now - this._sentTimes[0] > 1000) this._sentTimes.shift();
    if (this._sentTimes.length >= this.maxRate) {
      await sleep(1000 - (now - this._sentTimes[0]) + 1);
      return this._throttle();
    }
    this._sentTimes.push(now);
  }

  async _send(cmd) {
    if (this.closed) throw new TransportError(`Bot disconnected (${this.endReason ?? 'unknown'})`, { code: 'ENDED' });
    const c = cmd.startsWith('/') ? cmd : '/' + cmd;
    if (c.length > 256) throw new TransportError(`Command longer than 256 characters: ${c.slice(0, 60)}…`, { code: 'TOO_LONG' });
    await this._throttle();
    this.lastSendAt = Date.now();
    this.bot.chat(c);
  }

  /**
   * Register an acknowledgement entry, send `cmds`, then the barrier. Resolves once everything is
   * *sent* (sends are serialised); `ack` resolves with the feedback the commands produced.
   * @returns {Promise<{ ack: Promise<object[]> }>}
   */
  _sendAcked(cmds, timeoutMs) {
    const run = async () => {
      const n = ++this.seq;
      const entry = { n, collected: [] };
      const ack = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = this._queue.indexOf(entry);
          if (i >= 0) this._queue.splice(i, 1);
          reject(new TransportError(`Server did not acknowledge commands within ${Math.round(timeoutMs / 1000)} s (lag or disconnect)`, { code: 'ACK_TIMEOUT' }));
        }, timeoutMs);
        entry.resolve = () => { clearTimeout(timer); resolve(entry.collected); };
        entry.reject = (e) => { clearTimeout(timer); reject(e); };
      });
      ack.catch(() => {});
      this._queue.push(entry);
      try {
        for (const c of cmds) await this._send(c);
        await this._send(this._barrierCommand(n));
      } catch (e) {
        const i = this._queue.indexOf(entry);
        if (i >= 0) this._queue.splice(i, 1);
        entry.reject(e);
      }
      return { ack };
    };
    const p = (this._sendLock ?? Promise.resolve()).then(run, run);
    this._sendLock = p.catch(() => {});
    return p;
  }

  /**
   * Run one command and collect the feedback it produced.
   * @returns {Promise<{ messages: object[], errors: object[] }>}
   */
  async command(cmd, { timeoutMs = 15_000, allowErrors = false } = {}) {
    const { ack } = await this._sendAcked([cmd], timeoutMs);
    const collected = await ack;
    const errors = collected.filter((e) => e.kind === 'error' || e.kind === 'retry');
    if (errors.length && !allowErrors) {
      const e = errors[0];
      throw new TransportError(`Command failed: /${cmd} → ${e.text}`, { code: e.key ?? 'COMMAND_FAILED', hint: explainKey(e.key, e.text) });
    }
    return { messages: collected, errors };
  }

  /** Text of the feedback for a query command (e.g. `gamerule x`, `data get entity …`). */
  async query(cmd) {
    const r = await this.command(cmd, { allowErrors: true });
    return { text: r.messages.map((m) => m.text).join('\n'), errors: r.errors, messages: r.messages };
  }

  /**
   * Run many commands in acknowledged batches (pipelined, `window` batches in flight).
   * Batches are capped by count and by total affected volume (`weights`, e.g. fill volumes) so a
   * single acknowledgement never covers an unbounded amount of server work.
   * Batches that hit unloaded chunks are retried after `ensureLoaded()`.
   * @param {string[]} cmds
   * @param {{ onBatch?: (done:number, errors:object[]) => void, retries?: number, ensureLoaded?: () => Promise<void>, weights?: number[] }} [opts]
   * @returns {Promise<{ sent: number, errors: object[], noops: number }>}
   */
  async run(cmds, opts = {}) {
    const errors = [];
    let noops = 0;
    let done = 0;
    let pending = [];
    const maxVol = this.cfg.maxBatchVolume ?? 200_000;
    let cur = [], vol = 0;
    cmds.forEach((c, i) => {
      const w = opts.weights?.[i] ?? 1;
      if (cur.length && (cur.length >= this.batchSize || vol + w > maxVol)) { pending.push(cur); cur = []; vol = 0; }
      cur.push(c);
      vol += w;
    });
    if (cur.length) pending.push(cur);
    for (let attempt = 0; pending.length; attempt++) {
      const retry = [];
      const inflight = [];
      const settle = async () => {
        const { batch, ack } = inflight.shift();
        const collected = await ack;
        if (collected.some((e) => e.kind === 'retry') && attempt < (opts.retries ?? 4)) {
          retry.push(batch);
          return;
        }
        for (const e of collected) {
          if (e.kind === 'noop') noops++;
          else if (e.kind === 'error' || e.kind === 'retry') errors.push({ key: e.key, text: e.text, cmd: e.cmd, hint: explainKey(e.key, e.text) });
        }
        done += batch.length;
        opts.onBatch?.(done, errors);
      };
      for (const batch of pending) {
        if (inflight.length >= this.window) await settle();
        const { ack } = await this._sendAcked(batch, this.cfg.ackTimeoutMs ?? 60_000);
        inflight.push({ batch, ack });
      }
      while (inflight.length) await settle();
      pending = retry;
      if (pending.length) {
        this.log?.(`${pending.length} batch(es) hit unloaded chunks — waiting and retrying (attempt ${attempt + 1})`);
        await sleep(500 * (attempt + 1));
        if (opts.ensureLoaded) await opts.ensureLoaded();
      }
    }
    return { sent: done, errors, noops };
  }

  /** Dimension (e.g. "minecraft:the_nether") the bot should work in; applied on the next teleport. */
  setDimension(id) {
    this.dimension = id ?? 'minecraft:overworld';
  }

  /** Teleport the bot (flying, creative) and wait for the surrounding chunks to arrive. */
  async teleport(x, y, z, { waitChunks = true, area = null } = {}) {
    const tp = `tp @s ${x} ${y} ${z}`;
    await this.command(this.dimension ? `execute in ${this.dimension} run ${tp}` : tp, { allowErrors: true });
    try { this.bot.creative?.startFlying(); } catch { /* ignore */ }
    if (waitChunks) await this.waitForArea(area ?? { x1: x - 16, z1: z - 16, x2: x + 16, z2: z + 16 });
  }

  /** Wait until the client has the chunks covering the area (server has them loaded too). */
  async waitForArea({ x1, z1, x2, z2 }, timeoutMs = 20_000) {
    const t0 = Date.now();
    const cx1 = Math.floor(x1 / 16), cx2 = Math.floor(x2 / 16), cz1 = Math.floor(z1 / 16), cz2 = Math.floor(z2 / 16);
    while (Date.now() - t0 < timeoutMs) {
      let missing = 0;
      for (let cx = cx1; cx <= cx2; cx++) {
        for (let cz = cz1; cz <= cz2; cz++) {
          if (!this.hasChunk(cx * 16, cz * 16)) missing++;
        }
      }
      if (!missing) return true;
      await sleep(100);
    }
    return false;
  }

  /**
   * Make sure the client's copy of the world is current: changes made by others (players, RCON,
   * redstone) are flushed to the client at the end of a server tick, so round-trip a barrier and
   * give it two more ticks.
   */
  async syncWorld() {
    const { ack } = await this._sendAcked([], 15_000);
    await ack;
    await sleep(120);
  }

  /** Make sure the chunks for an area are loaded server-side: hover above its centre. */
  async loadArea(area, { topY = 100 } = {}) {
    const cx = Math.floor((area.x1 + area.x2) / 2) + 0.5;
    const cz = Math.floor((area.z1 + area.z2) / 2) + 0.5;
    const y = Math.min(318, Math.max(-60, topY + 4));
    await this.teleport(cx, y, cz, { area });
  }

  /**
   * Edge length of the square area that's safely inside the bot's loaded view around one hover
   * point (chunk sending is circular): 128 with ≥ 8 chunks of view distance, else 64.
   */
  get readTileSize() {
    const vd = Math.min(this.bot.game?.serverViewDistance ?? 8, 12);
    return vd >= 8 ? 128 : 64;
  }

  /**
   * Canonical block state at a position, or undefined if that chunk isn't loaded client-side.
   * Reads the chunk's state id directly (≈2000× faster than bot.blockAt) and caches the string.
   */
  readBlock(x, y, z) {
    if (!this.hasChunk(x, z)) return undefined;
    if (!this._rv) { const V = Vec3(); this._rv = new V(0, 0, 0); this._rp = new V(0, 0, 0); }
    this._rv.x = x; this._rv.y = 0; this._rv.z = z;
    const col = this.bot.world.getColumnAt(this._rv);
    if (!col) return undefined;
    this._rp.x = x & 15; this._rp.y = y; this._rp.z = z & 15;
    let id;
    try { id = col.getBlockStateId(this._rp); } catch { return undefined; }
    if (id === undefined || id === null) return undefined;
    this._stateCache ??= new Map();
    let s = this._stateCache.get(id);
    if (s === undefined) {
      this._Block ??= require('prismarine-block')(this.bot.registry);
      const b = this._Block.fromStateId(id, 0);
      const props = {};
      for (const [k, v] of Object.entries(b.getProperties?.() ?? {})) props[k] = String(v);
      s = formatBlock({ name: b.name, props, nbt: null });
      this._stateCache.set(id, s);
    }
    return s;
  }

  /**
   * Position, facing and dimension of an online player — read through /tellraw, so it works even
   * while send_command_feedback is off (which hides ordinary command output from the bot).
   */
  async playerPose(name) {
    if (this.isOp === false) this.requireOp();
    if (/^[A-Za-z0-9_]{1,16}$/.test(name)) {
      const sel = JSON.stringify(name);
      const r = await this.query(`tellraw @s ["mcb:pose:",{"entity":${sel},"nbt":"Pos"},"|",{"entity":${sel},"nbt":"Rotation"},"|",{"entity":${sel},"nbt":"Dimension"}]`);
      const line = r.messages.map((x) => x.text).find((t) => t.startsWith('mcb:pose:'));
      if (line) {
        // NBT text components render compact SNBT: [520.5d,-60.0d,560.5d]|[-180.0f,0.0f]|minecraft:overworld
        const [pos, rot, dim] = line.slice('mcb:pose:'.length).split('|');
        const m = /\[\s*(-?[\d.E-]+)d,\s*(-?[\d.E-]+)d,\s*(-?[\d.E-]+)d\s*\]/.exec(pos ?? '');
        if (!m) throw new TransportError(`Player "${name}" not found online.`, { code: 'NO_PLAYER', hint: 'Names are case-sensitive; `mcb where` lists online players.' });
        const rr = /\[\s*(-?[\d.E-]+)f,\s*(-?[\d.E-]+)f\s*\]/.exec(rot ?? '');
        const d = /"?((?:[a-z0-9_.-]+:)?[a-z0-9_./-]+)"?/.exec((dim ?? '').trim());
        return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]), yaw: rr ? Number(rr[1]) : 0, pitch: rr ? Number(rr[2]) : 0, dimension: d ? d[1] : null };
      }
    }
    const pos = await this.query(`data get entity ${name} Pos`);
    if (pos.errors.length || !pos.text) {
      throw new TransportError(`Player "${name}" not found online.`, { code: 'NO_PLAYER', hint: 'Names are case-sensitive; `mcb where` lists online players.' });
    }
    const m = /\[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/.exec(pos.text);
    const rot = await this.query(`data get entity ${name} Rotation`);
    const r = /\[(-?[\d.E-]+)f, (-?[\d.E-]+)f\]/.exec(rot.text);
    const dim = await this.query(`data get entity ${name} Dimension`);
    const d = /"((?:[a-z0-9_.-]+:)?[a-z0-9_./-]+)"/.exec(dim.text);
    if (!m) throw new TransportError(`Could not parse position of ${name}: ${pos.text}`, { code: 'PARSE' });
    return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]), yaw: r ? Number(r[1]) : 0, pitch: r ? Number(r[2]) : 0, dimension: d ? d[1] : null };
  }

  /**
   * The numeric result of a command (e.g. a gamerule query), read back through command storage
   * and /tellraw so it does not depend on send_command_feedback. → { ok, value } | { ok: false, errors }
   */
  async queryResult(cmd) {
    const key = `v${this.nonce}`;
    const r = await this.command(`execute store result storage mcb:query ${key} int 1 run ${cmd}`, { allowErrors: true });
    if (r.errors.length) return { ok: false, errors: r.errors };
    const t = await this.query(`tellraw @s ["mcb:val:",{"storage":"mcb:query","nbt":${JSON.stringify(key)}}]`);
    const m = /mcb:val:(-?\d+)/.exec(t.text);
    return m ? { ok: true, value: Number(m[1]) } : { ok: false, errors: [] };
  }

  /** Online player names (from the tab list — no command output needed). */
  async listPlayers() {
    return Object.keys(this.bot.players ?? {}).filter((n) => n !== this.bot.username).sort();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await new Promise((resolve) => {
      this.bot.once('end', resolve);
      try { this.bot.quit('done'); } catch { resolve(); }
      setTimeout(resolve, 2000);
    });
  }
}
