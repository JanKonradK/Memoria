import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { emptyState, SERVER_TZ_OPTIONS, type Game } from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameDraft } from '../src/components/game-detail/useGameDraft';
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
  it.each([
    ['Tasks', 'New task name'],
    ['Quick spend', 'Label, e.g. Domain'],
    ['Reminders', 'Reminder message'],
  ])('keeps an unsaved %s draft when Done is rejected', (tab, label) => {
    renderDetail();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('tab', { name: tab }));
    const input = tab === 'Quick spend' ? screen.getByPlaceholderText(label) : screen.getByLabelText(label);
    fireEvent.change(input, { target: { value: 'Keep this draft' } });

    fireEvent.click(screen.getByRole('button', { name: 'Done', exact: true }));

    expect(confirm).toHaveBeenCalledWith('Discard your unsaved changes?');
    expect(useUI.getState().sheet).toEqual({ kind: 'game', gameId: game.id });
    expect(input).toHaveValue('Keep this draft');
    confirm.mockRestore();
  });

  it('keeps a reminder draft when Escape or an event replacement is rejected', () => {
    renderDetail();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Reminders' }));
    fireEvent.change(screen.getByLabelText('Reminder message'), { target: { value: 'Keep this reminder' } });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirm).toHaveBeenCalledOnce();
    expect(useUI.getState().sheet).toEqual({ kind: 'game', gameId: game.id });

    fireEvent.click(screen.getByRole('tab', { name: 'Events' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(useUI.getState().sheet).toEqual({ kind: 'game', gameId: game.id });
    fireEvent.click(screen.getByRole('tab', { name: 'Reminders' }));
    expect(screen.getByLabelText('Reminder message')).toHaveValue('Keep this reminder');
    confirm.mockRestore();
  });

  it('closes after adding a reminder without asking to discard saved changes', () => {
    renderDetail();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Reminders' }));
    fireEvent.change(screen.getByLabelText('Reminder message'), { target: { value: 'Saved reminder' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add reminder', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Done', exact: true }));

    expect(confirm).not.toHaveBeenCalled();
    expect(useUI.getState().sheet).toBeNull();
    expect(useApp.getState().state.reminders).toEqual([
      expect.objectContaining({ message: 'Saved reminder', gameId: game.id }),
    ]);
    confirm.mockRestore();
  });

  it('protects reminder edits when another reminder is selected and clears the guard after saving', () => {
    renderDetail();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    act(() => {
      useApp.getState().addReminder('First reminder', Date.now() + 3_600_000, game.id);
      useApp.getState().addReminder('Second reminder', Date.now() + 7_200_000, game.id);
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Reminders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit reminder First reminder' }));
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reminder message'), { target: { value: 'First reminder edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit reminder Second reminder' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Reminder message')).toHaveValue('First reminder edited');
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit reminder Second reminder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done', exact: true }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(useUI.getState().sheet).toBeNull();
    expect(useApp.getState().state.reminders[0]?.message).toBe('First reminder edited');
    confirm.mockRestore();
  });

  it('commits the nickname through the 300ms debounce', () => {
    vi.useFakeTimers();
    const updateGame = renderDetail();
    fireEvent.click(screen.getByRole('tab', { name: 'Game' }));
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
    fireEvent.click(screen.getByRole('tab', { name: 'Resets' }));

    fireEvent.click(screen.getByRole('radio', { name: 'EU' }));
    expect(updateGame).toHaveBeenLastCalledWith(game.id, { tz: serverTz(1) });

    fireEvent.click(screen.getByRole('radio', { name: 'NA' }));
    expect(updateGame).toHaveBeenLastCalledWith(game.id, { tz: serverTz(-5) });

    fireEvent.click(screen.getByRole('radio', { name: 'Asia' }));
    expect(updateGame).toHaveBeenLastCalledWith(game.id, { tz: serverTz(8) });
  });

  it('shows an uncommon timezone as a disabled selected option', () => {
    const updateGame = renderDetail({ ...game, tz: 'Pacific/Auckland' });
    fireEvent.click(screen.getByRole('tab', { name: 'Resets' }));
    const uncommonServer = screen.getByRole('radio', { name: /UTC/ });

    expect(uncommonServer).toBeChecked();
    expect(uncommonServer).toBeDisabled();
    fireEvent.click(uncommonServer);
    expect(updateGame).not.toHaveBeenCalled();
  });
});

const syncedFields = ['name', 'accountLabel'] as const;

describe('Drafts preserve incoming sync changes', () => {
  it('does not write an untouched title when the game page closes', () => {
    const updateGame = vi.fn(originalUpdateGame);
    useApp.setState({ state: { ...emptyState(), games: [game] }, updateGame });
    const { unmount } = renderHook(() => useGameDraft(game, syncedFields, false, 0));
    act(() => useApp.setState({ state: { ...emptyState(), games: [{ ...game, name: 'Synced title' }] } }));
    unmount();
    expect(updateGame).not.toHaveBeenCalled();
    expect(useApp.getState().state.games[0]!.name).toBe('Synced title');
  });

  it('flushes only the field typed locally when another field changes remotely', () => {
    vi.useFakeTimers();
    const updateGame = vi.fn(originalUpdateGame);
    useApp.setState({ state: { ...emptyState(), games: [game] }, updateGame });
    const { result, unmount } = renderHook(() => useGameDraft(game, syncedFields));
    act(() => result.current.changeDraft('accountLabel', 'Local nickname'));
    act(() => useApp.setState({ state: { ...emptyState(), games: [{ ...game, name: 'Synced title' }] } }));
    unmount();
    expect(updateGame).toHaveBeenCalledExactlyOnceWith(game.id, { accountLabel: 'Local nickname' });
    expect(useApp.getState().state.games[0]!.name).toBe('Synced title');
  });
});
