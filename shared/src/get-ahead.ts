import { DateTime } from 'luxon';
import { lastPlayDay, MORNING_MINUTES } from './play-day';
import { eventProgress } from './event-parts';
import type { CalendarEvent } from './calendar-views';
import type { GameEvent } from './types';

/**
 * Getting ahead: which unfinished events to do now, while there is time, and
 * which days are about to pile up. Days are the player's own days, and an end
 * in the small hours counts on the night before (play-day.ts).
 */

type Workable = CalendarEvent & Partial<Pick<GameEvent, 'partsDone' | 'deleted'>>;

/** At least this many unfinished endings on one day make it a pile-up. */
export const PILEUP = 3;

/** Work, not a pull decision or a broadcast: what a player can finish. */
export function isWork(event: Pick<GameEvent, 'type'>): boolean {
  return event.type === 'event' || event.type === 'cycle' || event.type === 'custom';
}

function open(event: Workable, now: number): boolean {
  return !event.deleted && isWork(event) && event.end > now;
}

export interface LoadDay {
  /** ISO date of the player's day. */
  date: string;
  /** Midnight starting it. */
  start: number;
  /** Work that ends on the day, finished or not. */
  total: number;
  /** Of those, how many are not finished. */
  left: number;
  /** Unfinished endings per game, most first. */
  games: { gameId: string; left: number }[];
}

/** The last playable day of each piece of open work, by ISO date. */
function byDay<E extends Workable>(events: readonly E[], now: number, tz: string, morning: number): Map<string, E[]> {
  const days = new Map<string, E[]>();
  for (const event of events) {
    if (!open(event, now)) continue;
    const date = lastPlayDay(event.end, now, tz, morning).toISODate()!;
    days.set(date, [...(days.get(date) ?? []), event]);
  }
  return days;
}

/** The next `days` days from today: what ends on each, and how much is left. */
export function deadlineLoad(
  events: readonly Workable[],
  now: number,
  tz: string,
  { days = 14, morning = MORNING_MINUTES, from }: { days?: number; morning?: number; from?: number } = {},
): LoadDay[] {
  const grouped = byDay(events, now, tz, morning);
  const first = DateTime.fromMillis(from ?? now, { zone: tz }).startOf('day');
  return Array.from({ length: days }, (_, index) => {
    const day = first.plus({ days: index });
    const date = day.toISODate()!;
    const ending = grouped.get(date) ?? [];
    const left = ending.filter((event) => !event.done);
    const perGame = new Map<string, number>();
    for (const event of left) perGame.set(event.gameId, (perGame.get(event.gameId) ?? 0) + 1);
    return {
      date,
      start: day.toMillis(),
      total: ending.length,
      left: left.length,
      games: [...perGame].map(([gameId, count]) => ({ gameId, left: count })).sort((a, b) => b.left - a.left),
    };
  });
}

export type AheadReason =
  | { kind: 'pinned' }
  | { kind: 'ends'; daysLeft: number }
  | { kind: 'pileup'; date: string; count: number }
  | { kind: 'started' }
  | { kind: 'reward'; amount: number };

export interface AheadPick<E> {
  event: E;
  score: number;
  /** Whole days between today and its last playable day: 0 is today. */
  daysLeft: number;
  reasons: AheadReason[];
}

/**
 * The few unfinished events most worth doing now. The score is mostly how near
 * the last day is (10 / (days left + 1)); it rises when that day is a pile-up
 * (+3 within a week, +1 later), when the event is pinned (+4) or already
 * started (+1.5), and with what it pays (up to +3). Events not yet open, banners, maintenance
 * and livestreams are never picked.
 */
export function getAheadPicks<E extends Workable>(
  events: readonly E[],
  now: number,
  tz: string,
  {
    limit = 4,
    morning = MORNING_MINUTES,
    reward,
  }: { limit?: number; morning?: number; reward?: (event: E) => number | null } = {},
): AheadPick<E>[] {
  const grouped = byDay(events, now, tz, morning);
  const today = DateTime.fromMillis(now, { zone: tz }).startOf('day');
  const picks: AheadPick<E>[] = [];
  for (const [date, ending] of grouped) {
    const left = ending.filter((event) => !event.done).length;
    const daysLeft = Math.max(0, Math.round(DateTime.fromISO(date, { zone: tz }).diff(today, 'days').days));
    for (const event of ending) {
      if (event.done || event.start > now) continue;
      const reasons: AheadReason[] = [];
      let score = 10 / (daysLeft + 1);
      if (event.pinned) {
        score += 4;
        reasons.push({ kind: 'pinned' });
      }
      reasons.push({ kind: 'ends', daysLeft });
      // A pile-up matters most in the coming week; further off it only nudges.
      if (left >= PILEUP) {
        score += daysLeft <= 7 ? 3 : 1;
        reasons.push({ kind: 'pileup', date, count: left });
      }
      if (eventProgress({ done: event.done, partsDone: event.partsDone }) === 'partial') {
        score += 1.5;
        reasons.push({ kind: 'started' });
      }
      const amount = reward?.(event) ?? null;
      if (amount != null && amount > 0) {
        score += Math.min(3, amount / 400);
        reasons.push({ kind: 'reward', amount });
      }
      picks.push({ event, score, daysLeft, reasons });
    }
  }
  return picks
    .sort((a, b) => b.score - a.score || a.event.end - b.event.end || a.event.id.localeCompare(b.event.id))
    .slice(0, limit);
}

/** Work whose last day falls between today and Sunday: how much there is and how much is done. */
export function weekProgress(
  events: readonly Workable[],
  now: number,
  tz: string,
  morning = MORNING_MINUTES,
): { done: number; total: number } {
  const today = DateTime.fromMillis(now, { zone: tz }).startOf('day');
  const sunday = today.plus({ days: 7 - today.weekday }).toISODate()!;
  const first = today.toISODate()!;
  let done = 0;
  let total = 0;
  for (const event of events) {
    if (event.deleted || !isWork(event) || event.end <= now) continue;
    const date = lastPlayDay(event.end, now, tz, morning).toISODate()!;
    if (date < first || date > sunday) continue;
    total += 1;
    if (event.done) done += 1;
  }
  return { done, total };
}
