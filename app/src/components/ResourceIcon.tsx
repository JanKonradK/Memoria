import type { ReactElement } from 'react';

/**
 * Original, hand-drawn glyphs representing gacha energy/currency types.
 * These are our own designs (not game art), rendered in the game's accent
 * color via `currentColor`. viewBox is 24×24 for every icon.
 */
const ICONS: Record<string, ReactElement> = {
  // Faceted crystal — Genshin resin and gem-like energies.
  crystal: (
    <>
      <path d="M6 3h12l3 5-9 13-9-13z" fill="currentColor" />
      <path d="M3 8h18M9 3l3 18 3-18" stroke="rgba(255,255,255,0.35)" strokeWidth="1" fill="none" />
    </>
  ),
  // Astral sparkle with a trailing spark — HSR Trailblaze Power.
  comet: (
    <>
      <path d="M12 2c0 6 2 8 8 8-6 0-8 2-8 8 0-6-2-8-8-8 6 0 8-2 8-8z" fill="currentColor" />
      <circle cx="19.5" cy="18.5" r="1.6" fill="currentColor" />
    </>
  ),
  // Stacked waves — Wuthering Waves waveplates.
  wave: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 7c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2" />
      <path d="M3 12c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2" />
      <path d="M3 17c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2" />
    </g>
  ),
  // Battery with a bolt — ZZZ battery charge.
  battery: (
    <>
      <rect x="2.5" y="7" width="15" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M20 10.3v3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10.5 8.5l-3 4h2.4l-1 3 3.6-4H10l1-3z" fill="currentColor" />
    </>
  ),
  // Lightning bolt — generic energy.
  bolt: <path d="M13 2 4 14h6l-2 8L20 9h-7z" fill="currentColor" />,
  // Stopwatch — training / time-point resources.
  stopwatch: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="14" r="7" />
      <path d="M12 14v-4M10 3h4M12 3v2" />
    </g>
  ),
  // Horseshoe — Umamusume RP / racing.
  horseshoe: (
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M8 4C4 6.5 4 13 8 20" />
      <path d="M16 4c4 2.5 4 9 0 16" />
      <path d="M8 20h1.5M16 20h-1.5" />
    </g>
  ),
  // Glowing orb with an inset star — Dokkan stamina.
  orb: (
    <>
      <circle cx="12" cy="12" r="9" fill="currentColor" />
      <path d="M12 7l1.3 2.9 3.2.3-2.4 2.1.7 3.1-2.8-1.7-2.8 1.7.7-3.1-2.4-2.1 3.2-.3z" fill="rgba(0,0,0,0.35)" />
    </>
  ),
  heart: <path d="M12 21C5 15 3 11 3 8a4.5 4.5 0 0 1 9-1 4.5 4.5 0 0 1 9 1c0 3-2 7-9 13z" fill="currentColor" />,
  flame: <path d="M12 2c3 4 6 6 6 10a6 6 0 0 1-12 0c0-2 1-3.2 2-4 .2 1.2 1 2 2 2 0-3 1-5 2-8z" fill="currentColor" />,
  droplet: <path d="M12 2c4 6 7 9 7 12a7 7 0 0 1-14 0c0-3 3-6 7-12z" fill="currentColor" />,
  moon: <path d="M20 14a8 8 0 1 1-9-11 6.5 6.5 0 0 0 9 11z" fill="currentColor" />,
  star: <path d="M12 2l2.9 6.2 6.8.7-5 4.6 1.4 6.7L12 17.8 5.9 20.9l1.4-6.7-5-4.6 6.8-.7z" fill="currentColor" />,
  ticket: (
    <path
      d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4z"
      fill="currentColor"
    />
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="9" fill="currentColor" />
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="1.5" />
    </>
  ),
};

export const RESOURCE_ICON_KEYS = Object.keys(ICONS);

export const DEFAULT_RESOURCE_ICON = 'bolt';

export function ResourceIcon({
  iconKey,
  size = 16,
  color,
  className,
}: {
  iconKey?: string;
  size?: number;
  color?: string;
  className?: string;
}) {
  const inner = ICONS[iconKey ?? ''] ?? ICONS[DEFAULT_RESOURCE_ICON]!;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={{ color, display: 'block' }}
      aria-hidden
    >
      {inner}
    </svg>
  );
}
