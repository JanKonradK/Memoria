import type { Cadence, ResourceKind, TaskMode } from './types';

/**
 * Preset library. Values are sane defaults as of mid-2026 — every one of them
 * is editable in the app, and caps/rates/reset times should be verified
 * in-game after patches. Presets are data, not rules.
 *
 * Server timezone notes: HoYo + Kuro servers run on FIXED offsets (no DST):
 *   America = UTC-5 → "Etc/GMT+5" (IANA Etc zones have inverted signs)
 *   Europe  = UTC+1 → "Etc/GMT-1"
 *   Asia    = UTC+8 → "Etc/GMT-8"
 */
export interface PresetResource {
  name: string;
  /** Key into the built-in resource icon set. */
  icon: string;
  cap: number;
  regenMinutes: number;
  reserveCap: number;
  /** Minutes per reserve point once the bar is capped; omit for the 2 × regenMinutes default. */
  reserveRegenMinutes?: number;
  kind?: ResourceKind;
  reserveLabel?: string;
  /** Ask the user for their own cap when adding (account-dependent caps like NTE City Stamina). */
  promptCap?: boolean;
}

export interface PresetTask {
  name: string;
  cadence: Cadence;
  /** For cadence "custom": rotation length in days (endgame cycles). */
  intervalDays?: number;
  mode?: TaskMode;
  timerDurationMinutes?: number;
  countTarget?: number;
}

export interface GamePreset {
  key: string;
  name: string;
  short: string;
  color: string;
  /** Secondary accent for two-tone gradients. */
  color2?: string;
  /** CSS font-family evoking the game's own logo/identity (bundled via @fontsource in the app). */
  titleFont?: string;
  icon: string;
  platform: 'pc' | 'mobile' | 'both';
  tz: string;
  dailyResetHour: number;
  weeklyResetDay: number; // ISO: 1 = Monday
  monthlyResetDay: number;
  resources: PresetResource[];
  tasks: PresetTask[];
  notes?: string;
  /** Executable names (no .exe, case-insensitive) for "what was I just playing" detection. */
  processNames?: string[];
}

export const SERVER_TZ_OPTIONS: Array<{ label: string; tz: string }> = [
  { label: 'HoYo/Kuro America (UTC-5)', tz: 'Etc/GMT+5' },
  { label: 'HoYo/Kuro Europe (UTC+1)', tz: 'Etc/GMT-1' },
  { label: 'HoYo/Kuro Asia (UTC+8)', tz: 'Etc/GMT-8' },
  { label: 'UTC', tz: 'Etc/UTC' },
  { label: 'US Pacific (DST)', tz: 'America/Los_Angeles' },
  { label: 'US Eastern (DST)', tz: 'America/New_York' },
  { label: 'Japan (UTC+9)', tz: 'Asia/Tokyo' },
  { label: 'Central Europe (DST)', tz: 'Europe/Warsaw' },
];

/**
 * The preset a game was created from, matched after the fact: games do not store
 * a preset key (they are fully editable copies), and renaming one should not
 * break the link, so `short` is the identity that actually survives editing.
 */
export function presetForGame(game: { name: string; short: string }): GamePreset | undefined {
  const short = game.short.trim().toLowerCase();
  const name = game.name.trim().toLowerCase();
  return (
    PRESETS.find((preset) => preset.short.toLowerCase() === short) ??
    PRESETS.find((preset) => preset.name.toLowerCase() === name)
  );
}

/** Preset tasks a game has not got, by name — what a "catch me up" action would add. */
export function missingPresetTasks(
  game: { name: string; short: string },
  existing: Array<{ name: string; deleted?: boolean }>,
): PresetTask[] {
  const preset = presetForGame(game);
  if (!preset) return [];
  // Deleted tasks count as present: the user removed them on purpose, and an
  // update that quietly resurrects them is worse than one that misses a few.
  const have = new Set(existing.map((task) => task.name.trim().toLowerCase()));
  return preset.tasks.filter((task) => !have.has(task.name.trim().toLowerCase()));
}

export const PRESETS: GamePreset[] = [
  {
    key: 'genshin',
    name: 'Genshin Impact',
    short: 'GI',
    // App-icon palette (sampled): Paimon's warm cream into soft tan.
    color: '#f8efdb',
    color2: '#d8c9b4',
    // Fantasy serif — Genshin's storybook look.
    titleFont: "'Marcellus', serif",
    icon: '',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      { name: 'Original Resin', icon: 'crystal', cap: 200, regenMinutes: 8, reserveCap: 0, kind: 'regen' },
      { name: 'Condensed Resin', icon: 'crystal', cap: 5, regenMinutes: 0, reserveCap: 0, kind: 'counter' },
      {
        name: 'Realm Currency',
        icon: 'orb',
        cap: 2400,
        regenMinutes: 2,
        reserveCap: 0,
        kind: 'regen',
        promptCap: true,
      },
    ],
    tasks: [
      { name: 'Daily Commissions ×4', cadence: 'daily', mode: 'count', countTarget: 4 },
      { name: 'Spend Resin', cadence: 'daily' },
      // Condensed banks 40 Resin at a time and is the only way to carry Resin
      // past the cap without wasting regen — craft before logging off.
      { name: 'Craft Condensed Resin', cadence: 'daily' },
      {
        name: 'Expeditions (collect + resend)',
        cadence: 'daily',
        mode: 'timer',
        timerDurationMinutes: 20 * 60,
      },
      // Realm Currency fills its cap in under three days, so this is daily in practice.
      { name: 'Teapot: currency + gifts', cadence: 'daily' },
      { name: 'Weekly Bosses ×3', cadence: 'weekly', mode: 'count', countTarget: 3 },
      { name: 'Reputation bounties + requests', cadence: 'weekly' },
      { name: 'Battle Pass weeklies', cadence: 'weekly' },
      // Both run permanently: Abyss resets the 15th, Theater the 1st (timeline tracks the windows).
      { name: 'Spiral Abyss + Imaginarium Theater', cadence: 'monthly' },
      { name: 'Stygian Onslaught cycle', cadence: 'custom', intervalDays: 35 },
      // 6d22h cooldown from use — anchor drifts, re-anchor after using it.
      { name: 'Parametric Transformer', cadence: 'custom', intervalDays: 7 },
    ],
    notes:
      'Europe server (UTC+1). Craft Condensed daily; it counts 60 Dire Prestige in Stygian. Realm Currency rate/cap depend on Trust Rank + Adeptal Energy.',
    processNames: ['GenshinImpact', 'YuanShen'],
  },
  {
    key: 'hsr',
    name: 'Honkai: Star Rail',
    short: 'HSR',
    // App-icon palette (sampled): March 7th pink into the icon's turquoise backdrop.
    color: '#f2a7c8',
    color2: '#74d8e6',
    // Condensed sci-fi — the Astral Express dashboard vibe.
    titleFont: "'Rajdhani', sans-serif",
    icon: '',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      {
        name: 'Trailblaze Power',
        icon: 'comet',
        cap: 300,
        regenMinutes: 6,
        reserveCap: 2400,
        kind: 'regen',
        reserveLabel: 'Reserve TB Power',
      },
    ],
    tasks: [
      { name: 'Daily Training (500)', cadence: 'daily' },
      { name: 'Spend Trailblaze Power', cadence: 'daily' },
      {
        name: 'Assignments (collect + resend)',
        cadence: 'daily',
        mode: 'timer',
        timerDurationMinutes: 20 * 60,
      },
      { name: 'Simulated/Divergent Universe', cadence: 'weekly' },
      { name: 'Echo of War ×3', cadence: 'weekly', mode: 'count', countTarget: 3 },
      { name: 'Nameless Honor weeklies', cadence: 'weekly' },
      // MoC / Pure Fiction / Apocalyptic Shadow / Anomaly Arbitration run
      // staggered 6-week cycles — a different one refreshes every ~2 weeks.
      { name: 'Endgame refresh (MoC/PF/AS/AA)', cadence: 'custom', intervalDays: 14 },
    ],
    notes: 'Reserve TB Power stores overflow (up to 2400). Europe server (UTC+1).',
    processNames: ['StarRail'],
  },
  {
    key: 'zzz',
    name: 'Zenless Zone Zero',
    short: 'ZZZ',
    // App-icon palette (sampled): the icon's exact orange into charcoal black.
    color: '#f3841b',
    color2: '#3b3b40',
    // Heavy urban display — New Eridu street style.
    titleFont: "'Archivo Black', sans-serif",
    icon: '',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      {
        name: 'Battery Charge',
        icon: 'battery',
        cap: 240,
        regenMinutes: 6,
        reserveCap: 2400,
        kind: 'regen',
        reserveLabel: 'Backup Battery',
      },
    ],
    tasks: [
      { name: 'Daily Engagement (400)', cadence: 'daily' },
      { name: 'Spend Battery Charge', cadence: 'daily' },
      // Coffee Shop: +60 Battery on top of the 240 cap, once a day — free energy.
      { name: 'Coffee (+60 Battery)', cadence: 'daily' },
      // Also feeds the Ridu Weekly grid, so it is never just the scratch reward.
      { name: 'Scratch Card', cadence: 'daily' },
      // 3×3 grid, 1300 points for the full payout — the biggest weekly Polychrome block.
      { name: 'Ridu Weekly (1300)', cadence: 'weekly' },
      { name: 'Notorious Hunt ×3', cadence: 'weekly', mode: 'count', countTarget: 3 },
      { name: 'Hollow Zero: bounties + research', cadence: 'weekly' },
      { name: 'Matrix Op / Lost Void', cadence: 'weekly' },
      // Shiyu Critical and Deadly Assault alternate every two weeks.
      { name: 'Shiyu Critical / Deadly Assault', cadence: 'custom', intervalDays: 14 },
    ],
    notes: 'Europe server (UTC+1). Matrix Operation weeklies pay ~4.6k Polychrome/month — don’t skip.',
    processNames: ['ZenlessZoneZero'],
  },
  {
    key: 'wuwa',
    name: 'Wuthering Waves',
    short: 'WuWa',
    // App-icon palette (sampled): mist silver into the hair's blue-charcoal.
    color: '#dde0e6',
    color2: '#3d4453',
    // Wide sleek tech — WuWa's minimal futurism.
    titleFont: "'Michroma', sans-serif",
    icon: '',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      {
        name: 'Waveplates',
        icon: 'wave',
        cap: 240,
        regenMinutes: 6,
        reserveCap: 480,
        kind: 'regen',
        reserveLabel: 'Waveplate Crystals',
      },
    ],
    tasks: [
      { name: 'Daily Activity (100)', cadence: 'daily' },
      { name: 'Spend Waveplates', cadence: 'daily' },
      { name: 'Weekly Challenges', cadence: 'weekly' },
      { name: 'Weekly Boss ×3', cadence: 'weekly', mode: 'count', countTarget: 3 },
      { name: 'Sim Battle Pass weeklies', cadence: 'weekly' },
      { name: 'ToA Hazard Zone cycle', cadence: 'custom', intervalDays: 28 },
      { name: 'Whimpering Wastes cycle', cadence: 'custom', intervalDays: 28 },
    ],
    notes: 'Europe server (UTC+1). Hazard Zone and WhiWa each rotate every 28 days (offset).',
    // Kuro ships a generic UE executable name; both spellings seen across installs.
    processNames: ['Wuthering Waves', 'Client-Win64-Shipping'],
  },
  {
    key: 'nte',
    name: 'Neverness to Everness',
    short: 'NTE',
    // App-icon palette (sampled): Mint's teal into the polka-dot yellow.
    color: '#28e1d7',
    color2: '#fedc40',
    // Playful rounded pop — Mint's polka-dot energy.
    titleFont: "'Baloo 2', sans-serif",
    icon: '',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 5,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      { name: 'Character Pixels', icon: 'bolt', cap: 240, regenMinutes: 6, reserveCap: 0, kind: 'regen' },
      {
        name: 'City Stamina',
        icon: 'orb',
        cap: 100,
        regenMinutes: 0,
        reserveCap: 0,
        kind: 'weekly',
        promptCap: true,
      },
    ],
    tasks: [
      { name: 'Spend Character Pixels', cadence: 'daily' },
      { name: 'Daily quests / 100 Participation', cadence: 'daily' },
      // "Make a Sincere Wish" every day — the Mhm! Coins path to a free S-Rank Arc.
      { name: "Nacupeda's Pool wish", cadence: 'daily' },
      { name: 'Mews Flash lottery', cadence: 'daily' },
      { name: 'Café by Origen (collect + restock)', cadence: 'daily' },
      // Capped at three attempts a week and the only Esper upgrade source — the
      // one weekly that actually costs you progress if you skip it.
      { name: 'Anomaly Pilgrimage ×3', cadence: 'weekly', mode: 'count', countTarget: 3 },
      // Every Hobby pays a flat 1000 Fons per City Stamina, so what you play is
      // taste; leaving stamina unspent before Monday is the only wrong answer.
      { name: 'Spend City Stamina (Hobbies)', cadence: 'weekly' },
      { name: "Ebisu's Auction", cadence: 'weekly' },
      { name: 'Realm of Greed', cadence: 'weekly' },
      { name: 'Special Commissions', cadence: 'weekly' },
      { name: 'Lost / Warp Exchange + Arc Selection', cadence: 'monthly' },
      { name: 'Beyond the Rails (per version)', cadence: 'custom', intervalDays: 42 },
    ],
    notes: 'Verify City Stamina cap for your account — it refills fully each Monday.',
    // Best guess — verify in Task Manager while NTE runs and edit if needed.
    processNames: ['NTE'],
  },
];
