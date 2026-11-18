import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { AppRail } from '../src/components/shell/AppRail';
import { TooltipProvider } from '../src/components/ui';
import { useApp } from '../src/store';
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
  useUI.setState({ tab: 'today', focusedGameId: null });
});

afterEach(() => useApp.setState({ load: originalLoad }));

const renderRail = (node: ReactElement = <AppRail />) => render(<TooltipProvider>{node}</TooltipProvider>);

it('leads with Today and Calendar, ends with Settings, and adds a game from the rail', () => {
  useUI.setState({ tab: 'today' });
  renderRail();
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  const names = within(nav)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent);
  expect(names[0]).toBe('Today');
  expect(names[1]).toBe('Calendar');
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
