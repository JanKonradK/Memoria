import { fireEvent, render, screen } from '@testing-library/react';
import { emptyState, type Game, type GameEvent } from '@memoria/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { TimelinePage } from '../src/components/Timeline';
import { TooltipProvider } from '../src/components/ui';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';

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

function show(events: GameEvent[], gameOverrides: Partial<Game> = {}) {
  useApp.setState({ state: { ...emptyState(), games: [{ ...game, ...gameOverrides }], events } });
  // Event rows carry countdown tooltips, which the real app supplies at the root.
  return render(
    <TooltipProvider>
      <div id="app-bar-actions" />
      <TimelinePage now={NOW} />
    </TooltipProvider>,
  );
}

afterEach(() => {
  useApp.setState({ state: emptyState() });
  useUI.setState({ timelineView: null, timelineSearch: '', timelineShowFinished: false });
});

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

  it('shows ended and ticked-off events with the history control', () => {
    show([
      event({ id: 'over', name: 'Ended', start: NOW - 9 * DAY, end: NOW - DAY }),
      event({ id: 'ticked', name: 'Ticked', done: true }),
      event({ id: 'live', name: 'Still running' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Show finished events' }));
    expect(screen.getByRole('button', row('Ended'))).toBeInTheDocument();
    expect(screen.getByRole('button', row('Ticked'))).toBeInTheDocument();
  });

  it('brings them back on request rather than losing them', () => {
    show([
      event({ id: 'over', name: 'Yesterdays banner', start: NOW - 9 * DAY, end: NOW - DAY }),
      event({ id: 'live', name: 'Still running' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Show finished events' }));

    expect(screen.getByRole('button', row('Yesterdays banner'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show finished events' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Show finished events' }));
    expect(screen.queryByRole('button', row('Yesterdays banner'))).not.toBeInTheDocument();
  });

  it('says so plainly when a lane has nothing running left', () => {
    show([event({ id: 'over', name: 'Yesterdays banner', start: NOW - 9 * DAY, end: NOW - DAY })]);

    expect(screen.getByText(/Nothing running/)).toBeInTheDocument();
    expect(screen.getByText(/1 finished event/)).toBeInTheDocument();
  });

  it('counts only visible events in the current game scope and view', () => {
    const events = [
      event({ id: 'running', name: 'Running' }),
      event({ id: 'finished', name: 'Finished', done: true }),
      event({ id: 'far', name: 'Far ahead', start: NOW + 90 * DAY, end: NOW + 95 * DAY }),
      event({ id: 'other', gameId: 'other', name: 'Another account' }),
    ];
    show(events);
    expect(screen.getByText('1 event')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show finished events' }));
    expect(screen.getByText('2 events')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'List', exact: true }));
    expect(screen.getByText('3 events')).toBeInTheDocument();
  });

  it('exposes exact local event dates to keyboard and screen reader users in duration view', () => {
    show([event({ id: 'dated', name: 'Dated event' })]);
    const open = screen.getByRole('button', row('Dated event'));
    expect(open.getAttribute('aria-description')).toMatch(/Starts 22 Aug 2026 .*Ends 1 Sep 2026 .*Dates in/);
    expect(open.getAttribute('title')).toContain('Dated event. Starts');
  });

  it('keeps Genshin world sections in order while reordering and filtering their events', () => {
    const { container } = show(
      [
        event({ id: 'banner', name: 'Cosmetic draw', type: 'banner', category: 'miliastra', sort: 0 }),
        event({ id: 'mw-1', name: 'Wonderland first', category: 'miliastra', sort: 1 }),
        event({ id: 'teyvat-1', name: 'Teyvat first', sort: 2 }),
        event({ id: 'mw-2', name: 'Wonderland second', category: 'miliastra', sort: 3 }),
        event({ id: 'teyvat-2', name: 'Teyvat second', type: 'endgame', sort: 4 }),
        event({ id: 'finished', name: 'Finished Teyvat', done: true, sort: 5 }),
        event({ id: 'other', name: 'Another account', gameId: 'other', sort: 6 }),
      ],
      { presetKey: 'genshin' },
    );
    const sections = () =>
      [...container.querySelectorAll('[data-timeline-event-group]')].map((section) => ({
        key: section.getAttribute('data-timeline-event-group'),
        ids: [...section.querySelectorAll('[data-event-id]')].map((item) => item.getAttribute('data-event-id')),
      }));
    expect(sections()).toEqual([
      { key: 'teyvat', ids: ['teyvat-1', 'teyvat-2'] },
      { key: 'miliastra', ids: ['mw-1', 'mw-2'] },
      { key: 'banners', ids: ['banner'] },
    ]);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Wonderland first' }), { key: 'ArrowUp' });
    expect(sections()[1].ids).toEqual(['mw-1', 'mw-2']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Wonderland second' }), { key: 'ArrowUp' });
    expect(sections()[1].ids).toEqual(['mw-2', 'mw-1']);
    expect(sections()[0].ids).toEqual(['teyvat-1', 'teyvat-2']);
    fireEvent.click(screen.getByRole('button', { name: 'Show finished events' }));
    expect(sections()[0].ids).toEqual(['teyvat-1', 'teyvat-2', 'finished']);
    fireEvent.click(screen.getByRole('button', { name: 'Find events' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search events' }), { target: { value: 'Wonderland' } });
    expect(sections()).toEqual([{ key: 'miliastra', ids: ['mw-2', 'mw-1'] }]);
  });
});
