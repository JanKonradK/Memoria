import { useId } from 'react';
import { MARK_HEIGHT, MARK_PATH, MARK_WIDTH } from './mark-path';

/**
 * The Memoria mark: an INFINITY SIGN with a piece missing where it crosses itself.
 *
 * A lemniscate of Bernoulli, stroke-modulated the way a broad-nib pen draws it
 * — heavy through the outer curves, light at the crossing. At the crossing one
 * strand stops short and resumes past the other: the gap is the under-strand
 * AND the loop's beginning/end, and it keeps the mark inside the app's
 * incomplete-ring language — nothing here draws a closed circle. Gold, never
 * blue.
 *
 * The outline is generated from app/scripts/mobius.mjs, the same geometry the
 * PNG/ICO app icons are rendered from, so the vector and raster marks agree.
 */
export function Logo({ wordmark, className = '' }: { wordmark?: string; className?: string }) {
  const gradientId = `logo-${useId().replaceAll(':', '')}`;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        aria-hidden="true"
        // w-auto, not a hard-coded width: the box is generated from the mark's
        // own aspect, so letting the intrinsic ratio drive the width keeps the
        // mark centred and the gap to the wordmark even at any height.
        className="h-6 w-auto shrink-0 overflow-visible"
        viewBox={`0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`}
        fill="none"
      >
        <defs>
          {/* Same three stops as the wordmark below — the ramp lives in the
              theme so the mark and the word can never drift apart. */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--color-fg)" />
            <stop offset="0.62" stopColor="var(--color-gold-hi)" />
            <stop offset="1" stopColor="var(--color-gold)" />
          </linearGradient>
        </defs>
        <path d={MARK_PATH} fill={`url(#${gradientId})`} />
      </svg>
      {wordmark ? (
        // Solid, not a gradient. The mark carries the gold ramp because it is a
        // shape; running the same ramp through the letterforms only softened
        // them and cost contrast at small sizes.
        <span className="text-gold">{wordmark}</span>
      ) : (
        <span className="sr-only">Memoria</span>
      )}
    </span>
  );
}
