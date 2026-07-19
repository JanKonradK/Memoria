import type { GameEvent } from '@technogg/shared';
import { describe, expect, it } from 'vitest';
import { agendaCompare, agendaRank } from '../src/timeline-sort';

const NOW = 1_000;

function event(overrides: Partial<GameEvent> = {}): GameEvent {
  return {
    id: overrides.id ?? 'event',
    gameId: overrides.gameId ?? 'game',
    name: overrides.name ?? 'Event',
    type: overrides.type ?? 'event',
    start: overrides.start ?? 900,
    end: overrides.end ?? 1_100,
    dailyTouch: overrides.dailyTouch ?? false,
    notify: overrides.notify ?? true,
    notes: overrides.notes ?? '',
    updatedAt: overrides.updatedAt ?? 0,
    ...overrides,
  };
}

function sorted(events: GameEvent[]): GameEvent[] {
  return [...events].sort((a, b) => agendaCompare(a, b, NOW));
}

describe('agendaRank', () => {
  it('uses the exact active, upcoming, ended-not-done, done ordering', () => {
    expect([
      agendaRank(event(), NOW),
      agendaRank(event({ start: 1_100, end: 1_200 }), NOW),
      agendaRank(event({ start: 800, end: 1_000 }), NOW),
      agendaRank(event({ done: true }), NOW),
    ]).toEqual([0, 1, 2, 3]);
  });
});

describe('agendaCompare', () => {
  it('sorts active events before upcoming events regardless of dates', () => {
    const active = event({ id: 'active', end: 5_000 });
    const upcoming = event({ id: 'upcoming', start: 1_001, end: 1_002 });
    expect(sorted([upcoming, active]).map((item) => item.id)).toEqual(['active', 'upcoming']);
  });

  it('sorts active events by end ascending', () => {
    const later = event({ id: 'later', type: 'event', end: 1_500 });
    const sooner = event({ id: 'sooner', type: 'maintenance', end: 1_100 });
    expect(sorted([later, sooner]).map((item) => item.id)).toEqual(['sooner', 'later']);
  });

  it('uses type rank when active events end together', () => {
    const maintenance = event({ id: 'maintenance', type: 'maintenance' });
    const cycle = event({ id: 'cycle', type: 'cycle' });
    const playable = event({ id: 'playable', type: 'event' });
    expect(sorted([maintenance, cycle, playable]).map((item) => item.id)).toEqual(['playable', 'cycle', 'maintenance']);
  });

  it('sorts upcoming events by start ascending', () => {
    const later = event({ id: 'later', start: 1_300, end: 1_400 });
    const sooner = event({ id: 'sooner', start: 1_100, end: 1_500 });
    expect(sorted([later, sooner]).map((item) => item.id)).toEqual(['sooner', 'later']);
  });

  it('keeps ended-not-done events ahead of done events', () => {
    const done = event({ id: 'done', done: true, end: 999 });
    const ended = event({ id: 'ended', start: 800, end: 900 });
    expect(sorted([done, ended]).map((item) => item.id)).toEqual(['ended', 'done']);
  });

  it('sorts ended and done events by end descending within their ranks', () => {
    const events = [
      event({ id: 'older-ended', start: 700, end: 800 }),
      event({ id: 'newer-ended', start: 800, end: 900 }),
      event({ id: 'older-done', done: true, end: 750 }),
      event({ id: 'newer-done', done: true, end: 950 }),
    ];
    expect(sorted(events).map((item) => item.id)).toEqual(['newer-ended', 'older-ended', 'newer-done', 'older-done']);
  });

  it('sinks done events below everything live', () => {
    const done = event({ id: 'done', done: true, start: 900, end: 1_100 });
    const live = event({ id: 'live', start: 900, end: 1_200 });
    expect(sorted([done, live]).map((item) => item.id)).toEqual(['live', 'done']);
  });

  it('treats an event starting exactly now as active', () => {
    expect(agendaRank(event({ start: NOW, end: 1_200 }), NOW)).toBe(0);
  });

  it('breaks full ties deterministically by id', () => {
    const b = event({ id: 'b' });
    const a = event({ id: 'a' });
    expect(sorted([b, a]).map((item) => item.id)).toEqual(['a', 'b']);
    expect(agendaCompare(a, b, NOW)).toBeLessThan(0);
    expect(agendaCompare(b, a, NOW)).toBeGreaterThan(0);
  });
});
