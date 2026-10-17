/**
 * Generator registry. A generator is a module whose default export is:
 *
 *   {
 *     name: 'house',
 *     description: 'One-line description',
 *     params: { width: { type: 'int', default: 9, min: 5, max: 64, description: '…' }, … },
 *     build(s, p, ctx) { … }   // fill Structure `s` using resolved params `p`
 *   }
 *
 * Conventions every generator follows:
 *   - y = 0 is the first layer above the ground (negative y = below ground, e.g. foundations)
 *   - the footprint's north-west corner is at x = 0, z = 0 (normalised after build)
 *   - the "front" (door, text, facade) faces SOUTH (+Z); callers rotate with --facing
 * Param types: int, number, bool, string, block, enum (needs `values`), text.
 */
import { Structure } from '../core/structure.js';
import { createRng } from '../core/rng.js';
import { canonical } from '../core/blockstate.js';

const registry = new Map();

export function registerGenerator(gen) {
  if (!gen?.name || typeof gen.build !== 'function') throw new Error('Invalid generator (needs name + build)');
  registry.set(gen.name, gen);
}

export function getGenerator(name) {
  const g = registry.get(String(name).toLowerCase());
  if (!g) {
    const names = [...registry.keys()].sort();
    throw new Error(`Unknown generator "${name}". Available: ${names.join(', ')}`);
  }
  return g;
}

export function listGenerators() {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function coerce(name, spec, value) {
  if (value === undefined || value === null || value === '') return spec.default;
  switch (spec.type) {
    case 'int': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) throw new Error(`Param "${name}" must be an integer, got "${value}"`);
      const r = Math.round(n);
      if (spec.min !== undefined && r < spec.min) throw new Error(`Param "${name}" must be ≥ ${spec.min}, got ${r}`);
      if (spec.max !== undefined && r > spec.max) throw new Error(`Param "${name}" must be ≤ ${spec.max}, got ${r}`);
      return r;
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) throw new Error(`Param "${name}" must be a number, got "${value}"`);
      if (spec.min !== undefined && n < spec.min) throw new Error(`Param "${name}" must be ≥ ${spec.min}, got ${n}`);
      if (spec.max !== undefined && n > spec.max) throw new Error(`Param "${name}" must be ≤ ${spec.max}, got ${n}`);
      return n;
    }
    case 'bool':
      if (typeof value === 'boolean') return value;
      if (/^(1|true|yes|y|on)$/i.test(String(value))) return true;
      if (/^(0|false|no|n|off)$/i.test(String(value))) return false;
      throw new Error(`Param "${name}" must be true/false, got "${value}"`);
    case 'block':
      return canonical(String(value));
    case 'enum': {
      const v = String(value).toLowerCase();
      if (!spec.values.includes(v)) throw new Error(`Param "${name}" must be one of ${spec.values.join('|')}, got "${value}"`);
      return v;
    }
    case 'blocks': // list of blocks (comma separated string or array)
      return (Array.isArray(value) ? value : String(value).split(',')).map((b) => canonical(String(b)));
    default:
      return value;
  }
}

/** Fill in defaults, coerce CLI strings, validate ranges. Unknown params are an error (typo guard). */
export function resolveParams(gen, params = {}) {
  const out = {};
  const specs = gen.params || {};
  for (const k of Object.keys(params)) {
    if (!(k in specs) && k !== 'seed') {
      throw new Error(`Generator "${gen.name}" has no param "${k}". Valid: ${Object.keys(specs).join(', ') || '(none)'}`);
    }
  }
  for (const [k, spec] of Object.entries(specs)) out[k] = coerce(k, spec, params[k]);
  out.seed = params.seed ?? 1;
  return out;
}

/** Build context passed to generators (and JS blueprints). */
export function makeContext(seed = 1) {
  const rng = createRng(seed);
  const ctx = {
    rng,
    Structure,
    gen: (name, params = {}) => runGenerator(name, { seed: rng.int(1, 2 ** 31), ...params }),
  };
  return ctx;
}

/** Run a generator → Structure with its footprint's NW corner at x = z = 0. */
export function runGenerator(name, params = {}) {
  const gen = getGenerator(name);
  const p = resolveParams(gen, params);
  const s = new Structure({ name: params.name ?? gen.name, meta: { generator: gen.name, params: p } });
  gen.build(s, p, makeContext(p.seed));
  const b = s.bounds();
  if (!b) return s;
  if (b.min[0] === 0 && b.min[2] === 0) return s;
  const n = s.translated(-b.min[0], 0, -b.min[2]);
  n.meta = s.meta;
  return n;
}
