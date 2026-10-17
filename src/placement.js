/**
 * Placement: where and how a blueprint lands in the world.
 *
 * Blueprint convention: the front faces SOUTH (+Z). `facing` turns the front toward a direction.
 * Anchors (x/z only — blueprint y=0 always lands on `at.y`, negative y goes below):
 *   corner  NW corner of the (rotated) footprint at at.x/at.z   (default for --at)
 *   center  footprint centre at at.x/at.z
 *   origin  blueprint (0,0,0) at `at` (raw coordinates, rotation around the origin)
 */
import { toQuarterTurns, transformDir } from './core/transform.js';

export const DIRS = ['north', 'east', 'south', 'west'];
const VEC = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
export const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };

/** Minecraft yaw (degrees; 0 = south, 90 = west, 180 = north, -90 = east) → cardinal direction looked at. */
export function yawToDir(yaw) {
  const a = ((Math.round(yaw / 90) % 4) + 4) % 4;
  return ['south', 'west', 'north', 'east'][a];
}

/** Clockwise quarter turns that make a south-facing front face `facing`. */
export function turnsForFacing(facing) {
  const f = String(facing).toLowerCase();
  const t = { south: 0, west: 1, north: 2, east: 3 }[f];
  if (t === undefined) throw new Error(`Invalid facing "${facing}" (north|east|south|west)`);
  return t;
}

/**
 * @param {import('./core/structure.js').Structure} structure
 * @param {{ at?: number[], anchor?: 'corner'|'center'|'origin', facing?: string, rotate?: number, mirror?: 'x'|'z'|null,
 *           pose?: {x:number,y:number,z:number,yaw:number}, gap?: number, side?: 'north'|'east'|'south'|'west' }} opts
 * @returns {{ world, origin:number[], turns:number, mirror, facing:string, bbox:{min:number[],max:number[],size:number[]} }}
 */
export function resolvePlacement(structure, opts = {}) {
  let { at, anchor, facing, rotate, mirror = null, pose, gap = 3, side } = opts;
  if (side != null && !VEC[String(side).toLowerCase()]) throw new Error(`Invalid side "${side}" (north|east|south|west)`);
  side = side != null ? String(side).toLowerCase() : null;
  let turns;
  if (pose && !at) {
    // the build goes on `side` of the player (default: where they look), front facing them
    const look = side ?? yawToDir(pose.yaw);
    facing = facing ?? OPPOSITE[look];
    turns = turnsForFacing(facing) + toQuarterTurns(rotate ?? 0);
  } else {
    turns = (facing ? turnsForFacing(facing) : 0) + toQuarterTurns(rotate ?? 0);
  }
  turns %= 4;
  const rotated = structure.transformed({ rotate: turns, mirror });
  const b = rotated.bounds();
  if (!b) throw new Error('Blueprint is empty — nothing to build');
  const [w, , d] = b.size;
  let origin; // world position of rotated (0,0,0)
  if (at) {
    const [ax, ay, az] = at.map(Math.floor);
    anchor = anchor ?? 'corner';
    if (anchor === 'origin') origin = [ax, ay, az];
    else if (anchor === 'center') origin = [ax - b.min[0] - Math.floor(w / 2), ay, az - b.min[2] - Math.floor(d / 2)];
    else if (anchor === 'corner') origin = [ax - b.min[0], ay, az - b.min[2]];
    else throw new Error(`Invalid anchor "${anchor}" (corner|center|origin)`);
  } else if (pose) {
    // On `side` of the player (default: in front of them), centred on that line, `gap` blocks
    // between them and the build's nearest edge, front facing them.
    const look = side ?? yawToDir(pose.yaw);
    const [vx, vz] = VEC[look];
    const px = Math.floor(pose.x), py = Math.floor(pose.y), pz = Math.floor(pose.z);
    const depthAlong = vx !== 0 ? w : d;
    const dist = gap + 1 + Math.floor(depthAlong / 2);
    const cx = px + vx * dist, cz = pz + vz * dist;
    origin = [cx - b.min[0] - Math.floor(w / 2), py, cz - b.min[2] - Math.floor(d / 2)];
  } else {
    throw new Error('No placement: give --at x,y,z or --near <player>');
  }
  const world = rotated.translated(origin[0], origin[1], origin[2]);
  const wb = world.bounds();
  return { world, origin, turns, mirror, facing: transformDir('south', { rotate: turns, mirror }), bbox: wb };
}
