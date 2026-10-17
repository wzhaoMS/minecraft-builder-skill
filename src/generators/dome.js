/** Dome — a hemisphere shell with an optional floor, a south entrance and a hanging lantern. */
export default {
  name: 'dome',
  description: 'Hemispherical dome (observatory / greenhouse / igloo) with a south entrance',
  params: {
    radius: { type: 'int', default: 8, min: 2, max: 64, description: 'radius in blocks' },
    material: { type: 'block', default: 'white_concrete', description: 'shell block (try glass, white_stained_glass, snow_block)' },
    thickness: { type: 'int', default: 1, min: 1, max: 8, description: 'shell thickness' },
    floor: { type: 'bool', default: true, description: 'lay a floor disc at y=-1 (replaces the ground)' },
    floorMaterial: { type: 'block', default: 'polished_andesite', description: 'floor block' },
    entrance: { type: 'bool', default: true, description: 'cut a doorway on the south side' },
    light: { type: 'bool', default: true, description: 'hang a lantern from the top inside' },
  },
  build(s, p) {
    const r = p.radius, t = Math.min(p.thickness, r);
    const c = r;
    if (p.floor) s.cylinder(c, -1, c, r, 1, p.floorMaterial);
    if (r - t >= 0) s.sphere(c, 0, c, r - t, 'air', { half: 'top' });
    s.sphere(c, 0, c, r, p.material, { hollow: true, thickness: t, half: 'top' });
    if (p.entrance && r >= 3) {
      const hw = r >= 6 ? 1 : 0;
      const h = Math.min(r >= 6 ? 3 : 2, r - 1);
      for (let x = c - hw; x <= c + hw; x++) {
        for (let y = 0; y < h; y++) {
          for (let z = c; z <= c + r; z++) if (s.get(x, y, z) != null) s.set(x, y, z, 'air');
        }
      }
    }
    if (p.light && r - t >= 2) {
      const top = Math.floor(r + 0.5 - t); // highest interior (air) cell on the axis
      const chain = Math.max(0, Math.min(Math.floor(r / 3), top - 3));
      const anchor = s.get(c, top + 1, c);
      if (anchor && anchor !== 'air') {
        for (let i = 0; i < chain; i++) s.set(c, top - i, c, 'iron_chain[axis=y]');
        s.set(c, top - chain, c, 'lantern[hanging=true]');
      }
    }
  },
};
