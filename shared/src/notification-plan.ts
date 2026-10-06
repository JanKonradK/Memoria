import { DateTime } from 'luxon';
import type { AppState } from './types';
import { buildUrgencyContext, gameActions } from './urgency';

export interface PlannedNotification {
  id: number;
  title: string;
  body: string;
  at: number;
  gameId: string | null;
}
function notificationId(key: string): number {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 2000000000) + 1;
}

/** Device notifications use existing game clocks and respect the owner's quiet hours. */
export function buildNotificationPlan(state: AppState, now: number): PlannedNotification[] {
  const horizon = now + 24 * 60 * 60_000;
  const inQuietHours = (at: number) => {
    const { quietStart: start, quietEnd: end } = state.settings;
    if (start == null || end == null || start === end) return false;
    const local = DateTime.fromMillis(at).setZone(state.settings.localTz || 'UTC');
    if (!local.isValid) return true;
    const minute = local.hour * 60 + local.minute;
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
  };
  const plan: PlannedNotification[] = [];
  const add = (key: string, title: string, body: string, at: number, gameId: string | null) => {
    if (!Number.isFinite(at) || at <= now + 1000 || at > horizon || inQuietHours(at)) return;
    let id = notificationId(key);
    while (plan.some((item) => item.id === id)) id = (id % 2000000000) + 1;
    plan.push({ id, title: title.slice(0, 100), body: body.slice(0, 200), at, gameId });
  };
  const active = state.games.filter((game) => !game.deleted && !game.paused);
  for (const reminder of state.reminders) {
    if (reminder.deleted || (reminder.gameId && !active.some((game) => game.id === reminder.gameId))) continue;
    add(`reminder:${reminder.id}`, 'Memoria reminder', reminder.message, reminder.at, reminder.gameId);
  }
  const context = buildUrgencyContext(state, now);
  // Freshness belongs to each individual meter. A recent resin reading must not
  // make an old teapot reading eligible, and initial guesses are never evidence.
  context.snaps = new Map(
    [...context.snaps].filter(
      ([, snapshot]) =>
        snapshot.provenance?.kind !== 'estimate' &&
        snapshot.takenAt >= now - 24 * 60 * 60_000 &&
        snapshot.takenAt <= now,
    ),
  );
  for (const game of active) {
    // One next-action notification per game keeps a large roster quiet.
    const action = gameActions(state, game, now, context).find(
      (item) => item.at > now + 30 * 60_000 && item.at - 30 * 60_000 <= horizon && !inQuietHours(item.at - 30 * 60_000),
    );
    if (!action) continue;
    const estimated = action.kind === 'energy_soon';
    add(
      `game:${game.id}:${action.kind}:${action.at}`,
      game.name,
      `${action.label} in about 30 minutes.${estimated ? ' Estimate from your last reading.' : ''}`,
      action.at - 30 * 60_000,
      game.id,
    );
  }
  return plan.sort((a, b) => a.at - b.at).slice(0, 32);
}
