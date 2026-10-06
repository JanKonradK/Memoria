import { fireEvent, render, screen } from '@testing-library/react';
import { emptyState, PRESETS, type Game } from '@memoria/shared';
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

function renderEditor(currentGame: Game = game, tab = 'Game') {
  const updateGame = vi.fn(originalUpdateGame);
  useApp.setState({
    state: { ...emptyState(), games: [currentGame] },
    updateGame,
  });
  const view = render(<GameEditor game={currentGame} />);
  if (tab !== 'Energy') openTab(tab);
  return { ...view, updateGame };
}

/** The editor only mounts one panel, so a field off the Game tab needs its tab. */
function openTab(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: label }));
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

  it('commits an edited name on the keystroke, not on blur', () => {
    const { updateGame } = renderEditor();
    const name = screen.getByLabelText('Name', { selector: 'input' });

    // The preview, the sheet title and the roster row behind the sheet all
    // render this value, so waiting for blur showed three stale copies of it.
    fireEvent.change(name, { target: { value: 'Instant name' } });
    expect(updateGame).toHaveBeenCalledWith(game.id, { name: 'Instant name' });
  });

  it('commits the short label without waiting out a debounce', () => {
    vi.useFakeTimers();
    const { updateGame } = renderEditor();
    const short = screen.getByLabelText("Short label (shown as the game's badge)");

    fireEvent.change(short, { target: { value: 'NEW' } });
    expect(updateGame).toHaveBeenCalledWith(game.id, { short: 'NEW' });
  });

  it('flushes the latest notes when the editor unmounts', () => {
    const { unmount, updateGame } = renderEditor();
    openTab('Resets');
    const notes = screen.getByLabelText('Notes');

    fireEvent.change(notes, { target: { value: 'Live notes' } });
    expect(updateGame).toHaveBeenCalledWith(game.id, { notes: 'Live notes' });

    fireEvent.change(notes, { target: { value: 'Live notes plus tail' } });
    unmount();

    expect(updateGame).toHaveBeenLastCalledWith(game.id, { notes: 'Live notes plus tail' });
  });

  it('does not lose a name typed immediately before unmount', () => {
    const { unmount, updateGame } = renderEditor();
    const name = screen.getByLabelText('Name', { selector: 'input' });

    fireEvent.change(name, { target: { value: 'Immediate unmount name' } });
    unmount();

    expect(updateGame).toHaveBeenCalledWith(game.id, { name: 'Immediate unmount name' });
  });
});

describe('Settings game editor tabs', () => {
  it('starts with energy and wires the selected panel to its tab', () => {
    renderEditor(game, 'Energy');
    const gameTab = screen.getByRole('tab', { name: 'Energy' });

    expect(gameTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', gameTab.id);
    expect(gameTab).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id);
    // The other four sections are not merely scrolled away — they are gone.
    expect(screen.queryByRole('heading', { name: 'Quick spend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tasks' })).not.toBeInTheDocument();

    openTab('Quick spend');
    expect(screen.getByRole('heading', { name: 'Quick spend' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Name', { selector: 'input' })).not.toBeInTheDocument();
  });

  it('keeps one tab stop and moves selection with the arrow keys', () => {
    renderEditor(game, 'Energy');
    const tabs = screen.getAllByRole('tab');

    expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveFocus();

    fireEvent.keyDown(tabs[1]!, { key: 'ArrowLeft' });
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    // Wraps rather than dead-ending on the first tab.
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowLeft' });
    expect(tabs[tabs.length - 1]).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Settings game editor identity', () => {
  it('previews the name as it is typed, before the store is read back', () => {
    renderEditor();

    fireEvent.change(screen.getByLabelText('Name', { selector: 'input' }), { target: { value: 'Typed live' } });
    // The preview reads the draft, so the name is on screen in the same commit
    // as the keystroke rather than one store round trip later.
    expect(screen.getByText('Typed live')).toBeInTheDocument();
  });

  it('edits all three trio slots, including the accent gameRim reads', () => {
    const { updateGame } = renderEditor();

    fireEvent.change(screen.getByLabelText('Primary colour picker'), { target: { value: '#112233' } });
    expect(updateGame).toHaveBeenLastCalledWith(game.id, { color: '#112233' });

    fireEvent.change(screen.getByLabelText('Secondary colour picker'), { target: { value: '#223344' } });
    expect(updateGame).toHaveBeenLastCalledWith(game.id, { color2: '#223344' });

    fireEvent.change(screen.getByLabelText('Accent colour picker'), { target: { value: '#334455' } });
    expect(updateGame).toHaveBeenLastCalledWith(game.id, { color3: '#334455' });
  });

  it('restores the whole preset trio in one press', () => {
    const genshin = PRESETS.find((preset) => preset.key === 'genshin')!;
    const { updateGame } = renderEditor({
      ...game,
      name: genshin.name,
      short: genshin.short,
      presetKey: genshin.key,
      color: '#ff0000',
      color2: undefined,
      color3: undefined,
    });

    fireEvent.click(screen.getByRole('button', { name: `Restore ${genshin.name} colours` }));
    expect(updateGame).toHaveBeenLastCalledWith(game.id, {
      color: genshin.color,
      color2: genshin.color2,
      color3: genshin.color3,
    });
  });
});
