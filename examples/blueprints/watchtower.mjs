/**
 * Watchtower — a JS blueprint example (procedural, parametric, deterministic).
 *
 *   mcb preview examples/blueprints/watchtower.mjs -p height=16 -o tower.png
 *   mcb build   examples/blueprints/watchtower.mjs --near Steve --verify
 *
 * Front (door) faces south. Uses only the Structure API so it's easy to read and adapt.
 */
export default {
  name: 'watchtower',
  description: 'Stone watchtower with log corners, a ladder inside, a fenced lookout deck and a hipped roof.',
  params: {
    height: { type: 'int', default: 12, min: 6, max: 60, description: 'Height of the stone shaft' },
    stone: { type: 'block', default: 'stone_bricks', description: 'Main wall block' },
    wood: { type: 'enum', values: ['spruce', 'oak', 'dark_oak', 'birch', 'jungle', 'acacia', 'mangrove', 'cherry'], default: 'spruce', description: 'Wood type for trim, deck and railing' },
    roof: { type: 'enum', values: ['dark_oak', 'spruce', 'oak', 'mangrove', 'cherry'], default: 'dark_oak', description: 'Wood type of the roof stairs' },
    moss: { type: 'number', default: 0.18, min: 0, max: 1, description: 'Fraction of weathered (mossy/cracked) wall blocks' },
  },
  build(s, p, ctx) {
    const h = p.height;
    const W = p.wood;
    const weathered = ['mossy_stone_bricks', 'cracked_stone_bricks'];
    const wall = () => (p.stone === 'stone_bricks' && ctx.rng.chance(p.moss) ? ctx.rng.pick(weathered) : p.stone);

    // footing + shaft (5×5, hollow) on a 7×7 cobblestone base
    s.fill(0, 0, 0, 6, 0, 6, 'cobblestone');
    for (let y = 1; y <= h; y++) {
      for (let x = 1; x <= 5; x++) {
        for (let z = 1; z <= 5; z++) {
          const edge = x === 1 || x === 5 || z === 1 || z === 5;
          s.set(x, y, z, edge ? wall() : 'air');
        }
      }
    }
    // log corners and a log band every 5 blocks
    for (const [x, z] of [[1, 1], [5, 1], [1, 5], [5, 5]]) s.fill(x, 1, z, x, h, z, `${W}_log`);
    for (let y = 5; y < h; y += 5) {
      s.fill(2, y, 1, 4, y, 1, `${W}_log[axis=x]`).fill(2, y, 5, 4, y, 5, `${W}_log[axis=x]`);
      s.fill(1, y, 2, 1, y, 4, `${W}_log[axis=z]`).fill(5, y, 2, 5, y, 4, `${W}_log[axis=z]`);
    }
    // door (front = south) with torches either side, arrow slits on every side
    s.set(3, 1, 5, `${W}_door[facing=south,hinge=left]`); // upper half is added automatically
    s.set(2, 3, 6, 'wall_torch[facing=south]').set(4, 3, 6, 'wall_torch[facing=south]');
    for (let y = 4; y < h - 1; y += 4) {
      s.set(4, y, 1, 'air').set(4, y + 1, 1, 'air'); // north (beside the ladder, not behind it)
      s.set(1, y, 3, 'air').set(1, y + 1, 3, 'air'); // west
      s.set(5, y, 3, 'air').set(5, y + 1, 3, 'air'); // east
      if (y > 4) s.set(3, y, 5, 'air').set(3, y + 1, 5, 'air'); // south (above the door)
    }
    // ladder on the inside of the north wall, up through a hatch in the deck
    s.fill(3, 1, 2, 3, h + 1, 2, 'ladder[facing=south]');

    // lookout deck (7×7) with fence railing and log posts
    const d = h + 1;
    s.fill(0, d, 0, 6, d, 6, `${W}_planks`);
    s.set(3, d, 2, 'ladder[facing=south]');
    s.fill(0, d + 1, 0, 6, d + 1, 6, `${W}_fence`, { mode: 'walls' });
    s.set(3, d + 1, 0, `${W}_fence`);
    for (const [x, z] of [[0, 0], [6, 0], [0, 6], [6, 6]]) s.fill(x, d + 1, z, x, d + 3, z, `${W}_log`);
    s.set(3, d + 1, 3, 'lantern'); // a lantern on the deck

    // hipped roof: rings of stairs climbing toward the centre, overhanging the deck by one block
    const r = d + 4;
    const st = (f) => `${p.roof}_stairs[facing=${f}]`;
    for (let k = 0; k <= 3; k++) {
      const a = -1 + k, b = 7 - k, y = r + k;
      if (a > b) break;
      for (let x = a; x <= b; x++) { s.set(x, y, a, st('south')); s.set(x, y, b, st('north')); }
      for (let z = a + 1; z <= b - 1; z++) { s.set(a, y, z, st('east')); s.set(b, y, z, st('west')); }
      // eaves underside on the first ring
      if (k === 0) {
        for (let x = a; x <= b; x++) { s.set(x, y - 1, a, `${p.roof}_slab[type=top]`); s.set(x, y - 1, b, `${p.roof}_slab[type=top]`); }
        for (let z = a + 1; z <= b - 1; z++) { s.set(a, y - 1, z, `${p.roof}_slab[type=top]`); s.set(b, y - 1, z, `${p.roof}_slab[type=top]`); }
      }
    }
    s.set(3, r + 4, 3, `${p.roof}_slab`);
    s.set(3, r + 3, 3, `${p.roof}_planks`);
    s.set(3, r + 5, 3, 'lightning_rod');
  },
};
