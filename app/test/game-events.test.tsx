import { fireEvent, render, screen, within } from '@testing-library/react';
import { emptyState, type Game, type GameEvent } from '@memoria/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEvents } from '../src/components/GameEvents';
import { EventStrip, GameControls } from '../src/components/GameCard';
import { MobileRoster } from '../src/components/MobileRoster';
import { GameEditor } from '../src/components/settings/GameEditor';
import { TooltipProvider } from '../src/components/ui';
import { useDerived } from '../src/selectors';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';

const NOW = Date.UTC(2026, 9, 3, 12);
const DAY = 86_400_000;
const game: Game = {
  id: 'main',
  name: 'My game',
  short: 'MG',
  color: '#8b5cf6',
  icon: '',
  platform: 'both',
  tz: 'Etc/UTC',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort: 0,
  updatedAt: 1,
};
function event(id: string, patch: Partial<GameEvent> = {}): GameEvent {
  return {
    id,
    gameId: game.id,
    name: id,
    type: 'event',
    start: NOW - DAY,
    end: NOW + DAY,
    dailyTouch: false,
    notify: true,
    updatedAt: 1,
    ...patch,
  };
}
function load(events: GameEvent[] = [], patch: Partial<Game> = {}) {
  useApp.setState({
    state: {
      ...emptyState(),
      games: [
        { ...game, ...patch },
        { ...game, id: 'alt', sort: 1 },
      ],
      events,
    },
  });
  useUI.setState({ sheet: null, focusedGameId: null });
}
function Controls() {
  const { entryById } = useDerived(NOW);
  const entry = entryById.get(game.id);
  if (!entry) return null;
  return (
    <TooltipProvider>
      <GameControls entry={entry} now={NOW} />
    </TooltipProvider>
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  useApp.setState({ state: emptyState() });
  useUI.setState({ sheet: null, focusedGameId: null });
});

describe('game event management', () => {
  it('keeps the same Genshin world order when searching or changing status', () => {
    const genshin = { ...game, presetKey: 'genshin' };
    load(
      [
        event('Test cosmetic', { category: 'miliastra', type: 'banner', sort: 0 }),
        event('Test Wonderland', { category: 'miliastra', sort: 1 }),
        event('Test Teyvat', { sort: 2 }),
        event('Finished Wonderland', { category: 'miliastra', done: true }),
      ],
      genshin,
    );
    render(<GameEvents game={genshin} now={NOW} />);
    expect(screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual([
      'Teyvat',
      'Miliastra Wonderland',
      'Banners',
    ]);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find event' }), { target: { value: 'Wonderland' } });
    expect(screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual([
      'Miliastra Wonderland',
    ]);
    fireEvent.click(screen.getByRole('radio', { name: 'Finished (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit My game event: Finished Wonderland' }));
    expect(useUI.getState().sheet).toEqual({ kind: 'event', gameId: game.id, eventId: 'Finished Wonderland' });
  });

  it('includes events with next actions off, and exposes done and ended events without leaking another account', () => {
    load(
      [
        event('Silent', { notify: false }),
        event('Done', { done: true }),
        event('Ended', { end: NOW - 1 }),
        event('Other account', { gameId: 'alt' }),
        event('Deleted', { deleted: true }),
      ],
      { cardLayout: [{ id: 'events', hidden: true }] },
    );
    render(<GameEvents game={game} now={NOW} />);
    expect(screen.getByRole('button', { name: 'Edit My game event: Silent' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Other account|Deleted|event: Done|event: Ended/ })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Finished (2)' }));
    expect(screen.getByRole('button', { name: 'Edit My game event: Done' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit My game event: Ended' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit My game event: Done' }));
    expect(useUI.getState().sheet).toEqual({ kind: 'event', gameId: game.id, eventId: 'Done' });
  });

  it('opens the full editor and scopes new events from normal controls and Edit layout', () => {
    load([event('Personal window')]);
    render(<Controls />);
    const controls = screen.getByLabelText('My game tracking controls');
    fireEvent.click(within(controls).getByRole('button', { name: 'Add event' }));
    expect(useUI.getState().sheet).toEqual({ kind: 'event', gameId: game.id });
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit My game', exact: true }).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: 'Manage events' }));
    const panel = screen.getByRole('region', { name: 'Events for My game' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit My game event: Personal window' }));
    expect(useUI.getState().sheet).toEqual({ kind: 'event', gameId: game.id, eventId: 'Personal window' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add event' }));
    expect(useUI.getState().sheet).toEqual({ kind: 'event', gameId: game.id });
  });

  it('keeps event management available in game settings', () => {
    // GameEditor reads the clock itself; keep it on the fixture's active day.
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    load([event('Personal window')]);
    render(<GameEditor game={game} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Events', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit My game event: Personal window' }));
    expect(useUI.getState().sheet).toEqual({ kind: 'event', gameId: game.id, eventId: 'Personal window' });
  });
});

describe('Genshin card event sections', () => {
  it('shows every active window with Teyvat first, Wonderland next and all banners last', () => {
    const genshin = { ...game, presetKey: 'genshin' };
    const rows = [
      event('Cosmetic draw', { type: 'banner', category: 'miliastra', bannerKind: 'other', end: NOW + 1 }),
      event('Character wish', { type: 'banner', bannerKind: 'character', end: NOW + 2 }),
      event('Wonderland gameplay', { category: 'miliastra', end: NOW + 3 }),
      ...Array.from({ length: 6 }, (_, index) => event(`Teyvat ${index}`, { end: NOW + index + 10 })),
      event('Owner moved', { sourceKey: 'genshin:21899', category: 'teyvat' }),
      event('Other account', { gameId: 'alt' }),
      event('Done', { done: true }),
      event('Deleted', { deleted: true }),
      event('Ended', { end: NOW - 1 }),
    ];
    const open: string[] = [];
    render(
      <TooltipProvider>
        <EventStrip game={genshin} events={rows} now={NOW} onOpenEvent={(id) => open.push(id)} />
      </TooltipProvider>,
    );
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual([
      'Teyvat events for My game',
      'Miliastra Wonderland events for My game',
      'Banners events for My game',
    ]);
    const teyvat = screen.getByRole('region', { name: 'Teyvat events for My game' });
    expect(within(teyvat).getAllByRole('button')).toHaveLength(7);
    expect(within(teyvat).getByRole('button', { name: /Owner moved/ })).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Banners events for My game' })).getAllByRole('button'),
    ).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Other account|Done|Deleted|Ended/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Cosmetic draw/ }));
    expect(open).toEqual(['Cosmetic draw']);
  });

  it('shows the next upcoming window in each section', () => {
    const rows = [
      event('Next Teyvat', { start: NOW + DAY, end: NOW + 3 * DAY }),
      event('Later Teyvat', { start: NOW + 2 * DAY, end: NOW + 4 * DAY }),
      event('Next Wonderland', { category: 'miliastra', start: NOW + DAY, end: NOW + 3 * DAY }),
      event('Next wish', { type: 'banner', start: NOW + DAY, end: NOW + 3 * DAY }),
    ];
    render(
      <TooltipProvider>
        <EventStrip game={{ ...game, presetKey: 'genshin' }} events={rows} now={NOW} onOpenEvent={() => {}} />
      </TooltipProvider>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Later Teyvat/ })).toBeNull();
  });

  it('preserves the compact summary for other games', () => {
    const rows = Array.from({ length: 6 }, (_, index) => event(`Window ${index}`, { end: NOW + index + 10 }));
    rows.push(event('Daily reward', { dailyTouch: true, end: NOW + DAY }));
    render(
      <TooltipProvider>
        <EventStrip game={game} events={rows} now={NOW} onOpenEvent={() => {}} />
      </TooltipProvider>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.getByRole('button', { name: /Daily reward/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Window 4/ })).toBeNull();
  });
});

describe('taking a break', () => {
  it('pauses and resumes a workspace without deleting tracking data or its events', () => {
    const events = [event('Personal window')];
    load(events);
    render(<Controls />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause tracking', exact: true }));
    expect(useApp.getState().state.games[0]?.paused).toBe(true);
    expect(useApp.getState().state.games[0]?.deleted).toBeFalsy();
    expect(useApp.getState().state.events).toEqual(events);
    expect(screen.getByRole('button', { name: 'Resume tracking', exact: true })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Manage events' }));
    expect(screen.getByRole('button', { name: 'Edit My game event: Personal window' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Resume tracking', exact: true }));
    expect(useApp.getState().state.games[0]?.paused).toBe(false);
    expect(useApp.getState().state.events).toEqual(events);
  });

  it('offers a direct resume from the phone roster and opens the saved workspace', () => {
    load([event('Personal window')], { paused: true });
    function Roster() {
      const { order } = useDerived(NOW);
      return <MobileRoster entries={order} now={NOW} />;
    }
    render(<Roster />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume My game tracking' }));
    expect(useApp.getState().state.games[0]?.paused).toBe(false);
    expect(useUI.getState().focusedGameId).toBe(game.id);
    expect(useApp.getState().state.events).toHaveLength(1);
  });
});
