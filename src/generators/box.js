/** Box / cuboid. */
export default {
  name: 'box',
  description: 'Rectangular box (hollow room with air inside by default)',
  params: {
    width: { type: 'int', default: 7, min: 1, max: 256, description: 'size along X (east)' },
    height: { type: 'int', default: 5, min: 1, max: 384, description: 'size along Y' },
    depth: { type: 'int', default: 7, min: 1, max: 256, description: 'size along Z (south)' },
    material: { type: 'block', default: 'stone_bricks', description: 'block to build with' },
    hollow: { type: 'bool', default: true, description: 'hollow (shell + air inside, like /fill … hollow)' },
  },
  build(s, p) {
    s.fill(0, 0, 0, p.width - 1, p.height - 1, p.depth - 1, p.material, { mode: p.hollow ? 'hollow' : 'replace' });
  },
};
