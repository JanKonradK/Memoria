import { presetForGame } from '@memoria/shared';
import { serverRegionLabel } from './server-region';

/**
 * The three regions offered as a one-tap choice, left to right — the HoYo/Kuro
 * rows of SERVER_TZ_OPTIONS, which is where these strings come from.
 *
 * Mind the sign: `Etc/GMT-1` is UTC**+**1. The POSIX zones invert, which is the
 * trap documented alongside SERVER_TZ_OPTIONS itself. game-detail-draft.test.tsx
 * derives the same three from their real UTC offsets and asserts they match, so
 * a typo here fails a test rather than silently sending a European account to
 * the wrong reset hour.
 */
export const SERVER_OPTIONS = [
  { value: 'Etc/GMT-1', label: 'EU' },
  { value: 'Etc/GMT+5', label: 'NA' },
  { value: 'Etc/GMT-8', label: 'Asia' },
];

/**
 * The server choices for one game. A game whose own Europe server follows
 * summer time (NTE) keeps that clock behind its EU choice, so picking EU never
 * moves its reset by an hour. A server outside the three is shown, disabled,
 * rather than quietly swapped for one of them.
 */
export function serverChoices(
  game: { name: string; short: string; presetKey?: string; tz: string },
  now = Date.now(),
): { value: string; label: string; disabled?: boolean }[] {
  const presetTz = presetForGame(game)?.tz;
  const ownEurope =
    presetTz && !presetTz.startsWith('Etc/') && serverRegionLabel(presetTz, now) === 'EU' ? presetTz : null;
  const regions = ownEurope
    ? SERVER_OPTIONS.map((option) => (option.label === 'EU' ? { ...option, value: ownEurope } : option))
    : SERVER_OPTIONS;
  if (regions.some((option) => option.value === game.tz)) return regions;
  return [...regions, { value: game.tz, label: serverRegionLabel(game.tz, now), disabled: true }];
}
