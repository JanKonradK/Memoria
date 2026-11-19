import { DateTime } from 'luxon';
import type { GameEvent } from './types';

/**
 * The Calendar's agenda, month and ending-soon views share one vocabulary: a
 * moment is something that happens to an event at one instant (it starts, it
 * ends, a livestream goes live, a server goes down), and several moments of one
 * game at one instant fold into a single row. Days are the player's own days,
 * in their home time zone, never the game server's.
 */

/** The fields these views read; callers get their own event type back. */
export type CalendarEvent = Pick<GameEvent, 'id' | 'gameId' | 'name' | 'type' | 'start' | 'end'> &
  Partial<Pick<GameEvent, 'done' | 'pinned'>>;

export type MomentKind = 'down' | 'ends' | 'starts' | 'live';

export interface CalendarMoment<E extends CalendarEvent = GameEvent> {
  /** Stable across renders: the kind, the instant and the lead event. */
  key: string;
  kind: MomentKind;
  at: number;
  gameId: string;
  /** The lead first, then the events folded under it. Never empty. */
  events: E[];
}

/** Fewer than this many same-game, same-instant moments stay as separate rows. */
export const FOLD_MIN = 3;

const KIND_ORDER: Record<MomentKind, number> = { down: 0, ends: 1, starts: 2, live: 3 };

function finished(event: CalendarEvent, now: number): boolean {
  return Boolean(event.done) || event.end <= now;
}

/**
 * A banner is a pull decision and a pinned event is one the player means to do,
 * so neither disappears into someone else's fold. Livestreams and maintenance
 * are one-offs and never repeat at one instant.
 */
function foldable(event: CalendarEvent): boolean {
  return !event.pinned && (event.type === 'event' || event.type === 'cycle' || event.type === 'custom');
}

/** Lead order inside a fold and row order between equal instants. */
function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  return (
    Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
    a.start - b.start ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}

function compareMoments<E extends CalendarEvent>(a: CalendarMoment<E>, b: CalendarMoment<E>): number {
  return a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || compareEvents(a.events[0]!, b.events[0]!);
}

/**
 * Folds same-game moments of one kind at one instant into one row, once there
 * are at least `min` of them. Everything else keeps a row of its own. The
 * result is in time order and holds its order between renders.
 */
export function foldMoments<E extends CalendarEvent>(
  items: readonly { event: E; kind: MomentKind; at: number }[],
  min = FOLD_MIN,
): CalendarMoment<E>[] {
  const groups = new Map<string, E[]>();
  const single: CalendarMoment<E>[] = [];
  for (const { event, kind, at } of items) {
    if (!foldable(event) || (kind !== 'ends' && kind !== 'starts')) {
      single.push({ key: `${kind}:${at}:${event.id}`, kind, at, gameId: event.gameId, events: [event] });
      continue;
    }
    const key = `${kind}:${at}:${event.gameId}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const folded: CalendarMoment<E>[] = [];
  for (const [key, events] of groups) {
    const [kind, at] = key.split(':') as [MomentKind, string];
    events.sort(compareEvents);
    if (events.length >= min)
      folded.push({ key: `${kind}:${at}:${events[0]!.id}`, kind, at: Number(at), gameId: events[0]!.gameId, events });
    else
      for (const event of events)
        folded.push({ key: `${kind}:${at}:${event.id}`, kind, at: Number(at), gameId: event.gameId, events: [event] });
  }
  return [...single, ...folded].sort(compareMoments);
}

/** Midnight of the player's day that holds `at`. */
export function dayStart(at: number, tz: string): number {
  return DateTime.fromMillis(at, { zone: tz }).startOf('day').toMillis();
}

/** The ISO date of the player's day that holds `at`. */
export function dayKey(at: number, tz: string): string {
  return DateTime.fromMillis(at, { zone: tz }).toISODate()!;
}

/** Midnight `days` days after the midnight `start`, across clock changes. */
function addDays(start: number, days: number, tz: string): number {
  return DateTime.fromMillis(start, { zone: tz }).plus({ days }).startOf('day').toMillis();
}

/** How far through its window an event is, from 0 before it starts to 1 at its end. */
export function elapsedShare(event: Pick<CalendarEvent, 'start' | 'end'>, now: number): number {
  const span = event.end - event.start;
  if (span <= 0) return now >= event.end ? 1 : 0;
  return Math.min(1, Math.max(0, (now - event.start) / span));
}

export interface AgendaDay<E extends CalendarEvent = GameEvent> {
  /** ISO date in the player's zone. */
  date: string;
  start: number;
  moments: CalendarMoment<E>[];
}

export interface Agenda<E extends CalendarEvent = GameEvent> {
  days: AgendaDay<E>[];
  /** Events over before today, latest first; empty unless finished events are shown. */
  finished: E[];
  /** Finished events left out because finished events are hidden. */
  hiddenFinished: number;
}

/**
 * The agenda: from the start of today, what happens on each day. A running
 * event shows where it ends; one still to come shows where it starts too. A
 * livestream shows where it goes live and maintenance where the server goes
 * down. Finished events (ticked or over) appear only when asked for: today's
 * and future ones in place, older ones in their own list.
 */
export function agendaDays<E extends CalendarEvent>(
  events: readonly E[],
  now: number,
  tz: string,
  { showFinished = false }: { showFinished?: boolean } = {},
): Agenda<E> {
  const today = dayStart(now, tz);
  const items: { event: E; kind: MomentKind; at: number }[] = [];
  const older: E[] = [];
  let hiddenFinished = 0;
  for (const event of events) {
    const over = finished(event, now);
    if (over && !showFinished) {
      hiddenFinished++;
      continue;
    }
    if (event.end <= today && event.type !== 'livestream' && event.type !== 'maintenance') {
      older.push(event);
      continue;
    }
    if (event.type === 'livestream' || event.type === 'maintenance') {
      if (event.start >= today || event.end > now)
        items.push({ event, kind: event.type === 'livestream' ? 'live' : 'down', at: Math.max(event.start, today) });
      else older.push(event);
      continue;
    }
    if (event.start >= today) items.push({ event, kind: 'starts', at: event.start });
    items.push({ event, kind: 'ends', at: event.end });
  }

  const days: AgendaDay<E>[] = [];
  for (const moment of foldMoments(items)) {
    const date = dayKey(moment.at, tz);
    const last = days.at(-1);
    if (last?.date === date) last.moments.push(moment);
    else days.push({ date, start: dayStart(moment.at, tz), moments: [moment] });
  }
  older.sort((a, b) => b.end - a.end || compareEvents(a, b));
  return { days, finished: older, hiddenFinished };
}

export type SoonBucket = 'today' | 'week' | 'next' | 'later';
export const SOON_BUCKETS: readonly SoonBucket[] = ['today', 'week', 'next', 'later'];

export interface SoonColumn<E extends CalendarEvent = GameEvent> {
  bucket: SoonBucket;
  /** The first instant the column covers, and the first it does not (Infinity for Later). */
  from: number;
  until: number;
  /** Events in the column, folds counted by what they hold. */
  count: number;
  moments: CalendarMoment<E>[];
}

/**
 * Unfinished events by when they end, in the player's weeks (Monday first):
 * today, the rest of this week to Sunday, next week, and later. Ticked events
 * stay in place, marked, unless `hideDone`. An event that has ended is gone.
 */
export function soonColumns<E extends CalendarEvent>(
  events: readonly E[],
  now: number,
  tz: string,
  { hideDone = false }: { hideDone?: boolean } = {},
): SoonColumn<E>[] {
  const today = DateTime.fromMillis(now, { zone: tz }).startOf('day');
  const tomorrow = addDays(today.toMillis(), 1, tz);
  const nextMonday = addDays(today.toMillis(), 8 - today.weekday, tz);
  const weekAfter = addDays(nextMonday, 7, tz);
  const bounds: Record<SoonBucket, [number, number]> = {
    today: [now, tomorrow],
    week: [tomorrow, nextMonday],
    next: [nextMonday, weekAfter],
    later: [weekAfter, Infinity],
  };
  return SOON_BUCKETS.map((bucket) => {
    const [from, until] = bounds[bucket];
    const inside = events.filter(
      (event) =>
        event.type !== 'livestream' &&
        event.type !== 'maintenance' &&
        event.end > now &&
        event.end >= from &&
        event.end < until &&
        !(hideDone && event.done),
    );
    return {
      bucket,
      from: bucket === 'today' ? today.toMillis() : from,
      until,
      count: inside.length,
      moments: foldMoments(inside.map((event) => ({ event, kind: 'ends' as const, at: event.end }))),
    };
  });
}

export interface MonthDay {
  date: string;
  start: number;
  /** The day of the month. */
  day: number;
  inMonth: boolean;
  weekend: boolean;
}

export interface MonthWeek {
  start: number;
  /** Midnight after its Sunday. */
  end: number;
  days: MonthDay[];
}

/** The Monday-first weeks that cover a month (1-12) in the player's zone. */
export function monthWeeks(year: number, month: number, tz: string): MonthWeek[] {
  const first = DateTime.fromObject({ year, month, day: 1 }, { zone: tz });
  const last = first.endOf('month');
  let cursor = first.minus({ days: first.weekday - 1 }).startOf('day');
  const weeks: MonthWeek[] = [];
  while (cursor <= last) {
    const days: MonthDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = cursor.plus({ days: i }).startOf('day');
      days.push({
        date: day.toISODate()!,
        start: day.toMillis(),
        day: day.day,
        inMonth: day.month === month,
        weekend: day.weekday >= 6,
      });
    }
    const end = cursor.plus({ days: 7 }).startOf('day');
    weeks.push({ start: cursor.toMillis(), end: end.toMillis(), days });
    cursor = end;
  }
  return weeks;
}

export interface WeekBar<E extends CalendarEvent = GameEvent> {
  /** The lead event and any folded under it. */
  events: E[];
  /** The first column (0 Monday) and the column after the last. */
  from: number;
  to: number;
  lane: number;
  /** The event runs on before this week or after it. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

export interface PackedWeek<E extends CalendarEvent = GameEvent> {
  bars: WeekBar<E>[];
  /** Per day, how many events had no lane left. */
  hidden: number[];
  /** Per day, the maintenance and livestreams that start on it. */
  marks: E[][];
  /** Per day, the games with an event on it, in lane order: the phone grid's dots. */
  games: string[][];
}

/** The column of the day holding `at`, given the eight midnights that bound a week. */
function columnOf(at: number, edges: readonly number[]): number {
  let column = 0;
  while (column < 6 && at >= edges[column + 1]!) column++;
  return column;
}

/**
 * Packs a week's events into `lanes` rows of bars. Events that start or end
 * in the week claim lanes before those running straight through it, earlier
 * and longer first; what does not fit is counted per day as "+N more". Same-game events with one window fold into one bar. Maintenance and
 * livestreams are marks on their day, not bars.
 */
export function packWeek<E extends CalendarEvent>(
  events: readonly E[],
  week: Pick<MonthWeek, 'days' | 'end'>,
  lanes = 3,
): PackedWeek<E> {
  const edges = [...week.days.map((day) => day.start), week.end];
  const ws = edges[0]!;
  const we = week.end;
  const marks: E[][] = Array.from({ length: 7 }, () => []);
  const windows = new Map<string, E[]>();
  for (const event of events) {
    if (event.type === 'livestream' || event.type === 'maintenance') {
      if (event.start >= ws && event.start < we) marks[columnOf(event.start, edges)]!.push(event);
      continue;
    }
    if (event.end <= ws || event.start >= we) continue;
    const key = foldable(event) ? `${event.gameId}:${event.start}:${event.end}` : `id:${event.id}`;
    windows.set(key, [...(windows.get(key) ?? []), event]);
  }
  const groups: E[][] = [];
  for (const group of windows.values()) {
    group.sort(compareEvents);
    if (group.length >= FOLD_MIN || group.length === 1) groups.push(group);
    else for (const event of group) groups.push([event]);
  }
  const spans = groups.map((group) => {
    const lead = group[0]!;
    const from = columnOf(Math.max(lead.start, ws), edges);
    const to = columnOf(Math.min(lead.end, we) - 1, edges) + 1;
    // A bar that starts or ends this week says something about it; one that
    // runs straight through says the same thing every week, so it waits.
    const through = lead.start < ws && lead.end > we;
    return { group, lead, from, to: Math.max(to, from + 1), through };
  });
  spans.sort(
    (a, b) =>
      Number(a.through) - Number(b.through) ||
      a.from - b.from ||
      b.to - b.from - (a.to - a.from) ||
      compareEvents(a.lead, b.lead),
  );

  const taken: boolean[][] = Array.from({ length: lanes }, () => [false, false, false, false, false, false, false]);
  const bars: WeekBar<E>[] = [];
  const hidden = [0, 0, 0, 0, 0, 0, 0];
  const games: string[][] = Array.from({ length: 7 }, () => []);
  for (const { group, lead, from, to } of spans) {
    for (let day = from; day < to; day++) if (!games[day]!.includes(lead.gameId)) games[day]!.push(lead.gameId);
    const lane = taken.findIndex((row) => row.slice(from, to).every((used) => !used));
    if (lane < 0) {
      for (let day = from; day < to; day++) hidden[day]! += group.length;
      continue;
    }
    for (let day = from; day < to; day++) taken[lane]![day] = true;
    bars.push({ events: group, from, to, lane, clippedStart: lead.start < ws, clippedEnd: lead.end > we });
  }
  bars.sort((a, b) => a.lane - b.lane || a.from - b.from);
  for (const list of marks) list.sort(compareEvents);
  return { bars, hidden, marks, games };
}

export interface DayDigest<E extends CalendarEvent = GameEvent> {
  /** Events whose window overlaps the day. */
  running: number;
  /** What ends during the day, folded. */
  ends: CalendarMoment<E>[];
  /** Maintenance and livestreams that start during the day. */
  marks: E[];
  /** What starts during the following day, folded. */
  startsNext: CalendarMoment<E>[];
}

/** The month view's panel for one chosen day, starting at midnight `start`. */
export function dayDigest<E extends CalendarEvent>(events: readonly E[], start: number, tz: string): DayDigest<E> {
  const end = addDays(start, 1, tz);
  const after = addDays(start, 2, tz);
  const timed = events.filter((event) => event.type !== 'livestream' && event.type !== 'maintenance');
  return {
    running: timed.filter((event) => event.start < end && event.end > start).length,
    ends: foldMoments(
      timed
        .filter((event) => event.end >= start && event.end < end)
        .map((event) => ({ event, kind: 'ends' as const, at: event.end })),
    ),
    marks: events
      .filter((event) => !timed.includes(event) && event.start >= start && event.start < end)
      .sort((a, b) => a.start - b.start || compareEvents(a, b)),
    startsNext: foldMoments(
      timed
        .filter((event) => event.start >= end && event.start < after)
        .map((event) => ({ event, kind: 'starts' as const, at: event.start })),
    ),
  };
}
