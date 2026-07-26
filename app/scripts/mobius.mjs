// The Void mark: a Möbius band with a beginning/end.
//
// The centreline is a lemniscate (figure eight), so the mark still reads as an
// infinity sign at a glance. The band's width breathes once per loop, which is
// exactly what a half-twisted strip does seen flat — it turns edge-on once and
// only once. Where the band crosses itself, ONE strand stops short and picks up
// again past the other; the missing piece is the crossing's under-strand and the
// loop's beginning/end at the same time. It also keeps the app's incomplete-ring
// language: every ring in this UI is drawn with a gap in it.
//
// Zero dependencies and no DOM: the same geometry feeds the SVG mark (favicon,
// in-app logo) and the pixel renderer behind the PNG/ICO icons, so the vector
// and the raster can never drift apart.

/** Everything about the mark's proportions, in math space (x ∈ [-1,1], y ∈ [-0.5,0.5]). */
export const MARK = {
  /** Band half-width where the strip faces the viewer straight on. */
  halfWidth: 0.135,
  /** Half-width at the edge-on point, as a fraction of `halfWidth` — the twist. */
  pinch: 0.3,
  /**
   * Arc length removed at the crossing. The strand passing over eats about a
   * band-width of it, so this has to be comfortably more than that or the break
   * disappears behind the crossing instead of reading as a break.
   */
  gapArc: 0.62,
  /** Which of the two self-crossings gets broken (π/2 and 3π/2 are the crossings). */
  gapAt: Math.PI / 2,
  /** Centreline resolution. High enough that the raster splat leaves no scallops. */
  samples: 2400,
};

/** Gerono lemniscate: crosses itself at the origin at t = π/2 and t = 3π/2. */
function point(t) {
  return { x: Math.cos(t), y: 0.5 * Math.sin(2 * t) };
}

function tangent(t) {
  return { x: -Math.sin(t), y: Math.cos(2 * t) };
}

/**
 * Half a twist per loop: |cos(t/2)| completes one zero in 2π, so the band goes
 * edge-on exactly once (at t = π, the far tip). Two zeroes would be a cylinder
 * with a full twist; none would be a flat ring. One is what makes it a Möbius.
 */
function halfWidthAt(t, mark) {
  return mark.halfWidth * (mark.pinch + (1 - mark.pinch) * Math.abs(Math.cos(t / 2)));
}

/**
 * The centreline as an ordered open strip: it begins where the band resumes
 * after the gap and ends where the band stops before it. Each sample carries the
 * outward normal and the local half-width, which is all either renderer needs.
 */
export function bandSamples(mark = MARK) {
  const count = mark.samples;
  const raw = [];
  for (let i = 0; i < count; i++) {
    // Start the walk AT the crossing, so trimming both ends by half the gap
    // removes an equal bite from either side of it.
    const t = mark.gapAt + (i / count) * Math.PI * 2;
    const p = point(t);
    const d = tangent(t);
    const len = Math.hypot(d.x, d.y) || 1;
    raw.push({
      t,
      x: p.x,
      y: p.y,
      tx: d.x / len,
      ty: d.y / len,
      nx: -d.y / len,
      ny: d.x / len,
      w: halfWidthAt(t, mark),
    });
  }

  const step = [0];
  for (let i = 1; i < count; i++) {
    step[i] = step[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
  }
  const total = step[count - 1] + Math.hypot(raw[0].x - raw[count - 1].x, raw[0].y - raw[count - 1].y);
  const half = Math.min(mark.gapArc, total * 0.5) / 2;

  let first = 0;
  while (first < count - 1 && step[first] < half) first++;
  let last = count - 1;
  while (last > first && total - step[last] < half) last--;

  const band = raw.slice(first, last + 1);
  const arc = band.map((_, i) => step[first + i] - step[first]);
  return { band, arc, length: arc[arc.length - 1] ?? 0 };
}

/** Pick `count` samples spaced evenly along the band by arc length, ends included. */
function byArcLength(band, arc, count) {
  const total = arc[arc.length - 1];
  const picked = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / (count - 1)) * total;
    while (cursor < band.length - 1 && arc[cursor] < target) cursor++;
    picked.push(band[cursor]);
  }
  return picked;
}

/**
 * Half-circle of points closing one end of the band, bulging past the tip.
 * Always ordered from the +normal edge to the −normal edge, so a cap used at the
 * start of the outline has to be reversed to keep the loop wound one way.
 */
function cap(sample, steps, sign) {
  const points = [];
  for (let i = 1; i < steps; i++) {
    const angle = (i / steps) * Math.PI;
    // Rotate the outward normal around the end point, through the tangent side.
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    points.push({
      x: sample.x + sample.w * (c * sample.nx + s * sign * sample.tx),
      y: sample.y + sample.w * (c * sample.ny + s * sign * sample.ty),
    });
  }
  return points;
}

/** Closed outline of the band: one side out, round cap, the other side back. */
export function bandOutline({ mark = MARK, sides = 26, capSteps = 5 } = {}) {
  const { band, arc } = bandSamples(mark);
  const spine = byArcLength(band, arc, sides);
  const left = spine.map((s) => ({ x: s.x + s.nx * s.w, y: s.y + s.ny * s.w }));
  const right = spine.map((s) => ({ x: s.x - s.nx * s.w, y: s.y - s.ny * s.w })).reverse();
  return [...left, ...cap(spine[spine.length - 1], capSteps, 1), ...right, ...cap(spine[0], capSteps, -1).reverse()];
}

/** Extent of the drawn band (centreline ± half-width), for fitting it into a box. */
export function bandBounds(mark = MARK) {
  const { band } = bandSamples(mark);
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const s of band) {
    for (const sign of [1, -1]) {
      const x = s.x + sign * s.nx * s.w;
      const y = s.y + sign * s.ny * s.w;
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
    }
  }
  return { ...box, width: box.maxX - box.minX, height: box.maxY - box.minY };
}

/** Catmull-Rom through every point, emitted as cubics — smooth at any size. */
function smoothClosedPath(points, precision) {
  const n = points.length;
  const f = (v) => Number(v.toFixed(precision));
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)}`;
    d += ` ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)}`;
    d += ` ${f(p2.x)} ${f(p2.y)}`;
  }
  return `${d}Z`;
}

/**
 * The mark as one filled SVG path, fitted to a `width` × `height` box.
 * y is flipped on the way out, because SVG counts downward.
 */
export function markPath({ width, height, padding = 0, mark = MARK, sides = 26, capSteps = 5, precision = 2 } = {}) {
  const bounds = bandBounds(mark);
  const scale = Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height);
  const cx = width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
  const cy = height / 2 + ((bounds.minY + bounds.maxY) / 2) * scale;
  const points = bandOutline({ mark, sides, capSteps }).map((p) => ({
    x: cx + p.x * scale,
    y: cy - p.y * scale,
  }));
  return smoothClosedPath(points, precision);
}
