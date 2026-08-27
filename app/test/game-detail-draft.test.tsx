import { act, fireEvent, render, screen } from '@testing-library/react';
import { emptyState, SERVER_TZ_OPTIONS, type Game } from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameDetailSheet } from '../src/components/GameDetail';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';

const game: Game = {
  id: 'draft-game',
  name: 'Original name',
  accountLabel: 'Original account',
  short: 'OG',
  color: '#8b5cf6',
  icon: '',
  platform: 'both',
  tz: 'Etc/UTC',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort: 0,
  notes: 'Original notes',
  updatedAt: 1,
};

const originalUpdateGame = useApp.getState().updateGame;
const serverTz = (utcOffset: number) =>
  SERVER_TZ_OPTIONS.find((option) => {
    const match = /^Etc\/GMT([+-])(\d+)$/.exec(option.tz);
    if (!match) return false;
    const hours = Number(match[2]);
    return (match[1] === '-' ? hours : -hours) === utcOffset;
  })?.tz;

function renderDetail(currentGame: Game = game) {
  const updateGame = vi.fn(originalUpdateGame);
  useApp.setState({
    state: { ...emptyState(), games: [currentGame] },
    updateGame,
  });
  useUI.setState({ sheet: { kind: 'game', gameId: currentGame.id } });
  render(<GameDetailSheet gameId={currentGame.id} open />);
  return updateGame;
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  useApp.setState({ state: emptyState(), updateGame: originalUpdateGame });
  useUI.setState({ sheet: null });
});

describe('GameDetail drafts and server', () => {
  it('commits the nickname through the 300ms debounce', () => {
    vi.useFakeTimers();
    const updateGame = renderDetail();
    const nickname = screen.getByLabelText('Nickname');

    expect(nickname).toHaveValue('Original account');
    fireEvent.change(nickname, { target: { value: 'Main EU' } });
    act(() => vi.advanceTimersByTime(299));
    expect(updateGame).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(updateGame).toHaveBeenCalledWith(game.id, { accountLabel: 'Main EU' });
  });

  it('writes the preset timezone for each server', () => {
    const updateGame = renderDetail();

    fireEvent.click(screen.getByRole('radio', { name: 'EU' }));
    expect(updateGame).toHaveBeenLastCalledWith(game.id, { tz: serverTz(1) });

    fireEvent.click(screen.getByRole('radio', { name: 'NA' }));
    expect(updateGame).toHaveBeenLastCalledWith(game.id, { tz: serverTz(-5) });

    fireEvent.click(screen.getByRole('radio', { name: 'Asia' }));
    expect(updateGame).toHaveBeenLastCalledWith(game.id, { tz: serverTz(8) });
  });

  it('shows an uncommon timezone as a disabled selected option', () => {
    const updateGame = renderDetail({ ...game, tz: 'Pacific/Auckland' });
    const uncommonServer = screen.getByRole('radio', { name: /UTC/ });

    expect(uncommonServer).toBeChecked();
    expect(uncommonServer).toBeDisabled();
    fireEvent.click(uncommonServer);
    expect(updateGame).not.toHaveBeenCalled();
  });
});
