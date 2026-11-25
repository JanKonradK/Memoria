import type { GamePity } from './pity';
import type { GameSavings } from './savings';
import { detectLocalTz } from './timezone';

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'custom';
export type ResourceKind = 'regen' | 'weekly' | 'counter';
export type TaskMode = 'check' | 'timer' | 'count';
/**
 * Schema 10 requires HLC-aware peers at every write boundary. Schema 12 adds
 * quest progress, which an older peer would drop on its next write.
 */
export const CURRENT_SCHEMA_VERSION = 13;
export interface Hlc {
  wall: number;
  counter: number;
  device: string;
}
export const MAX_GAME_IMAGE_LENGTH = 200_000;
/** The largest document devices sync with each other. The PC enforces the same number (desktop/tauri/src/core.rs). */
export const MAX_SYNC_BYTES = 8_000_000;
/**
 * A game image is always an embedded picture. A web address would load from
 * someone else's server whenever the card shows, revealing the viewer's IP,
 * so backups, sync and the shared folder can only carry raster data URLs.
 */
export const GAME_IMAGE_PATTERN = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
export function isSafeGameImage(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_GAME_IMAGE_LENGTH && GAME_IMAGE_PATTERN.test(value);
}

/** updatedAt is for display; hlc orders changes, including clock rollback. */
export interface Syncable {
  hlc?: Hlc;
  deviceId?: string;
  updatedAt: number;
  /** Soft delete — kept as tombstone so deletions sync across devices. */
  deleted?: boolean;
}

/** Stable resource/task references, plus the card's shared controls. */
export interface GameLayoutItem {
  id: string;
  hidden?: boolean;
}

export interface Game extends Syncable {
  id: string;
  name: string;
  /** Preset this game came from; survives any rename. */
  presetKey?: string;
  /** User's label for this account, e.g. "Main EU". */
  accountLabel?: string;
  /** Short name for chips and compact UI, e.g. "HSR". */
  short: string;
  /** Accent color (hex). */
  color: string;
  /** Secondary accent (hex) — the title ink and the lead tube tone. */
  color2?: string;
  /**
   * Third accent (hex) — small highlights, and the first candidate for the
   * card's saturated 1px rim. Optional because a game the user typed in by hand
   * only has to supply one colour; the rim then falls back down the trio.
   */
  color3?: string;
  /** Emoji used as the game icon (fallback when no image is set). */
  icon: string;
  /** Optional character/cover art, always an embedded picture (see GAME_IMAGE_PATTERN). */
  image?: string;
  platform: 'pc' | 'mobile' | 'both';
  /** Which of its game's servers this account is on (see GAME_SERVERS); unset for a custom timezone. */
  server?: string;
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
  /** CSS font-family for the game's name, matching its logo — each game keeps its own personality. */
  titleFont?: string;
  /** Absent uses the grouped default card. Stored with the game for backup/sync. */
  cardLayout?: GameLayoutItem[];
  /** Savings planner balance and goals for this account. */
  savings?: GameSavings;
  /** Pity tracker: pulls since the last 5★ per banner type, and past 5★s. */
  pity?: GamePity;
  /** Redemption codes saved for this account. */
  codes?: GameCode[];
}

/** A redemption code the player saved for one game. */
export interface GameCode {
  id: string;
  code: string;
  /** What the code pays, e.g. "60 Primogems, 5 Hero's Wit". */
  rewards?: string;
  /** Absolute deadline (epoch ms); absent when the source did not say. */
  expiresAt?: number;
  /** Where to redeem it; always https. */
  redeemUrl?: string;
  redeemed?: boolean;
  addedAt: number;
}

export interface Resource extends Syncable {
  id: string;
  gameId: string;
  name: string;
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
export interface ObservationProvenance {
  kind: 'manual' | 'account' | 'screenshot' | 'estimate';
  /** A short adapter name, never a login secret or account cookie. */
  provider?: string;
  observedAt: number;
  importedAt: number;
  batchId?: string;
}

export interface Snapshot extends Partial<Syncable> {
  id: string;
  resourceId: string;
  value: number;
  takenAt: number;
  /** Overflow reserve level at the same moment (HSR Reserve TB Power), if known. */
  reserve?: number;
  provenance?: ObservationProvenance;
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
  /** Minutes removed from a running timer on each click. */
  timerStepMinutes?: number;
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
  /**
   * The preset row this task was created from, as a slug that never changes.
   *
   * Names do change — a preset gets sharpened, a mode is renamed by its
   * publisher, a user edits the row to suit themselves. `missingPresetTasks`
   * used to compare names alone, so any of those turned one routine into two:
   * the preset no longer recognised the task the user already had, offered it
   * as missing, and "Add them" duplicated it. The key survives all three.
   */
  presetTaskKey?: string;
  /**
   * The handful of tasks that actually pay the game's premium pull currency
   * (Primogems, Stellar Jade, Polychrome, Astrite…). These sort above everything
   * else on the card and are the ones the completion ring counts, because
   * missing one costs real pulls while missing a side chore costs nothing.
   */
  core?: boolean;
}

/** Completion state of a task within one period. id = `${taskId}|${periodKey}`. */
export interface Completion extends Syncable {
  id: string;
  taskId: string;
  periodKey: string;
  done: boolean;
  /** Progress for count-mode tasks in this period. */
  countDone?: number;
  provenance?: ObservationProvenance;
}

/**
 * 'cycle' = recurring endgame windows (Abyss/Theater, MoC/PF/AS/AA, Shiyu/DA…).
 * 'livestream' = the patch preview broadcast (HoYo "Special Program", Kuro
 * version livestream, and the equivalents) that reveals the next version. It is
 * the cue to refresh the bundled feed, so a predicted one is stored as the
 * plausible date RANGE rather than as a single guessed moment.
 */
export type EventType = 'banner' | 'event' | 'cycle' | 'maintenance' | 'livestream' | 'custom';
export type BannerKind = 'character' | 'weapon' | 'support' | 'memory' | 'other';

export interface GameEvent extends Syncable {
  id: string;
  gameId: string;
  name: string;
  type: EventType;
  category?: 'teyvat' | 'miliastra';
  /** What the banner awards; absent for unclassified or cosmetic banners. */
  bannerKind?: BannerKind;
  /** Retired manual timeline position. The timeline packs rows itself; kept so older backups still load. */
  sort?: number;
  start: number;
  end: number;
  /** Requires a daily touch (login/claim) — always shown on the game card's event strip while active. */
  dailyTouch: boolean;
  /** Premium currency the event pays in total (Primogems, Stellar Jade, …), when the notice states it. */
  reward?: number;
  /** Include the event in time-sensitive in-app next actions. */
  notify: boolean;
  /** User marked it complete — collapsed on the timeline and off the card. */
  done?: boolean;
  /** Marked as one you mean to do: highlighted and listed first. */
  pinned?: boolean;
  /** How many parts the event is ticked off in. Absent means the count is inferred — see eventParts. */
  parts?: number;
  /** How many parts are ticked, in order from the first. Absent is none. */
  partsDone?: number;
  notes: string;
  /** Stable id of the imported source (e.g. "genshin:21788") — used to dedupe re-imports. */
  sourceKey?: string;
  /**
   * Fingerprint of the values the bundled feed last wrote here, so a refresh can
   * tell ITS OWN drift from YOUR edits. Present only on rows the feed wrote.
   *
   * If the event still hashes to this, nobody has touched it and the feed may
   * correct it. If it does not, you changed something and the feed leaves the
   * whole row alone from then on — a corrected date is worth less than a note
   * you wrote. Absent on hand-made events and on ⤓ HoYoLAB imports, neither of
   * which the feed owns.
   */
  seedHash?: string;
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
  /** The first time it fires. */
  at: number;
  /** Repeats every this many days from `at`. Absent = once. */
  repeatDays?: number;
  /** How it reaches the player. Absent = the style chosen for reminders in Settings. */
  style?: NotificationStyle;
}

export const MAX_REMINDER_REPEAT_DAYS = 365;

/** What a notification is about. Each kind has its own style in Settings. */
export type NotificationKind = 'daily' | 'weekly' | 'monthly' | 'event' | 'energy' | 'reminder' | 'digest';
export const NOTIFICATION_KINDS: NotificationKind[] = [
  'daily',
  'weekly',
  'monthly',
  'event',
  'energy',
  'reminder',
  'digest',
];
/**
 * How loudly a notification arrives. Silent: in the notification list only.
 * Gentle: a soft sound, no pop-up. Standard: pops up with a sound. Alarm: rings
 * until it is dismissed or snoozed.
 */
export type NotificationStyle = 'silent' | 'gentle' | 'standard' | 'alarm';
export const NOTIFICATION_STYLES: NotificationStyle[] = ['silent', 'gentle', 'standard', 'alarm'];
/** The ring of alarm-style notifications. */
export type AlarmTone = 'classic' | 'pulse' | 'chime' | 'ring';
export const ALARM_TONES: AlarmTone[] = ['classic', 'pulse', 'chime', 'ring'];
export const DEFAULT_NOTIFICATION_STYLES: Record<NotificationKind, NotificationStyle> = {
  daily: 'standard',
  weekly: 'standard',
  monthly: 'standard',
  event: 'standard',
  energy: 'gentle',
  reminder: 'standard',
  digest: 'gentle',
};

/** Where a player stands on a quest or one part of it. */
export type QuestState = 'done' | 'partial' | 'skipped';
export const QUEST_STATES: QuestState[] = ['done', 'partial', 'skipped'];

/**
 * Progress on one quest, or one part of it, from the bundled catalog or a quest
 * the player added. One row per mark, so ticks made on two devices merge
 * cleanly; clearing a mark tombstones its row.
 */
export interface QuestMark extends Syncable {
  /** `${gameId}|${questId}` for the quest itself, `${gameId}|${questId}|${partId}` for a part. */
  id: string;
  gameId: string;
  questId: string;
  partId?: string;
  state: QuestState;
}

export type QuestKind = 'main' | 'story' | 'world' | 'side' | 'event';
export const QUEST_KINDS: QuestKind[] = ['main', 'story', 'world', 'side', 'event'];

/** A quest line the player added: for a game without a catalog, or one the catalog lacks. */
export interface CustomQuest extends Syncable {
  id: string;
  gameId: string;
  title: string;
  kind: QuestKind;
  series?: string;
  characters?: string[];
  parts?: { id: string; title: string }[];
  notes?: string;
}

/** A note's tint. `game` takes the colour of the game it belongs to. */
export type NoteColor = 'game' | 'red' | 'amber' | 'green' | 'blue' | 'violet' | 'pink';
export const NOTE_COLORS: readonly NoteColor[] = ['game', 'red', 'amber', 'green', 'blue', 'violet', 'pink'];

/**
 * One of the player's notes. A note belongs to a game, or to none. Its body is
 * plain text; a line written "- [ ] x" or "- [x] x" is a checklist item.
 */
export interface Note extends Syncable {
  id: string;
  /** The game it is about; null for a note of its own. */
  gameId: string | null;
  title: string;
  body: string;
  color?: NoteColor;
  pinned?: boolean;
  /** The player's own order: higher first. New notes take the highest. */
  sort: number;
}

export type SettingsField =
  | 'quietStart'
  | 'quietEnd'
  | 'quietHoursChosen'
  | 'localTz'
  | 'sleepHours'
  | 'digestAt'
  | 'notificationStyles'
  | 'alarmTone'
  | 'alarmFreeWindows';
/** Settings merged one field at a time, so edits on two devices do not overwrite each other. */
export const SETTINGS_FIELDS: SettingsField[] = [
  'quietStart',
  'quietEnd',
  'quietHoursChosen',
  'localTz',
  'sleepHours',
  'digestAt',
  'notificationStyles',
  'alarmTone',
  'alarmFreeWindows',
];

/**
 * A stretch of the week when no alarm rings, such as work or sleep. An alarm
 * that falls inside one still arrives, as a silent notification.
 */
export interface AlarmFreeWindow {
  id: string;
  /** What it is for, e.g. "Work". */
  label: string;
  /** Minutes from midnight, home time. An end before the start runs past midnight. */
  start: number;
  end: number;
  /** ISO weekdays (1 = Monday) the window starts on. */
  days: number[];
}
export const MAX_ALARM_FREE_WINDOWS = 12;

export interface Settings extends Syncable {
  /**
   * Quiet hours in minutes-from-midnight home time; null = none (the default).
   * Notifications that fall inside them move to just before they begin.
   */
  quietStart: number | null;
  quietEnd: number | null;
  /**
   * The owner picked the quiet hours above. Before 4.1 every document carried a
   * hidden 01:00–08:00 default nobody could see or change; without this mark
   * that pair reads as "no quiet hours".
   */
  quietHoursChosen?: boolean;
  /** IANA home timezone, used for quiet hours and notification timing. */
  localTz: string;
  /** Kept for older devices; quiet hours replaced it. */
  sleepHours: number;
  /**
   * An optional evening digest, in minutes-from-midnight home time: one
   * notification listing what is still open across games. Absent or null = off.
   */
  digestAt?: number | null;
  /** Style per kind of notification; a kind left out uses DEFAULT_NOTIFICATION_STYLES. */
  notificationStyles?: Partial<Record<NotificationKind, NotificationStyle>>;
  /** The ring of alarm-style notifications. Absent = classic. */
  alarmTone?: AlarmTone;
  /** Times when no alarm rings; alarms inside them arrive silently. Absent = none. */
  alarmFreeWindows?: AlarmFreeWindow[];
  /**
   * The `SEED_UPDATED` stamp of the bundled event feed this device has already
   * taken a refresh from, as `YYYY-MM-DD`.
   *
   * The feed import runs on every load, so without this the refresh pass would
   * re-apply the bundled name and dates to an already-imported event forever —
   * silently reverting any edit the user made to one. Absent means "never
   * refreshed", which is the correct state for a device that has only ever added.
   */
  seedImportedVersion?: string;
  /** Latest reviewed public calendar; protects its corrections from older bundles. */
  remoteFeedVersion?: { generatedAt: string; seedUpdated: string; revision: string; receivedAt: number };
  /**
   * The catch-up digests the player has read, per game preset key, as
   * `digestId@revision`. Keyed by preset so two accounts of one game share it.
   * A set that only grows, so devices merge it by union with no clocks; new
   * research on a version gets a new revision and reads as unread again.
   */
  catchUpSeen?: Record<string, string[]>;
  /** Per-field clocks prevent unrelated settings edits on two devices from overwriting each other. */
  fieldUpdatedAt?: Partial<Record<SettingsField, number>>;
  fieldHlc?: Partial<Record<SettingsField, Hlc>>;
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
  questMarks: QuestMark[];
  customQuests: CustomQuest[];
  notes: Note[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  hlc: { wall: 0, counter: 0, device: 'Unknown device' },
  deviceId: 'Unknown device',
  quietStart: null,
  quietEnd: null,
  localTz: 'UTC',
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
    questMarks: [],
    customQuests: [],
    notes: [],
    settings: {
      ...DEFAULT_SETTINGS,
      localTz: detectLocalTz(),
      fieldUpdatedAt: { ...DEFAULT_SETTINGS.fieldUpdatedAt },
    },
  };
}
