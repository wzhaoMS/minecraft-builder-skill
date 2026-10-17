/**
 * Rotation / mirroring of coordinates and block states.
 *
 * Conventions (Minecraft): +X = east, +Z = south, +Y = up.
 * `rotate` is clockwise when viewed from above, in quarter turns (90° steps), around the origin:
 *   (x, z) → (-z, x)   (north → east → south → west)
 * `mirror: 'x'` flips the X axis (east ↔ west), `mirror: 'z'` flips Z (north ↔ south).
 * When both are given, mirror is applied first, then rotation.
 */
import { parseBlock, formatBlock } from './blockstate.js';

const HORIZ = ['north', 'east', 'south', 'west'];
const CW = { north: 'east', east: 'south', south: 'west', west: 'north' };
const FLIP_X = { east: 'west', west: 'east' };
const FLIP_Z = { north: 'south', south: 'north' };

/** Normalize degrees / turns to 0..3 clockwise quarter turns. */
export function toQuarterTurns(rotate) {
  if (rotate == null || rotate === '') return 0;
  let n = Number(rotate);
  if (!Number.isFinite(n)) throw new Error(`Invalid rotation "${rotate}" (use 0, 90, 180 or 270)`);
  if (Math.abs(n) >= 4 || n === 0) {
    if (n % 90 !== 0) throw new Error(`Rotation must be a multiple of 90 degrees, got ${rotate}`);
    n = n / 90;
  }
  return ((n % 4) + 4) % 4;
}

export function rotateDir(dir, turns) {
  let d = dir;
  for (let i = 0; i < turns; i++) d = CW[d] ?? d;
  return d;
}

export function mirrorDir(dir, axis) {
  if (axis === 'x') return FLIP_X[dir] ?? dir;
  if (axis === 'z') return FLIP_Z[dir] ?? dir;
  return dir;
}

/** Transform a point (integers). */
export function transformPoint(x, y, z, { rotate = 0, mirror = null } = {}) {
  if (mirror === 'x') x = 0 - x;
  else if (mirror === 'z') z = 0 - z;
  const t = toQuarterTurns(rotate);
  for (let i = 0; i < t; i++) {
    const nx = 0 - z;
    z = x;
    x = nx;
  }
  return [x, y, z];
}

/** Which way a facing points after the transform. */
export function transformDir(dir, { rotate = 0, mirror = null } = {}) {
  return rotateDir(mirrorDir(dir, mirror), toQuarterTurns(rotate));
}

const SWAP_LR = { left: 'right', right: 'left' };
const SWAP_SHAPE = {
  inner_left: 'inner_right', inner_right: 'inner_left',
  outer_left: 'outer_right', outer_right: 'outer_left',
};

function mapDirFn(fn) {
  return (v) => (HORIZ.includes(v) ? fn(v) : v);
}

function transformRailShape(shape, dirFn) {
  if (shape === 'north_south' || shape === 'east_west') {
    const d = dirFn(shape === 'north_south' ? 'north' : 'east');
    return d === 'north' || d === 'south' ? 'north_south' : 'east_west';
  }
  if (shape.startsWith('ascending_')) return 'ascending_' + dirFn(shape.slice(10));
  const parts = shape.split('_');
  if (parts.length === 2 && parts.every((p) => HORIZ.includes(p))) {
    const ds = parts.map(dirFn);
    const ns = ds.find((d) => d === 'north' || d === 'south');
    const ew = ds.find((d) => d === 'east' || d === 'west');
    if (ns && ew) return `${ns}_${ew}`;
  }
  return shape;
}

/**
 * Apply a transform to a single block state's properties.
 * @param {string} block canonical or raw block string
 * @returns {string} canonical block string
 */
export function transformBlock(block, { rotate = 0, mirror = null } = {}) {
  const turns = toQuarterTurns(rotate);
  if (!turns && !mirror) return block;
  const b = parseBlock(block);
  const keys = Object.keys(b.props);
  if (!keys.length) return formatBlock(b);
  const dirFn = (d) => rotateDir(mirrorDir(d, mirror), turns);
  const mapDir = mapDirFn(dirFn);
  const p = { ...b.props };
  const out = {};
  const horizSeen = {};
  for (const k of keys) {
    const v = p[k];
    if (HORIZ.includes(k)) { horizSeen[k] = v; continue; }
    switch (k) {
      case 'facing':
      case 'horizontal_facing':
        out[k] = mapDir(v);
        break;
      case 'axis':
        out[k] = turns % 2 === 1 && (v === 'x' || v === 'z') ? (v === 'x' ? 'z' : 'x') : v;
        break;
      case 'rotation': {
        let r = Number(v);
        if (Number.isInteger(r)) {
          if (mirror === 'x') r = (16 - r) % 16;
          else if (mirror === 'z') r = (24 - r) % 16;
          r = (r + 4 * turns) % 16;
          out[k] = String(r);
        } else out[k] = v;
        break;
      }
      case 'shape':
        if (SWAP_SHAPE[v] || v === 'straight') out[k] = mirror ? (SWAP_SHAPE[v] ?? v) : v;
        else out[k] = transformRailShape(v, dirFn);
        break;
      case 'hinge':
        out[k] = mirror ? (SWAP_LR[v] ?? v) : v;
        break;
      case 'type':
        // chests: single/left/right (slabs use top/bottom/double and are untouched)
        out[k] = mirror ? (SWAP_LR[v] ?? v) : v;
        break;
      case 'orientation':
        // jigsaw / crafter: "<front>_<top>", e.g. north_up, up_east
        out[k] = v.split('_').map(mapDir).join('_');
        break;
      default:
        out[k] = v;
    }
  }
  for (const [k, v] of Object.entries(horizSeen)) out[dirFn(k)] = v;
  return formatBlock({ name: b.name, props: out, nbt: b.nbt });
}
