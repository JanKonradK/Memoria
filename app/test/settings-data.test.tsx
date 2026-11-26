import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { emptyState } from '@memoria/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeGame } from '../../shared/test/helpers';
import { SettingsPage } from '../src/components/Settings';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';

vi.mock('../src/components/settings/DeviceSync', () => ({ DeviceSync: () => null, deviceSyncAvailable: () => false }));
vi.mock('../src/cloud-sync', () => ({
  CLOUD_FILE_SUGGESTED_NAME: 'memoria-sync.json',
  cloudSyncSupported: () => true,
  cloudSyncNow: vi.fn(),
  connectExistingCloudFile: vi.fn(),
  connectNewCloudFile: vi.fn(),
  disconnectCloudFile: vi.fn(),
  reconnectCloudFile: vi.fn(),
}));

// The test window is wide, so Settings shows one pane beside its menu.
beforeEach(() => {
  useUI.setState({ settingsSection: 'data' });
});

afterEach(() => {
  useApp.setState({ state: emptyState(), cloudStatus: 'off', cloudFileName: '', cloudError: '' });
});

function selectBackup(text: () => Promise<string>) {
  fireEvent.change(screen.getByLabelText('Import backup'), { target: { files: [{ size: 512, text }] } });
}

it('rejects malformed backup data before offering a merge', async () => {
  useApp.setState({ state: emptyState() });
  render(<SettingsPage />);
  selectBackup(async () => JSON.stringify({ ...emptyState(), games: [makeGame({ dailyResetHour: 99 })] }));
  await screen.findByText('Import failed: not a Memoria backup.');
  expect(screen.queryByRole('button', { name: 'Merge backup', exact: true })).not.toBeInTheDocument();
  expect(useApp.getState().state.games).toHaveLength(0);
});

it('keeps only the latest chosen backup when file reads finish out of order', async () => {
  useApp.setState({ state: emptyState() });
  render(<SettingsPage />);
  let finishFirst!: (text: string) => void;
  const firstRead = new Promise<string>((resolve) => {
    finishFirst = resolve;
  });
  selectBackup(() => firstRead);
  const latest = { ...emptyState(), games: [makeGame({ name: 'Latest backup' })] };
  selectBackup(async () => JSON.stringify(latest));
  await screen.findByText('Merge backup with 1 game and 0 events?');
  await act(async () => finishFirst(JSON.stringify(emptyState())));

  expect(screen.getByText('Merge backup with 1 game and 0 events?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Merge backup', exact: true }));
  expect(useApp.getState().state.games[0]?.name).toBe('Latest backup');
});

it('clears an old preview when a replacement file cannot be read', async () => {
  useApp.setState({ state: emptyState() });
  render(<SettingsPage />);
  selectBackup(async () => JSON.stringify({ ...emptyState(), games: [makeGame()] }));
  await screen.findByRole('button', { name: 'Merge backup', exact: true });
  selectBackup(async () => {
    throw new Error('The backup file could not be read.');
  });
  expect(screen.queryByRole('button', { name: 'Merge backup', exact: true })).not.toBeInTheDocument();
  await screen.findByText('The backup file could not be read.');
});

it('shows an initial shared-folder connection error before a filename is available', () => {
  useApp.setState({
    state: emptyState(),
    cloudStatus: 'error',
    cloudFileName: '',
    cloudError: 'Cannot open this file.',
  });
  useUI.setState({ settingsSection: 'sync' });
  render(<SettingsPage />);
  expect(screen.getByText('Cannot open this file.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Use existing file…' })).toBeVisible();
});

it('keeps the backup counts on screen in Minimal mode, upright, beside a button-sized file picker', () => {
  useApp.setState({ state: { ...emptyState(), games: [makeGame()] } });
  render(<SettingsPage />);
  // A count is a fact: never under `.say`, which Minimal hides, and never in the italic aside.
  const counts = screen.getByText('1 game · 0 events');
  expect(counts.closest('.say')).toBeNull();
  expect(counts.closest('.aside')).toBeNull();
  // The file picker is a button-sized label that keeps the input in the tab order.
  const picker = screen.getByLabelText('Import backup');
  expect(picker).toHaveClass('sr-only');
  expect(picker.closest('label')).toHaveClass('focus-ring-group', 'min-h-(--control-h)');
});

it('has eight sections, and folded ones open where they went', () => {
  useApp.setState({ state: emptyState() });
  render(<SettingsPage />);
  const menu = screen.getByRole('navigation', { name: 'Settings sections' });
  // This PC joins the list only in the Windows app.
  expect(
    within(menu)
      .getAllByRole('button')
      .map((button) => button.querySelector('span')?.textContent),
  ).toEqual(['Games', 'Time & reminders', 'Appearance', 'Device sync', 'Accounts', 'Data', 'Activity & About']);
  act(() => useUI.getState().openSettings('general'));
  expect(useUI.getState().settingsSection).toBe('reminders');
  expect(screen.getByRole('heading', { name: 'Time & reminders', level: 2 })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Home timezone' })).toBeInTheDocument();
  act(() => useUI.getState().openSettings('updates'));
  expect(useUI.getState().settingsSection).toBe('activity');
  // The guide and the keys moved here from the page bar.
  expect(screen.getByRole('button', { name: 'Open guide' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show shortcuts' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Guide', exact: true })).not.toBeInTheDocument();
});
