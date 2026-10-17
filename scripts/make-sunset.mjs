// Generates examples/images/sunset.png — a small procedural picture for the pixelart generator demo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../src/render/png.js';

const W = 96, H = 64;
const px = new Uint8Array(W * H * 4);
const set = (x, y, [r, g, b], a = 255) => { const i = (y * W + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const horizon = 38;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let c;
    if (y < horizon) {
      const t = y / horizon;
      c = t < 0.5 ? lerp([38, 30, 92], [214, 72, 92], t * 2) : lerp([214, 72, 92], [252, 176, 64], (t - 0.5) * 2);
    } else {
      const t = (y - horizon) / (H - horizon);
      c = lerp([40, 70, 120], [16, 30, 60], t);
    }
    set(x, y, c);
  }
}
// sun + reflection
const sx = 60, sy = 30, sr = 11;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = Math.hypot(x - sx, y - sy);
  if (d <= sr && y < horizon) set(x, y, lerp([255, 236, 120], [255, 190, 60], d / sr));
  const ry = 2 * horizon - y;
  if (y > horizon && Math.hypot(x - sx, ry - sy) <= sr && (y % 2 === 0)) set(x, y, [240, 170, 70]);
}
// mountains
for (let x = 0; x < W; x++) {
  const h1 = horizon - Math.round(9 + 6 * Math.sin(x / 9) + 3 * Math.sin(x / 3.7));
  for (let y = h1; y < horizon; y++) set(x, y, lerp([60, 40, 80], [34, 24, 54], (y - h1) / Math.max(1, horizon - h1)));
}
// stars
for (const [x, y] of [[8, 4], [20, 9], [33, 3], [47, 7], [77, 5], [88, 11], [14, 15], [70, 2]]) set(x, y, [255, 255, 230]);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'images', 'sunset.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(W, H, px));
console.log('wrote', out);
