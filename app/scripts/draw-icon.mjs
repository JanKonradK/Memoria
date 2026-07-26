// Shared, zero-dependency icon drawing used by both the PWA PNG generator and
// the Windows .ico generator. Renders the Void mark: a gold infinity built from
// two OPEN arcs, each carrying the same gap as the app's incomplete-ring language.
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
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Signed distance to one open arc lobe, in normalised 0..1 icon space.
 * `gapFrom`/`gapTo` are angles (radians) that stay UNDRAWN, which is what makes
 * each lobe an incomplete ring rather than a closed circle.
 */
function arcDistance(u, v, cx, cy, radius, gapFrom, gapTo) {
  const dx = u - cx;
  const dy = v - cy;
  const d = Math.hypot(dx, dy);
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += Math.PI * 2;
  let from = gapFrom;
  let to = gapTo;
  if (from < 0) from += Math.PI * 2;
  if (to < 0) to += Math.PI * 2;
  const inGap = from <= to ? angle >= from && angle <= to : angle >= from || angle <= to;
  if (inGap) return Infinity;
  return Math.abs(d - radius);
}

/** Draw the icon and return the raw RGBA pixel buffer for `size`×`size`. */
export function drawPixels(size, { maskable = false } = {}) {
  const px = new Uint8Array(size * size * 4);
  const scale = maskable ? 0.66 : 0.84; // keep inside the maskable safe zone
  const stroke = maskable ? 0.055 : 0.062;
  const radius = 0.2;
  const SS = 2; // 2× supersample for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u0 = (x + (sx + 0.5) / SS) / size;
          const v0 = (y + (sy + 0.5) / SS) / size;
          const u = (u0 - 0.5) / scale + 0.5;
          const v = (v0 - 0.5) / scale + 0.5;
          // Two lobes meeting at centre; each leaves a wedge open toward the join.
          const left = arcDistance(u, v, 0.5 - radius * 0.82, 0.5, radius, -0.62, 0.62);
          const right = arcDistance(u, v, 0.5 + radius * 0.82, 0.5, radius, Math.PI - 0.62, Math.PI + 0.62);
          const d = Math.min(left, right);
          const edge = stroke / 2;
          if (d > edge) {
            if (maskable) a += 255;
            continue;
          }
          // Gold → amber along the diagonal, brightest at the upper left.
          const t = Math.min(1, Math.max(0, (u + v) / 2));
          const cr = lerp(0xf5, 0xc7, t);
          const cg = lerp(0xd6, 0x8a, t);
          const cb = lerp(0x8a, 0x2e, t);
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
