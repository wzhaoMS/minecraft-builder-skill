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

/** "x,y,z" | "x y z" → [x,y,z] integers (allows ~ relative to `base`). */
export function parseCoords(s, base = null, what = 'coordinates') {
  if (Array.isArray(s)) return s;
  const parts = String(s).trim().split(/[\s,]+/);
  if (parts.length !== 3) throw new Error(`${what} must be "x,y,z", got "${s}"`);
  return parts.map((p, i) => {
    if (p.startsWith('~')) {
      if (!base) throw new Error(`Relative ${what} (~) need a reference position`);
      return Math.floor(base[i]) + (p.length > 1 ? Number(p.slice(1)) : 0);
    }
    const n = Number(p);
    if (!Number.isFinite(n)) throw new Error(`${what}: "${p}" is not a number`);
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
