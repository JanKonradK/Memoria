import { act, fireEvent, render, screen } from '@testing-library/react';
import { emptyState, type Game } from '@memoria/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEditor } from '../src/components/settings/GameEditor';
import { useApp } from '../src/store';

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

function renderEditor() {
  const updateGame = vi.fn(originalUpdateGame);
  useApp.setState({
    state: { ...emptyState(), games: [game] },
    updateGame,
  });
  const view = render(<GameEditor game={game} />);
  return { ...view, updateGame };
}

afterEach(() => {
  vi.useRealTimers();
  useApp.setState({ state: emptyState(), updateGame: originalUpdateGame });
});

describe('Settings game editor text drafts', () => {
  it('does not offer card display toggles', () => {
    renderEditor();

    expect(screen.queryByText('Card display')).not.toBeInTheDocument();
    expect(screen.queryByText('Daily progress ring')).not.toBeInTheDocument();
    expect(screen.queryByText('Active events strip')).not.toBeInTheDocument();
  });

  it('commits an edited name on blur', () => {
    const { updateGame } = renderEditor();
    const name = screen.getByLabelText('Name', { selector: 'input' });

    fireEvent.change(name, { target: { value: 'Blurred name' } });
    fireEvent.blur(name);

    expect(updateGame).toHaveBeenCalledWith(game.id, { name: 'Blurred name' });
  });

  it('commits the short label after the exact 300ms debounce', () => {
    vi.useFakeTimers();
    const { updateGame } = renderEditor();
    const short = screen.getByLabelText("Short label (shown as the game's badge)");

    fireEvent.change(short, { target: { value: 'NEW' } });
    act(() => vi.advanceTimersByTime(299));
    expect(updateGame).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(updateGame).toHaveBeenCalledWith(game.id, { short: 'NEW' });
  });

  it('flushes the latest notes when the editor unmounts', () => {
    vi.useFakeTimers();
    const { unmount, updateGame } = renderEditor();
    const notes = screen.getByLabelText('Notes');

    fireEvent.change(notes, { target: { value: 'Debounced notes' } });
    act(() => vi.advanceTimersByTime(300));
    expect(updateGame).toHaveBeenCalledWith(game.id, { notes: 'Debounced notes' });

    fireEvent.change(notes, { target: { value: 'Debounced notes plus tail' } });
    unmount();

    expect(updateGame).toHaveBeenLastCalledWith(game.id, { notes: 'Debounced notes plus tail' });
  });

  it('does not lose a name typed immediately before unmount', () => {
    const { unmount, updateGame } = renderEditor();
    const name = screen.getByLabelText('Name', { selector: 'input' });

    fireEvent.change(name, { target: { value: 'Immediate unmount name' } });
    unmount();

    expect(updateGame).toHaveBeenCalledWith(game.id, { name: 'Immediate unmount name' });
  });
});
