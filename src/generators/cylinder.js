/** Vertical cylinder / tube. */
export default {
  name: 'cylinder',
  description: 'Vertical cylinder (hollow tube by default)',
  params: {
    radius: { type: 'int', default: 5, min: 1, max: 64, description: 'radius in blocks' },
    height: { type: 'int', default: 10, min: 1, max: 384, description: 'height in blocks' },
    material: { type: 'block', default: 'stone_bricks', description: 'block to build with' },
    hollow: { type: 'bool', default: true, description: 'hollow tube (false = solid)' },
    thickness: { type: 'int', default: 1, min: 1, max: 16, description: 'wall thickness when hollow' },
  },
  build(s, p) {
    s.cylinder(p.radius, 0, p.radius, p.radius, p.height, p.material, { hollow: p.hollow, thickness: p.thickness });
  },
};
