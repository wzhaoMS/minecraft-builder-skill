/**
 * RCON transport: runs commands as the server console. No bot, no op, no chat spam limits —
 * the most robust way to build on a server you control (enable-rcon=true in server.properties).
 *
 * Chunks: since 1.21.9 even spawn chunks aren't kept loaded, so before working on an area we
 * `/forceload add` it, wait for `execute if loaded`, and remove only the forceloads we added.
 */
import net from 'node:net';
import { classifyRconText } from './feedback.js';
import { TransportError } from './bot.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPE_AUTH = 3;
const TYPE_COMMAND = 2;

export class RconClient {
  constructor({ host = '127.0.0.1', port = 25575, password, timeoutMs = 15_000 } = {}) {
    Object.assign(this, { host, port, password, timeoutMs });
    this.nextId = 1;
    this.pending = new Map();
    this.buf = Buffer.alloc(0);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.port, this.host);
      this.sock = sock;
      sock.setNoDelay(true);
      const fail = (err) => {
        reject(new TransportError(`RCON connection to ${this.host}:${this.port} failed: ${err.message}`, {
          code: err.code ?? 'RCON_CONNECT',
          hint: 'Enable RCON in server.properties (enable-rcon=true, rcon.port, rcon.password) and restart the server.',
        }));
      };
      sock.once('error', fail);
      sock.on('data', (d) => this._onData(d));
      sock.on('close', () => {
        this.closed = true;
        for (const [, p] of this.pending) p.reject(new TransportError('RCON connection closed', { code: 'RCON_CLOSED' }));
        this.pending.clear();
      });
      sock.once('connect', async () => {
        sock.removeListener('error', fail);
        sock.on('error', () => {});
        try {
          const r = await this._request(TYPE_AUTH, this.password ?? '');
          if (r.id === -1) throw new TransportError('RCON authentication failed (wrong rcon.password)', { code: 'RCON_AUTH' });
          resolve(this);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 4) {
      const len = this.buf.readInt32LE(0);
      if (this.buf.length < 4 + len) break;
      const id = this.buf.readInt32LE(4);
      const body = this.buf.toString('utf8', 12, 4 + len - 2);
      this.buf = this.buf.subarray(4 + len);
      if (id === -1) {
        // auth failure is reported with id -1 → fail the oldest pending auth request
        const first = [...this.pending.entries()][0];
        if (first) { this.pending.delete(first[0]); first[1].resolve({ id: -1, body }); }
        continue;
      }
      const p = this.pending.get(id);
      if (p) {
        // Responses > 4 KB arrive in several packets with the same id; accumulate briefly.
        p.body += body;
        clearTimeout(p.flush);
        p.flush = setTimeout(() => { this.pending.delete(id); clearTimeout(p.timer); p.resolve({ id, body: p.body }); }, body.length >= 4000 ? 50 : 0);
      }
    }
  }

  _request(type, body) {
    // The vanilla/Paper RCON server reads one packet per TCP read and drops the connection when
    // several requests arrive together, so requests are strictly serialised.
    const run = () => this._requestNow(type, body);
    const p = (this._chain ?? Promise.resolve()).then(run, run);
    this._chain = p.catch(() => {});
    return p;
  }

  _requestNow(type, body) {
    if (this.closed) return Promise.reject(new TransportError('RCON connection closed', { code: 'RCON_CLOSED' }));
    const id = this.nextId++;
    const b = Buffer.from(body, 'utf8');
    if (b.length > 1446) return Promise.reject(new TransportError(`RCON command too long (${b.length} bytes > 1446)`, { code: 'TOO_LONG' }));
    const pkt = Buffer.alloc(14 + b.length);
    pkt.writeInt32LE(10 + b.length, 0);
    pkt.writeInt32LE(id, 4);
    pkt.writeInt32LE(type, 8);
    b.copy(pkt, 12);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TransportError(`RCON timeout for: ${body.slice(0, 60)}`, { code: 'RCON_TIMEOUT' }));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, body: '' });
      this.sock.write(pkt);
    });
  }

  async command(cmd) {
    const r = await this._request(TYPE_COMMAND, cmd.replace(/^\//, ''));
    return r.body;
  }

  close() {
    try { this.sock?.end(); } catch { /* ignore */ }
  }
}

export async function connectRcon(cfg = {}) {
  const client = new RconClient({ host: cfg.host ?? '127.0.0.1', port: Number(cfg.rconPort ?? 25575), password: cfg.rconPassword });
  await client.connect();
  return new RconTransport(client, cfg);
}

export class RconTransport {
  constructor(client, cfg = {}) {
    this.kind = 'rcon';
    this.canRead = false;
    this.isOp = true;
    this.client = client;
    this.cfg = cfg;
    this.log = cfg.log ?? (() => {});
    this.pipeline = cfg.pipeline ?? 8;
    this.version = cfg.version ?? null;
    this.username = null;
    this._forceloaded = null;
    this._added = new Set();
  }

  requireOp() {}

  /** Open a fresh RCON connection (after a timeout / server restart). */
  async reconnect() {
    try { this.client.close(); } catch { /* ignore */ }
    const c = new RconClient({ host: this.client.host, port: this.client.port, password: this.client.password });
    await c.connect();
    this.client = c;
  }

  async command(cmd, { allowErrors = false } = {}) {
    const text = await this.client.command(cmd);
    const kind = classifyRconText(text);
    const errors = kind === 'error' || kind === 'retry' ? [{ key: null, kind, text, cmd }] : [];
    if (errors.length && !allowErrors) throw new TransportError(`Command failed: /${cmd} → ${text}`, { code: 'COMMAND_FAILED' });
    return { messages: [{ text, kind }], errors };
  }

  async query(cmd) {
    const r = await this.command(cmd, { allowErrors: true });
    return { text: r.messages.map((m) => m.text).join('\n'), errors: r.errors, messages: r.messages };
  }

  async run(cmds, opts = {}) {
    const errors = [];
    let noops = 0, done = 0;
    let pending = cmds.slice();
    for (let attempt = 0; pending.length; attempt++) {
      const retry = [];
      for (let i = 0; i < pending.length; i += this.pipeline) {
        const chunk = pending.slice(i, i + this.pipeline);
        const results = await Promise.all(chunk.map((c) => this.client.command(c)));
        results.forEach((text, j) => {
          const kind = classifyRconText(text);
          if (kind === 'retry' && attempt < (opts.retries ?? 4)) { retry.push(chunk[j]); return; }
          if (kind === 'noop') noops++;
          else if (kind === 'error' || kind === 'retry') errors.push({ key: null, text, cmd: chunk[j] });
          done++;
        });
        opts.onBatch?.(done, errors);
      }
      pending = retry;
      if (pending.length) {
        await sleep(300 * (attempt + 1));
        if (opts.ensureLoaded) await opts.ensureLoaded();
      }
    }
    return { sent: done, errors, noops };
  }

  /** Forceload the chunks covering an area (releasing the previous area) and wait until they're loaded. */
  async loadArea(area) {
    if (!this._forceloaded) {
      const q = await this.client.command('forceload query');
      this._forceloaded = new Set([...q.matchAll(/\[(-?\d+), (-?\d+)\]/g)].map((m) => `${m[1]},${m[2]}`));
    }
    const key = `${area.x1},${area.z1},${area.x2},${area.z2}`;
    if (this._currentArea === key) return true;
    await this.releaseAreas();
    this._currentArea = key;
    const cx1 = Math.floor(area.x1 / 16), cx2 = Math.floor(area.x2 / 16), cz1 = Math.floor(area.z1 / 16), cz2 = Math.floor(area.z2 / 16);
    await this.client.command(`forceload add ${area.x1} ${area.z1} ${area.x2} ${area.z2}`);
    for (let cx = cx1; cx <= cx2; cx++) for (let cz = cz1; cz <= cz2; cz++) {
      const k = `${cx},${cz}`;
      if (!this._forceloaded.has(k)) this._added.add(k);
    }
    const probes = [[area.x1, area.z1], [area.x2, area.z2], [area.x1, area.z2], [area.x2, area.z1]];
    const t0 = Date.now();
    while (Date.now() - t0 < 20_000) {
      const res = await Promise.all(probes.map(([x, z]) => this.client.command(`execute if loaded ${x} 0 ${z}`)));
      if (res.every((r) => /passed/i.test(r))) return true;
      await sleep(100);
    }
    return false;
  }

  /** Remove the forceloads this transport added. */
  async releaseAreas() {
    this._currentArea = null;
    for (const k of this._added) {
      const [cx, cz] = k.split(',').map(Number);
      await this.client.command(`forceload remove ${cx * 16} ${cz * 16}`).catch(() => {});
    }
    this._added.clear();
  }

  async playerPose(name) {
    const pos = await this.client.command(`data get entity ${name} Pos`);
    const m = /\[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/.exec(pos);
    if (!m) throw new TransportError(`Player "${name}" not found online (${pos.trim()})`, { code: 'NO_PLAYER', hint: 'Names are case-sensitive; check `/list`.' });
    const rot = await this.client.command(`data get entity ${name} Rotation`);
    const r = /\[(-?[\d.E-]+)f, (-?[\d.E-]+)f\]/.exec(rot);
    return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]), yaw: r ? Number(r[1]) : 0, pitch: r ? Number(r[2]) : 0 };
  }

  readBlock() { return undefined; }

  async close() {
    await this.releaseAreas().catch(() => {});
    this.client.close();
  }
}
