/**
 * Dry-run transport: records commands instead of sending them. Used by `--dry-run`, exports and tests.
 */
export class DryRunTransport {
  constructor({ version = null, log = () => {} } = {}) {
    this.kind = 'dry-run';
    this.canRead = false;
    this.isOp = true;
    this.version = version;
    this.username = 'dry-run';
    this.log = log;
    /** @type {string[]} */
    this.commands = [];
  }

  requireOp() {}

  async command(cmd) {
    this.commands.push(cmd.replace(/^\//, ''));
    return { messages: [], errors: [] };
  }

  async query(cmd) {
    this.commands.push(cmd.replace(/^\//, ''));
    return { text: '', errors: [], messages: [] };
  }

  async run(cmds, opts = {}) {
    for (const c of cmds) this.commands.push(c.replace(/^\//, ''));
    opts.onBatch?.(cmds.length, []);
    return { sent: cmds.length, errors: [], noops: 0 };
  }

  async loadArea() { return true; }
  readBlock() { return undefined; }
  async playerPose() { return null; }
  async close() {}
}
