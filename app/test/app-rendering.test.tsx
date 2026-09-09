import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyState } from '@memoria/shared';

const views = vi.hoisted(() => ({
  dashboard: vi.fn(({ now }: { now: number }) => <div>Dashboard time: {now}</div>),
  timeline: vi.fn(({ now }: { now: number }) => <div>Timeline time: {now}</div>),
  settings: vi.fn(() => <div>Settings</div>),
  shell: vi.fn(() => <header>App bar</header>),
  editor: vi.fn(() => <div>Game editor</div>),
}));

vi.mock('../src/components/Dashboard', () => ({ DashboardPage: views.dashboard }));
vi.mock('../src/components/Timeline', () => ({ TimelinePage: views.timeline }));
vi.mock('../src/components/Settings', () => ({ SettingsPage: views.settings }));
vi.mock('../src/components/AppBar', () => ({ AppBar: views.shell }));
vi.mock('../src/components/GameDetail', () => ({ GameDetailSheet: views.editor }));
vi.mock('../src/cloud-sync', () => ({ initCloudSync: vi.fn() }));
vi.mock('../src/sync', () => ({ initSync: vi.fn() }));
vi.mock('../src/pwa', () => ({ applyPwaUpdate: vi.fn() }));

import App from '../src/App';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('keeps countdown ticks and sheet navigation out of unrelated views', async () => {
  vi.useFakeTimers();
  vi.spyOn(useApp.getState(), 'load').mockResolvedValue();
  useApp.setState({ state: emptyState(), loaded: true, loadError: '' });
  useUI.setState({ tab: 'home', sheet: null, tourSeenVersion: 1 });
  const { unmount } = render(<App />);
  await act(() => vi.dynamicImportSettled());
  vi.clearAllMocks();

  await act(async () => {
    vi.advanceTimersByTime(30_000);
  });
  expect(screen.getByText(`Dashboard time: ${Date.now()}`)).toBeInTheDocument();
  expect(views.shell).not.toHaveBeenCalled();
  vi.clearAllMocks();

  await act(async () => {
    useUI.getState().openSheet({ kind: 'game', gameId: 'test-game' });
    await vi.dynamicImportSettled();
  });
  expect(screen.getByText('Game editor')).toBeInTheDocument();
  expect(views.dashboard).not.toHaveBeenCalled();
  expect(views.shell).not.toHaveBeenCalled();
  vi.clearAllMocks();

  await act(async () => {
    vi.advanceTimersByTime(30_000);
  });
  expect(views.dashboard).toHaveBeenCalled();
  expect(views.editor).not.toHaveBeenCalled();

  await act(async () => {
    useUI.getState().setTab('settings');
    await vi.dynamicImportSettled();
  });
  expect(screen.getByText('Settings')).toBeInTheDocument();
  vi.clearAllMocks();
  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });
  expect(views.settings).not.toHaveBeenCalled();
  expect(views.shell).not.toHaveBeenCalled();
  unmount();
});
