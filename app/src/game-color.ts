/**
 * The game trio: how an owner's colours become a wash, a title ink and a rim.
 *
 * The governing rule is that owner colours are never *replaced* — a pale primary
 * stays pale jewelry rather than being dark-filtered into mud. When a colour
 * cannot be read against the current ground it walks toward a tinted lift of its
 * own hue, retaining ~40% of the source at the far end. Substituting white,
 * black or grey bleaches an owner's choice into chrome, which is the one thing
 * this system exists to avoid. See DESIGN.md, The Lift, Never Bleach Rule.
 */

import { presetForGame } from '@memoria/shared';

export type Trio = { primary: string; secondary: string; accent: string };

export type GameColors = { color: string; color2?: string; color3?: string };

type IdentityGame = {
  id: string;
  name: string;
  short?: string;
  presetKey?: string;
  sort?: number;
} & GameColors;

/** One parser for every helper, so shorthand hex cannot break a subset of them. */
function channels(hex: string): [number, number, number] {
  const raw = hex.trim().replace('#', '');
  const full = raw.length === 3 ? raw.replace(/(.)/g, '$1$1') : raw;
  if (!/^[\da-f]{6}/i.test(full)) return [148, 148, 158];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return [r!, g!, b!];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Blends two colours. `t` is how much of `a` survives. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return toHex([ar * t + br * (1 - t), ag * t + bg * (1 - t), ab * t + bb * (1 - t)]);
}

function relativeLuminance(hex: string): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Picks black or white ink for a filled swatch. Game colours span lime to deep
 * teal, so a single hard-coded ink is unreadable on half of them.
 */
export function onColor(hex: string): string {
  return relativeLuminance(hex) > 0.42 ? '#0a0a0b' : '#f4f4f6';
}

/** Keeps a palette role intact, lifting only as far as legibility demands. */
function legible(color: string, ground: string): string {
  if (contrast(color, ground) >= 3) return color;
  const liftLight = contrast('#ffffff', ground) >= contrast('#000000', ground);
  // The endpoint retains ~40% of the source, so a pale cream primary is still
  // recognisably that game's cream after the walk.
  const toward = liftLight ? mix(color, '#ffffff', 0.4) : mix(color, '#000000', 0.4);
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(color, toward, 1 - step / 20);
    if (contrast(candidate, ground) >= 3.2) return candidate;
  }
  return toward;
}

/** Fills the trio out from whatever the owner actually supplied. */
export function trioOf(game: GameColors): Trio {
  const primary = game.color;
  const secondary = game.color2 || primary;
  const accent = game.color3 || secondary;
  return { primary, secondary, accent };
}

export function gameIdentityKey(game: Pick<IdentityGame, 'name' | 'short' | 'presetKey'>): string {
  const preset = presetForGame({ name: game.name, short: game.short ?? '', presetKey: game.presetKey });
  return preset ? `preset:${preset.key}` : `name:${game.name.trim().toLowerCase()}`;
}

function sameTrio(left: Trio, right: Trio): boolean {
  return (['primary', 'secondary', 'accent'] as const).every(
    (key) => left[key].trim().toLowerCase() === right[key].trim().toLowerCase(),
  );
}

/**
 * Resolves every account of one game to one stable visual trio.
 *
 * A preset-matching account is authoritative even when another account sorts
 * first. Custom identity groups fall back to sort order, then id, so the result
 * does not depend on the order in which a caller happened to receive the games.
 */
export function resolveGameIdentityColors(games: readonly IdentityGame[]): Record<string, GameColors> {
  const groups = new Map<string, IdentityGame[]>();
  for (const game of games) {
    const key = gameIdentityKey(game);
    groups.set(key, [...(groups.get(key) ?? []), game]);
  }

  const resolved: Record<string, GameColors> = {};
  for (const group of groups.values()) {
    const presetMatches = new Map(
      group.map((game) => {
        const preset = presetForGame({ name: game.name, short: game.short ?? '', presetKey: game.presetKey });
        return [game.id, preset ? sameTrio(trioOf(game), trioOf(preset)) : false] as const;
      }),
    );
    const winner = [...group].sort(
      (left, right) =>
        Number(presetMatches.get(right.id)) - Number(presetMatches.get(left.id)) ||
        (left.sort ?? 0) - (right.sort ?? 0) ||
        left.id.localeCompare(right.id),
    )[0]!;
    const trio = trioOf(winner);
    const colors = { color: trio.primary, color2: trio.secondary, color3: trio.accent };
    group.forEach((game) => {
      resolved[game.id] = colors;
    });
  }
  return resolved;
}

function hueAndLightness(hex: string): { hue: number | null; lightness: number } {
  const [r, g, b] = channels(hex).map((value) => value / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  // Near-neutrals have no perceptually useful hue; compare them by lightness.
  if (delta <= 0.04) return { hue: null, lightness };
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, lightness };
}

/**
 * The card fill. The primary only *whispers* into the chrome — about 7% on dark,
 * 22% on the cream ground — so five cards stay pleasant charcoal panels wearing
 * jewelry, rather than five muddy painted walls. See The Whisper Rule.
 */
export function gameWash(game: GameColors, surface: [string, string], theme: 'dark' | 'light'): [string, string] {
  const amount = theme === 'dark' ? 0.07 : 0.22;
  const { primary } = trioOf(game);
  return [mix(primary, surface[0], amount), mix(primary, surface[1], amount * 0.75)];
}

/**
 * The saturated 1px card edge. Prefers accent, then secondary, then primary, and
 * skips anything near-white or near-black — a pale accent yields to a cyan
 * secondary rather than drawing an edge nobody can see.
 */
export function gameRim(game: GameColors, ground: string): string {
  const { primary, secondary, accent } = trioOf(game);
  const pick = [accent, secondary, primary].find((candidate) => {
    const { hue, lightness } = hueAndLightness(candidate);
    return hue !== null && lightness > 0.12 && lightness < 0.88;
  });
  return legible(pick ?? primary, ground);
}

/** The first-priority colour: timeline bars and the resource readout. */
export function gameInk(game: GameColors, ground: string): string {
  return legible(trioOf(game).primary, ground);
}

/**
 * The name of the game, in the game's own colour.
 *
 * A title is the largest piece of identity on the page, so it is the one place
 * where a lift is the *second* answer rather than the first. Walk the trio for a
 * member that already reads against this ground, and only lift if none does.
 *
 * This is what a two-colour game is for. Wuthering Waves ships a pale
 * `#d3dae0` and a navy `#27396f`: the pale one is jewelry on charcoal (14.9:1)
 * and invisible on cream (1.2:1), where the navy reads at 9.2:1. Lifting the
 * pale one instead produced `#7a7e82` — a grey that belongs to no game. Stepping
 * gives each theme the member that was always right for it, unmodified.
 *
 * Games with no legible member (Star Rail's pink, Zenless's orange — both too
 * light for cream, in every slot) still fall through to the lift, which is the
 * correct answer when the owner has not supplied a dark option.
 */
export function gameTitleInk(game: GameColors, ground: string): string {
  const { primary, secondary, accent } = trioOf(game);
  return [primary, secondary, accent].find((candidate) => contrast(candidate, ground) >= 3) ?? legible(primary, ground);
}

/** The second-priority colour: title ink and the lead tube tone. */
export function gameSupport(game: GameColors, ground: string): string {
  return legible(trioOf(game).secondary, ground);
}

/** The third-priority colour, reserved for small highlights. */
export function gameAccent(game: GameColors, ground: string): string {
  return legible(trioOf(game).accent, ground);
}

function tooClose(a: string, b: string): boolean {
  const first = hueAndLightness(a);
  const second = hueAndLightness(b);
  if (Math.abs(first.lightness - second.lightness) > 0.12) return false;
  // At the ends of the lightness range hue stops being perceptible: a cream and
  // a blush white differ by 60° of hue and by nothing at all to the eye. Judging
  // two near-whites by hue is how a pair of cream primaries both kept their
  // colour and drew two identical beige lanes — one sat a hair either side of
  // the neutrality threshold, so they were never compared. Neither of the two
  // games that hit it is cream any more, but the trap is in the maths, not in
  // those palettes: any two pale primaries would fall into it again.
  if (first.lightness > 0.85 && second.lightness > 0.85) return true;
  if (first.lightness < 0.15 && second.lightness < 0.15) return true;
  if (first.hue === null || second.hue === null) return first.hue === null && second.hue === null;
  const direct = Math.abs(first.hue - second.hue);
  return Math.min(direct, 360 - direct) <= 24;
}

/**
 * Assigns every game a bar colour in one pass so the dashboard and the timeline
 * agree. Priority still leads: a game gets its primary unless an earlier game
 * already occupies that region of hue and lightness, in which case it steps down
 * to secondary then accent. Accounts of the same game reuse the first result;
 * colour identifies the title, while the account label identifies the account.
 * Without this, three of five reference games resolve to near-identical greys on
 * the cream ground and become indistinguishable.
 */
export function assignGameInks(games: IdentityGame[], ground: string): Record<string, string> {
  const taken: string[] = [];
  const out: Record<string, string> = {};
  const byGame = new Map<string, string>();
  const identityColors = resolveGameIdentityColors(games);
  for (const game of games) {
    const identity = gameIdentityKey(game);
    const shared = byGame.get(identity);
    if (shared) {
      out[game.id] = shared;
      continue;
    }
    const colors = identityColors[game.id] ?? game;
    const candidates = [gameInk(colors, ground), gameSupport(colors, ground), gameAccent(colors, ground)];
    const chosen = candidates.find((candidate) => !taken.some((other) => tooClose(candidate, other))) ?? candidates[2]!;
    out[game.id] = chosen;
    byGame.set(identity, chosen);
    taken.push(chosen);
  }
  return out;
}
