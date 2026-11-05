import type { ReactElement, ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { emptyState, type Game, type GameEvent, type GameUrgency } from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEvent, makeGame, makeResource, makeTask } from '../../shared/test/helpers';
import { EventStrip, GameControlsView, type GameControlActions } from '../src/components/GameCard';
import { TodayPage } from '../src/components/Today';
import { TooltipProvider } from '../src/components/ui';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';

const NOW = Date.UTC(2026, 9, 6, 12);
const DAY = 86_400_000;
const game: Game = makeGame({ id: 'test-game', name: 'Testland' });

/** Rendered tooltips need the provider that the app mounts once at the root. */
const show = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

/** An event running now, so it is listed. */
function event(id: string, patch: Partial<GameEvent> = {}): GameEvent {
  return makeEvent({
    id,
    gameId: game.id,
    name: id,
    type: 'event',
    start: NOW - DAY,
    end: NOW + DAY,
    ...patch,
  });
}

function roster(events: GameEvent[] = []) {
  return {
    ...emptyState(),
    games: [game],
    events,
    resources: [makeResource({ id: 'energy', gameId: game.id, name: 'Energy', kind: 'regen' })],
    tasks: [makeTask({ id: 'dailies', gameId: game.id, name: 'Dailies' })],
  };
}

function controls(): GameControlActions {
  const store = useApp.getState();
  return {
    setTaskDone: store.setTaskDone,
    restartTaskTimer: store.restartTaskTimer,
    advanceTaskTimer: store.advanceTaskTimer,
    setTaskCount: store.setTaskCount,
    setEnergy: store.setEnergy,
    adjustEnergy: store.adjustEnergy,
  };
}

/** Reads the store on every render, as GamePage does, so a store change reaches the view. */
function GamePageControls({ layout, actionsEnd }: { layout?: 'card' | 'focus'; actionsEnd?: ReactNode }) {
  const state = useApp((store) => store.state);
  const entry: GameUrgency = { game, next: null, actions: [] };
  return (
    <GameControlsView
      entry={entry}
      state={state}
      actions={controls()}
      now={NOW}
      layout={layout}
      onOpenEvent={() => {}}
      actionsEnd={actionsEnd}
    />
  );
}

function strip(events: GameEvent[], props: Partial<Parameters<typeof EventStrip>[0]> = {}) {
  return show(<EventStrip game={game} events={events} now={NOW} onOpenEvent={() => {}} {...props} />);
}

beforeEach(() => {
  useUI.setState({ tab: 'today', sheet: null, focusedGameId: null, todayGameId: null });
});

afterEach(() => {
  useApp.setState({ state: emptyState() });
  useUI.setState({ tab: 'today', sheet: null, focusedGameId: null, todayGameId: null });
});

describe('game page event list', () => {
  it('hides finished events from a card summary and keeps each row a single button', () => {
    strip([event('Open window'), event('Finished window', { done: true })]);
    expect(screen.queryByText('Finished window')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('lists finished events with a tick on the game page, struck through and checked', () => {
    strip([event('Open window'), event('Finished window', { done: true })], { onSetProgress: vi.fn() });
    expect(screen.getByRole('button', { name: /Finished window/ })).toBeInTheDocument();
    expect(screen.getByText('Finished window')).toHaveClass('line-through');
    expect(screen.getByRole('checkbox', { name: 'Finished window: done' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Open window: done' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Open window')).not.toHaveClass('line-through');
  });

  it('orders unfinished events before finished ones within a section', () => {
    // The finished event ends first, so end time alone would put it at the top.
    strip(
      [
        event('Finished first', { done: true, end: NOW + DAY }),
        event('Open later', { end: NOW + 5 * DAY }),
        event('Open sooner', { end: NOW + 2 * DAY }),
      ],
      { onSetProgress: vi.fn() },
    );
    expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))).toEqual([
      'Open sooner: done',
      'Open later: done',
      'Finished first: done',
    ]);
  });

  it('reports the next state when a tick is pressed: partly done, then not started after done', () => {
    const onSetProgress = vi.fn();
    strip([event('Open window'), event('Finished window', { done: true })], { onSetProgress });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Open window: done' }));
    expect(onSetProgress).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'Open window' }), 'partial');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Finished window: done' }));
    expect(onSetProgress).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'Finished window' }), 'none');
  });

  it('says the empty label in place of the list when nothing is running or coming up', () => {
    strip([], { onSetProgress: vi.fn(), emptyLabel: 'No events running or coming up.' });
    expect(screen.getByText('No events running or coming up.')).toBeInTheDocument();
  });

  it('renders nothing for an empty list when no empty label is given', () => {
    const { container } = strip([], { onSetProgress: vi.fn() });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('game page controls', () => {
  it('lays out resources and tasks in one column and the events in the other on the game page', () => {
    useApp.setState({ state: roster([event('Open window')]) });
    const { container } = show(<GamePageControls layout="focus" />);
    const grid = container.querySelector<HTMLElement>('.focus-bay-grid');
    expect(grid).not.toBeNull();
    expect(grid!.children).toHaveLength(2);
    const [left, right] = Array.from(grid!.children) as HTMLElement[];
    const resources = left!.querySelector('[data-tour="resources"]');
    const tasks = left!.querySelector('[data-tour="tasks"]');
    expect(resources).not.toBeNull();
    expect(tasks).not.toBeNull();
    expect(resources!.compareDocumentPosition(tasks!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(right!).getByRole('region', { name: 'Windows events for Testland' })).toBeInTheDocument();
    expect(within(left!).queryByRole('region', { name: /events for/ })).not.toBeInTheDocument();
  });

  it('steps an event through partly done and done in the store, then takes it back', () => {
    useApp.setState({ state: roster([event('Open window')]) });
    show(<GamePageControls layout="focus" />);
    const eventDone = () => useApp.getState().state.events.find((item) => item.id === 'Open window')?.done;
    const tick = () => screen.getByRole('checkbox', { name: 'Open window: done' });

    fireEvent.click(tick());
    expect(eventDone()).toBe(false);
    expect(tick()).toHaveAttribute('aria-checked', 'mixed');

    fireEvent.click(tick());
    expect(eventDone()).toBe(true);
    expect(tick()).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(tick());
    expect(eventDone()).toBe(false);
    expect(tick()).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps the game actions in the heading, above the grid, with the extra control last', () => {
    useApp.setState({ state: roster([event('Open window')]) });
    const { container } = show(
      <GamePageControls layout="focus" actionsEnd={<button type="button">Open full page</button>} />,
    );
    const bar = screen.getByLabelText('Testland tracking controls');
    const grid = container.querySelector('.focus-bay-grid');
    expect(bar.closest('.game-card-heading')).not.toBeNull();
    expect(bar.compareDocumentPosition(grid!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Layout and events share one Edit menu.
    expect(within(bar).getByRole('button', { name: 'Edit Testland', exact: true })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    );
    expect(within(bar).queryByRole('button', { name: 'Manage events', exact: true })).toBeNull();
    // One way to add an event (the Add menu), and pausing lives under Edit.
    for (const name of ['Add event', 'Pause tracking', 'Readings', 'Set up launch']) {
      expect(screen.queryByRole('button', { name, exact: true })).toBeNull();
    }
    expect(within(bar).getAllByRole('button').at(-1)).toHaveTextContent('Open full page');
  });

  it('uses the same heading actions in the card layout', () => {
    useApp.setState({ state: roster([event('Open window')]) });
    const { container } = show(<GamePageControls />);
    const bar = screen.getByLabelText('Testland tracking controls');
    expect(bar.closest('.game-card-heading')).not.toBeNull();
    expect(container.querySelector('.focus-bay-grid')).toBeNull();
    const resources = container.querySelector('[data-tour="resources"]');
    expect(resources).not.toBeNull();
    expect(bar.compareDocumentPosition(resources!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("Today's selected game", () => {
  it('gives the selected game an Open full page button in its heading', () => {
    useApp.setState({ state: roster(), loaded: true });
    show(<TodayPage now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review Testland', exact: true }));
    const bar = screen.getByLabelText('Testland tracking controls');
    expect(bar.closest('.game-card-heading')).not.toBeNull();
    expect(within(bar).getByRole('button', { name: 'Open full page', exact: true })).toBeInTheDocument();
    expect(within(bar).getAllByRole('button').at(-1)).toHaveTextContent('Open full page');
  });
});
