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
      const text = kickText(reason);
      let hint = '';
      if (/whitelist/i.test(text)) hint = `Whitelist the bot: run \`whitelist add ${opts.username}\` in the server console.`;
      else if (/outdated|incompatible|version/i.test(text)) hint = 'Version mismatch — omit --version to auto-detect, or use a server version mineflayer supports.';
      else if (/authenticat|premium|online/i.test(text)) hint = 'Server is in online-mode: use --auth microsoft or set online-mode=false for a local build server.';
      done(new TransportError(`Kicked while joining: ${text}`, { code: 'KICKED', hint }));
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

function kickText(reason) {
  if (typeof reason === 'string') {
    try { return flattenText(JSON.parse(reason)); } catch { return reason; }
  }
  return flattenText(reason);
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
    this.dimension = id;
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
    const { Vec3 } = require('vec3');
    const t0 = Date.now();
    const cx1 = Math.floor(x1 / 16), cx2 = Math.floor(x2 / 16), cz1 = Math.floor(z1 / 16), cz2 = Math.floor(z2 / 16);
    while (Date.now() - t0 < timeoutMs) {
      let missing = 0;
      for (let cx = cx1; cx <= cx2; cx++) {
        for (let cz = cz1; cz <= cz2; cz++) {
          if (!this.bot.world.getColumnAt(new Vec3(cx * 16, 0, cz * 16))) missing++;
        }
      }
      if (!missing) return true;
      await sleep(100);
    }
    return false;
  }

  /** Make sure the chunks for an area are loaded server-side: hover above its centre. */
  async loadArea(area, { topY = 100 } = {}) {
    const cx = Math.floor((area.x1 + area.x2) / 2) + 0.5;
    const cz = Math.floor((area.z1 + area.z2) / 2) + 0.5;
    const y = Math.min(318, Math.max(-60, topY + 4));
    await this.teleport(cx, y, cz, { area });
  }

  /** Canonical block state at a position, or undefined if that chunk isn't loaded client-side. */
  readBlock(x, y, z) {
    const { Vec3 } = require('vec3');
    const b = this.bot.blockAt(new Vec3(x, y, z), false);
    if (!b) return undefined;
    const props = {};
    for (const [k, v] of Object.entries(b.getProperties?.() ?? {})) props[k] = String(v);
    return formatBlock({ name: b.name, props, nbt: null });
  }

  /** Position, facing and dimension of an online player. */
  async playerPose(name) {
    const pos = await this.query(`data get entity ${name} Pos`);
    if (pos.errors.length || !pos.text) {
      throw new TransportError(`Player "${name}" not found online.`, { code: 'NO_PLAYER', hint: 'Names are case-sensitive; check `mcb where` (lists online players).' });
    }
    const m = /\[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/.exec(pos.text);
    const rot = await this.query(`data get entity ${name} Rotation`);
    const r = /\[(-?[\d.E-]+)f, (-?[\d.E-]+)f\]/.exec(rot.text);
    const dim = await this.query(`data get entity ${name} Dimension`);
    const d = /"((?:[a-z0-9_.-]+:)?[a-z0-9_./-]+)"/.exec(dim.text);
    if (!m) throw new TransportError(`Could not parse position of ${name}: ${pos.text}`, { code: 'PARSE' });
    return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]), yaw: r ? Number(r[1]) : 0, pitch: r ? Number(r[2]) : 0, dimension: d ? d[1] : null };
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
