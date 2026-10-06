import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { emptyState } from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGame } from '../../shared/test/helpers';

const native = vi.hoisted(() => ({ list: vi.fn(), connect: vi.fn() }));
vi.mock('../src/native', () => ({ isNativeApp: true }));
vi.mock('../src/hoyo-native', () => ({
  listHoyoAccounts: native.list,
  connectHoyo: native.connect,
  fetchHoyoNotes: vi.fn(),
  disconnectHoyo: vi.fn(),
}));
vi.mock('../src/launcher', () => ({ servedByLauncher: () => false, launcherFetch: vi.fn() }));
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn(async () => []) }));

import { GameConnections } from '../src/components/GameConnections';
import { useApp } from '../src/store';
import { useGameConnections } from '../src/game-connections';

const account = { provider: 'genshin', uid: '700000001', server: 'os_euro', nickname: 'Traveler' };
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  native.list.mockReset();
  native.connect.mockReset();
  useGameConnections.setState({ connections: [], error: '', refreshing: false });
  const state = emptyState();
  state.games = [makeGame({ presetKey: 'genshin' })];
  useApp.setState({ state, loaded: true });
});
afterEach(cleanup);

describe('native account discovery', () => {
  it('fills the only linked account but waits for Connect and review', async () => {
    native.list.mockResolvedValue({ accounts: [account] });
    const onReview = vi.fn();
    render(<GameConnections gameId="g1" onReview={onReview} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find my accounts' }));
    await screen.findByText('Account found. Select Connect and review to check its readings.');
    expect(screen.getByRole('textbox', { name: 'In-game UID' })).toHaveValue(account.uid);
    expect(onReview).not.toHaveBeenCalled();
    expect(native.list).toHaveBeenCalledWith({ provider: 'genshin' });
  });

  it('lets the user choose between linked accounts without replacing the current draft first', async () => {
    native.list.mockResolvedValue({
      accounts: [account, { ...account, uid: '800000002', server: 'os_asia', nickname: 'Alt' }],
    });
    render(<GameConnections gameId="g1" onReview={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'In-game UID' }), { target: { value: '799999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find my accounts' }));
    const select = await screen.findByRole('combobox', { name: 'Linked HoYoLAB account' });
    expect(screen.getByRole('textbox', { name: 'In-game UID' })).toHaveValue('799999999');
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /Alt.*Asia.*800000002/ }));
    expect(screen.getByRole('textbox', { name: 'In-game UID' })).toHaveValue('800000002');
    expect(screen.getByRole('combobox', { name: 'Game server' })).toHaveTextContent('Asia');
  });

  it('keeps manual values after a failed lookup', async () => {
    native.list.mockRejectedValue(new Error('HoYoLAB is unavailable. Try again.'));
    render(<GameConnections gameId="g1" onReview={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'In-game UID' }), { target: { value: '799999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find my accounts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HoYoLAB is unavailable. Try again.');
    expect(screen.getByRole('textbox', { name: 'In-game UID' })).toHaveValue('799999999');
    expect(screen.getByRole('combobox', { name: 'Game server' })).toHaveTextContent('Europe');
  });

  it('looks up accounts after successful sign-in', async () => {
    native.connect.mockResolvedValue({ connected: true });
    native.list.mockResolvedValue({ accounts: [account] });
    render(<GameConnections gameId="g1" onReview={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with HoYoLAB' }));
    await screen.findByText('Account found. Select Connect and review to check its readings.');
    expect(native.list).toHaveBeenCalledOnce();
  });

  it('keeps manual values and explains an empty account list', async () => {
    native.list.mockResolvedValue({ accounts: [] });
    render(<GameConnections gameId="g1" onReview={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'In-game UID' }), { target: { value: '799999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find my accounts' }));
    expect(await screen.findByRole('status')).toHaveTextContent('No linked account was found for this game.');
    expect(screen.getByRole('textbox', { name: 'In-game UID' })).toHaveValue('799999999');
  });

  it('discards account discovery after the view closes', async () => {
    let resolve!: (result: { accounts: (typeof account)[] }) => void;
    native.list.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<GameConnections gameId="g1" onReview={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find my accounts' }));
    view.unmount();
    await act(async () => resolve({ accounts: [account] }));
    expect(useGameConnections.getState().connections).toEqual([]);
  });
});
