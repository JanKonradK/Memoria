import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState, type Note } from '@memoria/shared';
import { makeEvent, makeGame } from '../../shared/test/helpers';

vi.mock('../src/components/Today', () => ({ TodayRoute: () => <div>Today page</div> }));
vi.mock('../src/components/Settings', () => ({ SettingsPage: () => <div>Settings page</div> }));
vi.mock('../src/cloud-sync', () => ({ initCloudSync: vi.fn(), cloudSyncNow: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/data/remote-feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/remote-feed')>()),
  initRemoteFeed: vi.fn(),
}));
vi.mock('../src/sync', () => ({ initSync: vi.fn(), syncNow: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/pwa', () => ({ applyPwaUpdate: vi.fn() }));

import App from '../src/App';
import { AppRail } from '../src/components/shell/AppRail';
import { NoteCard } from '../src/components/notes/NoteCard';
import { TimelinePage } from '../src/components/Timeline';
import { TooltipProvider } from '../src/components/ui';
import { useTabSwipe } from '../src/gestures';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';

const touch = { pointerId: 7, pointerType: 'touch', isPrimary: true };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useUI.getState().dismissUndo();
  useApp.setState({ state: emptyState() });
  useUI.setState({ tab: 'today', focusedGameId: null, lastGameId: null, sheet: null, timelineView: null });
});

describe('H5: the Calendar week board keeps its sideways swipe', () => {
  const NOW = Date.UTC(2026, 10, 18, 12);
  const DAY = 86_400_000;

  function Page({ onSwipe }: { onSwipe: (towards: 1 | -1) => void }) {
    const swipe = useTabSwipe(onSwipe);
    return (
      <main {...swipe}>
        <div className="page-enter">
          <TimelinePage now={NOW} />
          <p data-testid="outside">Elsewhere on the page</p>
        </div>
      </main>
    );
  }

  function drag(target: HTMLElement, from: number, to: number) {
    fireEvent.pointerDown(target, { ...touch, clientX: from, clientY: 100 });
    fireEvent.pointerMove(target, { ...touch, clientX: (from + to) / 2, clientY: 100 });
    fireEvent.pointerMove(target, { ...touch, clientX: to, clientY: 100 });
    fireEvent.pointerUp(target, { ...touch, clientX: to, clientY: 100 });
  }

  it('steps the week without also changing page', () => {
    const game = makeGame({ id: 'g', name: 'Testland', updatedAt: NOW });
    useApp.setState({
      state: {
        ...emptyState(),
        games: [game],
        events: [makeEvent({ id: 'e', gameId: game.id, name: 'Story', start: NOW - DAY, end: NOW + DAY })],
      },
    });
    const onSwipe = vi.fn();
    const { container } = render(
      <TooltipProvider>
        <Page onSwipe={onSwipe} />
      </TooltipProvider>,
    );
    const board = container.querySelector<HTMLElement>('.tl-board')!;
    const dates = () => screen.getAllByRole('group', { name: /^Dates shown:/ })[0]!.getAttribute('aria-label');
    const before = dates();

    // The same finger, seen as pointer events by the page and as touches by the board.
    fireEvent.touchStart(board, { touches: [{ clientX: 300, clientY: 100 }] });
    drag(board, 300, 100);
    fireEvent.touchEnd(board, { changedTouches: [{ clientX: 100, clientY: 100 }] });

    expect(dates()).not.toBe(before);
    expect(onSwipe).not.toHaveBeenCalled();
    expect(container.querySelector('.page-enter')).not.toHaveAttribute('data-swiping');

    // The board let the finger go: a swipe elsewhere still changes page.
    drag(screen.getByTestId('outside'), 300, 100);
    expect(onSwipe).toHaveBeenCalledWith(1);
  });
});

describe('H6: connector and capture notices outside Settings', () => {
  const notify = (tone: 'warn' | 'error', text: string) =>
    act(() => {
      window.dispatchEvent(new CustomEvent('memoria:connector-notice', { detail: { tone, text } }));
    });

  async function renderApp(tab: 'today' | 'settings') {
    vi.spyOn(useApp.getState(), 'load').mockResolvedValue();
    useApp.setState({ state: emptyState(), loaded: true, loadError: '' });
    useUI.setState({ tab, sheet: null });
    localStorage.setItem('memoria-onboarding', 'complete');
    render(<App />);
    await act(() => vi.dynamicImportSettled());
  }

  it('shows an error as an alert with Dismiss, and lets a warning time out unless held', async () => {
    vi.useFakeTimers();
    await renderApp('today');

    notify('error', 'The snip could not be read.');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The snip could not be read.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(screen.queryByText('The snip could not be read.')).toBeNull();

    notify('warn', 'Add a game first, then read a screenshot into it.');
    const warning = screen.getByText('Add a game first, then read a screenshot into it.').closest('[role="status"]')!;
    expect(warning).not.toBeNull();
    fireEvent.mouseEnter(warning);
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('Add a game first, then read a screenshot into it.')).toBeInTheDocument();
    fireEvent.mouseLeave(warning);
    await act(async () => vi.advanceTimersByTime(7000));
    expect(screen.queryByText('Add a game first, then read a screenshot into it.')).toBeNull();
  });

  it('does not repeat a notice over Settings, which shows it inline', async () => {
    await renderApp('settings');
    expect(await screen.findByText('Settings page')).toBeInTheDocument();
    notify('error', 'Memoria cannot read HoYoLAB numbers.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Memoria cannot read HoYoLAB numbers.')).toBeNull();
  });
});

it('loads first-run setup on its own, off the startup path, and still shows it', async () => {
  vi.spyOn(useApp.getState(), 'load').mockResolvedValue();
  useApp.setState({ state: emptyState(), loaded: true, loadError: '' });
  useUI.setState({ tab: 'today', sheet: null });
  render(<App />);
  await act(() => vi.dynamicImportSettled());
  expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  expect(screen.queryByText('Today page')).toBeNull();
});

describe('M8: the Undo notice holds while it is used', () => {
  beforeEach(() => vi.useFakeTimers());

  it('pauses and resumes with what it had left, never less than a short grace', () => {
    const ui = useUI.getState();
    ui.showUndo('Note deleted', () => {});
    vi.advanceTimersByTime(3000);
    ui.pauseUndo();
    vi.advanceTimersByTime(60_000);
    expect(useUI.getState().undoNotice?.text).toBe('Note deleted');
    ui.resumeUndo();
    vi.advanceTimersByTime(3900);
    expect(useUI.getState().undoNotice).not.toBeNull();
    vi.advanceTimersByTime(200);
    expect(useUI.getState().undoNotice).toBeNull();

    ui.showUndo('Dailies ticked', () => {});
    vi.advanceTimersByTime(6900);
    ui.pauseUndo();
    ui.resumeUndo();
    vi.advanceTimersByTime(2400);
    expect(useUI.getState().undoNotice).not.toBeNull();
    vi.advanceTimersByTime(200);
    expect(useUI.getState().undoNotice).toBeNull();
  });

  it('holds while the toast is pointed at or focused, and lets go once both leave', async () => {
    vi.spyOn(useApp.getState(), 'load').mockResolvedValue();
    useApp.setState({ state: emptyState(), loaded: true, loadError: '' });
    useUI.setState({ tab: 'today', sheet: null });
    localStorage.setItem('memoria-onboarding', 'complete');
    render(<App />);
    await act(() => vi.dynamicImportSettled());

    act(() => useUI.getState().showUndo('Note deleted', () => {}));
    const button = screen.getByRole('button', { name: 'Undo' });
    const toast = button.closest('[role="status"]')!;

    fireEvent.mouseEnter(toast);
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(useUI.getState().undoNotice).not.toBeNull();

    // Focus inside keeps it held after the pointer leaves.
    act(() => button.focus());
    fireEvent.mouseLeave(toast);
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(useUI.getState().undoNotice).not.toBeNull();

    act(() => button.blur());
    await act(async () => vi.advanceTimersByTime(7100));
    expect(useUI.getState().undoNotice).toBeNull();
  });
});

describe('M9: a note being written stays open when the window loses focus', () => {
  const note: Note = { id: 'n', gameId: null, title: 'Plan', body: 'Farm', sort: 1, updatedAt: 1 };

  function renderEditing() {
    useApp.setState({ state: { ...emptyState(), notes: [note] } });
    const onEditing = vi.fn();
    render(<NoteCard note={note} games={[]} now={0} showGame={false} compact={false} editing onEditing={onEditing} />);
    return { onEditing, box: screen.getByRole('textbox', { name: 'Note' }) };
  }

  it('ignores the blur of switching to another window', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { onEditing, box } = renderEditing();
    fireEvent.blur(box, { relatedTarget: null });
    expect(onEditing).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument();
  });

  it('still closes on a press elsewhere in the app', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { onEditing, box } = renderEditing();
    fireEvent.blur(box, { relatedTarget: null });
    expect(onEditing).toHaveBeenCalledWith(false);
  });
});

describe('M10: Alt+4 never opens a deleted game', () => {
  it('falls back to the first live game when the last one open was deleted', () => {
    const state = emptyState();
    state.games = [
      makeGame({ id: 'gone', name: 'Retired', sort: 0, deleted: true }),
      makeGame({ id: 'first', name: 'Genshin Impact', sort: 1 }),
      makeGame({ id: 'second', name: 'Honkai: Star Rail', sort: 2 }),
    ];
    useApp.setState({ state, loaded: true, loadError: '', saveError: '' });
    useUI.setState({ tab: 'today', focusedGameId: null, lastGameId: 'gone', sheet: null });
    render(
      <TooltipProvider>
        <AppRail />
      </TooltipProvider>,
    );
    fireEvent.keyDown(document, { key: '4', altKey: true });
    expect(useUI.getState()).toMatchObject({ tab: 'home', focusedGameId: 'first' });

    // A live last game still wins.
    useUI.setState({ tab: 'today', focusedGameId: null, lastGameId: 'second' });
    fireEvent.keyDown(document, { key: '4', altKey: true });
    expect(useUI.getState()).toMatchObject({ tab: 'home', focusedGameId: 'second' });
  });
});
