import type { Cadence, ResourceKind, TaskMode } from './types';

/**
 * Preset library. Values are sane defaults as of mid-2026 — every one of them
 * is editable in the app, and caps/rates/reset times should be verified
 * in-game after patches. Presets are data, not rules.
 *
 * ## What earns a place in a task list
 *
 * The audience is someone already several gacha deep, not a newcomer being
 * taught the game. A preset that ships chores they delete on every fresh
 * install is worse than one that ships too few, because the deleting is manual
 * and the list is the first thing they see. Three tests, all of which a task
 * must pass:
 *
 * 1. **Would they forget it?** If playing at all completes it, it is noise.
 *    "Spend <energy>" tasks are the clearest case: you spend the energy because
 *    you logged in to spend the energy, and the resource row already projects
 *    the cap and raises the in-app warning. Battle-pass weeklies fall out the same way.
 * 2. **Does it cost something to miss?** Prefer things with a real deadline and
 *    a real loss — Condensed Resin banking past the cap, ZZZ's Coffee handing
 *    you 60 Battery the cap cannot hold, NTE's three Anomaly Pilgrimage runs.
 * 3. **Does anything else already own it?** Endgame windows (Spiral Abyss,
 *    Imaginarium Theater, Stygian, MoC/PF/AS/AA, Shiyu/Deadly Assault, Beyond
 *    the Rails) ship as seeded Timeline cycle events with their true windows.
 *    Duplicating them as tickable tasks meant maintaining the same fact twice.
 *    WuWa's ToA/Whimpering Wastes stay as tasks precisely because nothing
 *    seeds them.
 *
 * `core: true` is stricter still — reserved for tasks that pay the game's
 * premium pull currency, so skipping one costs pulls. Those sort to the top of
 * the card. Ascension mats and side rewards do not qualify.
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
  /**
   * Pays the game's premium pull currency. Sorts to the top of the card.
   *
   * The bar is deliberately high: a task is core only if skipping it costs you
   * pulls. Ascension materials, battle-pass XP and side rewards do not qualify,
   * however annoying they are to miss.
   */
  core?: boolean;
  /**
   * Custom-cadence tasks follow the matching Timeline window by default. Set
   * false for personal cooldowns that start when *you* use them and have no
   * game-wide window (Parametric Transformer).
   */
  timelineLinked?: boolean;
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
 * The preset a game was created from, matched by its stored key when available.
 * Legacy games fall back to the original `short`, then `name`, heuristic.
 */
export function presetForGame(game: { name: string; short: string; presetKey?: string }): GamePreset | undefined {
  const short = game.short.trim().toLowerCase();
  const name = game.name.trim().toLowerCase();
  return (
    PRESETS.find((preset) => preset.key === game.presetKey) ??
    PRESETS.find((preset) => preset.short.toLowerCase() === short) ??
    PRESETS.find((preset) => preset.name.toLowerCase() === name)
  );
}

/** Preset tasks a game has not got, by name — what a "catch me up" action would add. */
export function missingPresetTasks(
  game: { name: string; short: string; presetKey?: string },
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
      { name: 'Daily Commissions ×4', cadence: 'daily', mode: 'count', countTarget: 4, core: true },
      // Condensed banks 40 Resin at a time and is the only way to carry Resin
      // past the cap without wasting regen — craft before logging off.
      { name: 'Craft Condensed Resin', cadence: 'daily' },
      {
        name: 'Expeditions (collect + resend)',
        cadence: 'daily',
        mode: 'timer',
        timerDurationMinutes: 20 * 60,
      },
      // Rewards are capped at 10 Random Events a day (10–15 Companionship EXP
      // each, plus Mora and Fine Enhancement Ore). Nothing announces the cap and
      // nothing carries over, so it is quietly the largest thing most players
      // leave on the table. "Friend to Animals" — feeding the puppy — is the
      // quickest to trigger; it wants Fowl ×1 in your bag.
      { name: 'Random Events ×10', cadence: 'daily', mode: 'count', countTarget: 10 },
      // Overworld artifact investigation points respawn on the daily reset and
      // stop paying out after 30 pickups. Free strongbox fodder and artifact
      // EXP for a route you can run on autopilot.
      { name: 'Artifact route (30 pickups)', cadence: 'daily' },
      { name: 'Weekly Bosses ×3', cadence: 'weekly', mode: 'count', countTarget: 3 },
      { name: 'Reputation bounties + requests', cadence: 'weekly' },
      // 6d22h cooldown from use, not a game-wide window — it starts when you
      // press the button, so it must not chase a Timeline event.
      { name: 'Parametric Transformer', cadence: 'custom', intervalDays: 7, timelineLinked: false },
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
      { name: 'Daily Training (500)', cadence: 'daily', core: true },
      {
        name: 'Assignments (collect + resend)',
        cadence: 'daily',
        mode: 'timer',
        timerDurationMinutes: 20 * 60,
      },
      // The largest repeatable Jade block outside the endgame modes.
      { name: 'Simulated/Divergent Universe', cadence: 'weekly', core: true },
      { name: 'Echo of War ×3', cadence: 'weekly', mode: 'count', countTarget: 3 },
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
      { name: 'Daily Engagement (400)', cadence: 'daily', core: true },
      // Coffee Shop: +60 Battery on top of the 240 cap, once a day — free energy
      // that the cap cannot hold, so it is genuinely lost if you skip it.
      { name: 'Coffee (+60 Battery)', cadence: 'daily' },
      // 3×3 grid, 1300 points for the full payout — the biggest weekly Polychrome block.
      { name: 'Ridu Weekly (1300)', cadence: 'weekly', core: true },
      { name: 'Notorious Hunt ×3', cadence: 'weekly', mode: 'count', countTarget: 3 },
      { name: 'Hollow Zero: bounties + research', cadence: 'weekly' },
      { name: 'Matrix Op / Lost Void', cadence: 'weekly' },
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
      { name: 'Daily Activity (100)', cadence: 'daily', core: true },
      { name: 'Weekly Challenges', cadence: 'weekly' },
      { name: 'Weekly Boss ×3', cadence: 'weekly', mode: 'count', countTarget: 3 },
      // Kept as tasks: unlike the HoYo endgame modes, these two have no seeded
      // Timeline events, so dropping them would lose the rotation entirely.
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
      { name: 'Daily quests / 100 Participation', cadence: 'daily', core: true },
      // "Make a Sincere Wish" every day — the Mhm! Coins path to a free S-Rank Arc.
      { name: "Nacupeda's Pool wish", cadence: 'daily' },
      { name: 'Mews Flash lottery', cadence: 'daily' },
      // Capped at three attempts a week and the only Esper upgrade source — the
      // one weekly that actually costs you progress if you skip it.
      { name: 'Anomaly Pilgrimage ×3', cadence: 'weekly', mode: 'count', countTarget: 3 },
      { name: "Ebisu's Auction", cadence: 'weekly' },
      { name: 'Realm of Greed', cadence: 'weekly' },
      { name: 'Special Commissions', cadence: 'weekly' },
      { name: 'Lost / Warp Exchange + Arc Selection', cadence: 'monthly' },
    ],
    notes: 'Verify City Stamina cap for your account — it refills fully each Monday.',
    // Best guess — verify in Task Manager while NTE runs and edit if needed.
    processNames: ['NTE'],
  },
];
