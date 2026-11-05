import type { ReactElement } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { emptyState, type Game, type GameEvent, type GameUrgency } from '@memoria/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { makeEvent, makeGame } from '../../shared/test/helpers';
import { EventSheet } from '../src/components/EventSheet';
import { EventStrip, GameControlsView, type GameControlActions } from '../src/components/GameCard';
import { TooltipProvider } from '../src/components/ui';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';

const NOW = Date.UTC(2026, 9, 6, 12);
const DAY = 86_400_000;
const game: Game = makeGame({ id: 'test-game', name: 'Testland' });

const show = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

/** An event running now, so it is listed. */
function event(name: string, patch: Partial<GameEvent> = {}): GameEvent {
  return makeEvent({ id: name, gameId: game.id, name, type: 'event', start: NOW - DAY, end: NOW + DAY, ...patch });
}

const tick = (name: string) => screen.getByRole('checkbox', { name: `${name}: done` });

function strip(events: GameEvent[], onSetProgress = vi.fn()) {
  show(<EventStrip game={game} events={events} now={NOW} onOpenEvent={() => {}} onSetProgress={onSetProgress} />);
  return { onSetProgress };
}

/** Reads the store on every render, as the game page does. */
function Page() {
  const state = useApp((store) => store.state);
  const store = useApp.getState();
  const actions: GameControlActions = {
    setTaskDone: store.setTaskDone,
    restartTaskTimer: store.restartTaskTimer,
    advanceTaskTimer: store.advanceTaskTimer,
    setTaskCount: store.setTaskCount,
    setEnergy: store.setEnergy,
    adjustEnergy: store.adjustEnergy,
  };
  const entry: GameUrgency = { game, next: null, actions: [] };
  return (
    <GameControlsView entry={entry} state={state} actions={actions} now={NOW} layout="focus" onOpenEvent={() => {}} />
  );
}

const stored = (name: string) => useApp.getState().state.events.find((item) => item.name === name)!;

beforeEach(() => {
  useApp.setState({ state: { ...emptyState(), games: [game] }, loaded: true });
  useUI.setState({ sheet: null });
});

it('gives every event one tick, with no per-part segments, whatever its text says', () => {
  strip([event('Anniversary login rewards — 7-day login'), event('Story', { parts: 4, partsDone: 2 })]);
  expect(screen.queryByRole('group')).toBeNull();
  expect(tick('Anniversary login rewards — 7-day login')).toHaveAttribute('aria-checked', 'false');
  // An old part tally short of done reads as partly done.
  expect(tick('Story')).toHaveAttribute('aria-checked', 'mixed');
});

it('asks for the next state when the tick is pressed', () => {
  const { onSetProgress } = strip([event('Fresh'), event('Half', { partsDone: 1 }), event('Finished', { done: true })]);
  fireEvent.click(tick('Fresh'));
  expect(onSetProgress).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Fresh' }), 'partial');
  fireEvent.click(tick('Half'));
  expect(onSetProgress).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Half' }), 'done');
  fireEvent.click(tick('Finished'));
  expect(onSetProgress).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Finished' }), 'none');
});

it('cycles an event through partly done, done and back in the store', () => {
  useApp.setState({ state: { ...emptyState(), games: [game], events: [event('Story', { parts: 3 })] } });
  show(<Page />);
  fireEvent.click(tick('Story'));
  expect(stored('Story')).toMatchObject({ partsDone: 1, done: false });
  expect(stored('Story').parts).toBeUndefined();
  expect(tick('Story')).toHaveAttribute('aria-checked', 'mixed');
  fireEvent.click(tick('Story'));
  expect(stored('Story')).toMatchObject({ partsDone: 2, done: true });
  expect(tick('Story')).toBeChecked();
  fireEvent.click(tick('Story'));
  expect(stored('Story')).toMatchObject({ partsDone: 0, done: false });
});

it('sets the status from the editor', () => {
  useApp.setState({ state: { ...emptyState(), games: [game], events: [event('Story', { parts: 3, partsDone: 2 })] } });
  useUI.setState({ sheet: { kind: 'event', gameId: game.id, eventId: 'Story' } });
  show(<EventSheet open gameId={game.id} eventId="Story" />);
  expect(screen.queryByRole('spinbutton', { name: 'Parts' })).toBeNull();
  const status = screen.getByRole('radiogroup', { name: 'Status' });
  expect(within(status).getByRole('radio', { name: 'Partly done' })).toBeChecked();
  fireEvent.click(within(status).getByRole('radio', { name: 'Done' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  expect(stored('Story')).toMatchObject({ partsDone: 2, done: true });
  expect(stored('Story').parts).toBeUndefined();
});
