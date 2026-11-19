import { DateTime } from 'luxon';
import type { Game } from '@memoria/shared';
import { lastWeeklyReset, nextWeeklyReset } from '@memoria/shared';

/** The timeline shows one week back and three weeks ahead of today. */
export const TIMELINE_BACK_DAYS = 7;
export const TIMELINE_AHEAD_DAYS = 21;

/**
 * Whole local days: from midnight a week ago to the end of the 21st day ahead,
 * so every day on the ruler is a full day.
 */
export function timelineWindow(now: number, localTz: string): { start: number; end: number } {
  const today = DateTime.fromMillis(now, { zone: localTz }).startOf('day');
  return {
    start: today.minus({ days: TIMELINE_BACK_DAYS }).toMillis(),
    end: today.plus({ days: TIMELINE_AHEAD_DAYS + 1 }).toMillis(),
  };
}

type ResetGame = Pick<Game, 'tz' | 'dailyResetHour' | 'weeklyResetDay' | 'monthlyResetDay'>;

/**
 * Where the week lines go: the weekly reset most of the shown games share.
 *
 * Each game's resets are worked out in its own time zone, so daylight saving
 * moves a line only when it moves the reset. Games vote with their whole run of
 * resets in the window; a tie goes to the earlier run. With no games, the lines
 * fall back to Monday midnight in the player's zone.
 */
export function weekResetLines(games: readonly ResetGame[], start: number, end: number, localTz: string): number[] {
  const votes = new Map<string, { count: number; lines: number[] }>();
  for (const game of games) {
    const lines: number[] = [];
    try {
      let at = lastWeeklyReset(game, start);
      if (at < start) at = nextWeeklyReset(game, at);
      while (at <= end && lines.length < 10) {
        lines.push(at);
        at = nextWeeklyReset(game, at);
      }
    } catch {
      continue;
    }
    if (lines.length === 0) continue;
    const key = lines.join(',');
    const vote = votes.get(key);
    if (vote) vote.count += 1;
    else votes.set(key, { count: 1, lines });
  }
  let best: { count: number; lines: number[] } | undefined;
  for (const vote of votes.values()) {
    if (!best || vote.count > best.count || (vote.count === best.count && vote.lines[0]! < best.lines[0]!)) {
      best = vote;
    }
  }
  if (best) return best.lines;

  const lines: number[] = [];
  let monday = DateTime.fromMillis(start, { zone: localTz }).startOf('week');
  if (monday.toMillis() < start) monday = monday.plus({ weeks: 1 });
  while (monday.toMillis() <= end) {
    lines.push(monday.toMillis());
    monday = monday.plus({ weeks: 1 });
  }
  return lines;
}

/** The local midnights that begin each day in the window. */
export function timelineDays(start: number, end: number, localTz: string): DateTime[] {
  const days: DateTime[] = [];
  let day = DateTime.fromMillis(start, { zone: localTz }).startOf('day');
  while (day.toMillis() < end) {
    days.push(day);
    day = day.plus({ days: 1 });
  }
  return days;
}

/** Days before today each range opens on, and how many days it spans. */
export const TIMELINE_RANGES = {
  week: { back: 1, days: 7, label: 'Week' },
  month: { back: TIMELINE_BACK_DAYS, days: TIMELINE_BACK_DAYS + TIMELINE_AHEAD_DAYS, label: '4 weeks' },
  season: { back: TIMELINE_BACK_DAYS, days: 63, label: 'Season' },
} as const;
export type TimelineRangeKey = keyof typeof TIMELINE_RANGES;

/**
 * The range on screen, in whole local days, moved `weeks` away from the one
 * that holds now. A week opens on yesterday, so the day just gone stays in view.
 */
export function rangeWindow(
  now: number,
  localTz: string,
  range: TimelineRangeKey,
  weeks = 0,
): { start: number; end: number } {
  const { back, days } = TIMELINE_RANGES[range];
  const first = DateTime.fromMillis(now, { zone: localTz }).startOf('day').minus({ days: back }).plus({ weeks });
  return { start: first.toMillis(), end: first.plus({ days }).toMillis() };
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

export type BarTone = 'rose' | 'warn' | 'muted' | 'ok';

/** Time left, short enough to sit inside a bar: "5h", "2d 4h", "12d". */
export function shortLeft(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < 3 * DAY) return `${Math.floor(ms / DAY)}d ${Math.floor((ms % DAY) / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

/**
 * What a bar says at its end. A running event counts down, rose under a day and
 * amber under three; one still to come says when it arrives; one that runs past
 * the range names its last day instead of a number nobody can see the end of.
 */
export function barCountdown(
  event: { start: number; end: number; done?: boolean },
  now: number,
  rangeEnd: number,
  localTz: string,
): { label: string; tone: BarTone } {
  if (event.done) return { label: 'done', tone: 'ok' };
  if (event.end <= now) return { label: 'ended', tone: 'muted' };
  if (event.start > now) return { label: `in ${shortLeft(event.start - now)}`, tone: 'muted' };
  const left = event.end - now;
  if (event.end > rangeEnd && left >= 3 * DAY) {
    return { label: `to ${DateTime.fromMillis(event.end, { zone: localTz }).toFormat('d LLL')}`, tone: 'muted' };
  }
  return { label: shortLeft(left), tone: left < DAY ? 'rose' : left < 3 * DAY ? 'warn' : 'muted' };
}

/**
 * One line for a collapsed game: what ends first and how much ends with it on
 * the same day, "VOLT TRIP and 8 more end today".
 */
export function collapsedSummary(
  events: readonly { name: string; type: string; start: number; end: number; done?: boolean }[],
  now: number,
  localTz: string,
  withTime = false,
): string {
  const running = events
    .filter((e) => !e.done && e.start <= now && e.end > now && e.type !== 'maintenance' && e.type !== 'livestream')
    .sort((a, b) => a.end - b.end || a.name.localeCompare(b.name));
  const first = running[0];
  if (!first) {
    const coming = events.filter((e) => !e.done && e.start > now).length;
    return coming > 0 ? `${coming} coming, nothing running` : 'Nothing running';
  }
  const end = DateTime.fromMillis(first.end, { zone: localTz });
  const today = DateTime.fromMillis(now, { zone: localTz }).startOf('day');
  const more = running.filter((e) => DateTime.fromMillis(e.end, { zone: localTz }).hasSame(end, 'day')).length - 1;
  const days = Math.round(end.startOf('day').diff(today, 'days').days);
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : end.toFormat('ccc d LLL');
  return `${first.name}${more > 0 ? ` and ${more} more end` : ' ends'} ${when}${withTime ? ` at ${end.toFormat('HH:mm')}` : ''}`;
}
