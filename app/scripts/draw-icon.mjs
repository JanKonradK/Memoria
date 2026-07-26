// Shared, zero-dependency icon drawing used by both the PWA PNG generator and
// the Windows .ico generator. Renders the Void app icon: the Möbius mark (see
// mobius.mjs) in polished gold on a golden-black squircle.
//
// Everything is drawn from a signed distance field rather than sampled shapes,
// so edges antialias analytically and the bevel/glow can read the distance and
// the surface normal at every pixel — that is what gives the glyph its lit,
// three-dimensional edge at 512px without turning to mush at 16px.
import { deflateSync } from 'node:zlib';
import { bandBounds, bandSamples } from './mobius.mjs';

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
/**
 * Per-row PNG filtering, picked by the standard minimum-sum-of-absolute-
 * differences heuristic. Unfiltered rows (what this encoder used to emit) cost
 * ~3× the bytes on an icon that is mostly smooth gradient, and these files are
 * precached by the service worker — the app ships them to every install.
 */
function filterScanlines(size, pixels) {
  const bpp = 4;
  const stride = size * bpp;
  const out = Buffer.alloc(size * (stride + 1));
  const prior = new Uint8Array(stride);
  const candidate = new Uint8Array(stride);
  const best = new Uint8Array(stride);

  for (let y = 0; y < size; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    let bestType = 0;
    let bestScore = Infinity;
    for (let type = 0; type <= 4; type++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        // Filters reference the ORIGINAL bytes of this row and the row above;
        // a decoder has already reconstructed both by the time it needs them.
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prior[i];
        const c = i >= bpp ? prior[i - bpp] : 0;
        let value;
        if (type === 0) value = row[i];
        else if (type === 1) value = row[i] - a;
        else if (type === 2) value = row[i] - b;
        else if (type === 3) value = row[i] - ((a + b) >> 1);
        else {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = row[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        const byte = value & 0xff;
        candidate[i] = byte;
        score += byte > 127 ? 256 - byte : byte;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        best.set(candidate);
      }
    }
    out[y * (stride + 1)] = bestType;
    out.set(best, y * (stride + 1) + 1);
    prior.set(row);
  }
  return out;
}

export function encodePng(size, pixels /* RGBA Uint8Array */) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = filterScanlines(size, pixels);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- palette: black field, gold light. No blue anywhere. ---
const FIELD_TOP = [0x0a, 0x08, 0x06];
const FIELD_BOTTOM = [0x4c, 0x35, 0x0d];
const GLOW = [0xe8, 0xb4, 0x5a];
const GLYPH_TOP = [0xff, 0xf6, 0xe0];
const GLYPH_MID = [0xe8, 0xb4, 0x5a];
const GLYPH_BOTTOM = [0xb0, 0x74, 0x1e];
const GLYPH_SHADE = [0x5c, 0x3a, 0x09];
const WHITE = [0xff, 0xff, 0xff];
/** Up and to the left, so the mark is lit like the reference app icons. */
const LIGHT = [-0.42, -0.91];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Signed distance (in pixels, negative inside) to the squircle, plus the two
 * fields the glyph shading needs: the distance to the band and the outward
 * normal of the nearest band edge.
 */
function bandField(size, scale, cx, cy, pad) {
  const sd = new Float32Array(size * size).fill(Infinity);
  const nx = new Float32Array(size * size);
  const ny = new Float32Array(size * size);
  const halfWidth = new Float32Array(size * size);
  const flat = new Float32Array(size * size);
  const { band } = bandSamples();

  for (const s of band) {
    // Screen space: y grows downward, so the centreline's y is negated once here
    // and every normal derived from it follows.
    const px = cx + s.x * scale;
    const py = cy - s.y * scale;
    const r = s.w * scale;
    // How square-on the strip faces the viewer here: 1 flat, 0 edge-on.
    const facing = Math.abs(Math.cos(s.t / 2));
    const reach = r + pad;
    const x0 = Math.max(0, Math.floor(px - reach));
    const x1 = Math.min(size - 1, Math.ceil(px + reach));
    const y0 = Math.max(0, Math.floor(py - reach));
    const y1 = Math.min(size - 1, Math.ceil(py + reach));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - px;
        const dy = y + 0.5 - py;
        const d = Math.hypot(dx, dy);
        const value = d - r;
        const i = y * size + x;
        if (value >= sd[i]) continue;
        sd[i] = value;
        // Outward edge normal: away from the centreline, which for a point off
        // the spine is simply the direction from the nearest spine point.
        const inv = d > 1e-6 ? 1 / d : 0;
        nx[i] = dx * inv;
        ny[i] = dy * inv;
        halfWidth[i] = r;
        flat[i] = facing;
      }
    }
  }
  return { sd, nx, ny, halfWidth, flat };
}

/** Draw the icon and return the raw RGBA pixel buffer for `size`×`size`. */
export function drawPixels(size, { maskable = false, squircle = true } = {}) {
  const px = new Uint8Array(size * size * 4);
  const bounds = bandBounds();
  // Maskable icons must keep their content inside the safe circle; the plain
  // icon can run closer to the edge because the squircle is the frame.
  const fit = maskable ? 0.62 : 0.78;
  const scale = (fit * size) / bounds.width;
  const cx = size / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
  const cy = size / 2 + ((bounds.minY + bounds.maxY) / 2) * scale;
  const glyphTop = cy - bounds.maxY * scale;
  const glyphHeight = bounds.height * scale;

  const glowRadius = Math.max(2, size * 0.038);
  const field = bandField(size, scale, cx, cy, glowRadius * 2.2);

  // Squircle: a superellipse, the shape every platform's app icon actually is.
  const exponent = 4.4;
  const half = size / 2;
  const margin = size * 0.012;
  const shellRadius = half - margin;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const o = i * 4;
      const u = (x + 0.5 - half) / shellRadius;
      const v = (y + 0.5 - half) / shellRadius;

      let shell = 1;
      if (!maskable && squircle) {
        const f = Math.pow(Math.pow(Math.abs(u), exponent) + Math.pow(Math.abs(v), exponent), 1 / exponent);
        shell = clamp01((1 - f) * shellRadius * 0.75 + 0.5);
        if (shell <= 0) continue;
      }

      // Field: warm black at the top falling into gold at the bottom, with the
      // mark sitting in its own pool of light.
      const down = clamp01((y + 0.5) / size);
      let color = mix(FIELD_TOP, FIELD_BOTTOM, down * down);
      const dist = field.sd[i];
      if (Number.isFinite(dist) && dist > 0) {
        // Small icons get less halo: at 16-32px it is most of the glyph's width
        // and eats the contrast the mark needs to stay readable.
        const glow = Math.exp(-(dist / glowRadius) * (dist / glowRadius)) * (size >= 64 ? 0.32 : 0.16);
        color = mix(color, GLOW, glow);
      }
      // Rim light along the top of the shell, the way a glass tile catches light.
      if (!maskable && squircle) {
        const rim = smoothstep(1, 0.93, Math.hypot(u, v)) * smoothstep(0.1, -0.95, v);
        color = mix(color, WHITE, rim * 0.14);
      }

      let alpha = shell * 255;

      // The mark itself.
      const cover = clamp01(0.5 - dist);
      if (cover > 0) {
        const g = clamp01((y + 0.5 - glyphTop) / glyphHeight);
        let glyph = g < 0.5 ? mix(GLYPH_TOP, GLYPH_MID, g * 2) : mix(GLYPH_MID, GLYPH_BOTTOM, (g - 0.5) * 2);
        // The strip turning edge-on catches less light — this is the shading that
        // says "twisted ribbon" rather than "bent tube".
        glyph = mix(glyph, GLYPH_BOTTOM, (1 - field.flat[i]) * 0.4);
        // Bevel: the band's own edge normal against the light. Only the outer
        // third of the band's width picks it up, so the middle stays flat gold.
        const w = field.halfWidth[i] || 1;
        const edge = smoothstep(0.3, 0.98, 1 + dist / w);
        const lit = field.nx[i] * LIGHT[0] + field.ny[i] * LIGHT[1];
        glyph = mix(glyph, WHITE, clamp01(lit) * edge * 0.8);
        glyph = mix(glyph, GLYPH_SHADE, clamp01(-lit) * edge * 0.55);
        color = mix(color, glyph, cover);
        alpha = Math.max(alpha, cover * 255);
      }

      px[o] = color[0];
      px[o + 1] = color[1];
      px[o + 2] = color[2];
      px[o + 3] = alpha;
    }
  }
  return px;
}

/** Draw the icon and return a PNG buffer. */
export function drawPng(size, opts) {
  return encodePng(size, drawPixels(size, opts));
}
