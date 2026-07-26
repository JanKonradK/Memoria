import { describe, expect, it } from 'vitest';
import type { Game, GameEvent } from '@void/shared';
import { emptyState } from '@void/shared';
import { selectAgendaData } from '../src/components/TimelineAgenda';

const NOW = 1_000_000_000;
const HOUR = 3_600_000;

const game: Game = {
  id: 'game-1',
  name: 'Test Game',
  short: 'TG',
  color: '#7c5cff',
  icon: '',
  platform: 'both',
  tz: 'UTC',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort: 0,
  updatedAt: NOW,
};

function event(id: string, start: number, end: number): GameEvent {
  return {
    id,
    gameId: game.id,
    name: id,
    type: 'event',
    start,
    end,
    dailyTouch: false,
    notify: true,
    notes: '',
    updatedAt: NOW,
  };
}

describe('dashboard agenda selection', () => {
  it('drops past events and applies the shared nine-row budget', () => {
    const state = emptyState();
    state.games = [game];
    state.events = [
      event('past', NOW - 2 * HOUR, NOW - HOUR),
      ...Array.from({ length: 5 }, (_, index) => event(`live-${index}`, NOW - HOUR, NOW + (index + 1) * HOUR)),
      ...Array.from({ length: 8 }, (_, index) =>
        event(`upcoming-${index}`, NOW + (index + 1) * HOUR, NOW + (index + 2) * HOUR),
      ),
    ];

    const agenda = selectAgendaData(state, NOW, 'dashboard');

    expect(agenda.live).toHaveLength(5);
    expect(agenda.upcoming).toHaveLength(4);
    expect(agenda.live.map((row) => row.kind)).toEqual(Array(5).fill('event'));
    expect(agenda.upcoming.map((row) => row.kind)).toEqual(Array(4).fill('event'));
    expect(agenda.past).toEqual([]);
  });

  it('keeps the complete timeline window in full mode', () => {
    const state = emptyState();
    state.games = [game];
    state.events = [
      event('past', NOW - 2 * HOUR, NOW - HOUR),
      ...Array.from({ length: 5 }, (_, index) => event(`live-${index}`, NOW - HOUR, NOW + (index + 1) * HOUR)),
      ...Array.from({ length: 8 }, (_, index) =>
        event(`upcoming-${index}`, NOW + (index + 1) * HOUR, NOW + (index + 2) * HOUR),
      ),
    ];

    const agenda = selectAgendaData(state, NOW);

    expect(agenda.live).toHaveLength(5);
    expect(agenda.upcoming).toHaveLength(8);
    expect(agenda.live.map((row) => row.kind)).toEqual(Array(5).fill('event'));
    expect(agenda.upcoming.map((row) => row.kind)).toEqual(Array(8).fill('event'));
    expect(agenda.past.map((item) => item.id)).toEqual(['past']);
  });
});
