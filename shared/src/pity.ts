import { z } from 'zod';

/**
 * Pity tracker: pulls since the last 5★ on each banner type, whether the next
 * 5★ is guaranteed to be the featured one, and a log of past 5★s.
 *
 * The player records pulls as they make them. Memoria does not read the game's
 * own history. Hard pity, base rates and the featured odds are each game's
 * published rules; the soft-pity start and ramp are community-measured, so
 * anything built on them ("typical") is shown as an estimate.
 *
 * Sources and the uncertain numbers, checked 2026-11-05, are in
 * docs/pity-rules.md.
 */

export interface PityRule {
  /** Stable id, stored as the track key. Lowercase letters only. */
  id: string;
  label: string;
  /** The pull that always gives a 5★. */
  hard: number;
  /** First pull with a raised 5★ rate. */
  soft: number;
  /** 5★ rate per pull before soft pity. */
  base: number;
  /** Rate added on each pull from soft pity on. */
  step: number;
  /**
   * Chance a 5★ is the featured one when it is not guaranteed. Absent on a
   * standard banner, which has nothing featured. 1 means always featured.
   */
  featured?: number;
  /** Calendar banners of this kind spend this track's pity. */
  bannerKind?: 'character' | 'weapon' | 'support';
}

const character = (label: string, featured = 0.5): PityRule => ({
  id: 'character',
  label,
  hard: 90,
  soft: 74,
  base: 0.006,
  step: 0.06,
  featured,
  bannerKind: 'character',
});
const standard = (hard = 90, soft = 74, base = 0.006, step = 0.06): PityRule => ({
  id: 'standard',
  label: 'Standard',
  hard,
  soft,
  base,
  step,
});

/** Per game preset key. A game without rules has no pity tracker. */
export const PITY_RULES: Record<string, readonly PityRule[]> = {
  genshin: [
    // Capturing Radiance (5.0): HoYoverse states 55% consolidated for a non-guaranteed 5★.
    character('Character event', 0.55),
    // Tracks the weapon chosen on the Epitomized Path: 37.5% on an open 5★
    // (75% featured, then one of two), and one Fate Point guarantees it next.
    {
      id: 'weapon',
      label: 'Weapon event (chosen weapon)',
      hard: 80,
      soft: 63,
      base: 0.007,
      step: 0.07,
      featured: 0.375,
      bannerKind: 'weapon',
    },
    standard(),
  ],
  hsr: [
    character('Character warp'),
    {
      id: 'weapon',
      label: 'Light cone warp',
      hard: 80,
      soft: 66,
      base: 0.008,
      step: 0.07,
      featured: 0.75,
      bannerKind: 'weapon',
    },
    standard(),
  ],
  zzz: [
    character('Exclusive channel'),
    {
      id: 'weapon',
      label: 'W-Engine channel',
      hard: 80,
      soft: 65,
      base: 0.01,
      step: 0.06,
      featured: 0.75,
      bannerKind: 'weapon',
    },
    {
      id: 'bangboo',
      label: 'Bangboo channel',
      hard: 80,
      soft: 65,
      base: 0.01,
      step: 0.06,
      featured: 1,
      bannerKind: 'support',
    },
    standard(),
  ],
  wuwa: [
    // WuWa's ramp is uneven (community: +4pp from 66, +8pp from 71, +10pp from 76);
    // a flat +5pp gives about the same 54-pull average.
    {
      id: 'character',
      label: 'Featured resonator',
      hard: 80,
      soft: 66,
      base: 0.008,
      step: 0.05,
      featured: 0.5,
      bannerKind: 'character',
    },
    {
      id: 'weapon',
      label: 'Featured weapon',
      hard: 80,
      soft: 66,
      base: 0.008,
      step: 0.05,
      featured: 1,
      bannerKind: 'weapon',
    },
    standard(80, 66, 0.008, 0.05),
  ],
};

export const pityRulesFor = (presetKey: string | undefined): readonly PityRule[] =>
  (presetKey && PITY_RULES[presetKey]) || [];

export const MAX_PITY_LOG = 200;
const MAX_PITY = 200;

export const PityOutcomeSchema = z.enum(['won', 'lost', 'guaranteed', 'standard']);

export const PityFiveStarSchema = z.object({
  id: z.string().min(1).max(64),
  /** When it was recorded, epoch ms. */
  at: z.number().int().positive(),
  /** The pull it came on, counted from the 5★ before it. */
  pity: z.number().int().min(1).max(MAX_PITY),
  outcome: PityOutcomeSchema,
  name: z.string().max(80).optional(),
});

export const PityTrackSchema = z.object({
  /** Pulls made since the last 5★. */
  count: z.number().int().min(0).max(MAX_PITY),
  /** The next 5★ is the featured one. */
  guaranteed: z.boolean().default(false),
  /** Past 5★s, oldest first. */
  log: z.array(PityFiveStarSchema).max(MAX_PITY_LOG).default([]),
});

/** Track ids are short lowercase words, so a key can never be `__proto__` or similar. */
const TRACK_KEY = /^[a-z]{1,16}$/;

export const GamePitySchema = z.object({
  tracks: z
    .record(z.string().regex(TRACK_KEY), PityTrackSchema)
    .refine((tracks) => Object.keys(tracks).length <= 8, 'Too many pity tracks.'),
});

export type PityOutcome = z.infer<typeof PityOutcomeSchema>;
export type PityFiveStar = z.infer<typeof PityFiveStarSchema>;
export type PityTrack = z.infer<typeof PityTrackSchema>;
export type GamePity = z.infer<typeof GamePitySchema>;

export const EMPTY_TRACK: PityTrack = { count: 0, guaranteed: false, log: [] };

export const trackOf = (pity: GamePity | undefined, id: string): PityTrack => pity?.tracks[id] ?? EMPTY_TRACK;

export function addPulls(track: PityTrack, pulls: number): PityTrack {
  return { ...track, count: Math.min(MAX_PITY, Math.max(0, track.count + Math.floor(pulls))) };
}

/**
 * Records a 5★ that came on pull `pity`. Pulls logged after it stay counted.
 * A lost 50/50 makes the next one guaranteed; any featured 5★ clears it.
 */
export function recordFiveStar(
  track: PityTrack,
  rule: PityRule,
  entry: { id: string; at: number; pity: number; won?: boolean; name?: string },
): PityTrack {
  const pity = Math.min(Math.max(1, Math.floor(entry.pity)), rule.hard);
  const outcome: PityOutcome =
    rule.featured === undefined
      ? 'standard'
      : track.guaranteed || rule.featured >= 1
        ? 'guaranteed'
        : entry.won === false
          ? 'lost'
          : 'won';
  const name = entry.name?.trim().slice(0, 80);
  const log = [...track.log, { id: entry.id, at: entry.at, pity, outcome, ...(name ? { name } : {}) }].slice(
    -MAX_PITY_LOG,
  );
  return {
    count: Math.max(0, track.count - pity),
    guaranteed: rule.featured === undefined ? false : outcome === 'lost',
    log,
  };
}

/** Removes a logged 5★. Pity and the guarantee are left as they are; the player can correct them. */
export const removeFiveStar = (track: PityTrack, id: string): PityTrack => ({
  ...track,
  log: track.log.filter((entry) => entry.id !== id),
});

/** Chance of a 5★ on pull `n` (1-based), given no 5★ before it. */
export function rateAt(rule: PityRule, n: number): number {
  if (n >= rule.hard) return 1;
  if (n < rule.soft) return rule.base;
  return Math.min(1, rule.base + rule.step * (n - rule.soft + 1));
}

/** Expected pulls to the next 5★, starting with `count` pulls already made. */
export function expectedPullsToFiveStar(rule: PityRule, count = 0): number {
  let survive = 1;
  let expected = 0;
  for (let n = count + 1; n <= rule.hard; n++) {
    const p = rateAt(rule, n);
    expected += survive * p * (n - count);
    survive *= 1 - p;
  }
  return expected;
}

export interface PullsNeeded {
  /** Pulls that make the featured 5★ certain. */
  worst: number;
  /** Expected pulls, from the soft-pity curve. An estimate. */
  typical: number;
}

/** Pulls needed for the next featured 5★ (or any 5★ on a standard banner). */
export function pullsForFeatured(rule: PityRule, track: PityTrack): PullsNeeded {
  const count = Math.min(track.count, rule.hard - 1);
  const first = rule.hard - count;
  const firstTypical = expectedPullsToFiveStar(rule, count);
  const certain = rule.featured === undefined || rule.featured >= 1 || track.guaranteed;
  if (certain) return { worst: first, typical: Math.round(firstTypical) };
  const miss = 1 - rule.featured!;
  return {
    worst: first + rule.hard,
    typical: Math.round(firstTypical + miss * expectedPullsToFiveStar(rule, 0)),
  };
}

export interface PityStats {
  fiveStars: number;
  /** Average pull a 5★ came on, or null with none logged. */
  averagePity: number | null;
  won: number;
  lost: number;
}

export function pityStats(track: PityTrack): PityStats {
  const total = track.log.reduce((sum, entry) => sum + entry.pity, 0);
  return {
    fiveStars: track.log.length,
    averagePity: track.log.length ? total / track.log.length : null,
    won: track.log.filter((entry) => entry.outcome === 'won').length,
    lost: track.log.filter((entry) => entry.outcome === 'lost').length,
  };
}

/** The track a calendar banner spends, for a game's rules. */
export function ruleForBanner(rules: readonly PityRule[], bannerKind: string | undefined): PityRule | undefined {
  return bannerKind ? rules.find((rule) => rule.bannerKind === bannerKind) : undefined;
}
