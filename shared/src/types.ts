export type Cadence = 'daily' | 'weekly' | 'monthly' | 'custom';
export type ResourceKind = 'regen' | 'weekly' | 'counter';
export type TaskMode = 'check' | 'timer' | 'count';
export const CURRENT_SCHEMA_VERSION = 3;

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
  /** Card display toggles — every block on the game card can be switched off. Default: shown. */
  hideProgressRing?: boolean;
  hideEventStrip?: boolean;
  hideSleepChip?: boolean;
  /** CSS font-family for the card/hero title — each game keeps its own personality. */
  titleFont?: string;
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
  /** Minutes per reserve point once the bar is capped. Default: 2 × regenMinutes (reserve fills at half speed). */
  reserveRegenMinutes?: number;
  sort: number;
  /** Regenerating bar, weekly refill counter, or manual-only counter. */
  kind?: ResourceKind;
  /** Display label for the reserve/overflow counter on the main resource row. */
  reserveLabel?: string;
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
  /** Presentation on the game card. Defaults to checkbox. */
  mode?: TaskMode;
  /** Timer length in minutes (expeditions / assignments). */
  timerDurationMinutes?: number;
  /** Epoch ms when the active timer ends; null when idle. */
  timerEndsAt?: number | null;
  /** Required completions per period (weekly bosses). */
  countTarget?: number;
  /**
   * Custom-cadence tasks follow the game's matching Timeline window by default:
   * they reset when the window ends and hide between windows. false = use the
   * internal intervalDays cooldown (personal cooldowns like Parametric Transformer).
   */
  timelineLinked?: boolean;
  /** Keyword override for the timeline match (case-insensitive contains); empty = fuzzy name match. */
  timelineMatch?: string;
}

/** Completion state of a task within one period. id = `${taskId}|${periodKey}`. */
export interface Completion extends Syncable {
  id: string;
  taskId: string;
  periodKey: string;
  done: boolean;
  /** Progress for count-mode tasks in this period. */
  countDone?: number;
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
  /** Requires a daily touch (login/claim) — always shown on the game card's event strip while active. */
  dailyTouch: boolean;
  /** Include in "event ending soon" alerts. */
  notify: boolean;
  /** User marked it complete — collapsed on the timeline, no alerts, off the card. */
  done?: boolean;
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

export type AlertType = 'energy_cap' | 'daily_undone' | 'weekly_undone' | 'monthly_undone' | 'event_end';

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

export type IntegrationKind = 'discord' | 'telegram';

export interface IntegrationStatus {
  kind: IntegrationKind;
  connected: boolean;
  maskedLabel: string;
  updatedAt: number | null;
  consentedAt: number | null;
}

/** Accepted only during local migration; these fields must never enter synced AppState JSON. */
export interface LegacySecretSettings {
  discordWebhook?: string;
  telegramToken?: string;
  telegramChatId?: string;
}

export type SettingsField = 'quietStart' | 'quietEnd' | 'localTz' | 'sleepHours';

export interface Settings extends Syncable {
  /** Quiet hours in minutes-from-midnight local time; null = disabled. */
  quietStart: number | null;
  quietEnd: number | null;
  /** IANA timezone used to format alert messages + quiet hours. */
  localTz: string;
  /** Hours of sleep used by the "safe to sleep" check. */
  sleepHours: number;
  /** Per-field clocks prevent unrelated settings edits on two devices from overwriting each other. */
  fieldUpdatedAt?: Partial<Record<SettingsField, number>>;
}

export interface AppState {
  schemaVersion: number;
  games: Game[];
  resources: Resource[];
  snapshots: Snapshot[];
  tasks: Task[];
  completions: Completion[];
  events: GameEvent[];
  chips: QuickChip[];
  alertRules: AlertRule[];
  reminders: Reminder[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  quietStart: 60, // 01:00
  quietEnd: 480, // 08:00
  localTz: 'Europe/Warsaw',
  sleepHours: 8,
  fieldUpdatedAt: {},
  updatedAt: 0,
};

export function emptyState(): AppState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    games: [],
    resources: [],
    snapshots: [],
    tasks: [],
    completions: [],
    events: [],
    chips: [],
    alertRules: [],
    reminders: [],
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
