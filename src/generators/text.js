import { Structure } from '../core/structure.js';
import { textBitmap } from './font.js';

// rotation (clockwise quarter turns) that turns south-readable text to be readable from `facing`
const TURNS = { south: 0, west: 1, north: 2, east: 3 };

/**
 * Block text that is ALWAYS readable from the stated side.
 * Built south-readable (left→right = +X, top row highest), then rotated as a whole for other facings.
 * plane 'flat' lies on the ground: readable standing on the `facing` side looking across it.
 */
export default {
  name: 'text',
  description: 'Block letters (5×7 or 3×5 font), vertical sign or flat on the ground, readable from the chosen side',
  params: {
    text: { type: 'text', default: 'HELLO', description: 'the text (a literal "\\n" starts a new line)' },
    block: { type: 'block', default: 'gold_block', description: 'letter block' },
    font: { type: 'enum', values: ['5x7', '3x5'], default: '5x7', description: 'bitmap font' },
    scale: { type: 'int', default: 1, min: 1, max: 16, description: 'pixel size in blocks' },
    facing: { type: 'enum', values: ['south', 'north', 'east', 'west'], default: 'south', description: 'side the text is read from' },
    plane: { type: 'enum', values: ['vertical', 'flat'], default: 'vertical', description: 'standing sign or lying on the ground' },
    background: { type: 'block', default: '', description: 'background block (empty = none)' },
    padding: { type: 'int', default: 0, min: 0, max: 32, description: 'background margin around the text' },
    depth: { type: 'int', default: 1, min: 1, max: 16, description: 'letter thickness (letters stand out from the background)' },
    spacing: { type: 'int', default: 1, min: 0, max: 8, description: 'gap between letters (in font pixels)' },
    lineSpacing: { type: 'int', default: 2, min: 0, max: 16, description: 'gap between lines (in font pixels)' },
    align: { type: 'enum', values: ['left', 'center', 'right'], default: 'center', description: 'alignment of multi-line text' },
  },
  build(s, p) {
    const src = String(p.text ?? '').replace(/\\n/g, '\n');
    const bm = textBitmap(src, { font: p.font, scale: p.scale, spacing: p.spacing, lineSpacing: p.lineSpacing, align: p.align });
    const t = new Structure();
    const pad = p.padding;
    const W = bm.width + 2 * pad, H = bm.height + 2 * pad;
    // south-readable: pixel (px, py) → x = px, top row at the highest y; letters stick out toward +z (south)
    const put = (u, v, layer, b) => {
      if (p.plane === 'flat') t.set(u, layer, v, b); // v = row from the top → z (north = top of letters)
      else t.set(u, H - 1 - v, layer, b);
    };
    if (p.background) {
      for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) put(u, v, 0, p.background);
    }
    const firstLayer = p.background && p.depth > 1 ? 1 : 0;
    const layers = p.background ? Math.max(1, p.depth - 1) : p.depth;
    for (let py = 0; py < bm.height; py++) {
      for (let px = 0; px < bm.width; px++) {
        if (!bm.pixels(px, py)) continue;
        for (let l = 0; l < layers; l++) put(px + pad, py + pad, firstLayer + l, p.block);
      }
    }
    const turns = TURNS[p.facing];
    s.paste(turns ? t.transformed({ rotate: turns }) : t, 0, 0, 0);
  },
};
