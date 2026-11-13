import { DateTime } from 'luxon';
import type { AlertType, AppState, Game, GameEvent } from './types';
import { buildUrgencyContext } from './urgency';
import { projectEnergy } from './energy';
import { effectiveResourceKind } from './tracking';
import { nextDailyReset, nextMonthlyReset, nextWeeklyReset } from './periods';

export interface PlannedNotification {
  id: number;
  title: string;
  body: string;
  at: number;
  gameId: string | null;
  /** What the notification is about, so a device can offer the matching action. */
  kind: 'daily' | 'weekly' | 'monthly' | 'event' | 'energy' | 'reminder';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Far enough ahead that a week without opening the app still warns before every reset. */
export const NOTIFICATION_HORIZON_DAYS = 7;
/** Android keeps at most 500 alarms per app. Nine games need about 63 for a week of dailies alone. */
export const MAX_PLANNED_NOTIFICATIONS = 128;
/** Weeklies take one hour of warning per game still owing them, never more than this. */
export const WEEKLY_LEAD_MAX_MINUTES = 600;

/**
 * Minutes of warning before each kind of deadline, unless an alert rule for the
 * game (or a global rule) says otherwise. Weekly is per game still owing them.
 */
export const DEFAULT_ALERT_MINUTES: Record<AlertType, number> = {
  daily_undone: 60,
  weekly_undone: 60,
  monthly_undone: 180,
  event_end: 180,
  energy_cap: 120,
};

/** Event kinds whose end costs the player something. Banners count only when pinned. */
const LOSABLE_EVENTS = new Set<GameEvent['type']>(['event', 'cycle', 'custom']);

function notificationId(key: string): number {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 2000000000) + 1;
}

/** "1 h", "3 h", "45 min", "2 h 30 min". */
export function formatLead(minutes: number): string {
  const rounded = Math.max(1, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * The warning a game gets for one kind of deadline, or null when the owner
 * switched that kind off. A rule for the game wins over a global rule.
 */
export function alertMinutes(state: AppState, gameId: string, type: AlertType): number | null {
  const live = state.alertRules.filter((rule) => !rule.deleted && rule.type === type);
  const rule = live.find((item) => item.gameId === gameId) ?? live.find((item) => item.gameId == null);
  if (!rule) return DEFAULT_ALERT_MINUTES[type];
  return rule.enabled ? Math.max(0, rule.thresholdMinutes) : null;
}

/** Resets of one kind from now until `until`, soonest first. */
function resetsUntil(first: number, step: (after: number) => number, until: number): number[] {
  const out: number[] = [];
  for (let at = first; at <= until && out.length < 40; at = step(at)) out.push(at);
  return out;
}

function gameTitle(game: Game): string {
  return game.accountLabel ? `${game.name} (${game.accountLabel})` : game.name;
}

/**
 * Device notifications for the next week: before each daily, weekly and
 * monthly reset that still has work, before unfinished events end, and before
 * a freshly read bar caps. Quiet hours move a notification earlier, never drop it.
 */
export function buildNotificationPlan(state: AppState, now: number): PlannedNotification[] {
  const horizon = now + NOTIFICATION_HORIZON_DAYS * 24 * HOUR;
  const zone = state.settings.localTz || 'UTC';

  /** The start of the quiet window that contains `at`, or null when `at` is outside quiet hours. */
  const quietWindowStart = (at: number): number | null => {
    const { quietStart: start, quietEnd: end } = state.settings;
    if (start == null || end == null || start === end) return null;
    const local = DateTime.fromMillis(at).setZone(zone);
    if (!local.isValid) return null;
    const minute = local.hour * 60 + local.minute;
    const inside = start < end ? minute >= start && minute < end : minute >= start || minute < end;
    if (!inside) return null;
    let opening = local.startOf('day').set({ hour: Math.floor(start / 60), minute: start % 60 });
    if (opening.toMillis() > at) opening = opening.minus({ days: 1 });
    return opening.toMillis();
  };
  /**
   * Inside quiet hours, a notification moves to the last minute before they
   * begin. If that minute has already passed, it keeps its own time: a late
   * notification can be dismissed, a missing one costs the reset.
   */
  const deliverAt = (at: number): number => {
    const opening = quietWindowStart(at);
    if (opening == null) return at;
    const moved = opening - MINUTE;
    return moved > now + 1000 ? moved : at;
  };

  const plan: PlannedNotification[] = [];
  const add = (
    key: string,
    kind: PlannedNotification['kind'],
    title: string,
    body: string,
    at: number,
    gameId: string | null,
  ) => {
    if (!Number.isFinite(at) || at > horizon) return;
    const when = deliverAt(at);
    if (when <= now + 1000) return;
    let id = notificationId(key);
    while (plan.some((item) => item.id === id)) id = (id % 2000000000) + 1;
    plan.push({ id, kind, title: title.slice(0, 100), body: body.slice(0, 200), at: when, gameId });
  };

  const active = state.games.filter((game) => !game.deleted && !game.paused);
  for (const reminder of state.reminders) {
    if (reminder.deleted || (reminder.gameId && !active.some((game) => game.id === reminder.gameId))) continue;
    add(`reminder:${reminder.id}`, 'reminder', 'Memoria reminder', reminder.message, reminder.at, reminder.gameId);
  }

  const context = buildUrgencyContext(state, now);
  // Freshness belongs to each individual meter. A recent resin reading must not
  // make an old teapot reading eligible, and initial guesses are never evidence.
  const snaps = new Map(
    [...context.snaps].filter(
      ([, snapshot]) =>
        snapshot.provenance?.kind !== 'estimate' && snapshot.takenAt >= now - 24 * HOUR && snapshot.takenAt <= now,
    ),
  );

  interface WeeklyDue {
    game: Game;
    resetAt: number;
    lead: number;
    left: number;
  }
  const weeklies: WeeklyDue[] = [];

  for (const game of active) {
    const items = context.checklistByGame.get(game.id) ?? [];
    const title = gameTitle(game);

    // Dailies. The current period counts what is still unticked; later days
    // have nothing ticked yet, so they warn unless the app is opened and the
    // plan rebuilt after ticking them off.
    const dailies = items.filter((item) => item.cadence === 'daily');
    const dailyLead = alertMinutes(state, game.id, 'daily_undone');
    if (dailies.length && dailyLead != null) {
      const left = dailies.filter((item) => !item.done).length;
      const resets = resetsUntil(
        nextDailyReset(game, now),
        (at) => nextDailyReset(game, at),
        horizon + dailyLead * MINUTE,
      );
      resets.forEach((resetAt, index) => {
        const owed = index === 0 ? left : dailies.length;
        if (!owed) return;
        const body =
          index === 0 && owed < dailies.length ? `${owed} of ${dailies.length} still to do.` : `${owed} to do.`;
        add(
          `daily:${game.id}:${resetAt}`,
          'daily',
          `${title}: dailies reset in ${formatLead(dailyLead)}`,
          body,
          resetAt - dailyLead * MINUTE,
          game.id,
        );
      });
    }

    // Weeklies are collected here and grouped across games below.
    const weeklyItems = items.filter((item) => item.cadence === 'weekly');
    const weeklyLead = alertMinutes(state, game.id, 'weekly_undone');
    if (weeklyItems.length && weeklyLead != null) {
      const left = weeklyItems.filter((item) => !item.done).length;
      const resets = resetsUntil(
        nextWeeklyReset(game, now),
        (at) => nextWeeklyReset(game, at),
        horizon + WEEKLY_LEAD_MAX_MINUTES * MINUTE,
      );
      resets.forEach((resetAt, index) => {
        const owed = index === 0 ? left : weeklyItems.length;
        if (owed) weeklies.push({ game, resetAt, lead: weeklyLead, left: owed });
      });
    }

    // Monthlies: only the current period. A month ahead is outside the plan anyway.
    const monthlyLeft = items.filter((item) => item.cadence === 'monthly' && !item.done);
    const monthlyLead = alertMinutes(state, game.id, 'monthly_undone');
    if (monthlyLeft.length && monthlyLead != null) {
      const resetAt = nextMonthlyReset(game, now);
      add(
        `monthly:${game.id}:${resetAt}`,
        'monthly',
        `${title}: monthlies reset in ${formatLead(monthlyLead)}`,
        monthlyLeft.map((item) => item.name).join(', '),
        resetAt - monthlyLead * MINUTE,
        game.id,
      );
    }

    // Events of one game that end within the same hour share one notification.
    const eventLead = alertMinutes(state, game.id, 'event_end');
    if (eventLead != null) {
      const ending = (context.eventsByGame.get(game.id) ?? [])
        .filter(
          (event) =>
            !event.deleted &&
            !event.done &&
            event.notify &&
            (LOSABLE_EVENTS.has(event.type) || (event.type === 'banner' && event.pinned)) &&
            event.end > now &&
            event.start <= event.end - eventLead * MINUTE,
        )
        .sort((a, b) => a.end - b.end || a.name.localeCompare(b.name));
      for (let start = 0; start < ending.length;) {
        const first = ending[start]!;
        let stop = start + 1;
        while (stop < ending.length && ending[stop]!.end - first.end < HOUR) stop++;
        const group = ending.slice(start, stop);
        add(
          `event:${game.id}:${first.end}`,
          'event',
          group.length === 1
            ? `${title}: event ends in ${formatLead(eventLead)}`
            : `${title}: ${group.length} events end in ${formatLead(eventLead)}`,
          group.map((event) => event.name).join(', '),
          first.end - eventLead * MINUTE,
          game.id,
        );
        start = stop;
      }
    }

    // Caps, from fresh, measured readings only.
    const capLead = alertMinutes(state, game.id, 'energy_cap');
    if (capLead != null) {
      for (const resource of context.resourcesByGame.get(game.id) ?? []) {
        if (resource.deleted || effectiveResourceKind(resource) !== 'regen') continue;
        const projection = projectEnergy(resource, snaps.get(resource.id), now, game);
        if (!projection.hasSnapshot || projection.isFull || projection.fullAt == null) continue;
        add(
          `energy:${resource.id}:${projection.fullAt}`,
          'energy',
          `${title}: ${resource.name} caps in ${formatLead(capLead)}`,
          'Estimate from your last reading.',
          projection.fullAt - capLead * MINUTE,
          game.id,
        );
      }
    }
  }

  // Weeklies: one notification per cluster of resets within the maximum lead.
  // The warning grows by each game's lead, so five games owing weeklies are
  // flagged five hours ahead and three games three hours ahead.
  weeklies.sort((a, b) => a.resetAt - b.resetAt || a.game.sort - b.game.sort);
  for (let start = 0; start < weeklies.length;) {
    const anchor = weeklies[start]!;
    let stop = start + 1;
    while (stop < weeklies.length && weeklies[stop]!.resetAt - anchor.resetAt < WEEKLY_LEAD_MAX_MINUTES * MINUTE)
      stop++;
    const group = weeklies.slice(start, stop);
    const lead = Math.min(
      WEEKLY_LEAD_MAX_MINUTES,
      group.reduce((sum, item) => sum + item.lead, 0),
    );
    const names = group.map((item) => item.game.short || item.game.name).join(', ');
    add(
      `weekly:${anchor.resetAt}`,
      'weekly',
      group.length === 1
        ? `${gameTitle(anchor.game)}: weeklies reset in ${formatLead(lead)}`
        : `Weeklies: ${group.length} games, first reset in ${formatLead(lead)}`,
      group.length === 1
        ? `${anchor.left} still to do.`
        : `${names}. ${group.reduce((sum, item) => sum + item.left, 0)} weeklies still to do.`,
      anchor.resetAt - lead * MINUTE,
      group.length === 1 ? anchor.game.id : null,
    );
    start = stop;
  }

  return plan.sort((a, b) => a.at - b.at || a.id - b.id).slice(0, MAX_PLANNED_NOTIFICATIONS);
}
