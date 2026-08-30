// The Memoria mark: an infinity sign with a beginning and an end.
//
// The centreline is a lemniscate of Bernoulli — the actual ∞ curve, with round
// lobes meeting at a right angle. The stroke is modulated symmetrically, heavy
// through the outer curves and light where the strokes cross, the way a
// broad-nib pen would draw it. Where the curve crosses itself ONE strand stops
// short and picks up again past the other; the missing piece is the crossing's
// under-strand and the loop's beginning/end at the same time. That keeps the
// app's incomplete-ring language: every ring in this UI is drawn with a gap.
//
// This used to be a true Möbius band — a Gerono lemniscate with a single half
// twist. The topology was cute and the result was lopsided: one lobe fat, one
// thin, on a curve whose lobes were too flat to read as a symbol at all. It is
// a logo before it is a demonstration, so both went.
//
// Zero dependencies and no DOM: the same geometry feeds the SVG mark (favicon,
// in-app logo) and the pixel renderer behind the PNG/ICO icons, so the vector
// and the raster can never drift apart.

/** Everything about the mark's proportions, in math space (x ∈ [-1,1]). */
export const MARK = {
  /** Band half-width where the strip faces the viewer straight on. */
  halfWidth: 0.155,
  /**
   * Half-width at the edge-on point, as a fraction of `halfWidth` — the twist.
   * Deliberately not severe: at 0.3 the strip nearly vanished at the tip and
   * read as a drawing mistake at favicon sizes rather than as a turn.
   */
  pinch: 0.56,
  /**
   * Arc length removed at the crossing. The strand passing over eats about a
   * band-width of it, so this has to be comfortably more than that or the break
   * disappears behind the crossing instead of reading as a break.
   */
  /**
   * Arc length removed at the break. Deliberately small — about 3% of the loop.
   * A big bite here does not read as "a chunk is missing", it reads as a pair of
   * tongs: two long arms reaching around a hole where a lobe used to be.
   */
  gapArc: 0.18,
  /**
   * How far each end tapers to its point, in multiples of the local half-width.
   * 2.8 is a ~20° half-angle at the apex — a needle, not a wedge.
   *
   * At the lobe tip the curve turns around, so the tangent is vertical and the
   * two cut ends point in OPPOSITE directions. Longer tips therefore open the
   * notch rather than closing it, which is the reverse of how this behaved when
   * the break sat on a crossing. Sharper and clearer pull the same way here.
   */
  tipLength: 2.8,
  /**
   * WHERE THE BREAK GOES. π is the far lobe's tip; π/2 and 3π/2 are the two
   * self-crossings.
   *
   * This used to sit on a crossing, which was a nice story — the gap was the
   * under-strand — and a bad symbol. An ∞ is legible because its two strokes
   * CROSS; delete one of them there and what is left is a single diagonal
   * between two lobes, which reads as a sideways S. Breaking the lobe instead
   * leaves the crossing fully intact, so the mark still says infinity at 16px.
   */
  gapAt: Math.PI,
  /**
   * Vertical stretch on the lemniscate. Bernoulli's natural proportions are
   * ~2.83:1, which is too flat to read as a symbol; this opens the lobes up to
   * roughly the 1.8:1 of a typographic ∞.
   */
  yScale: 1.34,
  /** Centreline resolution. High enough that the raster splat leaves no scallops. */
  samples: 2400,
};

/**
 * Lemniscate of BERNOULLI — the actual infinity curve.
 *
 * The mark used to ride a Gerono lemniscate (cos t, ½ sin 2t). Gerono is a
 * figure eight, but its lobes are flat-sided and it crosses itself at a shallow
 * angle, so it reads as a ribbon that happens to loop rather than as ∞.
 * Bernoulli has round lobes and crosses at right angles, which is what every
 * typographic infinity sign does. Both cross at the origin at t = π/2 and 3π/2,
 * so the gap placement is unchanged.
 */
function point(t, mark = MARK) {
  const denominator = 1 + Math.sin(t) ** 2;
  return {
    x: Math.cos(t) / denominator,
    y: (mark.yScale * (Math.sin(t) * Math.cos(t))) / denominator,
  };
}

/**
 * Central difference rather than the analytic derivative: the quotient rule on
 * the parametric form is easy to get subtly wrong, and at 2400 samples the
 * numeric tangent is accurate to far more places than the 2-decimal path output.
 */
function tangent(t, mark = MARK) {
  const h = 1e-6;
  const a = point(t - h, mark);
  const b = point(t + h, mark);
  return { x: (b.x - a.x) / (2 * h), y: (b.y - a.y) / (2 * h) };
}

/**
 * Symmetric stroke modulation: widest at the two outer tips (t = 0 and t = π),
 * narrowest at the crossing (t = π/2 and 3π/2).
 *
 * This used to be |cos(t/2)|, a single zero per loop — the half twist that made
 * the band a genuine Möbius strip. It was also the reason the mark looked
 * lopsided: one lobe was drawn with a fat stroke and the other with a thin one,
 * because the strip only turned edge-on at one end. A symbol people read at
 * 16px cannot afford that, and a proper infinity sign is stroke-modulated the
 * way a broad-nib pen modulates it — heavy through the outer curves, light
 * where the strokes cross. The Möbius conceit is gone on purpose; balance and
 * legibility were worth more than the topology joke.
 */
function halfWidthAt(t, mark) {
  return mark.halfWidth * (mark.pinch + (1 - mark.pinch) * Math.abs(Math.cos(t)));
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
    const p = point(t, mark);
    const d = tangent(t, mark);
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
 * SWORD TIP closing one end of the band: two straight flanks converging on a
 * single apex out along the tangent.
 *
 * This was a half-circle, which gave the mark two blunt rounded stubs where it
 * breaks — the break read as a cut piece of ribbon rather than as a deliberate
 * point. The apex is emitted three times; `segmentControls` collapses the
 * coincident segments so the incoming and outgoing flanks meet at a genuine
 * cusp instead of sharing a rounded tangent.
 *
 * Always ordered from the +normal edge to the −normal edge, so a cap used at the
 * start of the outline has to be reversed to keep the loop wound one way.
 */
function cap(sample, steps, sign, mark = MARK) {
  const tip = {
    x: sample.x + sample.w * mark.tipLength * sign * sample.tx,
    y: sample.y + sample.w * mark.tipLength * sign * sample.ty,
  };
  const flank = (side) => {
    const points = [];
    // Skip the endpoints: the spine already supplies the ±normal corner, and the
    // apex is appended separately.
    for (let i = 1; i < steps; i++) {
      const u = i / steps;
      const edge = {
        x: sample.x + side * sample.w * sample.nx,
        y: sample.y + side * sample.w * sample.ny,
      };
      // Even spacing keeps the smoothed flank on one straight approach instead
      // of leaving one long, under-sampled run into the point.
      points.push({ x: edge.x + (tip.x - edge.x) * u, y: edge.y + (tip.y - edge.y) * u });
    }
    return points;
  };
  return [...flank(1), tip, tip, tip, ...flank(-1).reverse()];
}

/** Closed outline of the band: one side out, round cap, the other side back. */
export function bandOutline({ mark = MARK, sides = 40, capSteps = 8 } = {}) {
  const { band, arc } = bandSamples(mark);
  const spine = byArcLength(band, arc, sides);
  const left = spine.map((s) => ({ x: s.x + s.nx * s.w, y: s.y + s.ny * s.w }));
  const right = spine.map((s) => ({ x: s.x - s.nx * s.w, y: s.y - s.ny * s.w })).reverse();
  return [
    ...left,
    ...cap(spine[spine.length - 1], capSteps, 1, mark),
    ...right,
    ...cap(spine[0], capSteps, -1, mark).reverse(),
  ];
}

/**
 * Extent of the drawn mark, for fitting it into a box.
 *
 * Measured from the OUTLINE that actually gets filled, not from centreline ±
 * normal. The round end caps bulge past the last centreline sample along the
 * tangent, so the old centreline-only measurement under-reported the real
 * extent — which is why the mark sat slightly off-centre in its viewBox and
 * could push into the padding. Same points in, same box out.
 */
export function bandBounds(mark = MARK, { sides = 40, capSteps = 8 } = {}) {
  return smoothBounds(bandOutline({ mark, sides, capSteps }));
}

/**
 * The Catmull-Rom control points for the segment p1 → p2, matching exactly what
 * `smoothClosedPath` emits. Kept next to it so the two can never disagree.
 */
function segmentControls(p0, p1, p2, p3) {
  if (p1.x === p2.x && p1.y === p2.y) return [p1, p1, p2, p2];
  return [
    p1,
    { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
    { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
    p2,
  ];
}

/**
 * True bounds of the SMOOTHED outline, by evaluating the same cubics the path
 * is made of.
 *
 * A Catmull-Rom spline does not stay inside the hull of the points it passes
 * through — it overshoots slightly on tight turns. Measuring the sample points
 * therefore under-reports the drawn shape by a fraction of a percent, which is
 * enough to push the mark past the edge of its own viewBox. Sampling the curve
 * itself is the only measurement that matches what a renderer will fill.
 */
function smoothBounds(points, perSegment = 12) {
  const n = points.length;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const track = (x, y) => {
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y);
    box.maxY = Math.max(box.maxY, y);
  };
  for (let i = 0; i < n; i++) {
    const [a, b, c, d] = segmentControls(points[(i - 1 + n) % n], points[i], points[(i + 1) % n], points[(i + 2) % n]);
    for (let s = 0; s <= perSegment; s++) {
      const u = s / perSegment;
      const v = 1 - u;
      const w0 = v * v * v;
      const w1 = 3 * v * v * u;
      const w2 = 3 * v * u * u;
      const w3 = u * u * u;
      track(w0 * a.x + w1 * b.x + w2 * c.x + w3 * d.x, w0 * a.y + w1 * b.y + w2 * c.y + w3 * d.y);
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
    const [, c1, c2, end] = segmentControls(p0, p1, p2, p3);
    d += `C${f(c1.x)} ${f(c1.y)}`;
    d += ` ${f(c2.x)} ${f(c2.y)}`;
    d += ` ${f(end.x)} ${f(end.y)}`;
  }
  return `${d}Z`;
}

/**
 * The mark as one filled SVG path, fitted to a `width` × `height` box.
 * y is flipped on the way out, because SVG counts downward.
 */
export function markPath({ width, height, padding = 0, mark = MARK, sides = 40, capSteps = 8, precision = 2 } = {}) {
  // Bounds and outline must come from the SAME sampling, or the box is measured
  // from a shape other than the one being drawn and the centring drifts.
  const bounds = bandBounds(mark, { sides, capSteps });
  const scale = Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height);
  const cx = width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
  const cy = height / 2 + ((bounds.minY + bounds.maxY) / 2) * scale;
  const points = bandOutline({ mark, sides, capSteps }).map((p) => ({
    x: cx + p.x * scale,
    y: cy - p.y * scale,
  }));
  return smoothClosedPath(points, precision);
}

/** Natural aspect of the drawn mark, so callers can size a box that fits it exactly. */
export function markAspect(mark = MARK, options) {
  const bounds = bandBounds(mark, options);
  return bounds.width / bounds.height;
}
