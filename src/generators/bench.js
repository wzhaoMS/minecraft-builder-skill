import { materialFamily, stairs, finish } from './helpers.js';

/** Bench: a row of stairs (the seat) with trapdoor armrests; the sitter faces `facing`. */
export default {
  name: 'bench',
  description: 'Park bench made of stairs with trapdoor armrests (the sitter looks toward the front/south)',
  params: {
    length: { type: 'int', default: 3, min: 1, max: 16, description: 'seats' },
    material: { type: 'block', default: 'spruce', description: 'wood (stairs + trapdoors)' },
    armrests: { type: 'bool', default: true, description: 'trapdoor armrests at both ends' },
  },
  build(s, p) {
    const fam = materialFamily(p.material);
    const ox = p.armrests ? 1 : 0;
    // sitter faces south → the tall back of the stairs is on the north
    for (let i = 0; i < p.length; i++) s.set(ox + i, 0, 0, stairs(fam.stairs ? p.material : 'spruce', 'north'));
    if (p.armrests) {
      const td = fam.trapdoor ?? 'spruce_trapdoor';
      // open trapdoors standing against the ends of the seat
      s.set(0, 0, 0, `${td}[facing=west,half=bottom,open=true]`);
      s.set(ox + p.length, 0, 0, `${td}[facing=east,half=bottom,open=true]`);
    }
    finish(s);
  },
};
