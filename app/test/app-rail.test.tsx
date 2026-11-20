import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { AppRail } from '../src/components/shell/AppRail';
import { railCountdown } from '../src/components/shell/rail-countdown';
import { TooltipProvider } from '../src/components/ui';
import { emptyState } from '@memoria/shared';
import { useApp } from '../src/store';
import { makeGame } from '../../shared/test/helpers';
import { useUI } from '../src/ui-store';
import { syncNow } from '../src/sync';
import { cloudSyncNow } from '../src/cloud-sync';
import { syncLanNow, useLanSync } from '../src/lan-sync';

vi.mock('../src/sync', () => ({ syncNow: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/cloud-sync', () => ({ cloudSyncNow: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/lan-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lan-sync')>()),
  syncLanNow: vi.fn().mockResolvedValue(undefined),
}));

const originalLoad = useApp.getState().load;

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    loaded: true,
    loadError: '',
    saveError: '',
    syncStatus: 'idle',
    cloudStatus: 'off',
    load: vi.fn().mockResolvedValue(undefined),
  });
  useLanSync.setState({ status: 'off', error: '' });
  useUI.setState({ tab: 'today', focusedGameId: null, sheet: null });
});

afterEach(() => useApp.setState({ load: originalLoad, state: emptyState() }));

const renderRail = (node: ReactElement = <AppRail />) => render(<TooltipProvider>{node}</TooltipProvider>);

it('runs Calendar, Games, Today, Notes, then the games, ends with Settings, and adds a game from the rail', () => {
  useUI.setState({ tab: 'today' });
  renderRail();
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  const names = within(nav)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent);
  expect(names.slice(0, 4)).toEqual(['Calendar', 'Games', 'Today', 'Notes']);
  expect(names.at(-1)).toBe('Settings');
  expect(names).toContain('Add game');
  // Pulls and Quests live inside each game now.
  expect(within(nav).queryByRole('button', { name: 'Pulls' })).toBeNull();
  fireEvent.click(within(nav).getByRole('button', { name: 'Calendar' }));
  expect(useUI.getState().tab).toBe('timeline');
  fireEvent.click(within(nav).getByRole('button', { name: 'Settings' }));
  expect(useUI.getState().tab).toBe('settings');
  fireEvent.click(within(nav).getByRole('button', { name: 'Add game' }));
  expect(useUI.getState().sheet).toEqual({ kind: 'addGame' });
});

it('shows phone sync status even without a desktop launcher in this window', () => {
  useLanSync.setState({ status: 'ok' });
  renderRail();
  expect(screen.getByRole('status')).toHaveTextContent('Synced');
});

it('shows a connection error ahead of another successful connection', () => {
  useApp.setState({ syncStatus: 'ok', cloudStatus: 'needs-permission', cloudError: 'Reconnect the sync file.' });
  renderRail();
  expect(screen.getByRole('button', { name: 'Sync needs attention: Reconnect the sync file.' })).toBeInTheDocument();
});

it('refreshes connected devices after local loading', async () => {
  let finishLoad!: () => void;
  useApp.setState({
    load: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLoad = resolve;
        }),
    ),
  });
  let finishSync!: () => void;
  vi.mocked(syncLanNow).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishSync = resolve;
      }),
  );
  useApp.setState({ syncStatus: 'error' });
  renderRail();
  const refresh = screen.getByRole('button', { name: 'Refresh data' });
  fireEvent.click(refresh);
  expect(refresh).toBeDisabled();
  expect(syncNow).not.toHaveBeenCalled();
  await act(async () => finishLoad());
  expect(syncNow).toHaveBeenCalledOnce();
  expect(cloudSyncNow).toHaveBeenCalledOnce();
  expect(syncLanNow).toHaveBeenCalledOnce();
  expect(refresh).toBeDisabled();
  await act(async () => finishSync());
  expect(refresh).toBeEnabled();
});

it.each(['loadError', 'saveError'] as const)('avoids sync after %s', async (field) => {
  useApp.setState({
    load: vi.fn(async () => {
      useApp.setState({ [field]: 'Storage is unavailable.' });
    }),
    syncStatus: 'error',
  });
  renderRail();
  const refresh = screen.getByRole('button', { name: 'Refresh data' });
  fireEvent.click(refresh);
  await waitFor(() => expect(refresh).toBeEnabled());
  expect(syncNow).not.toHaveBeenCalled();
  expect(cloudSyncNow).not.toHaveBeenCalled();
  expect(syncLanNow).not.toHaveBeenCalled();
});

it('keeps healthy sync and refresh out of sight', () => {
  useApp.setState({ syncStatus: 'ok' });
  renderRail();
  expect(screen.queryByRole('button', { name: 'Refresh data' })).toBeNull();
  expect(screen.queryByText('Sync needs attention')).toBeNull();
  expect(screen.queryByRole('button', { name: /theme/i })).toBeNull();
});

it('marks the open game rather than Today on a game page, and Today returns from it', () => {
  useUI.setState({ tab: 'home', focusedGameId: 'game' });
  renderRail();
  const today = within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', { name: 'Today' });
  expect(today).not.toHaveAttribute('aria-current');
  fireEvent.click(today);
  expect(useUI.getState().tab).toBe('today');
  expect(useUI.getState().focusedGameId).toBeNull();
});

function withGames() {
  const state = emptyState();
  state.games = [
    makeGame({ id: 'first', name: 'Genshin Impact', accountLabel: 'Main', sort: 0 }),
    makeGame({ id: 'second', name: 'Honkai: Star Rail', sort: 1 }),
  ];
  useApp.setState({ state });
}

it('names each game by its name and account, and keeps the countdown out of the name', () => {
  withGames();
  renderRail();
  const games = within(screen.getByRole('group', { name: 'Games' }));
  const first = games.getByRole('button', { name: 'Genshin Impact, Main' });
  expect(first).toHaveAttribute('aria-keyshortcuts', 'Control+1');
  expect(games.getByRole('button', { name: 'Honkai: Star Rail' })).toHaveAttribute('aria-keyshortcuts', 'Control+2');
});

it('opens the Nth game with Ctrl+N, but not while typing or with a sheet open', () => {
  withGames();
  renderRail();
  fireEvent.keyDown(document, { key: '2', ctrlKey: true });
  expect(useUI.getState()).toMatchObject({ tab: 'home', focusedGameId: 'second' });
  useUI.setState({ tab: 'today', focusedGameId: null });
  const field = document.createElement('input');
  document.body.append(field);
  fireEvent.keyDown(field, { key: '1', ctrlKey: true });
  expect(useUI.getState().tab).toBe('today');
  field.remove();
  useUI.setState({ sheet: { kind: 'addGame' } });
  fireEvent.keyDown(document, { key: '1', ctrlKey: true });
  expect(useUI.getState().tab).toBe('today');
  useUI.setState({ sheet: null });
  // There is no ninth game, and Alt or Shift leave the key alone.
  fireEvent.keyDown(document, { key: '9', ctrlKey: true });
  fireEvent.keyDown(document, { key: '1', ctrlKey: true, shiftKey: true });
  expect(useUI.getState().tab).toBe('today');
});

it('floors rail countdowns like Today and tones them by how soon they come', () => {
  const minute = 60_000;
  expect(railCountdown(59.9 * minute)).toMatchObject({ short: '59m', tone: 'now' });
  expect(railCountdown(119 * minute)).toMatchObject({ short: '1h', long: '1 h 59 min', tone: 'now' });
  expect(railCountdown(7.9 * 60 * minute)).toMatchObject({ short: '7h', tone: 'soon' });
  expect(railCountdown(9 * 60 * minute)).toMatchObject({ short: '9h', tone: 'later' });
  expect(railCountdown(3 * 24 * 60 * minute)).toMatchObject({ short: '3d', tone: 'later' });
  expect(railCountdown(0)).toMatchObject({ short: 'now', tone: 'now' });
});
