/**
 * The "TECH" tower — port of fly-tech-placer.js and capture-tech-tower-demo.js (the TECH-tower demo GIF).
 *
 * The scripts built a brick tower with `/fill`, then had a bot fly around it placing gold blocks one at a time:
 * "TECH" in the top third of the south face (capture script, 18×8 tower), and later on all four faces of a square
 * tower (fly-tech-placer). Mapping one pixel list onto four faces by hand made the text come out mirrored on some of
 * them — the mirrored-text bug. Here the letters are one south-facing structure that is rotated for the other faces.
 *
 * Layout (blueprint space, front = south): the body is x 1..18, z 1..8; the 2-high stone-brick base and the cornice
 * stick out one block, so the footprint's north-west corner is (0, 0). The letters stand one block in front of the wall.
 */

// 16 × 5 letter bitmap, top row first (the capture script's makeTECH: T, E, C, H with one empty column between them)
const TECH_BITMAP = [
  '###.###.###.#..#',
  '.#..#...#...#..#',
  '.#..###.#...####',
  '.#..#...#...#..#',
  '.#..###.###.#..#',
];

function bitmapLetters(Structure, block) {
  const letters = new Structure();
  TECH_BITMAP.forEach((row, i) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') letters.set(x, TECH_BITMAP.length - 1 - i, 0, block);
  });
  return letters;
}

/** South-facing "TECH" with its minimum corner at (0, 0, 0): from the text generator when the repo has one, else the bitmap. */
function makeLetters(ctx) {
  // the compact 3×5 font keeps the letters within the 18-wide wall; a generator without that option gets its default font
  for (const font of [{ font: '3x5' }, {}]) {
    try {
      const generated = ctx.gen('text', { text: 'TECH', block: 'gold_block', facing: 'south', ...font });
      const letters = new ctx.Structure(); // just the gold: whatever else the generator adds (a backing, air) stays out
      generated.forEach((x, y, z, b) => { if (b === 'gold_block') letters.set(x, y, z, b); });
      if (letters.count > 0) return letters.normalized();
    } catch {
      // no `text` generator, or it does not know this option: try the next one
    }
  }
  return bitmapLetters(ctx.Structure, 'gold_block');
}

export default {
  name: 'tech-tower-letters',
  description:
    'Brick tower (18×8, 14 tall) with a stone-brick base, glass strips, cornice and a pointed dark-oak roof, and gold TECH letters ' +
    'standing out from the top of its south face. `allSides` puts a TECH on every face, each readable from outside. ' +
    'Ported from fly-tech-placer.js and capture-tech-tower-demo.js.',
  params: {
    allSides: {
      type: 'bool',
      default: false,
      description: 'TECH on all four faces, each readable from outside (the tower becomes square so the letters fit on the short faces too)',
    },
  },
  build(s, p, ctx) {
    const letters = makeLetters(ctx);
    const [lw, lh] = letters.bounds().size;

    const TX = 1, TZ = 1; // north-west corner of the body
    const TY = -1; // ground
    const TW = Math.max(18, lw + 2), TH = 14; // 18 wide, or wider if the letters need it
    const TD = p.allSides ? TW : 8;
    const SOUTH_FACE_Z = TZ + TD - 1;
    const LY = Math.min(TY + TH - 7, TY + TH - 1 - lh); // letters in the top third, with body below them

    // Stone-brick base (first 2 layers), sticking out one block
    s.fill(TX - 1, TY + 1, TZ - 1, TX + TW, TY + 2, TZ + TD, 'stone_bricks');
    // Tower body — bricks, hollow
    s.fill(TX, TY + 3, TZ, TX + TW - 1, TY + TH - 1, TZ + TD - 1, 'bricks', { mode: 'hollow' });
    // Window strips on the south face (vertical glass), under the letters
    for (const wx of [TX + 3, TX + 10]) s.fill(wx, TY + 4, SOUTH_FACE_Z, wx, LY - 1, SOUTH_FACE_Z, 'glass');
    // Stone-brick cornice band right above the brick body
    s.fill(TX - 1, TY + TH, TZ - 1, TX + TW, TY + TH, TZ + TD, 'stone_bricks');
    // Pointed roof — layers of dark oak, one block smaller on every side, and a ridge on the last one
    let r = 0;
    for (; TX + r <= TX + TW - 1 - r && TZ + r <= TZ + TD - 1 - r; r++) {
      s.fill(TX + r, TY + TH + 1 + r, TZ + r, TX + TW - 1 - r, TY + TH + 1 + r, TZ + TD - 1 - r, 'dark_oak_planks');
    }
    const ridgeX = TX + Math.floor(TW / 2);
    s.fill(ridgeX, TY + TH + 1 + r, TZ + r - 1, ridgeX, TY + TH + 1 + r, TZ + TD - r, 'dark_oak_planks');

    // TECH: one south-facing structure, turned clockwise (seen from above) for each further face: south → west → north → east
    const faces = [
      { facing: 'south', rotate: 0 },
      { facing: 'west', rotate: 90 },
      { facing: 'north', rotate: 180 },
      { facing: 'east', rotate: 270 },
    ];
    for (const { facing, rotate } of p.allSides ? faces : faces.slice(0, 1)) {
      const t = letters.transformed({ rotate });
      const b = t.bounds();
      const [w, , d] = b.size;
      // centred along the wall, back plane touching the wall's outside
      let dx, dz;
      switch (facing) {
        case 'south': dx = TX + Math.floor((TW - w) / 2) - b.min[0]; dz = TZ + TD - b.min[2]; break;
        case 'north': dx = TX + Math.floor((TW - w) / 2) - b.min[0]; dz = TZ - 1 - b.max[2]; break;
        case 'west': dx = TX - 1 - b.max[0]; dz = TZ + Math.floor((TD - d) / 2) - b.min[2]; break;
        case 'east': dx = TX + TW - b.min[0]; dz = TZ + Math.floor((TD - d) / 2) - b.min[2]; break;
      }
      s.paste(t, dx, LY - b.min[1], dz);
    }
  },
};
