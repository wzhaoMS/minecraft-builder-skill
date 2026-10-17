/**
 * Minimal PNG encoder (RGBA8) using node:zlib, plus a decoder wrapper (pngjs) for images we read.
 */
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array|Uint8ClampedArray} rgba width*height*4 bytes
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // filter 1 (Sub) compresses flat-colour images far better than filter 0
    const o = y * (stride + 1);
    raw[o] = 1;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? rgba[row + i - 4] : 0;
      raw[o + 1 + i] = (rgba[row + i] - left) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Decode a PNG → { width, height, data: RGBA Buffer } (pngjs). */
export function decodePng(buf) {
  const { PNG } = require('pngjs');
  const p = PNG.sync.read(buf);
  return { width: p.width, height: p.height, data: p.data };
}
