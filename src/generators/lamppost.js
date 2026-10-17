import { lamp, withProps, finish } from './helpers.js';

/** Street furniture: a lamp post in a few styles. */
export default {
  name: 'lamppost',
  description: 'Lamp post: garden post, street lamp with an arm, double-arm boulevard lamp, or a hanging lantern on a bracket',
  params: {
    style: { type: 'enum', values: ['garden', 'street', 'double', 'bracket'], default: 'street', description: 'design' },
    height: { type: 'int', default: 5, min: 2, max: 16, description: 'height of the post' },
    post: { type: 'block', default: '', description: 'post block (default: dark_oak_fence for garden/bracket, polished_blackstone_wall otherwise)' },
    light: { type: 'enum', values: ['lantern', 'soul_lantern', 'copper_lantern'], default: 'lantern', description: 'light' },
  },
  build(s, p) {
    const post = p.post || (p.style === 'garden' || p.style === 'bracket' ? 'dark_oak_fence' : 'polished_blackstone_wall');
    if (p.style === 'garden') {
      lamp(s, 0, 0, 0, { style: 'post', height: Math.min(p.height, 4), post, light: p.light });
    } else if (p.style === 'double') {
      lamp(s, 2, 0, 0, { style: 'street', height: p.height, post, facing: 'east', arm: 2, light: p.light });
      for (let i = 1; i <= 2; i++) s.set(2 - i, p.height - 1, 0, post);
      s.set(0, p.height - 2, 0, withProps(p.light, { hanging: 'true' }));
      s.set(2, p.height, 0, 'polished_blackstone_slab[type=bottom]');
    } else if (p.style === 'bracket') {
      // free-standing wooden post with a bracket arm toward the south and a hanging lantern
      s.fill(0, 0, 0, 0, p.height - 1, 0, post);
      s.set(0, p.height - 1, 1, post);
      s.set(0, p.height - 2, 1, withProps(p.light, { hanging: 'true' }));
    } else {
      lamp(s, 0, 0, 0, { style: 'street', height: p.height, post, facing: 'south', arm: 1, light: p.light });
    }
    finish(s);
  },
};
