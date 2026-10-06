import { act, fireEvent, render, screen } from '@testing-library/react';
import { emptyState } from '@memoria/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { makeGame } from '../../shared/test/helpers';
import { SettingsPage } from '../src/components/Settings';
import { useApp } from '../src/store';

vi.mock('../src/components/settings/DeviceSync', () => ({ DeviceSync: () => null }));
vi.mock('../src/cloud-sync', () => ({
  CLOUD_FILE_SUGGESTED_NAME: 'memoria-sync.json',
  cloudSyncSupported: () => true,
  cloudSyncNow: vi.fn(),
  connectExistingCloudFile: vi.fn(),
  connectNewCloudFile: vi.fn(),
  disconnectCloudFile: vi.fn(),
  reconnectCloudFile: vi.fn(),
}));

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
  await screen.findByText('Import failed — not a valid Memoria backup file.');
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
  render(<SettingsPage />);
  expect(screen.getByText('Cannot open this file.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Use existing file…' })).toBeVisible();
});
