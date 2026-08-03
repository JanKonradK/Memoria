import { act, fireEvent, render, screen } from '@testing-library/react';
import { emptyState, type Game } from '@void/shared';
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

function renderDetail() {
  const updateGame = vi.fn(originalUpdateGame);
  useApp.setState({
    state: { ...emptyState(), games: [game] },
    updateGame,
  });
  useUI.setState({ sheet: { kind: 'game', gameId: game.id } });
  render(<GameDetailSheet gameId={game.id} open />);
  return updateGame;
}

/** Segmented is a Radix ToggleGroup, so its sections are radios, not buttons. */
function openGameSection() {
  fireEvent.click(screen.getByRole('radio', { name: 'Game' }));
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

describe('GameDetail text drafts', () => {
  it('commits an edited field on blur', () => {
    const updateGame = renderDetail();
    openGameSection();
    const name = screen.getByLabelText('Name');

    fireEvent.change(name, { target: { value: 'Blurred name' } });
    fireEvent.blur(name);

    expect(updateGame).toHaveBeenCalledWith(game.id, { name: 'Blurred name' });
  });

  it('commits the latest draft after the 300ms debounce', () => {
    vi.useFakeTimers();
    const updateGame = renderDetail();
    openGameSection();
    const short = screen.getByLabelText("Short label (shown as the game's badge)");

    fireEvent.change(short, { target: { value: 'NEW' } });
    act(() => vi.advanceTimersByTime(299));
    expect(updateGame).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(updateGame).toHaveBeenCalledWith(game.id, { short: 'NEW' });
  });

  it('commits the account label through the 300ms debounce', () => {
    vi.useFakeTimers();
    const updateGame = renderDetail();
    const accountLabel = screen.getByLabelText('Account label');

    expect(accountLabel).toHaveValue('Original account');
    fireEvent.change(accountLabel, { target: { value: 'Main EU' } });
    act(() => vi.advanceTimersByTime(299));
    expect(updateGame).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(updateGame).toHaveBeenCalledWith(game.id, { accountLabel: 'Main EU' });
  });

  it('flushes a pending tail when the sheet closes after an earlier debounce', () => {
    vi.useFakeTimers();
    const updateGame = renderDetail();
    const notes = screen.getByLabelText('Notes');

    fireEvent.change(notes, { target: { value: 'Debounced notes' } });
    act(() => vi.advanceTimersByTime(300));
    expect(updateGame).toHaveBeenCalledWith(game.id, { notes: 'Debounced notes' });

    fireEvent.change(notes, { target: { value: 'Debounced notes plus tail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(updateGame).toHaveBeenLastCalledWith(game.id, { notes: 'Debounced notes plus tail' });
  });

  it('does not lose text typed immediately before closing', () => {
    const updateGame = renderDetail();
    openGameSection();
    const name = screen.getByLabelText('Name');

    fireEvent.change(name, { target: { value: 'Immediate close name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(updateGame).toHaveBeenCalledWith(game.id, { name: 'Immediate close name' });
  });
});
