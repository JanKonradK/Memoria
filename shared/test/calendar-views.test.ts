import { describe, expect, it } from 'vitest';
import {
  agendaDays,
  dayDigest,
  dayKey,
  elapsedShare,
  foldMoments,
  monthWeeks,
  packWeek,
  soonColumns,
  type CalendarEvent,
} from '../src/calendar-views';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = 'Europe/Warsaw';
// Wednesday 18 November 2026, 14:00 in Warsaw (UTC+1).
const NOW = Date.UTC(2026, 10, 18, 13);
const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour - 1, minute);

function event(id: string, over: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, gameId: 'nikke', name: id, type: 'event', start: NOW - DAY, end: NOW + HOUR, ...over };
}

describe('folding', () => {
  it('folds three or more same-game moments at one instant and keeps the rest separate', () => {
    const end = at(18, 19, 59);
    const items = [
      ...['b', 'c', 'a'].map((id) => ({ event: event(id, { end }), kind: 'ends' as const, at: end })),
      { event: event('banner', { end, type: 'banner' }), kind: 'ends' as const, at: end },
      { event: event('other', { end, gameId: 'zzz' }), kind: 'ends' as const, at: end },
    ];
    const moments = foldMoments(items);
    const folded = moments.find((moment) => moment.events.length > 1)!;
    expect(folded.events.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(moments.filter((moment) => moment.events.length === 1).map((moment) => moment.events[0]!.id)).toEqual([
      'banner',
      'other',
    ]);
  });

  it('never folds two, and never folds a pinned event', () => {
    const end = at(18, 20);
    const two = foldMoments(['a', 'b'].map((id) => ({ event: event(id, { end }), kind: 'ends' as const, at: end })));
    expect(two).toHaveLength(2);
    const pinned = foldMoments(
      ['a', 'b', 'c'].map((id) => ({ event: event(id, { end, pinned: id === 'a' }), kind: 'ends' as const, at: end })),
    );
    expect(pinned).toHaveLength(3);
  });

  it('holds its order when the input order changes', () => {
    const items = [
      { event: event('late', { end: at(19, 3) }), kind: 'ends' as const, at: at(19, 3) },
      { event: event('early', { end: at(18, 15) }), kind: 'ends' as const, at: at(18, 15) },
      { event: event('starts', { start: at(18, 15) }), kind: 'starts' as const, at: at(18, 15) },
    ];
    const keys = foldMoments(items).map((moment) => moment.key);
    expect(foldMoments([...items].reverse()).map((moment) => moment.key)).toEqual(keys);
    expect(foldMoments(items).map((moment) => moment.kind)).toEqual(['ends', 'starts', 'ends']);
  });
});

describe('agenda', () => {
  it('groups moments by the player’s day and shows a coming event where it starts and where it ends', () => {
    const agenda = agendaDays(
      [
        event('running', { end: at(18, 15) }),
        event('coming', { start: at(19, 15), end: at(20, 12) }),
        event('live', { type: 'livestream', start: at(20, 13), end: at(20, 14) }),
        event('down', { type: 'maintenance', start: at(19, 13), end: at(19, 15) }),
      ],
      NOW,
      TZ,
    );
    expect(agenda.days.map((day) => day.date)).toEqual(['2026-11-18', '2026-11-19', '2026-11-20']);
    expect(agenda.days[1]!.moments.map((moment) => `${moment.kind}:${moment.events[0]!.id}`)).toEqual([
      'down:down',
      'starts:coming',
    ]);
    expect(agenda.days[2]!.moments.map((moment) => moment.kind)).toEqual(['ends', 'live']);
  });

  it('uses the home zone for the day boundary, not UTC', () => {
    // 23:30 in Warsaw on the 18th is already the 19th in Tokyo.
    const late = event('late', { end: at(18, 23, 30) });
    expect(agendaDays([late], NOW, TZ).days[0]!.date).toBe('2026-11-18');
    expect(agendaDays([late], NOW, 'Asia/Tokyo').days[0]!.date).toBe('2026-11-19');
  });

  it('keeps finished events behind Show finished, older ones in their own list', () => {
    const events = [
      event('running'),
      event('ticked', { done: true }),
      event('earlier today', { end: at(18, 9) }),
      event('yesterday', { start: at(10, 9), end: at(17, 9) }),
      event('last week', { start: at(1, 9), end: at(11, 9) }),
    ];
    const hidden = agendaDays(events, NOW, TZ);
    expect(hidden.days.flatMap((day) => day.moments).map((moment) => moment.events[0]!.id)).toEqual(['running']);
    expect(hidden.hiddenFinished).toBe(4);
    const shown = agendaDays(events, NOW, TZ, { showFinished: true });
    expect(shown.days[0]!.moments.map((moment) => moment.events[0]!.id)).toEqual([
      'earlier today',
      'running',
      'ticked',
    ]);
    expect(shown.finished.map((item) => item.id)).toEqual(['yesterday', 'last week']);
  });
});

describe('ending soon', () => {
  it('buckets unfinished events into today, by Sunday, next week and later', () => {
    const columns = soonColumns(
      [
        event('today', { end: at(18, 23, 59) }),
        event('thursday', { end: at(19, 3) }),
        event('sunday', { end: at(22, 23) }),
        event('monday', { end: at(23, 0, 30) }),
        event('next sunday', { end: at(29, 22) }),
        event('december', { end: at(30, 1) }),
        event('over', { end: NOW - 1 }),
        event('live', { type: 'livestream', end: at(19, 1) }),
      ],
      NOW,
      TZ,
    );
    const ids = Object.fromEntries(
      columns.map((column) => [column.bucket, column.moments.map((moment) => moment.events[0]!.id)]),
    );
    expect(ids).toEqual({
      today: ['today'],
      week: ['thursday', 'sunday'],
      next: ['monday', 'next sunday'],
      later: ['december'],
    });
    expect(columns[1]!.from).toBe(at(19, 0));
    expect(columns[2]!.from).toBe(at(23, 0));
  });

  it('on a Sunday, by Sunday is empty and next week starts tomorrow', () => {
    const sunday = at(22, 12);
    const columns = soonColumns([event('monday', { end: at(23, 10) })], sunday, TZ);
    expect(columns[1]!.count).toBe(0);
    expect(columns[2]!.moments).toHaveLength(1);
  });

  it('counts folded events and can hide ticked ones', () => {
    const end = at(18, 19, 59);
    const events = [...['a', 'b', 'c'].map((id) => event(id, { end })), event('done', { end, done: true })];
    const [today] = soonColumns(events, NOW, TZ);
    expect(today!.count).toBe(4);
    expect(today!.moments).toHaveLength(1);
    expect(today!.moments[0]!.events).toHaveLength(4);
    expect(soonColumns(events, NOW, TZ, { hideDone: true })[0]!.count).toBe(3);
  });

  it('measures how far through its window an event is', () => {
    expect(elapsedShare({ start: 0, end: 100 }, 25)).toBe(0.25);
    expect(elapsedShare({ start: 0, end: 100 }, -5)).toBe(0);
    expect(elapsedShare({ start: 0, end: 100 }, 500)).toBe(1);
    expect(elapsedShare({ start: 10, end: 10 }, 5)).toBe(0);
  });
});

describe('month', () => {
  it('covers the month in Monday-first weeks', () => {
    const weeks = monthWeeks(2026, 11, TZ);
    expect(weeks).toHaveLength(6);
    expect(weeks[0]!.days[0]!.date).toBe('2026-10-26');
    expect(weeks[0]!.days[6]).toMatchObject({ date: '2026-11-01', inMonth: true, weekend: true });
    expect(weeks.at(-1)!.days[0]!.date).toBe('2026-11-30');
    expect(weeks.at(-1)!.days[1]!.inMonth).toBe(false);
    expect(monthWeeks(2027, 2, TZ)).toHaveLength(4);
  });

  it('keeps a day 24 hours long only when the clock does not change', () => {
    const october = monthWeeks(2026, 10, TZ);
    const week = october.find((item) => item.days.some((day) => day.date === '2026-10-25'))!;
    expect(week.end - week.start).toBe(7 * DAY + HOUR);
    expect(dayKey(week.days[6]!.start, TZ)).toBe('2026-10-25');
  });

  it('gives lanes to what starts or ends in the week before what runs straight through it', () => {
    const week = monthWeeks(2026, 11, TZ)[3]!; // 16–22 November
    const long = event('long', { start: at(10, 9), end: at(30, 9) });
    const bars = packWeek(
      [
        long,
        event('mid', { start: at(17, 9), end: at(20, 9), gameId: 'a' }),
        event('short', { start: at(17, 9), end: at(17, 18), gameId: 'b' }),
        event('crowded', { start: at(17, 10), end: at(18, 10), gameId: 'c' }),
        event('down', { type: 'maintenance', start: at(18, 13), end: at(18, 15) }),
      ],
      week,
    );
    expect(bars.bars.map((bar) => [bar.events[0]!.id, bar.from, bar.to, bar.lane])).toEqual([
      ['mid', 1, 5, 0],
      ['crowded', 1, 3, 1],
      ['short', 1, 2, 2],
    ]);
    expect(bars.games[1]).toEqual(['a', 'c', 'b', 'nikke']);
    expect(bars.games[6]).toEqual(['nikke']);
    expect(bars.hidden).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(bars.marks[2]!.map((item) => item.id)).toEqual(['down']);

    // With room, the long bar takes the first lane free all week.
    const roomy = packWeek([long, event('mid', { start: at(17, 9), end: at(20, 9), gameId: 'a' })], week);
    expect(roomy.bars.map((bar) => [bar.events[0]!.id, bar.lane])).toEqual([
      ['mid', 0],
      ['long', 1],
    ]);
    expect(roomy.bars[1]).toMatchObject({ clippedStart: true, clippedEnd: true });
  });

  it('ends a bar on the day before an end at midnight, and folds one game’s shared window', () => {
    const week = monthWeeks(2026, 11, TZ)[3]!;
    const start = at(16, 5);
    const end = at(19, 0); // midnight: the bar stops on Wednesday 18
    const packed = packWeek(
      ['a', 'b', 'c'].map((id) => event(id, { start, end })),
      week,
    );
    expect(packed.bars).toHaveLength(1);
    expect(packed.bars[0]).toMatchObject({ from: 0, to: 3 });
    expect(packed.bars[0]!.events).toHaveLength(3);
  });

  it('summarises a chosen day: what runs, what ends, what starts the next day', () => {
    const digest = dayDigest(
      [
        event('ends today', { end: at(18, 15) }),
        event('runs on', { end: at(25, 15) }),
        event('starts tomorrow', { start: at(19, 15), end: at(25, 15) }),
        event('down', { type: 'maintenance', start: at(18, 13), end: at(18, 15) }),
      ],
      at(18, 0),
      TZ,
    );
    expect(digest.running).toBe(2);
    expect(digest.ends.map((moment) => moment.events[0]!.id)).toEqual(['ends today']);
    expect(digest.marks.map((item) => item.id)).toEqual(['down']);
    expect(digest.startsNext.map((moment) => moment.events[0]!.id)).toEqual(['starts tomorrow']);
  });
});
