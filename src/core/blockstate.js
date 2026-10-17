/**
 * Block-state strings: `[namespace:]name[prop=value,...]{snbt}`.
 *
 * Canonical form (used as palette keys everywhere): no `minecraft:` namespace,
 * lower-case name, properties sorted by key, SNBT kept verbatim.
 *   parseBlock('minecraft:Oak_Stairs[half=top, facing=east]') →
 *     { name: 'oak_stairs', props: { facing: 'east', half: 'top' }, nbt: null }
 */

const cache = new Map();

/**
 * @typedef {{ name: string, props: Record<string,string>, nbt: string|null }} BlockState
 */

/** @param {string|BlockState} input @returns {BlockState} */
export function parseBlock(input) {
  if (input && typeof input === 'object') {
    return { name: normName(input.name), props: { ...(input.props || {}) }, nbt: input.nbt ?? null };
  }
  if (typeof input !== 'string') throw new TypeError(`Block must be a string, got ${typeof input}`);
  const s = input.trim();
  if (!s) throw new Error('Empty block name');
  let i = 0;
  while (i < s.length && s[i] !== '[' && s[i] !== '{') i++;
  const name = normName(s.slice(0, i));
  if (!name) throw new Error(`Missing block name in "${input}"`);
  const props = {};
  let nbt = null;
  if (s[i] === '[') {
    const end = s.indexOf(']', i);
    if (end < 0) throw new Error(`Unclosed "[" in block "${input}"`);
    const body = s.slice(i + 1, end).trim();
    if (body) {
      for (const part of body.split(',')) {
        const eq = part.indexOf('=');
        if (eq < 0) throw new Error(`Bad property "${part.trim()}" in block "${input}" (expected key=value)`);
        const k = part.slice(0, eq).trim().toLowerCase();
        const v = part.slice(eq + 1).trim().toLowerCase();
        if (!k || !v) throw new Error(`Bad property "${part.trim()}" in block "${input}"`);
        props[k] = v;
      }
    }
    i = end + 1;
  }
  if (i < s.length) {
    const rest = s.slice(i).trim();
    if (!rest.startsWith('{') || !rest.endsWith('}')) throw new Error(`Unexpected text "${rest}" in block "${input}"`);
    nbt = rest;
  }
  return { name, props, nbt };
}

function normName(n) {
  let name = String(n).trim().toLowerCase().replace(/\s+/g, '_');
  if (name.startsWith('minecraft:')) name = name.slice(10);
  return name;
}

/** @param {BlockState} b */
export function formatBlock(b, { namespace = false } = {}) {
  const keys = Object.keys(b.props || {}).sort();
  let s = (namespace && !b.name.includes(':') ? 'minecraft:' : '') + b.name;
  if (keys.length) s += '[' + keys.map((k) => `${k}=${b.props[k]}`).join(',') + ']';
  if (b.nbt) s += b.nbt;
  return s;
}

/** Canonical string for any block input. Cached. */
export function canonical(input) {
  if (typeof input === 'string') {
    let c = cache.get(input);
    if (c === undefined) {
      c = formatBlock(parseBlock(input));
      if (cache.size > 50000) cache.clear();
      cache.set(input, c);
    }
    return c;
  }
  return formatBlock(parseBlock(input));
}

/** Name only (no props / nbt) of a canonical or raw block string. */
export function blockName(input) {
  if (typeof input !== 'string') return parseBlock(input).name;
  const i = input.search(/[[{]/);
  return normName(i < 0 ? input : input.slice(0, i));
}

/** Return a copy of `block` with `props` merged in. */
export function withProps(block, props) {
  const b = parseBlock(block);
  return formatBlock({ ...b, props: { ...b.props, ...props } });
}

export const AIR_NAMES = new Set(['air', 'cave_air', 'void_air']);
export const isAir = (block) => block != null && AIR_NAMES.has(blockName(block));
