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
 *
 * ## Why this file is full of raw hex values
 *
 * Every `color`/`color2`/`color3` below is sampled from a game's own icon or
 * logo. It is owner data, not a design token, and snapping it to our semantic
 * scale would turn it into a different game's colour. The design-colour detector
 * is scoped off for this file alone (.impeccable/config.json) — see The Owner
 * Palette Is Not A Token Rule in app/DESIGN.md. These values still only reach a
 * pixel through a trio helper in game-color.ts, which lifts them for legibility
 * and never bleaches them.
 */
export interface PresetResource {
  name: string;
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
  timerStepMinutes?: number;
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
  /** Secondary accent — the title ink and the lead tube tone. */
  color2?: string;
  /** Third accent — small highlights, and the first candidate for the card rim. */
  color3?: string;
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
  // Non-HoYo publishers cut their regions differently. Infold gives Love and
  // Deepspace a UTC+2 Europe and a UTC-7 America; Shift Up runs every NIKKE
  // region off one UTC+9 clock; Cygames runs Umamusume Global on UTC+0. All are
  // fixed offsets, like the HoYo/Kuro ones — none of them observe DST.
  { label: 'Infold Europe (UTC+2)', tz: 'Etc/GMT-2' },
  { label: 'Infold America (UTC-7)', tz: 'Etc/GMT+7' },
  { label: 'NIKKE, all regions (UTC+9)', tz: 'Etc/GMT-9' },
  { label: 'Umamusume Global (UTC+0)', tz: 'Etc/GMT' },
  { label: 'UTC', tz: 'Etc/UTC' },
  { label: 'US Pacific (DST)', tz: 'America/Los_Angeles' },
  { label: 'US Eastern (DST)', tz: 'America/New_York' },
  { label: 'Japan (UTC+9)', tz: 'Asia/Tokyo' },
  { label: 'Central Europe (DST)', tz: 'Europe/Warsaw' },
];

// Short labels are stored on games. Removing an old alias when a badge changes
// would detach a renamed legacy account that has no presetKey.
const LEGACY_PRESET_SHORTS: Readonly<Partial<Record<string, readonly string[]>>> = {
  genshin: ['gi'],
};

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
    PRESETS.find((preset) => LEGACY_PRESET_SHORTS[preset.key]?.includes(short)) ??
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
    short: 'Genshin',
    // Cream identity pair. The raw creams cannot clear 3:1 on the light cream
    // surfaces, so the existing trio helpers fall through to the navy accent
    // instead of inventing another colour. Helper contrast is: black — title
    // 18.36, rim/accent 3.27; dark panel #131316 — 16.21, 3.40; cream #efeae0 —
    // all 8.24; light panel #ebe4d6 — all 7.81.
    color: '#f8efdb',
    color2: '#d8c9b4',
    color3: '#2f4078',
    // Fantasy serif — Genshin's storybook look.
    titleFont: "'Cinzel', serif",
    icon: '',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      { name: 'Original Resin', cap: 200, regenMinutes: 8, reserveCap: 0, kind: 'regen' },
      { name: 'Condensed Resin', cap: 5, regenMinutes: 0, reserveCap: 0, kind: 'counter' },
      {
        name: 'Realm Currency',
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
      // Produces 15 Crystal Cores per 7-day cycle; the cooldown starts on harvest, not on the weekly reset.
      {
        name: 'Crystalfly Trap (Crystal Cores)',
        cadence: 'custom',
        intervalDays: 7,
        mode: 'timer',
        timerDurationMinutes: 10_080,
        timerStepMinutes: 720,
        timelineLinked: false,
      },
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
    color: '#ff8fc0',
    color2: '#5aa9ff',
    color3: '#ff8fc0',
    // Condensed sci-fi — the Astral Express dashboard vibe.
    titleFont: "'Orbitron', sans-serif",
    icon: '',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      {
        name: 'Trailblaze Power',
        cap: 300,
        regenMinutes: 6,
        reserveCap: 2400,
        // The reserve fills at a third of the bar's rate, not half — the 2 ×
        // regenMinutes default would have promised a full 2400 in 20 days
        // instead of 30.
        reserveRegenMinutes: 18,
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
    color: '#f07e0f',
    color2: '#f2f4f6',
    color3: '#f07e0f',
    // Heavy urban display — New Eridu street style.
    titleFont: "'Rajdhani', sans-serif",
    icon: '',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      {
        name: 'Battery Charge',
        cap: 240,
        regenMinutes: 6,
        reserveCap: 2400,
        // Backup Battery fills at 1 per 18 minutes — same third-rate rule as
        // HSR's reserve, and not the 2 × regenMinutes default.
        reserveRegenMinutes: 18,
        kind: 'regen',
        reserveLabel: 'Backup Battery',
      },
    ],
    tasks: [
      { name: 'Daily Engagement (400)', cadence: 'daily', core: true },
      // Coffee Shop: +60 Battery on top of the 240 cap, once a day — free energy
      // that the cap cannot hold, so it is genuinely lost if you skip it.
      { name: 'Coffee (+60 Battery)', cadence: 'daily' },
      // The track runs to 2100 points since v2.5, but all four Polychrome tiers
      // are paid by 800 — past that you are farming Denny, not pulls.
      { name: 'Ridu Weekly (800 for all Polychrome)', cadence: 'weekly', core: true },
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
    color: '#d3dae0',
    color2: '#27396f',
    color3: '#27396f',
    // Wide sleek tech — WuWa's minimal futurism.
    titleFont: "'Exo 2', sans-serif",
    icon: '',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      {
        name: 'Waveplates',
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
    color: '#3b7cff',
    color2: '#ffde40',
    color3: '#3b7cff',
    // Playful rounded pop — Mint's polka-dot energy.
    titleFont: "'Space Grotesk', sans-serif",
    icon: '',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 5,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      { name: 'Character Pixels', cap: 240, regenMinutes: 6, reserveCap: 0, kind: 'regen' },
      {
        name: 'City Stamina',
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
  {
    key: 'lads',
    name: 'Love and Deepspace',
    short: 'LADS',
    // App-icon palette (sampled): the icon's sky blue over its deep-space navy.
    // The sky blue sits within 18° of NTE's blue, so `assignGameInks` may hand
    // this game the navy on the timeline instead. That is the function working,
    // not a palette to fix: the navy is the member that reads on cream anyway.
    color: '#78b9dd',
    color2: '#101d3a',
    color3: '#f4f7fb',
    // Elegant geometric — the wordmark's thin, wide-set capitals.
    titleFont: "'Jost', sans-serif",
    icon: '',
    // No native desktop client. Infold's own FAQ points PC players at an
    // Android emulator, so there is no executable worth watching for.
    platform: 'mobile',
    tz: 'Etc/GMT-2',
    dailyResetHour: 5,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      // Both caps rise with the paid Aurum Pass (Stamina 120 → 170, Vitality
      // 480 → 720), so neither default is right for every account.
      { name: 'Stamina', cap: 120, regenMinutes: 6, reserveCap: 0, kind: 'regen', promptCap: true },
      { name: 'Vitality', cap: 480, regenMinutes: 6, reserveCap: 0, kind: 'regen', promptCap: true },
    ],
    tasks: [
      { name: 'Daily Agenda (100)', cadence: 'daily', core: true },
      // 30 Stamina at noon and 60 at night, in two fixed windows (10:00–14:00
      // and 16:00–20:00 server time). Miss the window and the Stamina is gone —
      // this is the clearest "costs you something" daily in the game.
      { name: 'Supply claims (noon + night)', cadence: 'daily', mode: 'count', countTarget: 2 },
      { name: 'Friend Stamina (send + claim)', cadence: 'daily' },
      { name: 'Galaxy Explorer (collect + resend)', cadence: 'daily' },
      { name: 'Weekly Agenda (all tiers)', cadence: 'weekly', core: true },
      { name: 'Home weekly tasks', cadence: 'weekly' },
      { name: 'Playtime free attempts', cadence: 'weekly' },
    ],
    notes:
      'Europe server (UTC+2); America runs UTC-7. Both Stamina caps rise with Aurum Pass — set your own. Deepspace Trials Directional Orbits open on fixed weekdays.',
  },
  {
    key: 'uma',
    name: 'Umamusume: Pretty Derby',
    short: 'Uma',
    // App-icon palette (sampled): the logo's turf green, its ribbon pink and
    // the gold trim.
    color: '#23b6a7',
    color2: '#f05a8a',
    color3: '#f5c542',
    // Soft heavy display — the logo's thick, friendly letterforms.
    titleFont: "'Fredoka', sans-serif",
    icon: '',
    platform: 'both',
    // One Global service on UTC+0 — there is no region to pick.
    tz: 'Etc/GMT',
    // 15:00 UTC, not midnight. Content drops (banners, story events) land at
    // 22:00 UTC instead, which is why the two clocks disagree in game.
    dailyResetHour: 15,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      { name: 'TP', cap: 100, regenMinutes: 10, reserveCap: 0, kind: 'regen' },
      { name: 'RP', cap: 5, regenMinutes: 120, reserveCap: 0, kind: 'regen' },
    ],
    tasks: [
      { name: 'Daily Missions (full set)', cadence: 'daily', core: true },
      { name: 'Daily Race tickets ×3', cadence: 'daily', mode: 'count', countTarget: 3 },
      // Five borrows a day, and they do not carry over — the quietest loss in
      // the daily loop.
      { name: 'Guest Legacies ×5', cadence: 'daily', mode: 'count', countTarget: 5 },
      // One ticket a day, capped at one: an unused ticket is simply gone.
      { name: 'Daily Legend Race', cadence: 'daily' },
      { name: 'Club: request an item', cadence: 'daily' },
      // Team Trials tallies once a week and pays the class reward off your best
      // score, so a week with no score entered is a week with no Carats. It is
      // also the ONLY weekly this game has — the Club ranking and every shop
      // exchange run monthly, and the mission list has no weekly tab at all.
      { name: 'Team Trials score before the tally', cadence: 'weekly', core: true },
      { name: 'Club Ranking Rewards', cadence: 'monthly' },
    ],
    notes:
      'Global service, UTC+0. Daily missions refresh 15:00; new banners and events open 22:00. Champions Meeting runs as its own limited window — see the Timeline.',
    processNames: ['UmamusumePrettyDerby'],
  },
  {
    key: 'nikke',
    name: 'Goddess of Victory: Nikke',
    short: 'NIKKE',
    // App-icon palette (sampled): the logo's accent red on the icon's
    // near-black, with the wordmark white as the third.
    color: '#e31b2d',
    color2: '#f2f2f4',
    color3: '#111318',
    // Techno stencil — the wordmark's cut, condensed capitals.
    titleFont: "'Chakra Petch', sans-serif",
    icon: '',
    platform: 'both',
    // Every region — Korea, Japan, NA, SEA and Global — publishes on one UTC+9
    // clock, so there is no per-region offset to choose.
    tz: 'Etc/GMT-9',
    dailyResetHour: 5,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      // NIKKE has no regenerating energy bar. What it has instead are two
      // stores that stop paying once they fill, which is the same failure the
      // resource row exists to warn about.
      { name: 'Interception attempts', cap: 3, regenMinutes: 0, reserveCap: 0, kind: 'counter' },
      {
        name: 'Outpost Defense (hours stored)',
        cap: 12,
        regenMinutes: 60,
        reserveCap: 0,
        kind: 'regen',
      },
    ],
    tasks: [
      { name: 'Daily Missions (100 points)', cadence: 'daily', core: true },
      { name: 'Outpost Defense claim', cadence: 'daily' },
      // Which manufacturer towers are open changes by weekday, and three floors
      // per open tower expire at reset.
      { name: 'Tribe Tower floors ×3', cadence: 'daily', mode: 'count', countTarget: 3 },
      { name: 'Interception ×3', cadence: 'daily', mode: 'count', countTarget: 3 },
      { name: 'Social Points (send + claim)', cadence: 'daily' },
      { name: 'Bulletin Board dispatch', cadence: 'daily' },
      { name: 'Weekly Missions (100 points)', cadence: 'weekly', core: true },
      { name: 'Recycling Shop: Gems for Broken Cores', cadence: 'weekly' },
    ],
    notes:
      'All regions run on UTC+9. Tribe Tower rotates by weekday: Mon all, Tue Elysion, Wed Missilis + Pilgrim, Thu Tetra, Fri Elysion, Sat Missilis, Sun Tetra.',
    processNames: ['nikke', 'nikke_launcher'],
  },
  {
    key: 'endfield',
    name: 'Arknights: Endfield',
    short: 'Endfield',
    // Logo and interface palette: the UI's signal yellow, the inverse logo
    // white, the logo black. The yellow lands close to Genshin's Mora gold, so
    // `assignGameInks` may step this game to the white on a shared surface.
    color: '#f0b900',
    color2: '#f2f2f0',
    color3: '#101114',
    // Wide industrial — the wordmark's cut-corner geometric capitals.
    titleFont: "'Saira', sans-serif",
    icon: '',
    platform: 'both',
    // GRYPHLINE runs ONE combined Americas/Europe server on UTC-5. A European
    // player is not on a UTC+1 clock here, unlike every HoYo/Kuro game above.
    tz: 'Etc/GMT+5',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      // The cap climbs the whole way from 125 to 360 across Authority Levels
      // 1–60, so the default is the level-60 ceiling and the app asks.
      { name: 'Sanity', cap: 360, regenMinutes: 7.2, reserveCap: 0, kind: 'regen', promptCap: true },
    ],
    tasks: [
      { name: 'Daily Activity (100)', cadence: 'daily', core: true },
      // The factory is the game's real daily: full stores and stalled queues
      // stop producing, and nothing tells you they have.
      { name: 'Dijiang cabins (collect + restock)', cadence: 'daily' },
      { name: 'Reception Room clue', cadence: 'daily' },
      { name: 'Outpost trade before Stock Bills cap', cadence: 'daily' },
      { name: 'Weekly Routine (10 points)', cadence: 'weekly', core: true },
      { name: 'Etchspace Salvage focus commissions ×3', cadence: 'weekly', mode: 'count', countTarget: 3 },
      { name: 'Stock Redistribution weekly goods', cadence: 'weekly' },
    ],
    notes:
      'Americas and Europe share one UTC-5 server. Sanity cap depends on Authority Level (125 at 1, 360 at 60) — set your own. Echoes of War seasons run in the Timeline.',
    processNames: ['Endfield'],
  },
];
