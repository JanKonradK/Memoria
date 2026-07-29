/**
 * Geometry for the incomplete-ring design language: a stroked outline with a
 * visible gap, the way an in-progress download indicator reads.
 *
 * Everything is one shape — a stadium (pill) outline. When width === height it
 * IS a circle, so badges that need to hold a long label stretch along their flat
 * edges while the caps stay perfectly circular. That is what keeps 'WuWa' legible
 * without abandoning the ring language.
 *
 * Callers set `pathLength={RING_PATH_LENGTH}` and drive the gap with
 * `stroke-dasharray`, so the sweep animates without recomputing any geometry.
 */

/** Normalised path length so a sweep of 0..1 maps directly onto stroke-dasharray. */
export const RING_PATH_LENGTH = 100;

function coord(value: number): string {
  return Number(value.toFixed(3)).toString();
}

/**
 * Stadium outline starting at top-centre of the left cap and running clockwise,
 * so a partial sweep grows from the top like a download ring.
 */
export function stadiumPath(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';
  const r = height / 2;
  const w = Math.max(width, height);
  const straight = w - height;
  return [
    `M${coord(r)} 0`,
    `L${coord(r + straight)} 0`,
    `A${coord(r)} ${coord(r)} 0 0 1 ${coord(r + straight)} ${coord(height)}`,
    `L${coord(r)} ${coord(height)}`,
    `A${coord(r)} ${coord(r)} 0 0 1 ${coord(r)} 0`,
    'Z',
  ].join(' ');
}

/** Convenience for the circular case. */
export function ringPath(size: number): string {
  return stadiumPath(size, size);
}

/** `stroke-dasharray` for a 0..1 sweep against RING_PATH_LENGTH. */
export function sweepDasharray(sweep: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(sweep) ? sweep : 0));
  return `${Number((clamped * RING_PATH_LENGTH).toFixed(3))} ${RING_PATH_LENGTH}`;
}

// The Void mark used to be built from two open arcs here. It is now an infinity
// band with a break at its crossing — geometry in app/scripts/mobius.mjs,
// generated outline in app/src/components/mark-path.ts.
