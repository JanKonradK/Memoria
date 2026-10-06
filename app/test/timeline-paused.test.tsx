import { act, fireEvent, render, screen } from '@testing-library/react';
import { emptyState, type AppState } from '@memoria/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeEvent, makeGame } from '../../shared/test/helpers';
import { TimelinePage } from '../src/components/Timeline';
import { TimelineList } from '../src/components/TimelineList';
import { TooltipProvider } from '../src/components/ui';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';

const NOW = Date.UTC(2026, 9, 3, 12);
const DAY = 86_400_000;
const active = makeGame({ id: 'active', name: 'Shared game', accountLabel: 'Main', updatedAt: NOW });
const paused = makeGame({ ...active, id: 'paused', accountLabel: 'Alt', paused: true, sort: 1 });
const deleted = makeGame({ ...active, id: 'deleted', deleted: true, sort: 2 });
const events = [
  makeEvent({ id: 'live', gameId: active.id, name: 'Main event', start: NOW - DAY, end: NOW + DAY }),
  makeEvent({ id: 'secret-live', gameId: paused.id, name: 'Secret current', start: NOW - DAY, end: NOW + DAY }),
  makeEvent({
    id: 'secret-upcoming',
    gameId: paused.id,
    name: 'Secret upcoming',
    start: NOW + DAY,
    end: NOW + 2 * DAY,
  }),
  makeEvent({
    id: 'secret-finished',
    gameId: paused.id,
    name: 'Secret finished',
    start: NOW - 2 * DAY,
    end: NOW - DAY,
  }),
  makeEvent({
    id: 'deleted-event',
    gameId: deleted.id,
    name: 'Deleted account event',
    start: NOW - DAY,
    end: NOW + DAY,
  }),
];
const fixture: AppState = { ...emptyState(), games: [active, paused, deleted], events };

function show(view: 'lanes' | 'list', options: { focus?: string; search?: string; finished?: boolean } = {}) {
  useApp.setState({ state: structuredClone(fixture) });
  useUI.setState({
    focusedGameId: options.focus ?? null,
    timelineView: view,
    timelineSearch: options.search ?? '',
    timelineShowFinished: options.finished ?? false,
  });
  return render(
    <TooltipProvider>
      <div id="app-bar-actions" />
      <TimelinePage now={NOW} />
    </TooltipProvider>,
  );
}

afterEach(() => {
  useApp.setState({ state: emptyState() });
  useUI.setState({ focusedGameId: null, timelineView: null, timelineSearch: '', timelineShowFinished: false });
});

describe.each(['lanes', 'list'] as const)('paused games in %s', (view) => {
  it('keeps a compact account row and excludes all its events and counts', () => {
    const { container } = show(view);
    expect(screen.getByText('1 event')).toBeInTheDocument();
    expect(container.querySelector('[data-paused-game="paused"]')).toBeInTheDocument();
    expect(screen.queryByText('Secret current')).not.toBeInTheDocument();
    expect(screen.queryByText('Secret upcoming')).not.toBeInTheDocument();
    expect(screen.queryByText('Secret finished')).not.toBeInTheDocument();
    expect(screen.queryByText('Deleted account event')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Expand Shared game.*Alt/ })).not.toBeInTheDocument();
    expect(useApp.getState().state.events).toEqual(events);
  });

  it('does not reveal paused events through search or finished-event controls', () => {
    const { container } = show(view, { search: 'Secret', finished: true });
    expect(container.querySelector('.timeline-caption')).toHaveTextContent('0 events');
    expect(container.querySelectorAll('[data-event-id], [data-list-event]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Resume tracking for Shared game, Alt/ })).toBeInTheDocument();
  });

  it('restores saved events on resume without changing the other account or saved records', () => {
    const { container } = show(view, { finished: true });
    fireEvent.click(screen.getByRole('button', { name: /Resume tracking for Shared game, Alt/ }));
    expect(container.querySelector('[data-paused-game="paused"]')).not.toBeInTheDocument();
    expect(screen.getByText('4 events')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-event-id], [data-list-event]')).toHaveLength(4);
    expect(useApp.getState().state.games.find((game) => game.id === active.id)?.paused).toBe(false);
    expect(useApp.getState().state.events).toEqual(events);
    act(() => useApp.getState().updateGame(paused.id, { paused: true }));
    expect(screen.getByText('1 event')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-event-id], [data-list-event]')).toHaveLength(1);
  });

  it('keeps a paused game focus without showing another account or an add-event empty state', () => {
    const { container } = show(view, { focus: paused.id });
    expect(screen.getByText('0 events')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-paused-game]')).toHaveLength(1);
    expect(screen.queryByText('Main')).not.toBeInTheDocument();
    expect(screen.queryByText(/Use Add → Event/)).not.toBeInTheDocument();
  });
});

it('the list excludes paused accounts even when a caller supplies their events', () => {
  const { container } = render(
    <TimelineList
      games={[paused]}
      events={events}
      now={NOW}
      localTz="Europe/London"
      showFinished
      onOpenEvent={vi.fn()}
      onToggleEvent={vi.fn()}
    />,
  );
  expect(container.querySelectorAll('[data-list-event]')).toHaveLength(0);
  expect(screen.getByText('Events are hidden while tracking is paused.')).toBeInTheDocument();
});
