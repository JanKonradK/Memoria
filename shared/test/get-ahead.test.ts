import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { deadlineLoad, getAheadPicks, weekProgress, type GameEvent } from '../src';

const tz = 'Europe/Warsaw';
// Saturday 21 November 2026, noon.
const now = DateTime.fromISO('2026-11-21T12:00', { zone: tz }).toMillis();
const at = (iso: string) => DateTime.fromISO(iso, { zone: tz }).toMillis();

let n = 0;
const event = (over: Partial<GameEvent> & { end: number }): GameEvent => ({
  id: `e${++n}`,
  gameId: 'g',
  name: `Event ${n}`,
  type: 'event',
  start: at('2026-11-01T10:00'),
  dailyTouch: false,
  notify: false,
  notes: '',
  updatedAt: 0,
  ...over,
});

describe('get ahead', () => {
  it('counts unfinished endings per day, the small hours on the night before', () => {
    const events = [
      event({ end: at('2026-11-23T04:00') }), // Monday 04:00 counts on Sunday night
      event({ end: at('2026-11-22T20:00'), done: true }),
      event({ end: at('2026-11-22T20:00'), gameId: 'h' }),
      event({ end: at('2026-11-22T20:00'), type: 'banner' }),
    ];
    const load = deadlineLoad(events, now, tz, { days: 3 });
    expect(load.map((day) => day.date)).toEqual(['2026-11-21', '2026-11-22', '2026-11-23']);
    expect(load[1]).toMatchObject({ total: 3, left: 2 });
    expect(load[1]!.games).toEqual([
      { gameId: 'g', left: 1 },
      { gameId: 'h', left: 1 },
    ]);
    expect(load[2]!.total).toBe(0);
  });

  it('picks what ends soonest, lifted by pile-ups, pins, progress and reward', () => {
    const soon = event({ end: at('2026-11-22T20:00'), name: 'soon' });
    const far = event({ end: at('2026-12-10T20:00'), name: 'far' });
    const pinnedFar = event({ end: at('2026-12-11T20:00'), name: 'pinned', pinned: true });
    const pile = [1, 2, 3].map((index) => event({ end: at('2026-11-25T20:00'), name: `pile${index}` }));
    const rich = event({ end: at('2026-11-30T20:00'), name: 'rich', reward: 1200 });
    const started = event({ end: at('2026-12-09T20:00'), name: 'started', partsDone: 1 });
    const later = event({ end: at('2026-11-22T20:00'), start: at('2026-11-22T10:00'), name: 'not open yet' });
    const banner = event({ end: at('2026-11-21T20:00'), type: 'banner', name: 'banner' });
    const picks = getAheadPicks([far, pinnedFar, started, soon, ...pile, rich, later, banner], now, tz, {
      limit: 20,
      reward: (item) => item.reward ?? null,
    });
    const names = picks.map((pick) => pick.event.name);
    expect(names[0]).toBe('soon');
    expect(names).not.toContain('not open yet');
    expect(names).not.toContain('banner');
    expect(names.indexOf('pinned')).toBeLessThan(names.indexOf('far'));
    expect(names.indexOf('started')).toBeLessThan(names.indexOf('far'));
    expect(picks.find((pick) => pick.event.name === 'pile1')!.reasons).toContainEqual({
      kind: 'pileup',
      date: '2026-11-25',
      count: 3,
    });
    expect(picks.find((pick) => pick.event.name === 'rich')!.reasons).toContainEqual({ kind: 'reward', amount: 1200 });
    expect(picks.find((pick) => pick.event.name === 'soon')!.daysLeft).toBe(1);
    expect(getAheadPicks([far, soon, rich], now, tz)).toHaveLength(3);
    expect(getAheadPicks([far, soon, rich], now, tz, { limit: 2 })).toHaveLength(2);
  });

  it('measures the week to Sunday', () => {
    const events = [
      event({ end: at('2026-11-22T20:00'), done: true }),
      event({ end: at('2026-11-21T20:00') }),
      event({ end: at('2026-11-24T20:00') }),
    ];
    expect(weekProgress(events, now, tz)).toEqual({ done: 1, total: 2 });
  });
});
