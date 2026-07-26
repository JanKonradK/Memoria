import { useId } from 'react';
import { MARK_HEIGHT, MARK_PATH, MARK_WIDTH } from './mark-path';

/**
 * The Void mark: a MÖBIUS BAND with a piece missing where it crosses itself.
 *
 * One loop, one half twist — the band goes edge-on exactly once (the taper at
 * the left tip), which is the whole difference between a Möbius strip and a
 * ring. At the crossing, one strand stops short and resumes past the other: the
 * gap is the under-strand of the crossing AND the loop's beginning/end, and it
 * keeps the mark inside the app's incomplete-ring language — nothing here draws
 * a closed circle. Gold to amber, never blue.
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
        className="h-6 w-11 shrink-0 overflow-visible drop-shadow-[0_0_10px_rgba(232,180,90,0.45)]"
        viewBox={`0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`}
        fill="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f5d68a" />
            <stop offset="0.55" stopColor="#e8b45a" />
            <stop offset="1" stopColor="#c78a2e" />
          </linearGradient>
        </defs>
        <path d={MARK_PATH} fill={`url(#${gradientId})`} />
      </svg>
      {wordmark ? (
        <span className="bg-gradient-to-r from-amber-100 via-gold to-amber-300 bg-clip-text text-transparent drop-shadow-[0_0_12px_rgba(232,180,90,0.35)]">
          {wordmark}
        </span>
      ) : (
        <span className="sr-only">Void</span>
      )}
    </span>
  );
}
