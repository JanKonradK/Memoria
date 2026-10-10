import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppBar } from '../src/components/AppBar';
import { CalendarToolbar } from '../src/components/CalendarToolbar';
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
vi.mock('../src/components/AddMenu', () => ({ AddMenu: () => null }));
vi.mock('../src/components/GameScope', () => ({ GameScope: () => null }));

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

it('keeps two primary routes and makes calendar livestreams and settings reachable', () => {
  useUI.setState({ tab: 'today' });
  render(
    <>
      <AppBar />
      <CalendarToolbar view="timeline" />
    </>,
  );
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  expect(
    within(nav)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Today', 'Calendar']);
  fireEvent.click(within(nav).getByRole('button', { name: 'Calendar' }));
  // Calendar's own views sit on the page, outside the app bar.
  expect(within(screen.getByRole('banner')).queryByRole('button', { name: 'Livestreams' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Livestreams' }));
  expect(useUI.getState().tab).toBe('livestreams');
  expect(within(nav).getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(useUI.getState().tab).toBe('settings');
});

it('shows phone sync status even without a desktop launcher in this window', () => {
  useLanSync.setState({ status: 'ok' });
  render(<AppBar />);
  expect(screen.getByRole('status')).toHaveTextContent('Synced');
});

it('shows a connection error ahead of another successful connection', () => {
  useApp.setState({ syncStatus: 'ok', cloudStatus: 'needs-permission', cloudError: 'Reconnect the sync file.' });
  render(<AppBar />);
  expect(screen.getByRole('status')).toHaveTextContent('Reconnect the sync file.');
  expect(screen.getByRole('status')).toHaveAttribute('title', 'Reconnect the sync file.');
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
  render(<AppBar />);
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
  });
  render(<AppBar />);
  const refresh = screen.getByRole('button', { name: 'Refresh data' });
  fireEvent.click(refresh);
  await waitFor(() => expect(refresh).toBeEnabled());
  expect(syncNow).not.toHaveBeenCalled();
  expect(cloudSyncNow).not.toHaveBeenCalled();
  expect(syncLanNow).not.toHaveBeenCalled();
});

it('keeps Today selected on a game page and returns to Today from it', () => {
  useUI.setState({ tab: 'home', focusedGameId: 'game' });
  render(<AppBar />);
  const today = within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', { name: 'Today' });
  expect(today).toHaveAttribute('aria-current', 'page');
  fireEvent.click(today);
  expect(useUI.getState().tab).toBe('today');
  expect(useUI.getState().focusedGameId).toBeNull();
});
