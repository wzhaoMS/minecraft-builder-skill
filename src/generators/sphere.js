/** Sphere / ball — compatible with the v1 blueprint generator ({ radius, material }). */
export default {
  name: 'sphere',
  description: 'Sphere (hollow shell by default) sitting on the ground: bottom at y=0',
  params: {
    radius: { type: 'int', default: 6, min: 1, max: 64, description: 'radius in blocks (diameter = 2r+1)' },
    material: { type: 'block', default: 'glass', description: 'block to build with' },
    hollow: { type: 'bool', default: true, description: 'hollow shell (false = solid ball)' },
    thickness: { type: 'int', default: 1, min: 1, max: 16, description: 'shell thickness when hollow' },
  },
  build(s, p) {
    const r = p.radius;
    s.sphere(r, r, r, r, p.material, { hollow: p.hollow, thickness: p.thickness });
  },
};
