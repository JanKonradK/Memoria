import { useId } from 'react';
import { infinityLobePath } from './ring-geometry';

/**
 * The Void mark: an infinity sign built from TWO OPEN ARCS.
 *
 * The infinity symbol is literally two circles, so drawing it from two
 * incomplete rings makes the logo and the UI language the same idea — each lobe
 * carries the same visible gap as the download-style rings used for nav cells,
 * badges and progress. Gold to amber, never blue.
 */
export function Logo({ wordmark, className = '' }: { wordmark?: string; className?: string }) {
  const gradientId = `logo-${useId().replaceAll(':', '')}`;
  const width = 44;
  const height = 24;
  const r = 8.5;
  const cy = height / 2;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        aria-hidden="true"
        className="h-6 w-11 shrink-0 overflow-visible drop-shadow-[0_0_10px_rgba(232,180,90,0.45)]"
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f5d68a" />
            <stop offset="0.55" stopColor="#e8b45a" />
            <stop offset="1" stopColor="#c78a2e" />
          </linearGradient>
        </defs>
        <g stroke={`url(#${gradientId})`} strokeWidth="2.4" strokeLinecap="round">
          <path d={infinityLobePath(width / 2 - r + 1.5, cy, r, false)} />
          <path d={infinityLobePath(width / 2 + r - 1.5, cy, r, true)} />
        </g>
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
