import { describe, expect, it } from 'vitest';
import type { Game, GameEvent } from '@memoria/shared';
import { emptyState } from '@memoria/shared';
import { DASHBOARD_AGENDA_DAYS, selectAgendaData } from '../src/agenda-data';
import { DASHBOARD_UPCOMING_LIMIT } from '../src/timeline-sort';

const NOW = 1_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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
  // The upcoming cap is asserted against DASHBOARD_UPCOMING_LIMIT, not against
  // its value: what is being pinned is that new arrivals are uncapped while
  // upcoming is capped, which is the asymmetry the panel depends on. How deep
  // the cap sits is a tuning decision and has already moved once.
  it('shows every new arrival and only the next few upcoming events', () => {
    const state = emptyState();
    state.games = [game];
    const DAY = 24 * HOUR;
    state.events = [
      event('past', NOW - 2 * HOUR, NOW - HOUR),
      // Fresh: inside the 2-day arrival window, so New arrivals claims them even
      // though they also end within the ending window.
      ...Array.from({ length: 5 }, (_, index) => event(`live-${index}`, NOW - HOUR, NOW + (index + 1) * HOUR)),
      // Aged past the arrival window, so these are the ones Ending soon owns.
      ...Array.from({ length: 2 }, (_, index) => event(`ending-${index}`, NOW - 5 * DAY, NOW + (index + 1) * DAY)),
      ...Array.from({ length: DASHBOARD_UPCOMING_LIMIT + 5 }, (_, index) =>
        event(`upcoming-${index}`, NOW + (index + 1) * HOUR, NOW + (index + 2) * HOUR),
      ),
    ];

    const agenda = selectAgendaData(state, NOW, 'dashboard');

    expect(agenda.live).toHaveLength(5);
    expect(agenda.upcoming).toHaveLength(DASHBOARD_UPCOMING_LIMIT);
    expect(agenda.endingSoon).toHaveLength(2);
    expect(agenda.past).toEqual([]);
  });

  it('windows the dashboard to a fortnight', () => {
    const state = emptyState();
    state.games = [game];
    state.events = [
      event('inside', NOW + DASHBOARD_AGENDA_DAYS * DAY - HOUR, NOW + DASHBOARD_AGENDA_DAYS * DAY),
      event('outside', NOW + (DASHBOARD_AGENDA_DAYS + 3) * DAY, NOW + (DASHBOARD_AGENDA_DAYS + 4) * DAY),
    ];

    const agenda = selectAgendaData(state, NOW, 'dashboard');

    expect(agenda.upcoming.flatMap((row) => (row.kind === 'event' ? [row.event.id] : []))).toEqual(['inside']);
  });

  it('excludes long-running live events beyond the dashboard fortnight without changing full mode', () => {
    const state = emptyState();
    state.games = [game];
    state.events = [event('long-running', NOW - 30 * DAY, NOW + 30 * DAY)];

    const dashboardAgenda = selectAgendaData(state, NOW, 'dashboard');
    const fullAgenda = selectAgendaData(state, NOW, 'full');

    expect(dashboardAgenda.live).toEqual([]);
    expect(fullAgenda.live.flatMap((row) => (row.kind === 'event' ? [row.event.id] : []))).toEqual(['long-running']);
  });

  it('does not cap new arrivals however long the live list runs', () => {
    const state = emptyState();
    state.games = [game];
    state.events = [
      ...Array.from({ length: 40 }, (_, index) => event(`live-${index}`, NOW - HOUR, NOW + (index + 1) * HOUR)),
      ...Array.from({ length: DASHBOARD_UPCOMING_LIMIT + 3 }, (_, index) =>
        event(`upcoming-${index}`, NOW + DAY, NOW + DAY + index * HOUR),
      ),
    ];

    const agenda = selectAgendaData(state, NOW, 'dashboard');

    expect(agenda.live).toHaveLength(40);
    expect(agenda.upcoming).toHaveLength(DASHBOARD_UPCOMING_LIMIT);
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
