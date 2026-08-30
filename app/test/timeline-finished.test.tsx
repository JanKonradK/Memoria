import { fireEvent, render, screen } from '@testing-library/react';
import { emptyState, type Game, type GameEvent } from '@memoria/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { TimelinePage } from '../src/components/Timeline';
import { TooltipProvider } from '../src/components/ui';
import { useApp } from '../src/store';

const NOW = Date.UTC(2026, 7, 27, 12);
const DAY = 86_400_000;

const game: Game = {
  id: 'genshin-eu',
  name: 'Genshin Impact',
  short: 'Genshin',
  color: '#f8efdb',
  icon: '',
  platform: 'both',
  tz: 'Etc/GMT-1',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort: 0,
  updatedAt: 1,
};

function event(over: Partial<GameEvent>): GameEvent {
  return {
    id: 'e',
    gameId: game.id,
    name: 'An event',
    type: 'event',
    start: NOW - 5 * DAY,
    end: NOW + 5 * DAY,
    dailyTouch: false,
    notify: true,
    notes: '',
    updatedAt: 1,
    ...over,
  };
}

function show(events: GameEvent[]) {
  useApp.setState({ state: { ...emptyState(), games: [game], events } });
  // Event rows carry countdown tooltips, which the real app supplies at the root.
  return render(
    <TooltipProvider>
      <TimelinePage now={NOW} />
    </TooltipProvider>,
  );
}

afterEach(() => useApp.setState({ state: emptyState() }));

/**
 * A row's visible name is dropped when the bar leaves no room for it, and jsdom
 * reports every width as zero, so the accessible name is what the row can be
 * identified by here. It is the better assertion regardless: it is what a screen
 * reader announces.
 */
const row = (name: string) => ({ name: `Open Genshin Impact event: ${name}` });

/**
 * An ended event has nothing left to act on. It should stop competing with the
 * things still running, without being destroyed — the record still matters.
 */
describe('finished events leave the lane', () => {
  it('hides an event the moment it ends, keeping the running one', () => {
    show([
      event({ id: 'over', name: 'Yesterdays banner', start: NOW - 9 * DAY, end: NOW - DAY }),
      event({ id: 'live', name: 'Still running' }),
    ]);

    expect(screen.getByRole('button', row('Still running'))).toBeInTheDocument();
    expect(screen.queryByRole('button', row('Yesterdays banner'))).not.toBeInTheDocument();
  });

  it('counts ended and ticked-off events in the same pile', () => {
    show([
      event({ id: 'over', name: 'Ended', start: NOW - 9 * DAY, end: NOW - DAY }),
      event({ id: 'ticked', name: 'Ticked', done: true }),
      event({ id: 'live', name: 'Still running' }),
    ]);

    expect(screen.getByRole('button', { name: '+ 2 finished events' })).toBeInTheDocument();
  });

  it('brings them back on request rather than losing them', () => {
    show([
      event({ id: 'over', name: 'Yesterdays banner', start: NOW - 9 * DAY, end: NOW - DAY }),
      event({ id: 'live', name: 'Still running' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: '+ 1 finished event' }));

    expect(screen.getByRole('button', row('Yesterdays banner'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '− collapse finished events' })).toBeInTheDocument();
  });

  it('says so plainly when a lane has nothing running left', () => {
    show([event({ id: 'over', name: 'Yesterdays banner', start: NOW - 9 * DAY, end: NOW - DAY })]);

    expect(screen.getByText(/Nothing running/)).toBeInTheDocument();
    expect(screen.getByText(/1 finished event/)).toBeInTheDocument();
  });
});
