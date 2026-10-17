import { Structure } from '../core/structure.js';
import { lamp, finish } from './helpers.js';

/** Straight road segment with lane markings, raised sidewalks, curbs and street lamps. */
export default {
  name: 'road',
  description: 'Straight road: asphalt at ground level, dashed centre line, raised sidewalks with curbs, street lamps',
  params: {
    length: { type: 'int', default: 32, min: 4, max: 1024, description: 'length along the road' },
    width: { type: 'int', default: 7, min: 3, max: 32, description: 'carriageway width (without sidewalks)' },
    axis: { type: 'enum', values: ['x', 'z'], default: 'x', description: 'direction the road runs' },
    material: { type: 'block', default: 'gray_concrete', description: 'asphalt (try black_concrete)' },
    lines: { type: 'bool', default: true, description: 'dashed centre line' },
    lineColor: { type: 'block', default: 'yellow_concrete', description: 'centre line block' },
    sidewalks: { type: 'bool', default: true, description: 'raised sidewalks on both sides' },
    sidewalkWidth: { type: 'int', default: 2, min: 1, max: 8, description: 'sidewalk width' },
    curbs: { type: 'bool', default: true, description: 'curb stones along the sidewalk edge' },
    lamps: { type: 'int', default: 12, min: 0, max: 64, description: 'street lamp spacing (0 = none)' },
  },
  build(s, p) {
    const road = buildRoad(new Structure(), p);
    s.paste(p.axis === 'z' ? road.transformed({ rotate: 90 }) : road, 0, 0, 0);
    finish(s);
  },
};

/** Draw a road along +X into `s` (z = 0 is the north edge of the carriageway, surface at y = -1). */
export function buildRoad(s, p) {
  const L = p.length, W = p.width, sw = p.sidewalks ? p.sidewalkWidth : 0;
  s.fill(0, -1, 0, L - 1, -1, W - 1, p.material);
  if (p.lines && W >= 3) {
    const cz = Math.floor(W / 2);
    for (let x = 0; x < L; x++) {
      if (x % 6 >= 3) continue;
      s.set(x, -1, cz, p.lineColor);
      if (W % 2 === 0) s.set(x, -1, cz - 1, p.lineColor);
    }
  }
  if (sw) {
    for (const [z0, z1, curbZ] of [[-sw, -1, -1], [W, W + sw - 1, W]]) {
      s.fill(0, -1, z0, L - 1, -1, z1, 'stone');
      s.fill(0, 0, z0, L - 1, 0, z1, 'smooth_stone_slab[type=bottom]');
      if (p.curbs) s.fill(0, 0, curbZ, L - 1, 0, curbZ, 'polished_andesite_slab[type=bottom]');
    }
    if (p.lamps > 0) {
      const half = Math.floor(p.lamps / 2);
      for (let x = half; x < L; x += p.lamps) {
        // staggered: north side, then the south side half a spacing later; arms reach over the road
        lamp(s, x, 0, -sw, { style: 'street', height: 5, post: 'polished_blackstone_wall', facing: 'south', arm: 1 });
        const x2 = x + half;
        if (x2 < L) lamp(s, x2, 0, W + sw - 1, { style: 'street', height: 5, post: 'polished_blackstone_wall', facing: 'north', arm: 1 });
      }
    }
  }
  return s;
}
