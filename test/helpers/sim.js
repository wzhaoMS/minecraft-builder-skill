/**
 * In-memory "server" for unit tests: executes the fill/setblock/gamerule commands mcb sends and
 * answers block reads, so build → verify → undo can be tested without Minecraft.
 */
import { parseBlock, formatBlock } from '../../src/core/blockstate.js';
import { defaultProps } from '../../src/core/blockinfo.js';

/** Full block state as the game reports it (defaults filled in). */
export function fullState(block) {
  const p = parseBlock(block);
  return formatBlock({ ...p, props: { ...(defaultProps(p.name) ?? {}), ...p.props }, nbt: null });
}

export class SimTransport {
  constructor({ blocks = {}, unreadable = () => false, serverKey = '127.0.0.1:25565', rules = {} } = {}) {
    this.kind = 'sim';
    this.canRead = true;
    this.isOp = true;
    this.version = '1.21.11';
    this.username = 'sim';
    this.serverKey = serverKey;
    this.unreadable = unreadable;
    this.world = new Map();
    for (const [k, b] of Object.entries(blocks)) this.world.set(k, fullState(b));
    this.rules = { send_command_feedback: 'true', max_block_modifications: '32768', ...rules };
    this.failRule = null; // (name, value) => true to make `gamerule name value` fail
    this.commands = [];
    this.dimension = null;
  }

  requireOp() {}
  setDimension(id) { this.dimension = id; }
  async loadArea() { return true; }
  async syncWorld() {}
  async releaseAreas() {}
  async playerPose() { return null; }
  async close() {}

  get(x, y, z) { return this.world.get(`${x},${y},${z}`) ?? 'air'; }

  readBlock(x, y, z) {
    if (this.unreadable(x, y, z)) return undefined;
    return this.get(x, y, z);
  }

  /** Commands that changed the world (fill/setblock). */
  get worldEdits() { return this.commands.filter((c) => /(^|run )(fill|setblock) /.test(c)); }

  _exec(raw) {
    this.commands.push(raw);
    let c = raw.replace(/^\//, '');
    const ex = /^execute in \S+ run (.*)$/.exec(c);
    if (ex) c = ex[1];
    let m;
    if ((m = /^gamerule (\S+)(?: (\S+))?$/.exec(c))) {
      const [, name, value] = m;
      if (!(name in this.rules)) return { error: `Unknown game rule: ${name}` };
      if (value === undefined) return { text: `Gamerule ${name} is currently set to: ${this.rules[name]}` };
      if (this.failRule?.(name, value)) return { error: 'An unexpected error occurred trying to execute that command' };
      this.rules[name] = value;
      return { text: `Gamerule ${name} is now set to: ${value}` };
    }
    if ((m = /^fill (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (.+?)( strict)?$/.exec(c))) {
      const [x1, y1, z1, x2, y2, z2] = m.slice(1, 7).map(Number);
      const b = fullState(m[7]);
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
          for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) this.world.set(`${x},${y},${z}`, b);
        }
      }
      return { text: 'Successfully filled' };
    }
    if ((m = /^setblock (-?\d+) (-?\d+) (-?\d+) (.+?)( strict)?$/.exec(c))) {
      this.world.set(`${m[1]},${m[2]},${m[3]}`, fullState(m[4]));
      return { text: 'Changed the block' };
    }
    return { text: '' };
  }

  async command(cmd, { allowErrors = false } = {}) {
    const r = this._exec(cmd);
    const errors = r.error ? [{ key: 'sim.error', kind: 'error', text: r.error, cmd }] : [];
    if (errors.length && !allowErrors) throw Object.assign(new Error(r.error), { code: 'COMMAND_FAILED' });
    return { messages: [{ text: r.text ?? r.error, kind: r.error ? 'error' : 'info' }], errors };
  }

  async query(cmd) {
    const r = await this.command(cmd, { allowErrors: true });
    return { text: r.messages.map((m) => m.text).join('\n'), errors: r.errors, messages: r.messages };
  }

  async run(cmds, opts = {}) {
    const errors = [];
    for (const c of cmds) {
      const r = this._exec(c);
      if (r.error) errors.push({ key: 'sim.error', text: r.error, cmd: c });
    }
    opts.onBatch?.(cmds.length, errors);
    return { sent: cmds.length, errors, noops: 0 };
  }
}
