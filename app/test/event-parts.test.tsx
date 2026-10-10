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

const parts = (name: string) => screen.getByRole('group', { name: new RegExp(`^${name}: \\d+ of \\d+ parts done$`) });
const pressed = (name: string) =>
  within(parts(name))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-pressed'));

function strip(events: GameEvent[], onSetParts = vi.fn(), onToggleDone = vi.fn()) {
  show(
    <EventStrip
      game={game}
      events={events}
      now={NOW}
      onOpenEvent={() => {}}
      onToggleDone={onToggleDone}
      onSetParts={onSetParts}
    />,
  );
  return { onSetParts, onToggleDone };
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

it('shows one segment per part, with the ticked ones first', () => {
  strip([event('Story', { parts: 4, partsDone: 2 })]);
  expect(parts('Story')).toHaveAccessibleName('Story: 2 of 4 parts done');
  expect(pressed('Story')).toEqual(['true', 'true', 'false', 'false']);
});

it('leaves a one-part event with only its tick', () => {
  strip([event('Plain')]);
  expect(screen.queryByRole('group')).toBeNull();
  expect(screen.getByRole('checkbox', { name: 'Plain: done' })).toBeInTheDocument();
});

it('infers seven parts for a login event that states none', () => {
  strip([event('Anniversary login rewards')]);
  expect(pressed('Anniversary login rewards')).toHaveLength(7);
});

it('ticks up to the chosen part and unticks the last ticked part', () => {
  const { onSetParts } = strip([event('Story', { parts: 4, partsDone: 2 })]);
  const buttons = within(parts('Story')).getAllByRole('button');
  fireEvent.click(buttons[3]!);
  expect(onSetParts).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Story' }), 4);
  fireEvent.click(buttons[1]!);
  expect(onSetParts).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Story' }), 1);
  fireEvent.click(buttons[0]!);
  expect(onSetParts).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Story' }), 1);
});

it('marks the event done with its last part and reopens it when that part is unticked', () => {
  useApp.setState({ state: { ...emptyState(), games: [game], events: [event('Story', { parts: 3 })] } });
  show(<Page />);
  const part = (index: number) => within(parts('Story')).getAllByRole('button')[index]!;
  fireEvent.click(part(1));
  expect(stored('Story')).toMatchObject({ partsDone: 2, done: false });
  fireEvent.click(part(2));
  expect(stored('Story')).toMatchObject({ partsDone: 3, done: true });
  expect(screen.getByRole('checkbox', { name: 'Story: done' })).toBeChecked();
  fireEvent.click(part(2));
  expect(stored('Story')).toMatchObject({ partsDone: 2, done: false });
});

it('ticks every part from the tick and clears them from it again', () => {
  useApp.setState({ state: { ...emptyState(), games: [game], events: [event('Story', { parts: 3, partsDone: 1 })] } });
  show(<Page />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Story: done' }));
  expect(stored('Story')).toMatchObject({ partsDone: 3, done: true });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Story: done' }));
  expect(stored('Story')).toMatchObject({ partsDone: 0, done: false });
});

it('saves a stated part count from the editor and keeps the parts already ticked', () => {
  useApp.setState({ state: { ...emptyState(), games: [game], events: [event('Story', { parts: 3, partsDone: 2 })] } });
  useUI.setState({ sheet: { kind: 'event', gameId: game.id, eventId: 'Story' } });
  show(<EventSheet open gameId={game.id} eventId="Story" />);
  const field = screen.getByRole('spinbutton', { name: 'Parts' });
  expect(field).toHaveValue(3);
  fireEvent.change(field, { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  expect(stored('Story')).toMatchObject({ parts: 6, partsDone: 2, done: false });
});

it('returns an event to the inferred count when the field is cleared', () => {
  useApp.setState({
    state: { ...emptyState(), games: [game], events: [event('Anniversary login rewards', { parts: 3 })] },
  });
  show(<EventSheet open gameId={game.id} eventId="Anniversary login rewards" />);
  const field = screen.getByRole('spinbutton', { name: 'Parts' });
  expect(field).toHaveAttribute('placeholder', 'Automatic (7)');
  fireEvent.change(field, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  expect(stored('Anniversary login rewards').parts).toBeUndefined();
});
