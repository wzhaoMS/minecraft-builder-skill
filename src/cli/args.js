/**
 * Tiny argv parser: positionals, --flag value, --flag=value, --no-flag, repeatable -p/--param k=v.
 */
const ALIASES = { o: 'out', p: 'param', h: 'help', j: 'json', q: 'quiet' };

/**
 * @param {string[]} argv
 * @param {{ booleans?: string[] }} [spec]
 */
export function parseArgs(argv, { booleans = [], optionalNumbers = ['clear'] } = {}) {
  const bool = new Set(booleans);
  const optNum = new Set(optionalNumbers);
  const out = { _: [], param: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    const isFlag = a.startsWith('--') || (/^-[a-z]$/i.test(a));
    if (isFlag) {
      let key = a.startsWith('--') ? a.slice(2) : (ALIASES[a.slice(1)] ?? a.slice(1));
      let val;
      const eq = key.indexOf('=');
      if (eq >= 0) { val = key.slice(eq + 1); key = key.slice(0, eq); }
      key = ALIASES[key] ?? key;
      if (key.startsWith('no-') && val === undefined) { out[camel(key.slice(3))] = false; continue; }
      const k = camel(key);
      if (val === undefined) {
        const next = argv[i + 1];
        if (bool.has(k)) val = true;
        else if (optNum.has(k)) val = next !== undefined && /^\d+$/.test(next) ? argv[++i] : true;
        else if (next !== undefined && !next.startsWith('--') && !/^-[a-z]$/i.test(next)) val = argv[++i];
        else val = true;
      } else if (bool.has(k)) {
        // --flag=value on a switch: parse strictly (never let "false" mean true)
        val = parseBool(val, `--${key}`);
      }
      if (k === 'param') out.param.push(String(val));
      else out[k] = val;
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function camel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Strict boolean: true/false/1/0/yes/no/on/off; anything else is an error. */
export function parseBool(v, what = 'value') {
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  throw Object.assign(new Error(`${what} must be true or false, got "${v}"`), { exitCode: 2, code: 'BAD_FLAG' });
}

/** "x,y,z" | "x y z" → [x,y,z] integers (allows ~ relative to `base`). */
export function parseCoords(s, base = null, what = 'coordinates') {
  if (Array.isArray(s)) return s;
  const bad = (msg) => Object.assign(new Error(msg), { exitCode: 2, code: 'BAD_COORDS' });
  const parts = String(s).trim().split(/[\s,]+/);
  if (parts.length !== 3) throw bad(`${what} must be "x,y,z", got "${s}"`);
  return parts.map((p, i) => {
    if (p.startsWith('~')) {
      if (!base) throw bad(`Relative ${what} (~) need a reference position`);
      const off = p.length > 1 ? Number(p.slice(1)) : 0;
      if (!Number.isFinite(off)) throw bad(`${what}: "${p}" is not ~ followed by a number`);
      return Math.floor(Math.floor(base[i]) + off);
    }
    const n = Number(p);
    if (!Number.isFinite(n)) throw bad(`${what}: "${p}" is not a number`);
    return Math.floor(n);
  });
}

/** ["width=9", "roof=spruce"] + optional JSON string → params object */
export function parseParams(list = [], json = null) {
  const p = {};
  if (json) Object.assign(p, typeof json === 'string' ? JSON.parse(json) : json);
  for (const item of list) {
    const i = item.indexOf('=');
    if (i < 0) throw new Error(`--param must be key=value, got "${item}"`);
    p[item.slice(0, i).trim()] = item.slice(i + 1);
  }
  return p;
}
