import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Pixel art from a PNG / JPEG: area-average resize, CIEDE2000 colour matching against a block
 * palette, optional Floyd–Steinberg dithering. Vertical art faces south (readable from the south);
 * flat art lies on the ground with the top of the image toward the north.
 */

// Average texture colours (sRGB) of solid, non-gravity, property-less blocks.
// prettier-ignore
export const PALETTES = {
  concrete: {
    white_concrete: [207, 213, 214], orange_concrete: [224, 97, 1], magenta_concrete: [169, 48, 159], light_blue_concrete: [36, 137, 199],
    yellow_concrete: [241, 175, 21], lime_concrete: [94, 169, 24], pink_concrete: [214, 101, 143], gray_concrete: [55, 58, 62],
    light_gray_concrete: [125, 125, 115], cyan_concrete: [21, 119, 136], purple_concrete: [100, 32, 156], blue_concrete: [45, 47, 143],
    brown_concrete: [96, 60, 32], green_concrete: [73, 91, 36], red_concrete: [142, 33, 33], black_concrete: [8, 10, 15],
  },
  wool: {
    white_wool: [234, 236, 237], orange_wool: [241, 118, 20], magenta_wool: [190, 69, 180], light_blue_wool: [58, 175, 217],
    yellow_wool: [249, 198, 40], lime_wool: [112, 185, 26], pink_wool: [238, 141, 172], gray_wool: [63, 68, 72],
    light_gray_wool: [142, 142, 135], cyan_wool: [21, 138, 145], purple_wool: [122, 42, 173], blue_wool: [53, 57, 157],
    brown_wool: [114, 72, 41], green_wool: [85, 110, 28], red_wool: [161, 39, 35], black_wool: [21, 21, 26],
  },
  terracotta: {
    terracotta: [152, 94, 68], white_terracotta: [210, 178, 161], orange_terracotta: [162, 84, 38], magenta_terracotta: [150, 88, 109],
    light_blue_terracotta: [113, 109, 138], yellow_terracotta: [186, 133, 35], lime_terracotta: [104, 118, 53], pink_terracotta: [162, 78, 79],
    gray_terracotta: [58, 42, 36], light_gray_terracotta: [135, 107, 98], cyan_terracotta: [87, 91, 91], purple_terracotta: [118, 70, 86],
    blue_terracotta: [74, 60, 91], brown_terracotta: [77, 51, 36], green_terracotta: [76, 83, 42], red_terracotta: [143, 61, 47],
    black_terracotta: [37, 23, 16],
  },
  extra: {
    oak_planks: [162, 131, 79], spruce_planks: [115, 85, 49], birch_planks: [192, 175, 121], jungle_planks: [160, 115, 81],
    acacia_planks: [168, 90, 50], dark_oak_planks: [67, 43, 20], mangrove_planks: [117, 54, 48], cherry_planks: [227, 179, 173],
    bamboo_planks: [194, 173, 80], crimson_planks: [101, 49, 71], warped_planks: [43, 105, 99], pale_oak_planks: [228, 217, 216],
    stone: [126, 126, 126], cobblestone: [128, 127, 128], smooth_stone: [159, 159, 159], stone_bricks: [122, 122, 122],
    andesite: [136, 136, 137], polished_andesite: [132, 135, 134], diorite: [189, 188, 189], polished_diorite: [193, 193, 195],
    granite: [149, 103, 86], polished_granite: [154, 107, 89], deepslate: [80, 80, 82], cobbled_deepslate: [77, 77, 80],
    polished_deepslate: [72, 73, 73], deepslate_tiles: [54, 54, 55], tuff: [108, 109, 103], calcite: [223, 224, 221],
    dripstone_block: [134, 107, 92], blackstone: [42, 36, 41], polished_blackstone: [53, 49, 57], smooth_basalt: [72, 72, 78],
    sandstone: [216, 203, 155], red_sandstone: [186, 99, 29], bricks: [150, 97, 83], mud_bricks: [137, 104, 79],
    packed_mud: [142, 107, 80], nether_bricks: [44, 21, 26], red_nether_bricks: [69, 7, 9], netherrack: [97, 38, 38],
    nether_wart_block: [115, 3, 2], warped_wart_block: [23, 120, 121], end_stone: [219, 222, 158], purpur_block: [169, 125, 169],
    prismarine: [99, 156, 151], prismarine_bricks: [99, 171, 158], dark_prismarine: [51, 91, 75], quartz_block: [235, 229, 222],
    copper_block: [192, 107, 79], exposed_copper: [161, 125, 103], weathered_copper: [108, 153, 110], oxidized_copper: [82, 162, 132],
    gold_block: [246, 208, 61], iron_block: [220, 220, 220], diamond_block: [98, 237, 228], emerald_block: [42, 203, 87],
    lapis_block: [30, 67, 140], netherite_block: [66, 61, 63], coal_block: [16, 15, 15], amethyst_block: [133, 97, 191],
    clay: [160, 166, 179], snow_block: [249, 254, 254], moss_block: [89, 109, 45], dirt: [134, 96, 67], coarse_dirt: [119, 85, 59],
    honeycomb_block: [229, 148, 29], shroomlight: [240, 146, 70], sponge: [195, 192, 74], obsidian: [15, 10, 24],
    raw_iron_block: [166, 136, 107], raw_copper_block: [154, 105, 79], raw_gold_block: [221, 169, 46], resin_bricks: [206, 101, 39],
    mud: [60, 57, 61], dried_kelp_block: [50, 58, 38],
  },
};

function paletteFor(name) {
  switch (name) {
    case 'wool': return { ...PALETTES.wool };
    case 'terracotta': return { ...PALETTES.terracotta };
    case 'concrete+wool': return { ...PALETTES.concrete, ...PALETTES.wool };
    case 'full': return { ...PALETTES.concrete, ...PALETTES.wool, ...PALETTES.terracotta, ...PALETTES.extra };
    default: return { ...PALETTES.concrete };
  }
}

export default {
  name: 'pixelart',
  description: 'Pixel art from a PNG/JPEG (CIEDE2000 colour matching, Floyd–Steinberg dithering); vertical faces south',
  params: {
    image: { type: 'string', default: '', description: 'path to a .png / .jpg (empty = built-in demo picture)' },
    width: { type: 'int', default: 64, min: 1, max: 1024, description: 'width in blocks' },
    height: { type: 'int', default: 0, min: 0, max: 1024, description: 'height in blocks (0 = keep aspect ratio)' },
    palette: { type: 'enum', values: ['concrete', 'wool', 'terracotta', 'concrete+wool', 'full'], default: 'concrete', description: 'blocks to use (full ≈ 110 solid blocks)' },
    dither: { type: 'bool', default: true, description: 'Floyd–Steinberg dithering' },
    plane: { type: 'enum', values: ['vertical', 'flat'], default: 'vertical', description: 'wall facing south, or a floor (top of image = north)' },
    alphaThreshold: { type: 'int', default: 128, min: 0, max: 255, description: 'pixels more transparent than this are skipped' },
    background: { type: 'block', default: '', description: 'block for transparent pixels (empty = leave untouched)' },
  },
  build(s, p) {
    const img = p.image ? loadImage(p.image) : demoImage();
    const tw = p.width;
    const th = p.height || Math.max(1, Math.round((img.height * tw) / img.width));
    const small = resizeArea(img, tw, th);
    const blocks = quantize(small, paletteFor(p.palette), { dither: p.dither, alphaThreshold: p.alphaThreshold });
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const b = blocks[y * tw + x] ?? (p.background || null);
        if (!b) continue;
        if (p.plane === 'flat') s.set(x, 0, y, b);
        else s.set(x, th - 1 - y, 0, b);
      }
    }
  },
};

/** Decode a PNG or JPEG file → { width, height, data: RGBA Uint8Array }. */
export function loadImage(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`pixelart: image not found: ${abs}`);
  const buf = fs.readFileSync(abs);
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const { PNG } = require('pngjs');
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const jpeg = require('jpeg-js');
    const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { width: j.width, height: j.height, data: j.data };
  }
  throw new Error(`pixelart: ${path.basename(file)} is not a PNG or JPEG`);
}

/** A small procedural landscape used when no image is given. */
export function demoImage(w = 96, h = 64) {
  const data = new Uint8Array(w * h * 4);
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c = mix([25, 40, 110], [250, 150, 70], Math.min(1, y / (h * 0.62))); // dusk sky
      const sx = x - w * 0.68, sy = y - h * 0.5;
      if (sx * sx + sy * sy < (h * 0.16) ** 2) c = [255, 214, 90]; // sun
      const ridge = h * 0.55 + Math.sin(x * 0.11) * h * 0.08 + Math.sin(x * 0.037 + 1) * h * 0.1;
      if (y > ridge) c = mix([70, 60, 95], [40, 35, 60], (y - ridge) / (h - ridge)); // mountains
      const hill = h * 0.78 + Math.sin(x * 0.07 + 2) * h * 0.04;
      if (y > hill) c = mix([60, 140, 50], [30, 80, 30], (y - hill) / (h - hill)); // meadow
      const i = (y * w + x) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Box-filter (area-average) resize with alpha-weighted colour. Returns Float32Array RGBA (0..255). */
export function resizeArea(img, tw, th) {
  const { width: sw, height: sh, data } = img;
  const out = new Float32Array(tw * th * 4);
  const fx = sw / tw, fy = sh / th;
  for (let ty = 0; ty < th; ty++) {
    const y0 = ty * fy, y1 = (ty + 1) * fy;
    for (let tx = 0; tx < tw; tx++) {
      const x0 = tx * fx, x1 = (tx + 1) * fx;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let sy = Math.floor(y0); sy < Math.min(sh, Math.ceil(y1)); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.min(sw, Math.ceil(x1)); sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;
          const wgt = wx * wy;
          const i = (sy * sw + sx) * 4;
          const al = data[i + 3] / 255;
          r += data[i] * al * wgt; g += data[i + 1] * al * wgt; b += data[i + 2] * al * wgt; a += al * wgt;
          area += wgt;
        }
      }
      const o = (ty * tw + tx) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = area > 0 ? (a / area) * 255 : 0;
    }
  }
  return { width: tw, height: th, data: out };
}

// ── colour science ──
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
/** sRGB (0..255) → CIELAB (D65). */
export function rgbToLab([r, g, b]) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 colour difference between two Lab colours. */
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (a, b) => { if (a === 0 && b === 0) return 0; const t = Math.atan2(b, a) / rad; return t < 0 ? t + 360 : t; };
  const h1p = h(a1p, b1), h2p = h(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360;
    hbp /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/**
 * Map an RGBA float image to palette blocks.
 * @returns {(string|null)[]} block per pixel (null = transparent)
 */
export function quantize(img, palette, { dither = true, alphaThreshold = 128 } = {}) {
  const entries = Object.entries(palette).map(([block, rgb]) => ({ block, rgb, lab: rgbToLab(rgb) }));
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
    let e = cache.get(key);
    if (e) return e;
    const lab = rgbToLab([r, g, b]);
    let best = null, bd = Infinity;
    for (const c of entries) {
      const d = deltaE2000(lab, c.lab);
      if (d < bd) { bd = d; best = c; }
    }
    cache.set(key, best);
    return best;
  };
  const { width: W, height: H } = img;
  const buf = Float32Array.from(img.data);
  const out = new Array(W * H).fill(null);
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let y = 0; y < H; y++) {
    const ltr = y % 2 === 0; // serpentine scan
    for (let k = 0; k < W; k++) {
      const x = ltr ? k : W - 1 - k;
      const i = (y * W + x) * 4;
      if (buf[i + 3] < alphaThreshold) continue;
      const r = clamp(buf[i]), g = clamp(buf[i + 1]), b = clamp(buf[i + 2]);
      const c = nearest(r, g, b);
      out[y * W + x] = c.block;
      if (!dither) continue;
      const er = r - c.rgb[0], eg = g - c.rgb[1], eb = b - c.rgb[2];
      const dir = ltr ? 1 : -1;
      const spread = (dx, dy, f) => {
        const nx = x + dx * dir, ny = y + dy;
        if (nx < 0 || nx >= W || ny >= H) return;
        const j = (ny * W + nx) * 4;
        if (buf[j + 3] < alphaThreshold) return;
        buf[j] += er * f; buf[j + 1] += eg * f; buf[j + 2] += eb * f;
      };
      spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
    }
  }
  return out;
}
