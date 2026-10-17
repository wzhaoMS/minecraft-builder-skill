/**
 * Block-entity data ("NBT": sign text, banner patterns, head profiles…) compared the way the game
 * means it. The same data is spelled differently by blueprints and by what a client receives: sign
 * lines as JSON strings ('"Hi"', '{"text":"Hi"}') or text components ("Hi", {text:"Hi"}), ids with
 * or without "minecraft:", default values present or left out. Everything is compared through a
 * canonical plain-object form.
 */
import { parseSnbt } from '../io/formats/nbt-util.js';
import { blockName } from './blockstate.js';

/** Blocks whose block-entity data the server shares with clients, so a bot can read it. */
const CLIENT_DATA_RE = /(_sign|_banner|_skull|_head)$|^decorated_pot$/;
export const clientSeesData = (block) => {
  const n = blockName(block);
  return CLIENT_DATA_RE.test(n) && n !== 'piston_head';
};

const isSign = (block) => /_sign$/.test(blockName(block));
const TEXT_KEYS = new Set(['messages', 'filtered_messages', 'custom_name', 'CustomName', 'Text1', 'Text2', 'Text3', 'Text4']);
const RESOURCE_RE = /^minecraft:[a-z0-9_./-]+$/;

/** The `{…}` part of a block string, or null. */
export function nbtPart(block) {
  const s = String(block);
  const i = s.indexOf('{');
  return i < 0 ? null : s.slice(i);
}

/** A text component (JSON string, SNBT compound or plain string) as a canonical value. */
function canonicalText(v) {
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('{') || t.startsWith('[') || t.startsWith('"')) {
      try { return canonicalText(JSON.parse(t)); } catch { /* plain text that merely looks like JSON */ }
    }
    return v;
  }
  if (Array.isArray(v)) {
    const parts = v.map(canonicalText);
    return parts.every((p) => typeof p === 'string') ? parts.join('') : parts;
  }
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) {
      const x = k === 'extra' ? canonicalText(v[k]) : v[k];
      if (k === 'extra' && (x === '' || (Array.isArray(x) && !x.length))) continue;
      o[k] = x;
    }
    const keys = Object.keys(o);
    if (!keys.length) return '';
    // {text:"a"} and {text:"a", extra:["b"]} without styling are plain text
    if (keys.every((k) => k === 'text' || k === 'extra') && (o.extra === undefined || typeof o.extra === 'string')) {
      return `${o.text ?? ''}${o.extra ?? ''}`;
    }
    return o;
  }
  return v;
}

/** Parsed NBT tag → plain canonical value. */
function plain(tag, key = null) {
  switch (tag.type) {
    case 'compound': {
      const o = {};
      for (const k of Object.keys(tag.value)) o[k] = plain(tag.value[k], k);
      return TEXT_KEYS.has(key) ? canonicalText(o) : o;
    }
    case 'list': {
      const t = tag.value.type;
      return tag.value.value.map((v) => {
        const p = plain({ type: t, value: v }, null);
        return TEXT_KEYS.has(key) ? canonicalText(p) : p;
      });
    }
    case 'string':
      if (TEXT_KEYS.has(key)) return canonicalText(tag.value);
      return RESOURCE_RE.test(tag.value) ? tag.value.slice('minecraft:'.length) : tag.value;
    case 'long':
      return String(tag.value);
    case 'byteArray': case 'intArray': case 'longArray':
      return Array.from(tag.value, (v) => (typeof v === 'number' ? v : String(v)));
    default:
      return tag.value;
  }
}

function fillSignDefaults(o) {
  for (const side of ['front_text', 'back_text']) {
    const s = o[side] && typeof o[side] === 'object' ? o[side] : (o[side] = {});
    s.color ??= 'black';
    s.has_glowing_text ??= 0;
    s.messages ??= ['', '', '', ''];
    if (s.filtered_messages && JSON.stringify(s.filtered_messages) === JSON.stringify(s.messages)) delete s.filtered_messages;
  }
  o.is_waxed ??= 0;
  return o;
}

/**
 * The block data of a block string as a canonical object (sign defaults filled in), {} when the
 * block carries none, or null when it can't be parsed.
 */
export function blockData(block, { fill = true } = {}) {
  const raw = nbtPart(block);
  let o = {};
  if (raw) {
    try {
      o = plain(parseSnbt(raw));
    } catch {
      return null;
    }
  }
  return fill && isSign(block) ? fillSignDefaults(o) : o;
}

function subset(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => subset(v, b[i]));
  if (a && typeof a === 'object') {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
    return Object.keys(a).every((k) => subset(a[k], b[k]));
  }
  return a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6);
}

const equal = (a, b) => subset(a, b) && subset(b, a);

/**
 * Does world block `cur` carry (at least) the block data blueprint block `want` asks for?
 * A block whose data clients never see (chest contents…) and that came back without any is
 * unknown: not satisfied, so it is sent again.
 */
export function dataSatisfied(want, cur) {
  if (!nbtPart(want)) return true;
  if (!nbtPart(cur) && !clientSeesData(cur)) return false;
  const a = blockData(want, { fill: false }), b = blockData(cur);
  if (a == null || b == null) return nbtPart(want) === nbtPart(cur);
  return subset(a, b);
}

/**
 * Do two block strings carry the same block data? For data clients see, missing values mean the
 * game's defaults (a bare sign is a blank sign); other data must be spelled identically.
 */
export function dataEquivalent(a, b) {
  const na = nbtPart(a), nb = nbtPart(b);
  if (!na && !nb) return true;
  if (!clientSeesData(a) || !clientSeesData(b)) return na === nb;
  const x = blockData(a), y = blockData(b);
  if (x == null || y == null) return na === nb;
  return equal(x, y);
}
