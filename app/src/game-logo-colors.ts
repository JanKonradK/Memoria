import type { Game } from '@memoria/shared';

/** Ring colours per preset, as [colour of RING_A, colour of RING_B] in docs/logos. */
const PRESET_RINGS = new Map<string, [string, string]>([
  ['genshin', ['#e8c77a', '#2f4078']],
  ['hsr', ['#5aa9ff', '#ff8fc0']],
  ['zzz', ['#f07e0f', '#f2f4f6']],
  ['wuwa', ['#d3dae0', '#27396f']],
  ['nte', ['#3b7cff', '#ffde40']],
  ['lads', ['#78b9dd', '#f4f7fb']],
  ['uma', ['#f05a8a', '#23b6a7']],
  ['nikke', ['#e31b2d', '#f2f2f4']],
  ['endfield', ['#f0b900', '#f2f2f0']],
]);

/** The two ring colours for a game: its preset's pair, else its own accents. */
export function logoRing(game: Pick<Game, 'presetKey' | 'color' | 'color2' | 'color3'>): [string, string] {
  const preset = game.presetKey ? PRESET_RINGS.get(game.presetKey) : undefined;
  return preset ?? [game.color, game.color2 ?? game.color3 ?? '#f2f4f6'];
}
