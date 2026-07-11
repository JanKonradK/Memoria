import type { Cadence } from './types';

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
  /** Ask the user for their own cap when adding (rank-based caps like Dokkan). */
  promptCap?: boolean;
}

export interface PresetTask {
  name: string;
  cadence: Cadence;
  /** For cadence "custom": rotation length in days (endgame cycles). */
  intervalDays?: number;
}

export interface GamePreset {
  key: string;
  name: string;
  short: string;
  color: string;
  icon: string;
  platform: 'pc' | 'mobile' | 'both';
  tz: string;
  dailyResetHour: number;
  weeklyResetDay: number; // ISO: 1 = Monday
  monthlyResetDay: number;
  resources: PresetResource[];
  tasks: PresetTask[];
  notes?: string;
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

export const PRESETS: GamePreset[] = [
  {
    key: 'genshin',
    name: 'Genshin Impact',
    short: 'GI',
    color: '#38bdf8',
    icon: '⚔️',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      { name: 'Original Resin', icon: 'crystal', cap: 200, regenMinutes: 8, reserveCap: 0 },
      // Worth 60 Dire Prestige each in Stygian Onslaught — bank 5 + near-max
      // resin before a Stygian phase for maximum limited-artifact value.
      { name: 'Condensed Resin', icon: 'crystal', cap: 5, regenMinutes: 0, reserveCap: 0 },
    ],
    tasks: [
      { name: 'Daily Commissions', cadence: 'daily' },
      { name: 'Spend Resin', cadence: 'daily' },
      { name: 'Weekly Bosses ×3', cadence: 'weekly' },
      { name: 'Abyss / Theater (alternate monthly)', cadence: 'monthly' },
      { name: 'Stygian Onslaught cycle', cadence: 'custom', intervalDays: 35 },
    ],
    notes: 'Europe server (UTC+1). Craft Condensed daily; it counts 60 Dire Prestige in Stygian.',
  },
  {
    key: 'hsr',
    name: 'Honkai: Star Rail',
    short: 'HSR',
    color: '#a78bfa',
    icon: '🚂',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [{ name: 'Trailblaze Power', icon: 'comet', cap: 300, regenMinutes: 6, reserveCap: 2400 }],
    tasks: [
      { name: 'Daily Training', cadence: 'daily' },
      { name: 'Simulated/Divergent Universe', cadence: 'weekly' },
      { name: 'Echo of War ×3', cadence: 'weekly' },
      // MoC / Pure Fiction / Apocalyptic Shadow / Anomaly Arbitration run
      // staggered 6-week cycles — a different one refreshes every ~2 weeks.
      { name: 'Endgame refresh (MoC/PF/AS/AA)', cadence: 'custom', intervalDays: 14 },
    ],
    notes: 'Reserve TB Power stores overflow (up to 2400). Europe server (UTC+1).',
  },
  {
    key: 'zzz',
    name: 'Zenless Zone Zero',
    short: 'ZZZ',
    color: '#a3e635',
    icon: '📺',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [{ name: 'Battery Charge', icon: 'battery', cap: 240, regenMinutes: 6, reserveCap: 0 }],
    tasks: [
      { name: 'Daily Engagement', cadence: 'daily' },
      { name: 'Matrix Op / Lost Void (weekly)', cadence: 'weekly' },
      { name: 'Weekly Boss', cadence: 'weekly' },
      // Shiyu Critical and Deadly Assault alternate every two weeks.
      { name: 'Shiyu Critical / Deadly Assault', cadence: 'custom', intervalDays: 14 },
    ],
    notes: 'Europe server (UTC+1). Matrix Operation weeklies pay ~4.6k Polychrome/month — don’t skip.',
  },
  {
    key: 'wuwa',
    name: 'Wuthering Waves',
    short: 'WuWa',
    color: '#2dd4bf',
    icon: '🌊',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [{ name: 'Waveplates', icon: 'wave', cap: 240, regenMinutes: 6, reserveCap: 0 }],
    tasks: [
      { name: 'Daily Activity', cadence: 'daily' },
      { name: 'Weekly Challenges', cadence: 'weekly' },
      { name: 'Weekly Boss ×3', cadence: 'weekly' },
      { name: 'ToA Hazard Zone cycle', cadence: 'custom', intervalDays: 28 },
      { name: 'Whimpering Wastes cycle', cadence: 'custom', intervalDays: 28 },
    ],
    notes: 'Europe server (UTC+1). Hazard Zone and WhiWa each rotate every 28 days (offset).',
  },
  {
    key: 'nte',
    name: 'Neverness to Everness',
    short: 'NTE',
    color: '#e879f9',
    icon: '🏙️',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 5,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      { name: 'Character Pixels', icon: 'bolt', cap: 240, regenMinutes: 6, reserveCap: 0 },
      // Refills in full every Monday — spend it in Hethereau Hobbies before then.
      { name: 'City Stamina', icon: 'orb', cap: 100, regenMinutes: 0, reserveCap: 0, promptCap: true },
    ],
    tasks: [
      { name: 'Spend Pixels / 100 Participation', cadence: 'daily' },
      { name: 'Anomaly Pilgrimage ×3', cadence: 'weekly' },
      { name: 'Spend City Stamina (Hobbies)', cadence: 'weekly' },
      { name: 'Beyond the Rails (per version)', cadence: 'custom', intervalDays: 42 },
    ],
    notes: 'Verify City Stamina cap for your account — it refills fully each Monday.',
  },
  {
    key: 'uma',
    name: 'Umamusume: Pretty Derby',
    short: 'Uma',
    color: '#f472b6',
    icon: '🐎',
    platform: 'both',
    tz: 'Etc/UTC',
    // Global resets 11:00 EDT / 10:00 EST = fixed 15:00 UTC.
    dailyResetHour: 15,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [
      { name: 'TP', icon: 'stopwatch', cap: 100, regenMinutes: 10, reserveCap: 0, promptCap: true },
      { name: 'RP', icon: 'horseshoe', cap: 5, regenMinutes: 720, reserveCap: 0 },
    ],
    tasks: [
      { name: 'Daily Missions / Carats', cadence: 'daily' },
      { name: 'Career Runs ×3', cadence: 'daily' },
      { name: 'Team Trials ×5 RP', cadence: 'daily' },
      { name: 'Weekly Missions', cadence: 'weekly' },
      { name: 'Champions Meeting', cadence: 'monthly' },
    ],
    notes: 'TP cap grows with rank — set YOUR cap. Global reset 15:00 UTC; verify.',
  },
  {
    key: 'dokkan',
    name: 'Dokkan Battle',
    short: 'Dokkan',
    color: '#fbbf24',
    icon: '🐉',
    platform: 'mobile',
    tz: 'America/Los_Angeles',
    dailyResetHour: 17,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    resources: [{ name: 'Stamina', icon: 'orb', cap: 200, regenMinutes: 5, reserveCap: 0, promptCap: true }],
    tasks: [
      { name: 'Daily Missions', cadence: 'daily' },
      { name: '50-Stone Login/Events', cadence: 'daily' },
      { name: 'Weekly Missions', cadence: 'weekly' },
      { name: "Pan's Adventure / rank farm", cadence: 'weekly' },
    ],
    notes: 'Stamina cap grows with rank — set YOUR cap. Global reset ≈ 17:00 US Pacific; verify.',
  },
];
