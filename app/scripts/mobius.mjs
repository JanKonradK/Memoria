// The Memoria mark: a wide infinity sign whose lower half has shattered,
// leaving its upper half standing as an M.
//
// The sign is drawn as two ribbons, exactly as a pen draws ∞. One runs from
// the left lobe's outer edge, over the left arch and down through the centre;
// the other is its mirror image from the right. They cross at the centre — the
// × of the ∞ — and both carry on past it into the lower half before breaking
// off. Read as one shape, the two arches, the outer legs and the deep valley
// over the crossing are an M — the initial.
//
// Everything below the breaks is gone: the lower bowls of both lobes have
// shattered into small faceted shards that still trace the bowls they came
// from. Four tiers, by how far the break has carried them: primary pieces
// beside the fracture mouths, secondary pieces mid-bowl, splinters along the
// bottom of each bowl, and fine slivers trailing furthest away. Memory as
// something that was whole once, and still holds its shape while pieces of it
// drift.
//
// Zero dependencies and no DOM: the same geometry feeds the SVG mark (favicon,
// in-app logo, splash mask) and the pixel renderer behind the PNG/ICO icons,
// so the vector and the raster can never drift apart.
//
// Every outline is a closed polygon of key points in math space (y up, x
// roughly in [-1.15, 1.15]). Points flagged `sharp` are hard corners — the
// fracture cuts, the crossing's corners and every shard facet — and everything
// else is joined by Catmull-Rom cubics, so the ribbons stay smooth and the
// breaks stay crisp.

const TAU = Math.PI * 2;
const P = (x, y) => ({ x, y, sharp: false });
const S = (x, y) => ({ x, y, sharp: true });

/** The infinity's centreline and the ribbon laid along it. */
const SHAPE = {
  // x = cos t / (1 + k·sin²t), y = h·sin t·cos t / (1 + k·sin²t). k runs from
  // Gerono's teardrop lobes (0) to Bernoulli's round ones (1); h sets how tall
  // the lobes stand. The outer edges of the centreline sit at x = ±1.
  k: 0.42,
  h: 1.12,
  /** Half the ribbon's width. */
  halfWidth: 0.122,
  /** How much the ribbon slims through the crossing, so the × stays open. */
  crossingThin: 0.16,
  /** Arc length each outer leg runs on below its widest point before it breaks. */
  legDrop: 0.23,
  /** Arc length each crossing ribbon runs on past the centre before it breaks. */
  stubReach: 0.33,
};

/** A point on the centreline. t = π is the left lobe's outer edge, 3π/2 the crossing. */
function centre(t) {
  const s = Math.sin(t);
  const c = Math.cos(t);
  const d = 1 + SHAPE.k * s * s;
  return { x: c / d, y: (SHAPE.h * s * c) / d };
}

/** Unit tangent and left-hand normal of the centreline at t. */
function frame(t) {
  const e = 1e-5;
  const a = centre(t - e);
  const b = centre(t + e);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const tx = (b.x - a.x) / len;
  const ty = (b.y - a.y) / len;
  return { tx, ty, nx: -ty, ny: tx };
}

function halfWidth(t) {
  const { x } = centre(t);
  return SHAPE.halfWidth * (1 - SHAPE.crossingThin * Math.exp(-((x / 0.32) ** 2)));
}

/**
 * A point across the ribbon: v = +1 is the edge on the left of travel (the
 * outside of the arches), v = -1 the edge on the right (the inside).
 */
function across(t, v) {
  const c = centre(t);
  const f = frame(t);
  const w = halfWidth(t) * v;
  return { x: c.x + f.nx * w, y: c.y + f.ny * w };
}

// Arc length along the centreline, so cuts and shards are placed by distance
// rather than by the parameter (which bunches up through the crossing).
const ARC = (() => {
  const n = 4096;
  const ts = new Float64Array(n + 1);
  const ss = new Float64Array(n + 1);
  let prev = centre(0);
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * TAU;
    const p = centre(t);
    ts[i] = t;
    ss[i] = ss[i - 1] + Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return { n, ts, ss, length: ss[n] };
})();

function arcAt(t) {
  const f = (t / TAU) * ARC.n;
  const i = Math.min(ARC.n - 1, Math.max(0, Math.floor(f)));
  return ARC.ss[i] + (ARC.ss[i + 1] - ARC.ss[i]) * (f - i);
}

function paramAt(s) {
  let lo = 0;
  let hi = ARC.n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ARC.ss[mid] <= s) lo = mid;
    else hi = mid;
  }
  return ARC.ts[lo] + ((ARC.ts[hi] - ARC.ts[lo]) * (s - ARC.ss[lo])) / (ARC.ss[hi] - ARC.ss[lo]);
}

/** A point across the ribbon at arc length s. */
const at = (s, v) => across(paramAt(s), v);

/** Smooth key points along one edge strictly between two arc lengths, about `step` apart. */
function run(v, from, to, step = 0.1) {
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / step));
  const points = [];
  for (let i = 1; i < n; i++) {
    const p = at(from + ((to - from) * i) / n, v);
    points.push(P(p.x, p.y));
  }
  return points;
}

const sharpAt = (s, v) => {
  const p = at(s, v);
  return S(p.x, p.y);
};
const mirrorPoint = (p) => ({ ...p, x: -p.x });
const mirror = (points) => points.map(mirrorPoint);
const reversed = (points) => [...points].reverse();

// --- the two ribbons -------------------------------------------------------
//
// Worked in the LEFT ribbon's own arc length: it starts low on the left lobe's
// outer edge, climbs over the left arch, passes through the crossing and ends
// in the lower right. The right ribbon is its mirror image.

const S_OUTER = arcAt(Math.PI); // the left lobe's outer edge
const S_CROSS = arcAt(1.5 * Math.PI); // the crossing
const S_LEG = S_OUTER - SHAPE.legDrop;
const S_STUB = S_CROSS + SHAPE.stubReach;

/**
 * The fractures, as arc offsets from the nominal break. Each cut runs from its
 * outer corner (v = +1) through a faint kink to its inner corner (v = -1): a
 * clean break, not a sawn one. Both cuts on each side lean the same way, about
 * 12° off level and falling toward the centre, as if one crack ran through.
 */
const LEG_CUT = { outer: 0.1, kink: { v: 0.15, s: 0.026 }, inner: -0.04 };
const STUB_CUT = { outer: 0.065, kink: { v: -0.15, s: 0.016 }, inner: -0.055 };

const cutPoints = (base, cut, flip = 1) => ({
  outer: sharpAt(base + cut.outer, flip),
  kink: sharpAt(base + cut.kink.s, cut.kink.v * flip),
  inner: sharpAt(base + cut.inner, -flip),
});
const LEG = cutPoints(S_LEG, LEG_CUT);
const STUB = cutPoints(S_STUB, STUB_CUT);

function bisect(f, lo, hi) {
  let flo = f(lo);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Where two sampled curves cross: returns the arc length on each. */
function crossingOf(f, [a0, a1], g, [b0, b1], n = 900) {
  const fa = Array.from({ length: n + 1 }, (_, i) => f(a0 + ((a1 - a0) * i) / n));
  const gb = Array.from({ length: n + 1 }, (_, i) => g(b0 + ((b1 - b0) * i) / n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const hit = segmentHit(fa[i], fa[i + 1], gb[j], gb[j + 1]);
      if (hit) return [a0 + ((a1 - a0) * (i + hit.u)) / n, b0 + ((b1 - b0) * (j + hit.v)) / n];
    }
  }
  throw new Error('mobius: curves do not cross');
}

function segmentHit(p, p2, q, q2) {
  const rx = p2.x - p.x;
  const ry = p2.y - p.y;
  const sx = q2.x - q.x;
  const sy = q2.y - q.y;
  const den = rx * sy - ry * sx;
  if (!den) return null;
  const u = ((q.x - p.x) * sy - (q.y - p.y) * sx) / den;
  const v = ((q.x - p.x) * ry - (q.y - p.y) * rx) / den;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { u, v } : null;
}

// The crossing is a rhombus: its top is where both outer edges meet (the M's
// valley), its bottom where both inner edges meet, and its sides where each
// ribbon's outer edge passes the other ribbon's inner edge.
const S_TOP = bisect((s) => at(s, 1).x, S_CROSS - 0.6, S_CROSS);
const S_BOTTOM = bisect((s) => at(s, -1).x, S_CROSS, S_CROSS + 0.6);
const [S_SIDE_OUTER, S_SIDE_INNER] = crossingOf(
  (s) => at(s, 1),
  [S_TOP, S_STUB],
  (s) => mirrorPoint(at(s, -1)),
  [S_CROSS - 0.5, S_BOTTOM],
);
const TOP = sharpAt(S_TOP, 1);
const BOTTOM = sharpAt(S_BOTTOM, -1);
/** The crossing's right corner (the left one is its mirror). */
const SIDE = sharpAt(S_SIDE_OUTER, 1);

/** The left ribbon — the one that passes OVER at the crossing. */
function buildOverStrand() {
  return [
    LEG.outer,
    ...run(1, S_LEG + LEG_CUT.outer, S_STUB + STUB_CUT.outer),
    STUB.outer,
    STUB.kink,
    STUB.inner,
    ...run(-1, S_STUB + STUB_CUT.inner, S_LEG + LEG_CUT.inner),
    LEG.inner,
    LEG.kink,
  ];
}

/** Both ribbons as one outline, without the seams where they cross. */
function buildBody() {
  const side = mirrorPoint(SIDE); // the left corner: left ribbon's inner edge meets the right ribbon's outer edge
  return [
    LEG.outer,
    ...run(1, S_LEG + LEG_CUT.outer, S_TOP),
    TOP, // the M's valley
    ...mirror(run(1, S_TOP, S_LEG + LEG_CUT.outer)),
    ...mirror([LEG.outer, LEG.kink, LEG.inner]),
    ...mirror(run(-1, S_LEG + LEG_CUT.inner, S_SIDE_INNER)),
    SIDE,
    ...run(1, S_SIDE_OUTER, S_STUB + STUB_CUT.outer),
    STUB.outer,
    STUB.kink,
    STUB.inner,
    ...run(-1, S_STUB + STUB_CUT.inner, S_BOTTOM),
    BOTTOM,
    ...mirror(run(-1, S_BOTTOM, S_STUB + STUB_CUT.inner)),
    ...mirror([STUB.inner, STUB.kink, STUB.outer]),
    ...mirror(run(1, S_STUB + STUB_CUT.outer, S_SIDE_OUTER)),
    side,
    ...run(-1, S_SIDE_INNER, S_LEG + LEG_CUT.inner),
    LEG.inner,
    LEG.kink,
  ];
}

/**
 * The shadow the over ribbon casts on the under one, where they cross: the
 * crossing rhombus, plus a crescent either side of the over ribbon that is
 * deepest mid-ribbon and runs out to nothing at the under ribbon's edges. The
 * part beneath the over ribbon is hidden by it; only the crescents show.
 */
function buildCrossShadow() {
  const crescent = (v, from, to, depth) => {
    const points = [];
    for (const f of [0.2, 0.4, 0.6, 0.8]) {
      const s = from + (to - from) * f;
      const t = paramAt(s);
      const p = across(t, v);
      const { nx, ny } = frame(t);
      const d = depth * Math.sin(Math.PI * f) * v;
      points.push(P(p.x + nx * d, p.y + ny * d));
    }
    return points;
  };
  return [
    TOP,
    ...crescent(1, S_TOP, S_SIDE_OUTER, 0.022),
    SIDE,
    BOTTOM,
    ...crescent(-1, S_BOTTOM, S_SIDE_INNER, 0.04),
    mirrorPoint(SIDE),
  ];
}

/**
 * A highlight along the outer flank of the left arch: a sliver just inside the
 * ribbon's outer edge, tapered to points at both ends.
 */
function buildSheen() {
  const from = S_OUTER - 0.02;
  const to = S_OUTER + 0.78;
  const n = 9;
  const outer = [];
  const inner = [];
  for (let i = 1; i < n; i++) {
    const f = i / n;
    const s = from + (to - from) * f;
    const taper = Math.sin(Math.PI * f) ** 0.7;
    const a = at(s, 0.84);
    const b = at(s, 0.84 - 0.42 * taper);
    outer.push(P(a.x, a.y));
    inner.push(P(b.x, b.y));
  }
  const start = at(from, 0.84);
  const end = at(to, 0.84);
  return [S(start.x, start.y), ...outer, S(end.x, end.y), ...reversed(inner)];
}

// --- the shards ------------------------------------------------------------
//
// Cut from the LEFT lobe's lost bowl, then mirrored for the right. The bowl is
// measured by its own arc length σ from the right ribbon's broken stub
// (σ = 0, near the centre) round the bottom of the lobe to the left ribbon's
// broken leg (σ = BOWL_LENGTH, out at the side). Across it, v = +1 is the
// outside of the lobe and v = -1 the inside.

const S_BOWL = S_STUB - ARC.length / 2; // the right ribbon's stub, seen from the left lobe
const BOWL_LENGTH = S_LEG - S_BOWL;
const bowl = (sigma, v) => at(S_BOWL + sigma, v);
const bowlFrame = (sigma) => frame(paramAt(S_BOWL + sigma));

/** Centre of the left lobe's hole: shards drift away from it, outward and down. */
const LOBE_CENTRE = (() => {
  const a = centre(Math.PI);
  const b = centre(Math.PI * 0.62);
  return { x: (a.x + b.x) / 2 + 0.06, y: 0 };
})();

// The stub's mirrored cut, as seen from the bowl: the mirror keeps the
// direction of travel but swaps the ribbon's sides, so its outer corner lands
// on the bowl's inside.
const BOWL_MOUTH = {
  inside: STUB_CUT.outer,
  kink: { v: -STUB_CUT.kink.v, s: STUB_CUT.kink.s },
  outside: STUB_CUT.inner,
};

/** The clean gap between a fracture and the piece that broke off it. */
const MOUTH_GAP = 0.062;

const toPoint = ({ s, v }) => {
  const p = bowl(s, v);
  return S(p.x, p.y);
};

/**
 * A primary shard: the piece that snapped off right at a fracture. Its end
 * facing the break copies that cut's profile one clean gap away, so it plainly
 * fits the break it came from; the rest of it tapers along the bowl to a
 * faceted point.
 */
function mouthShard(mouth, length) {
  if (mouth === 'stub') {
    const s0 = MOUTH_GAP;
    return [
      { s: s0 + BOWL_MOUTH.inside, v: -1 },
      { s: s0 + BOWL_MOUTH.kink.s, v: BOWL_MOUTH.kink.v },
      { s: s0 + BOWL_MOUTH.outside, v: 1 },
      { s: s0 + length * 0.6, v: 0.84 },
      { s: s0 + length, v: 0.1 },
      { s: s0 + length * 0.76, v: -0.8 },
    ].map(toPoint);
  }
  const s1 = BOWL_LENGTH - MOUTH_GAP;
  return [
    { s: s1 + LEG_CUT.outer, v: 1 },
    { s: s1 + LEG_CUT.kink.s, v: LEG_CUT.kink.v },
    { s: s1 + LEG_CUT.inner, v: -1 },
    { s: s1 - length * 0.66, v: -0.82 },
    { s: s1 - length, v: -0.08 },
    { s: s1 - length * 0.8, v: 0.86 },
  ].map(toPoint);
}

/**
 * Glass-shard outlines in a unit box: (along the bowl, across it), each from
 * -0.5 to 0.5. All acute tips and straight facets; none of them symmetric.
 */
const SHARD_SHAPES = {
  // A long kite, its widest point a little behind the leading tip.
  kite: [
    [0.5, 0.06],
    [0.06, 0.5],
    [-0.5, 0.14],
    [-0.1, -0.5],
  ],
  // A blade: one long straight edge, one broken one.
  blade: [
    [0.5, -0.05],
    [0.12, 0.5],
    [-0.5, 0.3],
    [-0.28, -0.5],
  ],
  // A splinter: slim, with a stepped facet on one side.
  splinter: [
    [0.5, 0.02],
    [-0.08, 0.5],
    [-0.5, -0.04],
    [-0.02, -0.28],
    [0.16, -0.5],
  ],
};

/**
 * A shard laid along the bowl at σ, set `v` off its centreline, `length`
 * along the bowl and `width` across it. `flip` mirrors it across the bowl so
 * neighbours cut from the same outline still differ.
 */
function shard({ at: sigma, v = 0, length, width, shape, flip = 1 }) {
  const c = bowl(sigma, v);
  const f = bowlFrame(sigma);
  return SHARD_SHAPES[shape].map(([along, side]) =>
    S(
      c.x + f.tx * along * length + f.nx * side * flip * width,
      c.y + f.ty * along * length + f.ny * side * flip * width,
    ),
  );
}

/** A fine sliver: a long, thin kite laid along the bowl at σ, set off it by `v`. */
function sliver({ at: sigma, v = 0, length, width, lean = 0 }) {
  const c = bowl(sigma, v);
  const f = bowlFrame(sigma);
  const a = (lean * Math.PI) / 180;
  const tx = f.tx * Math.cos(a) - f.ty * Math.sin(a);
  const ty = f.tx * Math.sin(a) + f.ty * Math.cos(a);
  const pt = (along, side) => S(c.x + tx * along - ty * side, c.y + ty * along + tx * side);
  return [pt(length * 0.55, 0), pt(-length * 0.05, width / 2), pt(-length * 0.45, 0), pt(length * 0.1, -width / 2)];
}

function centroid(points) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/**
 * Carry a piece away from where it broke: turn it about its own centre and
 * push it outward from the lobe's hole and down.
 */
function drift(points, { rot = 0, out = 0, down = 0, dx = 0, dy = 0 }) {
  const c = centroid(points);
  const ox = c.x - LOBE_CENTRE.x;
  const oy = c.y - LOBE_CENTRE.y;
  const ol = Math.hypot(ox, oy) || 1;
  const a = (rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const mx = (ox / ol) * out + dx;
  const my = (oy / ol) * out - down + dy;
  return points.map((p) => {
    const x = p.x - c.x;
    const y = p.y - c.y;
    return { ...p, x: c.x + x * cos - y * sin + mx, y: c.y + x * sin + y * cos + my };
  });
}

/**
 * The trail round the left bowl, from the stub's break to the leg's: primary
 * pieces at both mouths, then each step toward the bottom of the bowl — the
 * part furthest from either break — smaller and further adrift. Spacing is
 * solved, not hand-placed: the gaps widen toward the bottom by `JOINTS`,
 * whatever the pieces' lengths.
 */
const TRAIL = [
  { tier: 1, mouth: 'stub', length: 0.12, motion: { rot: -2, out: 0.02, down: 0.02 }, right: { rot: 2, dy: -0.004 } },
  {
    tier: 2,
    shape: 'kite',
    length: 0.155,
    width: 0.112,
    v: 0.08,
    motion: { rot: 5, out: 0.04, down: 0.03 },
    right: { rot: -5, dx: 0.005 },
  },
  {
    tier: 3,
    shape: 'splinter',
    length: 0.09,
    width: 0.06,
    v: 0.3,
    motion: { rot: -8, out: 0.05, down: 0.04 },
    right: { rot: 7, dy: 0.005 },
  },
  {
    tier: 3,
    shape: 'splinter',
    length: 0.09,
    width: 0.06,
    v: -0.3,
    flip: -1,
    motion: { rot: 6, out: 0.05, down: 0.035 },
    right: { rot: -6, dx: -0.004 },
  },
  {
    tier: 2,
    shape: 'blade',
    length: 0.155,
    width: 0.112,
    v: 0.06,
    motion: { rot: -5, out: 0.04, down: 0.026 },
    right: { rot: 4, dy: 0.004 },
  },
  { tier: 1, mouth: 'leg', length: 0.12, motion: { rot: 2, out: 0.024, down: 0.018 }, right: { rot: -2, dy: -0.004 } },
];
/** Relative widths of the gaps between consecutive pieces: widest at the bottom of the bowl. */
const JOINTS = [1, 1.2, 1.75, 1.6, 1];

/**
 * Pieces thrown clear of the line: a splinter flung out below the bottom of
 * the bowl, and the finest slivers trailing furthest away.
 */
const STRAYS = [
  {
    tier: 3,
    kind: 'shard',
    shape: 'blade',
    at: 0.47,
    v: 1.45,
    length: 0.1,
    width: 0.07,
    motion: { rot: -12, out: 0.06, down: 0.04 },
    right: { rot: 12, dx: 0.006 },
  },
  {
    tier: 4,
    kind: 'sliver',
    at: 0.24,
    v: 2.0,
    length: 0.075,
    width: 0.024,
    lean: 16,
    motion: { out: 0.07, down: 0.045 },
    right: { rot: -12, dx: 0.008 },
  },
  {
    tier: 4,
    kind: 'sliver',
    at: 0.86,
    v: 2.15,
    length: 0.072,
    width: 0.022,
    lean: -14,
    motion: { out: 0.06, down: 0.04 },
    right: { rot: 10, dy: -0.008 },
  },
];

function leftShards() {
  const lengths = TRAIL.reduce((sum, piece) => sum + piece.length, 0);
  const unit = (BOWL_LENGTH - 2 * MOUTH_GAP - lengths) / JOINTS.reduce((sum, weight) => sum + weight, 0);
  let from = MOUTH_GAP;
  const trail = TRAIL.map((piece, i) => {
    const points = piece.mouth
      ? mouthShard(piece.mouth, piece.length)
      : shard({ ...piece, at: from + piece.length / 2 });
    from += piece.length + (JOINTS[i] ?? 0) * unit;
    return { ...piece, points };
  });
  const strays = STRAYS.map((piece) => {
    const at = piece.at * BOWL_LENGTH;
    return { ...piece, points: piece.kind === 'shard' ? shard({ ...piece, at }) : sliver({ ...piece, at }) };
  });
  return [...trail, ...strays].map((piece) => ({ ...piece, points: drift(piece.points, piece.motion) }));
}

/**
 * Every shard, left and right. The right bowl's pieces are the left's mirrored
 * (winding kept), each nudged by its own `right` motion so the two sides
 * drift a little differently — zero gravity is never perfectly symmetric.
 */
function buildShards() {
  const shards = [];
  for (const piece of leftShards()) {
    shards.push({ tier: piece.tier, side: -1, points: piece.points });
    shards.push({ tier: piece.tier, side: 1, points: drift(reversed(mirror(piece.points)), piece.right) });
  }
  return shards;
}

const OVER = buildOverStrand();
const SHEEN = buildSheen();

/** Everything about the mark's proportions, in math space (y up). */
export const MARK = {
  /** The two arch peaks of the M — the tops of the infinity's lobes. */
  peak: (() => {
    const s = bisect((s) => frame(paramAt(s)).ty, S_OUTER + 0.1, S_CROSS - 0.1);
    const p = at(s, 1);
    return { x: -p.x, y: p.y };
  })(),
  /** The M's valley: the top of the crossing, where both outer edges meet. */
  valley: { x: 0, y: TOP.y },
  /** The crossing's four corners: top (valley), right, bottom, left. */
  crossing: { top: TOP, right: SIDE, bottom: BOTTOM, left: mirrorPoint(SIDE) },
  /** The lowest reach of the crossing ribbons before they break off. */
  stubY: Math.min(STUB.outer.y, STUB.kink.y, STUB.inner.y),
  /** The lowest reach of the outer legs before they break off. */
  legY: Math.min(LEG.outer.y, LEG.kink.y, LEG.inner.y),
  /** The lowest-ranked shard tier drawn. Small icons pass 1 to keep only the primary pieces. */
  maxTier: 4,
  body: buildBody(),
  overStrand: OVER,
  underStrand: reversed(mirror(OVER)),
  crossShadow: buildCrossShadow(),
  sheens: [SHEEN, reversed(mirror(SHEEN))],
  shards: buildShards(),
};

/**
 * Cubic control points for the segment p1 → p2. Catmull-Rom where both ends
 * are smooth; at a sharp end the handle points straight along the chord, so
 * the corner is a genuine cusp and a sharp-to-sharp edge is a straight line.
 */
function segmentControls(p0, p1, p2, p3) {
  const c1 = p1.sharp
    ? { x: p1.x + (p2.x - p1.x) / 3, y: p1.y + (p2.y - p1.y) / 3 }
    : { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
  const c2 = p2.sharp
    ? { x: p2.x - (p2.x - p1.x) / 3, y: p2.y - (p2.y - p1.y) / 3 }
    : { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
  return [p1, c1, c2, p2];
}

/**
 * The drawn outline as a polygon: every cubic evaluated at `perSegment` steps
 * (straight sharp-to-sharp edges need only their end). This is the exact shape
 * a renderer fills, for rasterising and for measuring.
 */
export function outlinePolygon(points, perSegment = 12) {
  const n = points.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [a, b, c, d] = segmentControls(points[(i - 1 + n) % n], points[i], points[(i + 1) % n], points[(i + 2) % n]);
    const steps = a.sharp && d.sharp ? 1 : perSegment;
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      const w = 1 - u;
      out.push({
        x: w * w * w * a.x + 3 * w * w * u * b.x + 3 * w * u * u * c.x + u * u * u * d.x,
        y: w * w * w * a.y + 3 * w * w * u * b.y + 3 * w * u * u * c.y + u * u * u * d.y,
      });
    }
  }
  return out;
}

/**
 * True bounds of a SMOOTHED outline, by evaluating the cubics it is made of.
 * Catmull-Rom overshoots its points slightly on tight turns, so measuring the
 * key points alone would under-report the drawn shape.
 */
function smoothBounds(points) {
  const polygon = outlinePolygon(points);
  const box = {
    minX: Math.min(...polygon.map((p) => p.x)),
    minY: Math.min(...polygon.map((p) => p.y)),
    maxX: Math.max(...polygon.map((p) => p.x)),
    maxY: Math.max(...polygon.map((p) => p.y)),
  };
  return { ...box, width: box.maxX - box.minX, height: box.maxY - box.minY };
}

function unionBounds(boxes) {
  const box = {
    minX: Math.min(...boxes.map((b) => b.minX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
  return { ...box, width: box.maxX - box.minX, height: box.maxY - box.minY };
}

const withBounds = (points) => ({ points, bounds: smoothBounds(points) });

/**
 * The mark's pieces in math space, each with its key points and true drawn
 * bounds: the body (both ribbons as one outline), the over and under ribbons
 * and the shadow between them, the arch highlights, and the shards. `maxTier`
 * drops the smaller shards (1 keeps only the primary pieces).
 */
export function markParts(mark = MARK, { maxTier = mark.maxTier } = {}) {
  return {
    body: withBounds(mark.body),
    overStrand: withBounds(mark.overStrand),
    underStrand: withBounds(mark.underStrand),
    crossShadow: withBounds(mark.crossShadow),
    sheens: mark.sheens.map(withBounds),
    shards: mark.shards
      .filter((shard) => shard.tier <= maxTier)
      .map((shard) => ({ ...shard, ...withBounds(shard.points) })),
  };
}

/** Extent of everything drawn, for fitting the mark into a box. */
export function bandBounds(mark = MARK, { maxTier = mark.maxTier } = {}) {
  const { body, shards } = markParts(mark, { maxTier });
  return unionBounds([body.bounds, ...shards.map((s) => s.bounds)]);
}

/** Natural aspect of the drawn mark, so callers can size a box that fits it exactly. */
export function markAspect(mark = MARK, options) {
  const bounds = bandBounds(mark, options);
  return bounds.width / bounds.height;
}

/**
 * The transform that centres the drawn mark (body plus the shards at
 * `maxTier`) in a `width` × `height` box, flipping y because SVG and pixels
 * count downward.
 */
export function fitMark({ width, height, padding = 0, mark = MARK, maxTier = mark.maxTier }) {
  const bounds = bandBounds(mark, { maxTier });
  const scale = Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height);
  const cx = width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
  const cy = height / 2 + ((bounds.minY + bounds.maxY) / 2) * scale;
  return {
    scale,
    place: (points) => points.map((p) => ({ ...p, x: cx + p.x * scale, y: cy - p.y * scale })),
  };
}

/** One closed subpath of cubics through every point; straight edges between sharp corners stay lines. */
function closedSubpath(points, f) {
  const n = points.length;
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < n; i++) {
    const [p1, c1, c2, end] = segmentControls(
      points[(i - 1 + n) % n],
      points[i],
      points[(i + 1) % n],
      points[(i + 2) % n],
    );
    if (p1.sharp && end.sharp) {
      // The closing edge is implied by Z.
      if (i < n - 1) d += `L${f(end.x)} ${f(end.y)}`;
      continue;
    }
    d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(end.x)} ${f(end.y)}`;
  }
  return `${d}Z`;
}

/** Any closed outline of key points as an SVG subpath, for shapes that are not part of the mark (the icon tile). */
export function outlinePath(points, precision = 2) {
  const f = (v) => Number(v.toFixed(precision));
  return closedSubpath(points, f);
}

/**
 * Every layer of the mark as SVG `d` strings, fitted to a `width` × `height`
 * box with one shared transform: the body, both ribbons, the crossing shadow,
 * the arch highlights, and each shard with its tier and side.
 */
export function markLayers({ width, height, padding = 0, mark = MARK, maxTier = mark.maxTier, precision = 2 } = {}) {
  const parts = markParts(mark, { maxTier });
  const { place } = fitMark({ width, height, padding, mark, maxTier });
  const f = (v) => Number(v.toFixed(precision));
  const d = (points) => closedSubpath(place(points), f);
  return {
    body: d(parts.body.points),
    overStrand: d(parts.overStrand.points),
    underStrand: d(parts.underStrand.points),
    crossShadow: d(parts.crossShadow.points),
    sheens: parts.sheens.map((sheen) => d(sheen.points)),
    shards: parts.shards.map((shard) => ({ d: d(shard.points), tier: shard.tier, side: shard.side })),
  };
}

/**
 * The mark as one SVG `d` string — the body first, then one closed subpath per
 * shard — fitted to a `width` × `height` box. One flat fill of this is the
 * whole silhouette (the splash mask, the in-app logo).
 */
export function markPath(options = {}) {
  const layers = markLayers(options);
  return [layers.body, ...layers.shards.map((shard) => shard.d)].join(' ');
}
