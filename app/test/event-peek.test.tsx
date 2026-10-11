import type { ReactElement } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { emptyState, type Game, type GameEvent } from '@memoria/shared';
import { beforeEach, expect, it } from 'vitest';
import { makeEvent, makeGame } from '../../shared/test/helpers';
import { EventPeek } from '../src/components/EventPeek';
import { EventStrip } from '../src/components/GameCard';
import { TooltipProvider } from '../src/components/ui';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';

const DAY = 86_400_000;
const game: Game = makeGame({ id: 'test-game', name: 'Testland' });

const show = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

/** An event running now. The quick view reads the real clock, so the window straddles it. */
function event(name: string, patch: Partial<GameEvent> = {}): GameEvent {
  const now = Date.now();
  return makeEvent({ id: name, gameId: game.id, name, type: 'event', start: now - DAY, end: now + DAY, ...patch });
}

const stored = (name: string) => useApp.getState().state.events.find((item) => item.name === name)!;
const seed = (events: GameEvent[]) =>
  useApp.setState({ state: { ...emptyState(), games: [game], events }, loaded: true });

beforeEach(() => useUI.setState({ sheet: null }));

it('names the event and its game, and offers done, pin and edit without the editor', () => {
  seed([event('Story', { notes: 'Bring the new character.' })]);
  show(<EventPeek open eventId="Story" />);
  const dialog = screen.getByRole('dialog', { name: 'Story' });
  expect(within(dialog).getByText('Testland')).toBeInTheDocument();
  expect(within(dialog).getByText('Bring the new character.')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Mark done' })).toHaveAttribute('aria-pressed', 'false');
  expect(within(dialog).getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'false');
  // No form fields: this is not the editor.
  expect(within(dialog).queryByRole('textbox')).toBeNull();
});

it('marks an event done and takes it back', () => {
  seed([event('Story')]);
  show(<EventPeek open eventId="Story" />);
  fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
  expect(stored('Story').done).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Done — undo' }));
  expect(stored('Story').done).toBe(false);
});

it('pins and unpins an event', () => {
  seed([event('Story')]);
  show(<EventPeek open eventId="Story" />);
  fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
  expect(stored('Story').pinned).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Pinned' }));
  expect(stored('Story').pinned).toBe(false);
});

it('ticks parts in the quick view and finishes the event with the last one', () => {
  seed([event('Story', { parts: 3 })]);
  show(<EventPeek open eventId="Story" />);
  const part = (index: number) =>
    within(screen.getByRole('group', { name: /parts done$/ })).getAllByRole('button')[index]!;
  fireEvent.click(part(1));
  expect(stored('Story')).toMatchObject({ partsDone: 2, done: false });
  fireEvent.click(part(2));
  expect(stored('Story')).toMatchObject({ partsDone: 3, done: true });
});

it('hands over to the editor from Edit', () => {
  seed([event('Story')]);
  show(<EventPeek open eventId="Story" />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(useUI.getState().sheet).toEqual({ kind: 'event', eventId: 'Story', gameId: game.id });
});

it('says so when the event has gone', () => {
  seed([]);
  show(<EventPeek open eventId="Missing" />);
  expect(screen.getByText('This event is no longer available.')).toBeInTheDocument();
});

it('lists a pinned event first on a game page, ahead of ones that end sooner', () => {
  const now = Date.now();
  const events = [event('Ends first', { end: now + DAY }), event('Pinned later', { end: now + 5 * DAY, pinned: true })];
  show(
    <EventStrip
      game={game}
      events={events}
      now={now}
      onOpenEvent={() => {}}
      onToggleDone={() => {}}
      onSetParts={() => {}}
    />,
  );
  const ticks = screen.getAllByRole('checkbox').map((node) => node.getAttribute('aria-label'));
  expect(ticks).toEqual(['Pinned later: done', 'Ends first: done']);
});
