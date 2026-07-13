export type Cadence = 'daily' | 'weekly' | 'monthly' | 'custom';

/** Everything syncable carries updatedAt (epoch ms) for last-write-wins merge. */
export interface Syncable {
  updatedAt: number;
  /** Soft delete — kept as tombstone so deletions sync across devices. */
  deleted?: boolean;
}

export interface Game extends Syncable {
  id: string;
  name: string;
  /** Short label for chips/notifications, e.g. "HSR". */
  short: string;
  /** Accent color (hex). */
  color: string;
  /** Secondary accent (hex) — gradients run color → color2 ("pink with hints of blue"). */
  color2?: string;
  /** Emoji used as the game icon (fallback when no image is set). */
  icon: string;
  /** Optional character/cover art (data URL or remote URL). Shown on the card. */
  image?: string;
  platform: 'pc' | 'mobile' | 'both';
  /** IANA timezone of the game server, e.g. "Etc/GMT-1" (fixed UTC+1). */
  tz: string;
  /** Hour of day (0-23, server time) when dailies reset. */
  dailyResetHour: number;
  /** ISO weekday (1 = Monday … 7 = Sunday) when weeklies reset. */
  weeklyResetDay: number;
  /** Day of month (1-28) when monthlies reset. */
  monthlyResetDay: number;
  paused: boolean;
  sort: number;
  /** Free-form note, e.g. "verify reset time for your server". */
  notes?: string;
  /** Executable names (no .exe, case-insensitive) the TUI matches against running processes. */
  processNames?: string[];
}

export interface Resource extends Syncable {
  id: string;
  gameId: string;
  name: string;
  /** Key into the built-in resource icon set (e.g. "crystal", "comet"). */
  icon?: string;
  cap: number;
  /** Minutes to regenerate 1 point. 0 = does not regenerate over time. */
  regenMinutes: number;
  /** Overflow reserve capacity (e.g. HSR Reserve Trailblaze Power). 0 = none. */
  reserveCap: number;
  sort: number;
}

/** A reading (manual or auto-imported): "this resource had `value` points at `takenAt`". */
export interface Snapshot {
  id: string;
  resourceId: string;
  value: number;
  takenAt: number;
  /** Overflow reserve level at the same moment (HSR Reserve TB Power), if known. */
  reserve?: number;
}

export interface Task extends Syncable {
  id: string;
  gameId: string;
  name: string;
  cadence: Cadence;
  /** For cadence "custom": period length in days. */
  intervalDays: number;
  /** For cadence "custom": epoch ms anchoring period boundaries. */
  anchorAt: number;
  sort: number;
}

/** Completion state of a task within one period. id = `${taskId}|${periodKey}`. */
export interface Completion extends Syncable {
  id: string;
  taskId: string;
  periodKey: string;
  done: boolean;
}

/** 'cycle' = recurring endgame windows (Abyss/Theater, MoC/PF/AS/AA, Shiyu/DA…). */
export type EventType = 'banner' | 'event' | 'cycle' | 'maintenance' | 'custom';

export interface GameEvent extends Syncable {
  id: string;
  gameId: string;
  name: string;
  type: EventType;
  start: number;
  end: number;
  /** Requires a daily touch (login/claim) — shows up in the daily checklist. */
  dailyTouch: boolean;
  /** Include in "event ending soon" alerts. */
  notify: boolean;
  notes: string;
  /** Stable id of the imported source (e.g. "genshin:21788") — used to dedupe re-imports. */
  sourceKey?: string;
}

/** One-tap spend button on a game card, e.g. { label: "Domain", delta: -20 }. */
export interface QuickChip extends Syncable {
  id: string;
  gameId: string;
  label: string;
  delta: number;
  sort: number;
}

export type AlertType =
  | 'energy_cap'
  | 'daily_undone'
  | 'weekly_undone'
  | 'monthly_undone'
  | 'event_end';

export interface AlertRule extends Syncable {
  id: string;
  /** null = global default override; otherwise per-game. */
  gameId: string | null;
  type: AlertType;
  /** Fire when the deadline is within this many minutes. */
  thresholdMinutes: number;
  enabled: boolean;
}

/** One-off custom reminder ("spend resin before maintenance Tue 06:00"). */
export interface Reminder extends Syncable {
  id: string;
  gameId: string | null;
  message: string;
  at: number;
}

/** HoYoLAB-supported games. */
export type HoyoKind = 'genshin' | 'hsr' | 'zzz';

/** Binds one TechnoGG game to a HoYoLAB game account for auto-import. */
export interface HoyoLink {
  gameId: string;
  kind: HoyoKind;
  uid: string;
  /** HoYo region code, e.g. "os_euro" / "prod_official_eu" / "prod_gf_eu". */
  region: string;
}

export interface NoteStat {
  label: string;
  value: string;
  /** Highlight (something is ready/claimable/about to overflow). */
  urgent?: boolean;
}

/** Normalized HoYoLAB daily note — the "yet to do in game" summary. */
export interface NoteSummary {
  primary: { value: number; cap: number; recoverSeconds: number | null };
  reserve: { value: number; cap: number } | null;
  daily: { done: number; total: number; claimed: boolean } | null;
  stats: NoteStat[];
}

/** Latest imported note per game. id = gameId (one row per game, LWW-merged). */
export interface GameStatus extends Syncable {
  id: string;
  gameId: string;
  fetchedAt: number;
  summary: NoteSummary;
}

/** One "what to build/farm next" goal for a game. */
export interface FocusItem extends Syncable {
  id: string;
  gameId: string;
  name: string;
  note: string;
  done: boolean;
  sort: number;
}

/** Recurring paid perk (Welkin, Battle Pass) tracked by expiry date. */
export interface Purchase extends Syncable {
  id: string;
  gameId: string;
  name: string;
  /** Renewal cycle in days (30 = monthly card, ~42 = per patch). */
  cycleDays: number;
  expiresAt: number;
  /** Ping via the alert engine when about to expire. */
  notify: boolean;
}

/** Premium-currency wallet + income model, one per game (id = gameId). */
export interface Wallet extends Syncable {
  id: string;
  gameId: string;
  /** Balance as entered at `balanceAt`. */
  balance: number;
  balanceAt: number;
  /** Average earned per day (include Welkin/BP drip if bought). */
  dailyIncome: number;
  /** Premium cost of one pull (160 for HoYo games). */
  pullCost: number;
  /** Start of the next version/patch; rolls forward by patchDays. */
  nextPatchAt: number | null;
  patchDays: number;
}

export interface TeamMember {
  name: string;
  /** Flagged as underbuilt — surfaces on the game card. */
  needsWork: boolean;
}

/** A saved team comp (e.g. one of your three ZZZ squads). */
export interface Team extends Syncable {
  id: string;
  gameId: string;
  name: string;
  members: TeamMember[];
  sort: number;
}

export interface Settings extends Syncable {
  discordWebhook: string;
  telegramToken: string;
  telegramChatId: string;
  /** Quiet hours in minutes-from-midnight local time; null = disabled. */
  quietStart: number | null;
  quietEnd: number | null;
  /** IANA timezone used to format alert messages + quiet hours. */
  localTz: string;
  /** Raw hoyolab.com cookie header for auto-import ("" = disabled). */
  hoyolabCookie: string;
  hoyolabLinks: HoyoLink[];
  /** Hours of sleep used by the "safe to sleep" check. */
  sleepHours: number;
}

export interface AppState {
  games: Game[];
  resources: Resource[];
  snapshots: Snapshot[];
  tasks: Task[];
  completions: Completion[];
  events: GameEvent[];
  chips: QuickChip[];
  alertRules: AlertRule[];
  reminders: Reminder[];
  focus: FocusItem[];
  teams: Team[];
  purchases: Purchase[];
  wallets: Wallet[];
  statuses: GameStatus[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  discordWebhook: '',
  telegramToken: '',
  telegramChatId: '',
  quietStart: 60, // 01:00
  quietEnd: 480, // 08:00
  localTz: 'Europe/Warsaw',
  hoyolabCookie: '',
  hoyolabLinks: [],
  sleepHours: 8,
  updatedAt: 0,
};

export function emptyState(): AppState {
  return {
    games: [],
    resources: [],
    snapshots: [],
    tasks: [],
    completions: [],
    events: [],
    chips: [],
    alertRules: [],
    reminders: [],
    focus: [],
    teams: [],
    purchases: [],
    wallets: [],
    statuses: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Default alert thresholds (minutes) when no AlertRule overrides them. */
export const DEFAULT_THRESHOLDS: Record<AlertType, number> = {
  energy_cap: 120,
  daily_undone: 180,
  weekly_undone: 24 * 60,
  monthly_undone: 48 * 60,
  event_end: 24 * 60,
};
