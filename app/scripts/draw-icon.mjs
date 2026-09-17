// Shared, zero-dependency icon drawing used by both the PWA PNG generator and
// the Windows .ico generator. Renders the Memoria app icon: the infinity mark (see
// mobius.mjs) in white-into-gold on a pure black squircle.
//
// The raster uses the same cubic outline as the SVG mark. Subpixel coverage
// preserves its pointed ends; small icons use a larger optical fit and flat ink.
import { deflateSync } from 'node:zlib';
import { MARK, markPath } from './mobius.mjs';

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
// Pure black, top to bottom. The tile used to run warm-black into gold, which
// on an OLED panel is the one thing a black background must never do: the
// gradient is visible as a smear where true black is simply off.
const FIELD = [0x00, 0x00, 0x00];
// White-led. The mark reads white first and gold second: pure white through the
// upper two thirds, warming to gold only as it falls away. The old ramp started
// at cream and was gold by the midpoint, so the "white and gold" idea never
// actually got any white in it.
const GLYPH_TOP = [0xff, 0xff, 0xff];
const GLYPH_MID = [0xff, 0xfa, 0xed];
const GLYPH_BOTTOM = [0xe8, 0xb4, 0x5a];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Supersampled scanline fill of the shared cubic outline, with nonzero winding. */
function markCoverage(size, fit) {
  const samples = 4;
  // The launcher silhouette closes the decorative break: pointed caps overlap
  // at this scale and otherwise leave two tiny notches on the outer lobe.
  const path = markPath({
    width: size,
    height: size,
    padding: (size * (1 - fit)) / 2,
    precision: 5,
    mark: { ...MARK, gapArc: 0, tipLength: 0, samples: MARK.samples * 16 },
  });
  const commands = path.match(/[MC][^MCZ]+/g);
  const points = [];
  for (const command of commands) {
    const values = command.slice(1).trim().split(/[ ,]+/).map(Number);
    if (command[0] === 'M') {
      points.push(values);
      continue;
    }
    const [x0, y0] = points.at(-1);
    const [x1, y1, x2, y2, x3, y3] = values;
    for (let step = 1; step <= 12; step++) {
      const t = step / 12;
      const u = 1 - t;
      points.push([
        u ** 3 * x0 + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x3,
        u ** 3 * y0 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3,
      ]);
    }
  }
  const cover = new Float32Array(size * size);
  for (let sy = 0; sy < size * samples; sy++) {
    const y = (sy + 0.5) / samples;
    const crossings = [];
    for (let index = 0; index < points.length; index++) {
      const [ax, ay] = points[index];
      const [bx, by] = points[(index + 1) % points.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        crossings.push({ x: ax + ((y - ay) * (bx - ax)) / (by - ay), direction: by > ay ? 1 : -1 });
      }
    }
    crossings.sort((a, b) => a.x - b.x);
    let winding = 0;
    for (let index = 0; index < crossings.length - 1; index++) {
      winding += crossings[index].direction;
      if (!winding) continue;
      const first = Math.max(0, Math.ceil(crossings[index].x * samples - 0.5));
      const last = Math.min(size * samples, Math.ceil(crossings[index + 1].x * samples - 0.5));
      for (let sx = first; sx < last; sx++)
        cover[Math.floor(sy / samples) * size + Math.floor(sx / samples)] += 1 / (samples * samples);
    }
  }
  return cover;
}

/** Draw the icon and return the raw RGBA pixel buffer for `size`×`size`. */
export function drawPixels(size, { maskable = false, squircle = true } = {}) {
  const px = new Uint8Array(size * size * 4);
  // Optical sizing gives Windows' 16–32 px entries enough visible stroke area.
  // Larger icons retain the established padding; maskable icons keep a safe inset.
  const fit = maskable ? 0.62 : size <= 32 ? 0.88 : size <= 48 ? 0.84 : 0.78;
  const coverage = markCoverage(size, fit);
  const occupied = [];
  for (let y = 0; y < size; y++) if (coverage.subarray(y * size, (y + 1) * size).some((v) => v > 0)) occupied.push(y);
  const glyphTop = occupied[0] ?? 0;
  const glyphHeight = (occupied.at(-1) ?? size - 1) - glyphTop + 1;

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

      // Pure black. No field gradient, no halo around the mark, no rim light on
      // the shell — every one of those was a soft edge competing with a symbol
      // whose whole job is to be crisp.
      let color = FIELD;

      let alpha = shell * 255;

      // The mark itself.
      const cover = coverage[i];
      if (cover > 0) {
        // White through the top two thirds, warming to gold only at the bottom.
        // The old split put gold at the midpoint, so almost none of the mark was
        // ever actually white.
        const g = clamp01((y + 0.5 - glyphTop) / glyphHeight);
        // Flat white at tiny sizes avoids brown bevel pixels swallowing the stroke.
        const glyph =
          size <= 32
            ? GLYPH_TOP
            : g < 0.68
              ? mix(GLYPH_TOP, GLYPH_MID, g / 0.68)
              : mix(GLYPH_MID, GLYPH_BOTTOM, (g - 0.68) / 0.32);
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
