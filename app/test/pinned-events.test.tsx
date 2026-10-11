import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Game, GameEvent } from '@memoria/shared';
import { beforeEach, expect, it } from 'vitest';
import { makeEvent, makeGame } from '../../shared/test/helpers';
import { PinnedEvents, pinnedEventsNeedingYou } from '../src/components/PinnedEvents';
import { useUI } from '../src/ui-store';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 8, 12);
const game: Game = makeGame({ id: 'testland', name: 'Testland', short: 'TL' });
const pausedGame: Game = makeGame({ id: 'paused', name: 'Paused game', short: 'PG', paused: true });
const deletedGame: Game = makeGame({ id: 'gone', name: 'Gone game', short: 'GG', deleted: true });

/** A pinned event running now unless the patch moves it. */
function event(name: string, patch: Partial<GameEvent> = {}): GameEvent {
  return makeEvent({
    id: name,
    gameId: game.id,
    name,
    type: 'event',
    start: NOW - HOUR,
    end: NOW + HOUR,
    pinned: true,
    ...patch,
  });
}

/** Opens the quick view the way the Calendar's bars do. */
const openPeek = (item: GameEvent) => useUI.getState().openSheet({ kind: 'eventPeek', eventId: item.id });

function strip(events: GameEvent[], games: Game[] = [game]) {
  return render(<PinnedEvents events={events} games={games} now={NOW} onOpen={openPeek} />);
}

const chipNames = () =>
  screen
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'))
    .filter((label) => label?.startsWith('Open pinned'));

beforeEach(() => useUI.setState({ sheet: null }));

it('renders nothing when no event is pinned, not even an empty heading', () => {
  const { container } = strip([event('Plain', { pinned: false })]);
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByRole('region', { name: 'Pinned events' })).toBeNull();
});

it('lists running events by deadline first, then upcoming ones by arrival', () => {
  strip([
    event('Ends late', { end: NOW + 5 * HOUR }),
    event('Arrives later', { start: NOW + 2 * HOUR, end: NOW + 3 * HOUR }),
    event('Ends soon', { end: NOW + HOUR }),
    event('Arrives first', { start: NOW + HOUR, end: NOW + 4 * HOUR }),
  ]);
  expect(chipNames()).toEqual([
    'Open pinned Testland event: Ends soon',
    'Open pinned Testland event: Ends late',
    'Open pinned Testland event: Arrives first',
    'Open pinned Testland event: Arrives later',
  ]);
  const region = screen.getByRole('region', { name: 'Pinned events' });
  const upcoming = within(region).getByRole('button', { name: 'Open pinned Testland event: Arrives first' });
  expect(upcoming).toHaveTextContent('in 1h 00m');
  const running = within(region).getByRole('button', { name: 'Open pinned Testland event: Ends soon' });
  expect(running).toHaveTextContent('1h 00m');
  expect(running).not.toHaveTextContent('in 1h');
});

it('leaves out done, deleted, ended, unpinned, paused-game and deleted-game events', () => {
  strip(
    [
      event('Kept'),
      event('Done', { done: true }),
      event('Deleted', { deleted: true }),
      event('Ended', { end: NOW }),
      event('Unpinned', { pinned: false }),
      event('Paused game event', { gameId: pausedGame.id }),
      event('Deleted game event', { gameId: deletedGame.id }),
    ],
    [game, pausedGame, deletedGame],
  );
  expect(chipNames()).toEqual(['Open pinned Testland event: Kept']);
});

it('shows how many events are pinned', () => {
  strip([event('First'), event('Second', { end: NOW + 2 * HOUR })]);
  const region = screen.getByRole('region', { name: 'Pinned events' });
  expect(within(region).getByRole('heading', { name: 'Pinned' })).toBeInTheDocument();
  expect(within(region).getByText('2')).toBeInTheDocument();
});

it('opens the quick view of the event a chip names', () => {
  strip([event('Story')]);
  fireEvent.click(screen.getByRole('button', { name: 'Open pinned Testland event: Story' }));
  expect(useUI.getState().sheet).toEqual({ kind: 'eventPeek', eventId: 'Story' });
});

it('selects by the same rules without rendering, so the page can share them', () => {
  const picked = pinnedEventsNeedingYou(
    [event('Upcoming', { start: NOW + HOUR, end: NOW + 2 * HOUR }), event('Running')],
    [game],
    NOW,
  );
  expect(picked.map((item) => item.name)).toEqual(['Running', 'Upcoming']);
});
