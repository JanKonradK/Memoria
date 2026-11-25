// Shared, zero-dependency icon drawing used by both the PWA PNG generator and
// the Windows .ico generator. Renders the Memoria app icon: the shattered
// infinity (see mobius.mjs) in ivory and gold on a pure black squircle.
//
// The raster is built from the same outlines as the SVG mark, layer by layer:
// the under ribbon, the shadow the over ribbon casts on it, the over ribbon,
// a highlight along each arch, then the shards from the largest to the finest.
// Each layer is filled on its own and composited, never summed, so the two
// ribbons cannot double up into a brighter seam where they cross.
//
// Small icons (≤ 32 px, the .ico's taskbar sizes) skip all of that: a flat,
// bright silhouette of the body and the primary shards only, because at that
// size shading and dust are just blur.
import { deflateSync } from 'node:zlib';
import { bandBounds, fitMark, MARK, markParts, outlinePolygon } from './mobius.mjs';

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

// --- palette: black field, ivory and gold light. No blue anywhere. ---
// Pure black. On an OLED panel black is simply off; any gradient in the tile
// shows as a smear.
const FIELD = [0x00, 0x00, 0x00];
// The same four stops as the SVG mark (gen-mark.mjs) and the intro: ivory,
// champagne, warm gold, deep gold. They run mostly top to bottom with a lean to
// the right, so the standing arches are lit and the fallen pieces glow gold.
const GLYPH_RAMP = [
  { at: 0, color: [0xff, 0xff, 0xff] },
  { at: 0.42, color: [0xff, 0xf6, 0xdc] },
  { at: 0.8, color: [0xe8, 0xb4, 0x5a] },
  { at: 1, color: [0xc9, 0x91, 0x38] },
];
const LIGHT = { x: 0.38, y: 0.62 }; // weights of the ramp's run across and down the mark
const WHITE = [0xff, 0xff, 0xff];
const GOLD = [0xe8, 0xb4, 0x5a];
// Shade is warm, never grey: a shadow on ivory and gold reads as umber.
const UMBER = [0x6e, 0x45, 0x12];
// What the farther shards warm toward: a lit gold, so they glow instead of browning.
const EMBER = [0xf6, 0xcb, 0x74];
// Small icons: one bright ivory-gold, lightly warmed toward the bottom.
const SMALL_TOP = [0xff, 0xfc, 0xf2];
const SMALL_BOTTOM = [0xf6, 0xd6, 0x92];
// A warm-gold hairline just inside the tile's edge, brightest along the top as
// if lit from above. On a dark taskbar or wallpaper a pure black tile otherwise
// loses its outline.
const RIM = [0xe8, 0xb4, 0x5a];
const RIM_ALPHA = { top: 0.34, bottom: 0.12 };
/**
 * How each shard tier is lit. Primary pieces are as crisp as the body; the
 * farther a piece has drifted, the more it warms toward ember gold and the
 * more translucent it gets — softer, never muddier.
 */
const TIER_LIGHT = {
  1: { warm: 0, alpha: 1 },
  2: { warm: 0.18, alpha: 0.94 },
  3: { warm: 0.34, alpha: 0.82 },
  4: { warm: 0.5, alpha: 0.68 },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scaleColor = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
function ramp(g) {
  for (let i = 1; i < GLYPH_RAMP.length; i++) {
    const from = GLYPH_RAMP[i - 1];
    const to = GLYPH_RAMP[i];
    if (g <= to.at) return mix(from.color, to.color, (g - from.at) / (to.at - from.at));
  }
  return GLYPH_RAMP.at(-1).color;
}

/**
 * Coverage of one closed polygon (pixel space, y down), nonzero winding, with
 * `rows` sample rows per pixel and exact horizontal span coverage. Only the
 * polygon's own rows are scanned, so the small shards cost next to nothing.
 */
function fillPolygon(points, size, cover = new Float32Array(size * size), rows = 5) {
  if (points.length < 3) return cover;
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of points) {
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  const weight = 1 / rows;
  const firstRow = Math.max(0, Math.floor(top * rows));
  const lastRow = Math.min(size * rows - 1, Math.ceil(bottom * rows));
  const crossings = [];
  for (let sy = firstRow; sy <= lastRow; sy++) {
    const y = (sy + 0.5) / rows;
    const py = Math.floor(sy / rows);
    crossings.length = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        crossings.push({ x: a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y), direction: b.y > a.y ? 1 : -1 });
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a.x - b.x);
    let winding = 0;
    for (let i = 0; i < crossings.length - 1; i++) {
      winding += crossings[i].direction;
      if (!winding) continue;
      const xa = Math.max(0, crossings[i].x);
      const xb = Math.min(size, crossings[i + 1].x);
      if (xb <= xa) continue;
      const ia = Math.floor(xa);
      const ib = Math.min(size - 1, Math.floor(xb));
      const row = py * size;
      if (ia === ib) {
        cover[row + ia] += (xb - xa) * weight;
        continue;
      }
      cover[row + ia] += (ia + 1 - xa) * weight;
      for (let x = ia + 1; x < ib; x++) cover[row + x] += weight;
      if (ib < size) cover[row + ib] += (xb - ib) * weight;
    }
  }
  return cover;
}

function clampCover(cover) {
  for (let i = 0; i < cover.length; i++) if (cover[i] > 1) cover[i] = 1;
  return cover;
}

/** Two passes of a separable box blur: close enough to a Gaussian for soft light and shade. */
function blur(src, size, radius) {
  const r = Math.max(1, Math.round(radius));
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < size; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[y * size + Math.min(size - 1, Math.max(0, x))];
      for (let x = 0; x < size; x++) {
        b[y * size + x] = sum / (2 * r + 1);
        sum += a[y * size + Math.min(size - 1, x + r + 1)] - a[y * size + Math.max(0, x - r)];
      }
    }
    [a, b] = [b, a];
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += a[Math.min(size - 1, Math.max(0, y)) * size + x];
      for (let y = 0; y < size; y++) {
        b[y * size + x] = sum / (2 * r + 1);
        sum += a[Math.min(size - 1, y + r + 1) * size + x] - a[Math.max(0, y - r) * size + x];
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

/** The mark's layers as pixel-space polygons for a `size` icon. */
function markLayout(size, fit, maxTier) {
  const padding = (size * (1 - fit)) / 2;
  const { place, scale } = fitMark({ width: size, height: size, padding, maxTier });
  const parts = markParts(MARK, { maxTier });
  const poly = (points) => outlinePolygon(place(points), 10);
  const bounds = bandBounds(MARK, { maxTier });
  const [corner] = place([{ x: bounds.minX, y: bounds.maxY }]);
  const [crossing] = place([{ x: 0, y: 0 }]);
  return {
    scale,
    crossing,
    box: { left: corner.x, top: corner.y, width: bounds.width * scale, height: bounds.height * scale },
    body: poly(parts.body.points),
    over: poly(parts.overStrand.points),
    under: poly(parts.underStrand.points),
    shadow: poly(parts.crossShadow.points),
    sheens: parts.sheens.map((sheen) => poly(sheen.points)),
    shards: parts.shards.map((shard) => ({ tier: shard.tier, polygon: poly(shard.points) })),
  };
}

/**
 * A shard is a flat facet tilted toward the light: brightest along the edge
 * that faces up and to the left, a shade deeper across to the far edge. A
 * smooth tilt rather than a lit/unlit split, which read as one crack too many.
 * Returns a per-pixel brightness factor for pixels inside the shard.
 */
function facetLight(polygon) {
  const lx = -Math.SQRT1_2;
  const ly = -Math.SQRT1_2;
  const along = polygon.map((p) => p.x * lx + p.y * ly);
  const lo = Math.min(...along);
  const span = Math.max(...along) - lo || 1;
  return (x, y) => 0.94 + 0.12 * ((x * lx + y * ly - lo) / span);
}

/** Draw the icon and return the raw RGBA pixel buffer for `size`×`size`. */
export function drawPixels(size, { maskable = false, squircle = true } = {}) {
  const px = new Uint8Array(size * size * 4);
  const small = size <= 32;
  // Optical sizing: the mark is wide, so it is the width that fills the tile.
  // Taskbar sizes fit tighter so their strokes keep a whole pixel; maskable
  // icons keep inside the platform's safe circle.
  const fit = maskable ? 0.66 : small ? 0.9 : size < 48 ? 0.88 : 0.84;
  // Each tier of shard is kept only while it is still a shape rather than a
  // speck: dust from 256 px, splinters from 96 px, secondary pieces from 33 px.
  const maxTier = small ? 1 : size < 96 ? 2 : size < 256 ? 3 : MARK.maxTier;
  const layout = markLayout(size, fit, maxTier);
  const rows = size <= 64 ? 8 : 5;

  const body = clampCover(fillPolygon(layout.body, size, undefined, rows));
  const shardCovers = layout.shards.map((shard) => ({
    ...shard,
    cover: clampCover(fillPolygon(shard.polygon, size, undefined, rows)),
    light: facetLight(shard.polygon),
  }));

  let over;
  let under;
  let shadow;
  let sheen;
  let glow;
  if (!small) {
    over = clampCover(fillPolygon(layout.over, size, undefined, rows));
    under = clampCover(fillPolygon(layout.under, size, undefined, rows));
    shadow = blur(clampCover(fillPolygon(layout.shadow, size, undefined, rows)), size, layout.scale * 0.007);
    const sheenCover = new Float32Array(size * size);
    for (const polygon of layout.sheens) fillPolygon(polygon, size, sheenCover, rows);
    sheen = blur(clampCover(sheenCover), size, layout.scale * 0.016);
    // The finest pieces glow faintly, as if still warm from the break.
    const dust = new Float32Array(size * size);
    for (const shard of shardCovers) {
      if (shard.tier < 3) continue;
      for (let i = 0; i < dust.length; i++) dust[i] = Math.max(dust[i], shard.cover[i]);
    }
    glow = blur(dust, size, layout.scale * 0.03);
  }

  const { box, crossing, scale } = layout;
  const rimmed = !maskable && squircle && size >= 48;
  const rimWidth = Math.max(1, size / 320);
  // Squircle: a superellipse, the shape every platform's app icon actually is.
  const exponent = 4.4;
  const half = size / 2;
  const shellRadius = half - size * 0.012;
  // How far round the crossing the under ribbon falls into the over ribbon's shade.
  const occlusion = (scale * 0.22) ** 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const o = i * 4;
      const u = (x + 0.5 - half) / shellRadius;
      const v = (y + 0.5 - half) / shellRadius;

      let shell = 1;
      let inset = Infinity;
      if (!maskable && squircle) {
        const f = Math.pow(Math.pow(Math.abs(u), exponent) + Math.pow(Math.abs(v), exponent), 1 / exponent);
        inset = (1 - f) * shellRadius;
        shell = clamp01(inset * 0.75 + 0.5);
        if (shell <= 0) continue;
      }
      const tileAlpha = maskable || squircle ? shell : 0;

      let color = FIELD;
      if (rimmed) {
        const rimAlpha = RIM_ALPHA.top + (RIM_ALPHA.bottom - RIM_ALPHA.top) * clamp01((v + 1) / 2);
        color = mix(FIELD, RIM, rimAlpha * clamp01(rimWidth + 0.5 - inset));
      }
      let alpha = tileAlpha;
      // Source-over in straight alpha, so a transparent tile takes the ink as is.
      const over_ = (c, a) => {
        if (a <= 0) return;
        const out = a + alpha * (1 - a);
        color = mix(color, c, a / out);
        alpha = out;
      };

      // Where this pixel sits on the light's run across the mark.
      const g = clamp01(((x + 0.5 - box.left) / box.width) * LIGHT.x + ((y + 0.5 - box.top) / box.height) * LIGHT.y);

      if (small) {
        const ink = mix(SMALL_TOP, SMALL_BOTTOM, clamp01((y + 0.5 - box.top) / box.height));
        let cover = body[i];
        for (const shard of shardCovers) cover = Math.max(cover, shard.cover[i]);
        over_(ink, cover);
      } else {
        over_(GOLD, glow[i] * 0.22);

        if (body[i] > 0) {
          const base = mix(ramp(g), WHITE, sheen[i] * 0.75);
          // The under ribbon dims as it dives beneath the crossing, and takes
          // the over ribbon's shadow on either side of it.
          const dx = x + 0.5 - crossing.x;
          const dy = y + 0.5 - crossing.y;
          const dive = 0.16 * Math.exp(-(dx * dx + dy * dy) / occlusion);
          const underColor = mix(base, UMBER, clamp01(dive + 0.42 * shadow[i] * under[i]));
          // Composite the ribbons premultiplied, then take the body's own
          // coverage as the alpha: the seam where they cross never shows.
          const co = over[i];
          const cu = under[i] * (1 - co);
          const a = co + cu;
          const strand = a > 0 ? mix(underColor, base, co / a) : base;
          over_(strand, body[i]);
        }

        for (const shard of shardCovers) {
          const cover = shard.cover[i];
          if (cover <= 0) continue;
          // Shards sit low on the ramp, where it turns deep gold; lifting them
          // a step keeps the fallen pieces glowing rather than going brown.
          const lit = TIER_LIGHT[shard.tier];
          const c = scaleColor(mix(ramp(g * 0.86), EMBER, lit.warm), shard.light(x + 0.5, y + 0.5));
          over_(c, cover * lit.alpha);
        }
      }

      px[o] = Math.round(Math.min(255, color[0]));
      px[o + 1] = Math.round(Math.min(255, color[1]));
      px[o + 2] = Math.round(Math.min(255, color[2]));
      px[o + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

/** Draw the icon and return a PNG buffer. */
export function drawPng(size, opts) {
  return encodePng(size, drawPixels(size, opts));
}
