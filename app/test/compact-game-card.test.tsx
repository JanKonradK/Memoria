import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { emptyHistory, emptyState, type AppState, type QuickChip } from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEvent, makeGame, makeResource, makeTask } from '../../shared/test/helpers';
import { CompactGameCard, endingSoon, pickCardGame } from '../src/components/CompactGameCard';
import { DesktopPresence } from '../src/components/settings/DesktopPresence';
import { TooltipProvider } from '../src/components/ui';
import { usePresence } from '../src/presence';
import type {
  DesktopHost,
  DesktopPresence as Presence,
  DesktopSurface,
  DesktopSurfaceChange,
  DesktopWindow,
} from '../src/desktop-host';
import { useApp } from '../src/store';
import { useUI } from '../src/ui-store';

// The full app's places, for the one test that renders the whole window.
vi.mock('../src/components/Today', () => ({ TodayRoute: () => <div>Today page</div> }));
vi.mock('../src/components/Timeline', () => ({ TimelinePage: () => <div>Timeline page</div> }));
vi.mock('../src/components/Settings', () => ({ SettingsPage: () => <div>Settings page</div> }));
vi.mock('../src/components/shell/AppRail', () => ({ AppRail: () => <nav>Rail</nav> }));
vi.mock('../src/cloud-sync', () => ({ initCloudSync: vi.fn() }));
vi.mock('../src/data/remote-feed', () => ({ initRemoteFeed: vi.fn() }));
vi.mock('../src/sync', () => ({ initSync: vi.fn(), flushSync: vi.fn(async () => undefined) }));
vi.mock('../src/pwa', () => ({ applyPwaUpdate: vi.fn() }));

const NOW = Date.now();
const HOUR = 3_600_000;
const genshin = makeGame({ id: 'genshin', name: 'Genshin Impact', short: 'GI', sort: 0 });
const hsr = makeGame({ id: 'hsr', name: 'Star Rail', short: 'HSR', sort: 1 });
const steady = { regenMinutes: 1_000_000, kind: 'regen' as const };

function roster(over: Partial<AppState> = {}): AppState {
  const chip: QuickChip = { id: 'domain', gameId: 'genshin', label: 'Domain', delta: -20, sort: 0, updatedAt: 1 };
  return {
    ...emptyState(),
    games: [genshin, hsr],
    resources: [
      makeResource({ id: 'resin', gameId: 'genshin', name: 'Original Resin', cap: 200, ...steady }),
      makeResource({ id: 'condensed', gameId: 'genshin', name: 'Condensed Resin', cap: 5, kind: 'counter', sort: 1 }),
      makeResource({
        id: 'tp',
        gameId: 'hsr',
        name: 'Trailblaze Power',
        cap: 240,
        reserveCap: 2400,
        reserveLabel: 'Reserved Power',
        ...steady,
      }),
    ],
    snapshots: [
      { id: 's-resin', resourceId: 'resin', value: 120, takenAt: NOW },
      { id: 's-condensed', resourceId: 'condensed', value: 2, takenAt: NOW },
      { id: 's-tp', resourceId: 'tp', value: 100, reserve: 500, takenAt: NOW },
    ],
    chips: [chip],
    tasks: [
      makeTask({ id: 'commissions', gameId: 'genshin', name: 'Daily commissions', sort: 0 }),
      makeTask({ id: 'points', gameId: 'genshin', name: 'Encounter points', sort: 1 }),
      makeTask({ id: 'boss', gameId: 'genshin', name: 'Weekly boss', cadence: 'weekly', sort: 2 }),
    ],
    events: [
      makeEvent({ id: 'far', gameId: 'genshin', name: 'Far festival', start: NOW - HOUR, end: NOW + 120 * HOUR }),
      makeEvent({ id: 'fishing', gameId: 'genshin', name: 'Fishing', start: NOW - HOUR, end: NOW + 40 * HOUR }),
      makeEvent({ id: 'lantern', gameId: 'genshin', name: 'Lantern Rite', start: NOW - HOUR, end: NOW + 10 * HOUR }),
      makeEvent({
        id: 'done',
        gameId: 'genshin',
        name: 'Done event',
        start: NOW - HOUR,
        end: NOW + 3 * HOUR,
        done: true,
      }),
      makeEvent({ id: 'later', gameId: 'genshin', name: 'Not yet', start: NOW + 5 * HOUR, end: NOW + 30 * HOUR }),
      makeEvent({ id: 'other', gameId: 'hsr', name: 'Other game', start: NOW - HOUR, end: NOW + 5 * HOUR }),
    ],
    ...over,
  };
}

function fakeWindow(initial: Partial<DesktopSurface> = {}) {
  const surface: DesktopSurface = { mode: 'compact', gameId: 'genshin', pinned: true, autoOpened: false, ...initial };
  let emit: (next: DesktopSurfaceChange) => void = () => undefined;
  const state = { maximized: false, focused: true, zoom: 1 };
  const host: DesktopWindow = {
    minimize: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => state),
    close: vi.fn(async () => undefined),
    getState: vi.fn(async () => state),
    onStateChanged: () => () => undefined,
    enterCompact: vi.fn(async (gameId?: string | null) => ({ ...surface, gameId: gameId ?? null })),
    exitCompact: vi.fn(async () => ({ mode: 'full' as const, gameId: null, pinned: false, autoOpened: false })),
    setCompactPin: vi.fn(async (pinned: boolean) => ({ ...surface, pinned })),
    getSurface: vi.fn(async () => surface),
    onSurfaceChanged: (listener) => {
      emit = listener;
      return () => (emit = () => undefined);
    },
  };
  return { host, surface, emit: (next: DesktopSurfaceChange) => act(() => emit(next)) };
}

function showCard(initial: Partial<DesktopSurface> = {}) {
  const fake = fakeWindow(initial);
  const view = render(
    <TooltipProvider>
      <CompactGameCard host={fake.host} surface={fake.surface} />
    </TooltipProvider>,
  );
  return { ...fake, ...view };
}

const latest = (resourceId: string) =>
  useApp
    .getState()
    .state.snapshots.filter((snapshot) => snapshot.resourceId === resourceId)
    .sort((a, b) => b.takenAt - a.takenAt)[0];

beforeEach(() => {
  useApp.setState({ state: roster(), loaded: true, loadError: '', history: emptyHistory('compact-test') });
  useUI.setState({ tab: 'today', sheet: null, focusedGameId: null });
});

afterEach(() => {
  useApp.setState({ state: emptyState() });
  useUI.setState({ tab: 'today', sheet: null, focusedGameId: null, undoNotice: null });
  delete window.memoriaDesktop;
  vi.restoreAllMocks();
});

describe('the quick card', () => {
  it('opens on the reading, commits a typed value and moves on to the first daily still owed', () => {
    showCard();
    const reading = screen.getByLabelText('Original Resin current value');
    expect(reading).toHaveFocus();
    expect(reading).toHaveValue('120');
    // The card's own bar is the only title bar, and sheets clear it.
    expect(document.querySelectorAll('[data-window-chrome]')).toHaveLength(1);
    expect(document.documentElement).toHaveAttribute('data-desktop-chrome');

    fireEvent.input(reading, { target: { value: '90' } });
    fireEvent.keyDown(reading, { key: 'Enter' });
    expect(latest('resin')?.value).toBe(90);
    expect(screen.getByRole('checkbox', { name: /Daily commissions/ })).toHaveFocus();

    // A, S, D and F step the reading as on the full card.
    act(() => reading.focus());
    fireEvent.keyDown(reading, { key: 'f' });
    expect(latest('resin')?.value).toBe(100);
  });

  it('waits to be clicked when Memoria opened it itself', () => {
    showCard({ autoOpened: true });
    expect(screen.getByLabelText('Original Resin current value')).not.toHaveFocus();
  });

  it('spends from the quick chips and the full and spent-all buttons', () => {
    showCard();
    fireEvent.click(screen.getByRole('button', { name: /Domain/ }));
    expect(latest('resin')?.value).toBe(100);
    fireEvent.click(screen.getByRole('button', { name: 'Spent all Original Resin' }));
    expect(latest('resin')?.value).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Original Resin full' }));
    expect(latest('resin')?.value).toBe(200);
  });

  it('shows the counter banked from the bar, and a reserve under its own bar', () => {
    const { unmount } = showCard();
    const counter = screen.getByLabelText('Condensed Resin for Original Resin');
    expect(counter).toHaveValue('2');
    unmount();
    showCard({ gameId: 'hsr' });
    expect(screen.getByLabelText('Trailblaze Power current value')).toHaveValue('100');
    expect(screen.getByLabelText('Reserved Power for Trailblaze Power')).toHaveValue('500');
  });

  it('ticks dailies one by one, walks them with the arrow keys, and ticks them all at once', () => {
    showCard();
    const dailies = screen.getByRole('region', { name: 'Daily tasks for Genshin Impact' });
    const rows = within(dailies).getAllByRole('checkbox');
    expect(rows.map((row) => row.textContent)).toEqual(['Daily commissions', 'Encounter points']);
    expect(within(dailies).queryByText('Weekly boss')).not.toBeInTheDocument();
    for (const row of rows) expect(row).toHaveClass('compact-card-daily');

    act(() => rows[0]!.focus());
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(rows[1]).toHaveFocus();
    fireEvent.keyDown(rows[1]!, { key: 'ArrowUp' });
    expect(rows[0]).toHaveFocus();
    // Up from the first daily goes back to the reading.
    fireEvent.keyDown(rows[0]!, { key: 'ArrowUp' });
    expect(screen.getByLabelText('Original Resin current value')).toHaveFocus();

    fireEvent.click(rows[0]!);
    expect(within(dailies).getByRole('checkbox', { name: /Daily commissions/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(within(dailies).getByRole('checkbox', { name: /Daily commissions/ }));
    expect(within(dailies).getByRole('checkbox', { name: /Daily commissions/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    fireEvent.click(within(dailies).getByRole('button', { name: 'Tick all dailies for Genshin Impact' }));
    for (const row of within(dailies).getAllByRole('checkbox')) expect(row).toHaveAttribute('aria-checked', 'true');
    expect(within(dailies).getByText('2/2')).toBeInTheDocument();
    fireEvent.click(within(dailies).getByRole('button', { name: 'Undo completing dailies for Genshin Impact' }));
    for (const row of within(dailies).getAllByRole('checkbox')) expect(row).toHaveAttribute('aria-checked', 'false');
  });

  it('lists up to three unfinished events ending within three days, soonest first, each opening the game', () => {
    const { host } = showCard();
    const ending = screen.getByRole('region', { name: 'Ending soon for Genshin Impact' });
    expect(
      within(ending)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([expect.stringContaining('Lantern Rite'), expect.stringContaining('Fishing')]);
    fireEvent.click(within(ending).getByRole('button', { name: /Lantern Rite/ }));
    expect(host.exitCompact).toHaveBeenCalledWith({ openGameId: 'genshin', toTray: false });
  });

  it('pins, opens the full app on its game, closes, and puts itself away on Escape', () => {
    const { host } = showCard();
    const pin = screen.getByRole('button', { name: 'Keep on top' });
    expect(pin).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(pin);
    expect(host.setCompactPin).toHaveBeenCalledWith(false);
    expect(pin).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Open in Memoria' }));
    expect(host.exitCompact).toHaveBeenLastCalledWith({ openGameId: 'genshin', toTray: false });
    fireEvent.click(screen.getByRole('button', { name: 'Close quick card' }));
    expect(host.exitCompact).toHaveBeenLastCalledWith();

    // Escape over a typed draft throws the draft away and keeps the card.
    vi.mocked(host.exitCompact!).mockClear();
    const reading = screen.getByLabelText('Original Resin current value');
    act(() => reading.focus());
    fireEvent.input(reading, { target: { value: '55' } });
    fireEvent.keyDown(reading, { key: 'Escape' });
    expect(host.exitCompact).not.toHaveBeenCalled();
    expect(latest('resin')?.value).toBe(120);
    // The next one puts the card away.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(host.exitCompact).toHaveBeenCalledWith();
  });

  it('switches to another game it tracks', () => {
    const { host } = showCard();
    fireEvent.change(screen.getByRole('combobox', { name: 'Show another game' }), { target: { value: 'hsr' } });
    expect(host.enterCompact).toHaveBeenCalledWith('hsr');
    expect(screen.getByLabelText('Trailblaze Power current value')).toBeInTheDocument();
  });

  it('offers the full app when there is no game to update', () => {
    useApp.setState({
      state: roster({
        games: [
          { ...genshin, paused: true },
          { ...hsr, paused: true },
        ],
      }),
    });
    const { host } = showCard();
    expect(screen.getByText(/No game to update/)).toBeInTheDocument();
    const open = screen.getAllByRole('button', { name: 'Open in Memoria' });
    fireEvent.click(open.at(-1)!);
    expect(host.exitCompact).toHaveBeenCalledWith({ openGameId: null, toTray: false });
  });
});

describe('which game and events the card shows', () => {
  const order = [genshin, hsr, { ...makeGame({ id: 'paused', name: 'Paused' }), paused: true }].map((game) => ({
    game,
    next: null,
    actions: [],
  }));

  it('takes the asked-for game, else the page behind it, else the most urgent, never a paused one', () => {
    const behind = { tab: 'today' as const, focusedGameId: null };
    expect(pickCardGame(order, 'hsr', behind)?.id).toBe('hsr');
    expect(pickCardGame(order, 'paused', behind)?.id).toBe('genshin');
    expect(pickCardGame(order, null, { tab: 'home', focusedGameId: 'hsr' })?.id).toBe('hsr');
    expect(pickCardGame(order, null, { tab: 'today', focusedGameId: 'hsr' })?.id).toBe('genshin');
    expect(pickCardGame(order.slice(2), null, behind)).toBeUndefined();
  });

  it('keeps unfinished events ending within 72 hours', () => {
    expect(endingSoon(roster().events, 'genshin', NOW).map((event) => event.id)).toEqual(['lantern', 'fishing']);
    const many = Array.from({ length: 5 }, (_, index) =>
      makeEvent({ id: `e${index}`, gameId: 'genshin', start: NOW - HOUR, end: NOW + (index + 1) * HOUR }),
    );
    expect(endingSoon(many, 'genshin', NOW)).toHaveLength(3);
  });
});

describe('the window becoming the card', () => {
  it('hides the full app under one title bar and comes back on the game asked for', async () => {
    vi.spyOn(useApp.getState(), 'load').mockResolvedValue();
    localStorage.setItem('memoria-onboarding', 'complete');
    const fake = fakeWindow({ mode: 'full', gameId: null, pinned: false });
    const host: DesktopHost = {
      version: 1,
      window: fake.host,
      onCloseRequested: () => () => undefined,
      completeClose: () => undefined,
    };
    window.memoriaDesktop = host;
    const { default: App } = await import('../src/App');
    render(
      <TooltipProvider>
        <App />
      </TooltipProvider>,
    );
    await act(() => vi.dynamicImportSettled());
    expect(await screen.findByRole('button', { name: 'Minimize' })).toBeInTheDocument();
    expect(document.querySelector('.app-frame')).not.toHaveAttribute('hidden');

    fake.emit({ mode: 'compact', gameId: 'genshin', pinned: true, autoOpened: false });
    await act(() => vi.dynamicImportSettled());
    expect(await screen.findByRole('button', { name: 'Close quick card' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Minimize' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-window-chrome]')).toHaveLength(1);
    expect(document.querySelector('.app-frame')).toHaveAttribute('hidden');

    fake.emit({ mode: 'full', gameId: null, pinned: false, autoOpened: false, openGameId: 'genshin' });
    await act(() => vi.dynamicImportSettled());
    expect(await screen.findByRole('button', { name: 'Minimize' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close quick card' })).not.toBeInTheDocument();
    expect(document.querySelector('.app-frame')).not.toHaveAttribute('hidden');
    expect(useUI.getState()).toMatchObject({ tab: 'home', focusedGameId: 'genshin' });
  });

  it('suspends an open sheet and global shortcuts under the card without losing drafts', async () => {
    vi.spyOn(useApp.getState(), 'load').mockResolvedValue();
    localStorage.setItem('memoria-onboarding', 'complete');
    const fake = fakeWindow({ mode: 'full', gameId: null, pinned: false });
    const host: DesktopHost = {
      version: 1,
      window: fake.host,
      onCloseRequested: () => () => undefined,
      completeClose: () => undefined,
    };
    window.memoriaDesktop = host;
    const { default: App } = await import('../src/App');
    render(
      <TooltipProvider>
        <App />
      </TooltipProvider>,
    );
    await act(() => vi.dynamicImportSettled());

    // Entering compact from full also ignores global shortcuts like `?`.
    fake.emit({ mode: 'compact', gameId: 'genshin', pinned: true, autoOpened: false });
    await act(() => vi.dynamicImportSettled());
    expect(await screen.findByRole('button', { name: 'Close quick card' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '?' });
    expect(useUI.getState().sheet).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    fake.emit({ mode: 'full', gameId: null, pinned: false, autoOpened: false });
    await act(() => vi.dynamicImportSettled());

    // Open an event sheet and edit a draft before switching to the quick card.
    act(() => useUI.getState().openSheet({ kind: 'event', gameId: 'genshin' }));
    await act(() => vi.dynamicImportSettled());
    const dialog = await screen.findByRole('dialog');
    const nameInput = within(dialog).getByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'Draft event' } });
    expect(nameInput).toHaveValue('Draft event');

    fake.emit({ mode: 'compact', gameId: 'genshin', pinned: true, autoOpened: false });
    await act(() => vi.dynamicImportSettled());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getByLabelText('Original Resin current value')).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(fake.host.exitCompact).toHaveBeenCalledWith();

    fake.emit({ mode: 'full', gameId: null, pinned: false, autoOpened: false });
    await act(() => vi.dynamicImportSettled());
    const restored = await screen.findByRole('dialog');
    expect(within(restored).getByLabelText('Name')).toHaveValue('Draft event');
  });
});

describe('the quick card in Settings', () => {
  const presence: Presence = {
    openAtLogin: false,
    closeToTray: true,
    gameStartNotices: true,
    remindersOnPc: true,
    canStartWithWindows: false,
    gameWatch: true,
    compactPopOutOnStop: false,
    compactAlwaysOnTop: true,
    compactShortcut: { enabled: false, accelerator: '', registered: false, error: null },
  };

  it('is opt-in, and its shortcut starts blank until keys are chosen', async () => {
    const set = vi.fn(async (changes: Partial<Presence>) => ({ ...presence, ...changes }));
    const setCompactShortcut = vi.fn(async (enabled: boolean, accelerator: string | null) => ({
      ...presence,
      compactShortcut: { enabled, accelerator: accelerator ?? '', registered: enabled, error: null },
    }));
    window.memoriaDesktop = {
      version: 1,
      presence: { set, setCompactShortcut } as unknown as DesktopHost['presence'],
      onCloseRequested: () => () => undefined,
      completeClose: () => undefined,
    };
    usePresence.setState({ presence, error: '' });
    render(
      <TooltipProvider>
        <DesktopPresence />
      </TooltipProvider>,
    );
    const popOut = screen.getByRole('switch', { name: 'Open quick card when a game closes' });
    expect(popOut).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Keep quick card on top' })).toBeChecked();
    // No keys yet: the shortcut cannot be switched on.
    expect(screen.getByRole('switch', { name: 'Quick card shortcut' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Clear quick card shortcut' })).not.toBeInTheDocument();

    fireEvent.click(popOut);
    await act(async () => undefined);
    expect(set).toHaveBeenCalledWith({ compactPopOutOnStop: true });

    // Choosing keys is the opt-in: the first ones turn it on.
    fireEvent.click(screen.getByRole('button', { name: 'Choose quick card shortcut' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Press shortcut… (Esc cancels)' }), {
      key: 'q',
      code: 'KeyQ',
      ctrlKey: true,
      altKey: true,
    });
    await act(async () => undefined);
    expect(setCompactShortcut).toHaveBeenCalledWith(true, 'Ctrl+Alt+Q');
    expect(screen.getByRole('switch', { name: 'Quick card shortcut' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Clear quick card shortcut' }));
    await act(async () => undefined);
    expect(setCompactShortcut).toHaveBeenLastCalledWith(false, '');

    // Keys another app holds are reported, with Windows' reason.
    act(() =>
      usePresence.setState({
        presence: {
          ...presence,
          compactShortcut: {
            enabled: true,
            accelerator: 'Ctrl+Alt+Q',
            registered: false,
            error: 'Another app uses it.',
          },
        },
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Ctrl+Alt+Q could not be set: Another app uses it.');
  });

  it('asks for game following before it can open the card when a game closes', () => {
    usePresence.setState({ presence: { ...presence, gameStartNotices: false }, error: '' });
    render(
      <TooltipProvider>
        <DesktopPresence />
      </TooltipProvider>,
    );
    expect(screen.getByRole('switch', { name: 'Open quick card when a game closes' })).toBeDisabled();
    expect(screen.getByText('Turn on Follow the game you start first.')).toBeInTheDocument();
  });
});
