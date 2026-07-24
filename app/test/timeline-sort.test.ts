import type { Game, GameEvent } from '@technogg/shared';
import { describe, expect, it } from 'vitest';
import { agendaCompare, agendaRank, budgetAgenda, groupVersionUpdates, type AgendaRow } from '../src/timeline-sort';

const NOW = 1_000;
const HOUR = 3_600_000;

const game: Game = {
  id: 'game',
  name: 'Zenless Zone Zero',
  short: 'ZZZ',
  color: '#ff7800',
  icon: '',
  platform: 'both',
  tz: 'UTC',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort: 0,
  updatedAt: 0,
};

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

function row(id: string): AgendaRow {
  return { kind: 'event', event: event({ id }) };
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

describe('groupVersionUpdates', () => {
  it('collapses a patch launch into one version summary at maintenance end', () => {
    const maintenance = event({
      id: 'maintenance',
      name: 'v3.1 update maintenance',
      type: 'maintenance',
      start: NOW + HOUR,
      end: NOW + 2 * HOUR,
    });
    const banner = event({ id: 'banner', type: 'banner', start: maintenance.end, end: maintenance.end + HOUR });
    const eventDrop = event({ id: 'event', start: maintenance.end, end: maintenance.end + 2 * HOUR });

    const rows = groupVersionUpdates(sorted([eventDrop, maintenance, banner]), new Map([[game.id, game]]), NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'group',
      gameId: game.id,
      label: 'ZZZ 3.1 Update',
      at: maintenance.end,
      count: 2,
    });
    expect(rows[0]?.kind === 'group' && rows[0].events.map((item) => item.id)).toEqual([
      'maintenance',
      'banner',
      'event',
    ]);
  });

  it('leaves maintenance and its only following event ungrouped', () => {
    const maintenance = event({
      id: 'maintenance',
      name: 'v3.1 update maintenance',
      type: 'maintenance',
      start: NOW + HOUR,
      end: NOW + 2 * HOUR,
    });
    const banner = event({ id: 'banner', type: 'banner', start: maintenance.end, end: maintenance.end + HOUR });

    const rows = groupVersionUpdates(sorted([banner, maintenance]), new Map([[game.id, game]]), NOW);

    expect(rows.map((item) => item.kind)).toEqual(['event', 'event']);
    expect(rows.map((item) => item.kind === 'event' && item.event.id)).toEqual(['maintenance', 'banner']);
  });

  it('falls back to the game short name when maintenance has no version', () => {
    const maintenance = event({
      id: 'maintenance',
      name: 'Update maintenance',
      type: 'maintenance',
      start: NOW + HOUR,
      end: NOW + 2 * HOUR,
    });
    const drops = [
      event({ id: 'a', start: maintenance.end, end: maintenance.end + HOUR }),
      event({ id: 'b', start: maintenance.end, end: maintenance.end + HOUR }),
    ];

    const rows = groupVersionUpdates(sorted([maintenance, ...drops]), new Map([[game.id, game]]), NOW);

    expect(rows[0]).toMatchObject({ kind: 'group', label: 'ZZZ update' });
  });

  it('never absorbs events from a different game', () => {
    const maintenance = event({
      id: 'maintenance',
      name: 'v3.1 update maintenance',
      type: 'maintenance',
      start: NOW + HOUR,
      end: NOW + 2 * HOUR,
    });
    const localDrops = [
      event({ id: 'local-a', start: maintenance.end, end: maintenance.end + HOUR }),
      event({ id: 'local-b', start: maintenance.end, end: maintenance.end + HOUR }),
    ];
    const other = event({
      id: 'other',
      gameId: 'other-game',
      start: maintenance.end,
      end: maintenance.end + HOUR,
    });

    const rows = groupVersionUpdates(sorted([maintenance, ...localDrops, other]), new Map([[game.id, game]]), NOW);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.kind === 'group' && rows[0].events.map((item) => item.id)).not.toContain('other');
    expect(rows[1]).toMatchObject({ kind: 'event', event: { id: 'other' } });
  });
});

describe('budgetAgenda', () => {
  it('caps the combined lists at nine rows', () => {
    const budgeted = budgetAgenda(
      Array.from({ length: 4 }, (_, index) => row(`live-${index}`)),
      Array.from({ length: 8 }, (_, index) => row(`upcoming-${index}`)),
    );

    expect(budgeted.live).toHaveLength(4);
    expect(budgeted.upcoming).toHaveLength(5);
  });

  it('reserves three upcoming slots when live is long', () => {
    const budgeted = budgetAgenda(
      Array.from({ length: 10 }, (_, index) => row(`live-${index}`)),
      Array.from({ length: 5 }, (_, index) => row(`upcoming-${index}`)),
    );

    expect(budgeted.live).toHaveLength(6);
    expect(budgeted.upcoming).toHaveLength(3);
  });

  it('lets live use the spare reserved slots when upcoming has fewer than three rows', () => {
    const budgeted = budgetAgenda(
      Array.from({ length: 10 }, (_, index) => row(`live-${index}`)),
      Array.from({ length: 2 }, (_, index) => row(`upcoming-${index}`)),
    );

    expect(budgeted.live).toHaveLength(7);
    expect(budgeted.upcoming).toHaveLength(2);
  });
});
