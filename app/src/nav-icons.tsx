import type { CSSProperties } from 'react';
import { type IconSet } from './icon-sets';
import { NAV_ICON_ART } from './nav-icon-art';
import { useUI } from './ui-store';

export { DEFAULT_ICON_SET, ICON_SETS, isIconSet, type IconSet } from './icon-sets';

export type NavGlyph = 'today' | 'calendar' | 'notes' | 'games' | 'settings' | 'add' | 'refresh';

/**
 * Each place's own hue, for the Colour and Tiles sets: Today the morning's
 * amber, Calendar blue, Notes green, Games violet, Settings slate. Fixed hues
 * that read on every palette, light or dark.
 */
const HUE: Record<NavGlyph, string> = {
  today: 'oklch(0.8 0.15 70)',
  calendar: 'oklch(0.7 0.14 245)',
  notes: 'oklch(0.74 0.14 155)',
  games: 'oklch(0.68 0.17 300)',
  settings: 'oklch(0.66 0.04 260)',
  add: 'oklch(0.66 0.04 260)',
  refresh: 'oklch(0.66 0.04 260)',
};

/**
 * Pixel art on a 12×12 grid, one row a string: `#` is a lit pixel. Drawn for
 * this app, in the spirit of an eight-bit menu.
 */
const PIXELS: Record<NavGlyph, string[]> = {
  today: [
    '.....##.....',
    '.#...##...#.',
    '..#......#..',
    '....####....',
    '...######...',
    '##.######.##',
    '##.######.##',
    '...######...',
    '....####....',
    '..#......#..',
    '.#...##...#.',
    '.....##.....',
  ],
  calendar: [
    '...#....#...',
    '.##########.',
    '.##########.',
    '.#........#.',
    '.#.##..##.#.',
    '.#.##..##.#.',
    '.#........#.',
    '.#.##..##.#.',
    '.#.##..##.#.',
    '.#........#.',
    '.##########.',
    '............',
  ],
  notes: [
    '.#######....',
    '.#.....##...',
    '.#.....#.#..',
    '.#.....####.',
    '.#........#.',
    '.#.######.#.',
    '.#........#.',
    '.#.######.#.',
    '.#........#.',
    '.#.####...#.',
    '.##########.',
    '............',
  ],
  games: [
    '............',
    '............',
    '.##########.',
    '############',
    '##.######.##',
    '#...####.#.#',
    '##.######.##',
    '############',
    '####....####',
    '###......###',
    '.#........#.',
    '............',
  ],
  settings: [
    '.....##.....',
    '..#.####.#..',
    '.##########.',
    '..###..###..',
    '.###....###.',
    '####....####',
    '####....####',
    '.###....###.',
    '..###..###..',
    '.##########.',
    '..#.####.#..',
    '.....##.....',
  ],
  add: [
    '............',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.##########.',
    '.##########.',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '............',
  ],
  refresh: [
    '............',
    '....####.#..',
    '..##....###.',
    '.#.....####.',
    '.#..........',
    '#...........',
    '#...........',
    '.#........#.',
    '.#........#.',
    '..##....##..',
    '....####....',
    '............',
  ],
};

/** A pixel grid as one path of unit squares. */
function pixelPath(rows: string[]): string {
  let d = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) if (row[x] === '#') d += `M${x} ${y}h1v1h-1Z`;
  });
  return d;
}
const PIXEL_PATHS = Object.fromEntries(
  (Object.keys(PIXELS) as NavGlyph[]).map((glyph) => [glyph, pixelPath(PIXELS[glyph])]),
) as Record<NavGlyph, string>;

/**
 * The places' icons (Today, Calendar, Notes, Games, Settings) and the rail's
 * small actions, in the set the player picks in Settings → Appearance → Icons.
 * The sets differ in kind: Outline, Solid, Colour and Tiles draw the same
 * pictures (Phosphor Icons, nav-icon-art.ts) as lines, as solids, over a
 * colour fill and on a coloured tile; Minimal draws other pictures as abstract
 * marks; Pixel is pixel art.
 */
export function NavIcon({
  glyph,
  className = '',
  set: forced,
}: {
  glyph: NavGlyph;
  className?: string;
  set?: IconSet;
}) {
  const chosen = useUI((s) => s.iconSet);
  const set = forced ?? chosen;
  const common = {
    'aria-hidden': true,
    className: `nav-icon ${className}`,
    'data-set': set,
    style: { '--place-hue': HUE[glyph] } as CSSProperties,
  };
  if (set === 'pixel')
    return (
      <svg {...common} viewBox="-1 -1 14 14" fill="currentColor" shapeRendering="crispEdges">
        <path d={PIXEL_PATHS[glyph]} />
      </svg>
    );
  if (set === 'tiles')
    return (
      <svg {...common} viewBox="0 0 256 256">
        <rect width="256" height="256" rx="72" fill="var(--place-hue)" />
        <g
          fill="#fff"
          transform="translate(52 52) scale(0.594)"
          // Static markup from the generated art file, never from data.
          dangerouslySetInnerHTML={{ __html: NAV_ICON_ART.solid[glyph] }}
        />
      </svg>
    );
  return (
    <svg
      {...common}
      viewBox="0 0 256 256"
      fill="currentColor"
      // Static markup from the generated art file, never from data.
      dangerouslySetInnerHTML={{ __html: NAV_ICON_ART[set][glyph] }}
    />
  );
}
