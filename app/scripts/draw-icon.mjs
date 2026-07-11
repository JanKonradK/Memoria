// Shared, zero-dependency icon drawing used by both the PWA PNG generator and
// the Windows .ico generator. Renders a rounded violet→rose tile with a bolt.
import { deflateSync } from 'node:zlib';

// --- minimal PNG encoder (RGBA, 8-bit) ---
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
export function encodePng(size, pixels /* RGBA Uint8Array */) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.subarray(y * size * 4, (y + 1) * size * 4).forEach((v, i) => {
      raw[y * (size * 4 + 1) + 1 + i] = v;
    });
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- drawing ---
const BOLT = [
  [0.585, 0.06],
  [0.3, 0.54],
  [0.475, 0.54],
  [0.415, 0.94],
  [0.72, 0.42],
  [0.53, 0.42],
];
function inPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Draw the icon and return the raw RGBA pixel buffer for `size`×`size`. */
export function drawPixels(size, { maskable = false } = {}) {
  const px = new Uint8Array(size * size * 4);
  const radius = maskable ? 0 : size * 0.22;
  const boltScale = maskable ? 0.62 : 0.8; // keep inside the maskable safe zone
  const SS = 2; // 2× supersample for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const cx = Math.max(Math.abs(u * size - size / 2) - (size / 2 - radius), 0);
          const cy = Math.max(Math.abs(v * size - size / 2) - (size / 2 - radius), 0);
          if (radius > 0 && cx * cx + cy * cy > radius * radius) continue;
          const t = (u + v) / 2;
          let cr = lerp(0x14, 0x2a, t);
          let cg = lerp(0x0a, 0x14, t);
          let cb = lerp(0x28, 0x40, t);
          cr = lerp(cr, lerp(0x7c, 0xff, t), 0.5);
          cg = lerp(cg, lerp(0x5c, 0x6f, t), 0.5);
          cb = lerp(cb, lerp(0xff, 0xa5, t), 0.5);
          const edge = Math.max(u, v);
          if (edge > 0.86) {
            const g = (edge - 0.86) / 0.14;
            cr = lerp(cr, 0xe8, g * 0.5);
            cg = lerp(cg, 0xb4, g * 0.5);
            cb = lerp(cb, 0x5a, g * 0.5);
          }
          const bu = (u - 0.5) / boltScale + 0.5;
          const bv = (v - 0.5) / boltScale + 0.5;
          if (inPolygon(bu, bv, BOLT)) {
            cr = 0xff;
            cg = 0xf4;
            cb = 0xe6;
          }
          r += cr;
          g += cg;
          b += cb;
          a += 255;
        }
      }
      const i = (y * size + x) * 4;
      const n = SS * SS;
      px[i] = r / n;
      px[i + 1] = g / n;
      px[i + 2] = b / n;
      px[i + 3] = a / n;
    }
  }
  return px;
}

/** Draw the icon and return a PNG buffer. */
export function drawPng(size, opts) {
  return encodePng(size, drawPixels(size, opts));
}
