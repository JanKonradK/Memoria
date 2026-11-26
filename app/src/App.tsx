import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { AnimatePresence, m } from 'motion/react';
import { flushPersist, useApp } from './store';
import { initCloudSync } from './cloud-sync';
import { initNotifications } from './notifications';
import { initSync } from './sync';
import { disconnectLanSync, initLanSync } from './lan-sync';
import { useUI, type Tab } from './ui-store';
import { useNow, useOnline } from './hooks';
import { applyPwaUpdate } from './pwa';
import { useAppUpdate } from './app-update-state';
import { servedByLauncher } from './launcher';
import { initWorkspaceHistory, openGame } from './workspace-navigation';
import { arrivePage } from './page-arrival';
import { SheetHandoff } from './components/sheet-handoff';
import { initDesktopHost, type DesktopSurface, type DesktopSurfaceChange, type DesktopWindow } from './desktop-host';
import { dismissLaunchNotice, initGameLaunch, useGameLaunch } from './game-launch';
import { initPresence } from './presence';
import { initHomeWidget } from './home-widget';
import { easing, duration } from './motion';
import { nextGameStop, useTabSwipe } from './gestures';
import { refreshData } from './refresh-data';
import { AppRail } from './components/shell/AppRail';
import { Btn, focusSilently } from './components/ui';
import { confirmDialog, ConfirmHost, SuspendDialogs } from './components/ConfirmDialog';
import { splashDone } from './splash';
import { isNativeApp } from './native';

/** The dock's order, left to right, which the pages slide in from; `home` is a game's page, the Games place. */
const TAB_ORDER: readonly Tab[] = ['timeline', 'home', 'today', 'notes', 'settings'];
const tabRank = (tab: Tab) => TAB_ORDER.indexOf(tab);

const ONBOARDING_KEY = 'memoria-onboarding';
/** The key this flag shipped under before the rename; still honoured on read. */
const LEGACY_ONBOARDING_KEY = 'void-onboarding';

/** Rendered with the first real screen: the intro may leave once this has drawn. */
function SplashDone() {
  useEffect(splashDone, []);
  return null;
}

function onboardingComplete(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) !== null || localStorage.getItem(LEGACY_ONBOARDING_KEY) !== null;
  } catch {
    return false;
  }
}

function markOnboardingComplete(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, 'complete');
  } catch {
    // Without storage the setup shows again next time, which is harmless.
  }
}

const toastMotion = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: duration.fast, ease: easing.out },
  },
  exit: {
    opacity: 0,
    y: 8,
    scale: 0.98,
    transition: { duration: duration.fast, ease: easing.out },
  },
};

/**
 * Pointing at a toast or tabbing into it holds it open; it lets go once both
 * the pointer and focus have left.
 */
const holdWhileUsed = (hold: (held: boolean) => void) => ({
  onMouseEnter: () => hold(true),
  onMouseLeave: (event: { currentTarget: HTMLElement }) =>
    event.currentTarget.contains(document.activeElement) || hold(false),
  onFocus: () => hold(true),
  onBlur: (event: FocusEvent<HTMLElement>) =>
    event.currentTarget.contains(event.relatedTarget as Node | null) ||
    event.currentTarget.matches(':hover') ||
    hold(false),
});

/** A connector or capture warning raised outside Settings: a snip, Shift+S, the global shortcut. */
type ConnectorToast = { id: number; tone?: 'warn' | 'error'; text: string };

/** Settings shows the same notice inline, so it is never repeated over it. */
function useConnectorToast(tab: Tab) {
  const [notice, setNotice] = useState<ConnectorToast | null>(null);
  const [held, setHeld] = useState(false);
  if (tab === 'settings' && notice) setNotice(null);
  useEffect(() => {
    const show = ({ detail, timeStamp }: Event & { detail?: ConnectorToast }) => {
      if (typeof detail?.text !== 'string' || useUI.getState().tab === 'settings') return;
      setHeld(false);
      setNotice({ ...detail, id: timeStamp });
    };
    window.addEventListener('memoria:connector-notice', show);
    return () => window.removeEventListener('memoria:connector-notice', show);
  }, []);
  useEffect(() => {
    if (!notice || held) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice, held]);
  return [notice, setNotice, setHeld] as const;
}

const Onboarding = lazy(() => import('./components/Onboarding').then((module) => ({ default: module.Onboarding })));
const TodayRoute = lazy(() => import('./components/Today').then((module) => ({ default: module.TodayRoute })));
// The places past Today, fetched once the app is idle (prefetchPlaces) so a
// first visit opens without waiting on the network. Still their own chunks.
const timelineChunk = () => import('./components/Timeline');
const notesChunk = () => import('./components/Notes');
const settingsChunk = () => import('./components/Settings');
const TimelinePage = lazy(() => timelineChunk().then((module) => ({ default: module.TimelinePage })));
const NotesPage = lazy(() => notesChunk().then((module) => ({ default: module.NotesPage })));
const SettingsPage = lazy(() => settingsChunk().then((module) => ({ default: module.SettingsPage })));
const GameDetailSheet = lazy(() =>
  import('./components/GameDetail').then((module) => ({ default: module.GameDetailSheet })),
);
const AddGameSheet = lazy(() => import('./components/AddGame').then((module) => ({ default: module.AddGameSheet })));
const EventSheet = lazy(() => import('./components/EventSheet').then((module) => ({ default: module.EventSheet })));
const EventPeek = lazy(() => import('./components/EventPeek').then((module) => ({ default: module.EventPeek })));
const Guide = lazy(() => import('./components/Guide').then((module) => ({ default: module.Guide })));
const ReminderSheet = lazy(() =>
  import('./components/ReminderSheet').then((module) => ({ default: module.ReminderSheet })),
);
const ScreenshotConfirm = lazy(() =>
  import('./components/ScreenshotConfirm').then((module) => ({ default: module.ScreenshotConfirm })),
);
const ShortcutsSheet = lazy(() =>
  import('./components/ShortcutsSheet').then((module) => ({ default: module.ShortcutsSheet })),
);
const UpdateScreen = lazy(() =>
  import('./components/UpdateScreen').then((module) => ({ default: module.UpdateScreen })),
);
// Its own chunk, fetched only in the Windows app: the web and Android never load it.
const WindowChrome = lazy(() =>
  import('./components/WindowChrome').then((module) => ({ default: module.WindowChrome })),
);
// Fetched only once the Windows app's window becomes the quick card.
const CompactGameCard = lazy(() =>
  import('./components/CompactGameCard').then((module) => ({ default: module.CompactGameCard })),
);

/** Where the full app was when the quick card took the window, to come back to. */
type FullView = { scrollY: number; tab: Tab; focusedGameId: string | null };

/**
 * What the Windows app's one window shows: the full app, or the quick card for
 * one game. Before the card takes over, the page notes where it was and commits
 * any value being typed; coming back, it opens the game asked for, or returns
 * to the same place at the same scroll.
 */
function useDesktopSurface(host: DesktopWindow | undefined): DesktopSurface | null {
  const [surface, setSurface] = useState<DesktopSurface | null>(null);
  const view = useRef<FullView | null>(null);
  const returning = useRef<{ openGameId: string | null } | null>(null);
  useEffect(() => {
    if (!host?.onSurfaceChanged) return;
    let active = true;
    let heard = false;
    let mode: DesktopSurface['mode'] = 'full';
    const apply = (next: DesktopSurfaceChange) => {
      if (!active) return;
      if (next.mode === 'compact' && mode !== 'compact') {
        const ui = useUI.getState();
        view.current = { scrollY: window.scrollY, tab: ui.tab, focusedGameId: ui.focusedGameId };
        // Inline energy editors commit on blur, before their field is hidden.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
      if (next.mode === 'full' && mode === 'compact') returning.current = { openGameId: next.openGameId ?? null };
      mode = next.mode;
      setSurface(next);
    };
    const stop = host.onSurfaceChanged((next) => {
      heard = true;
      apply(next);
    });
    // A page reloaded under the card opens as the card.
    void host.getSurface?.().then(
      (next) => !heard && apply(next),
      () => undefined,
    );
    return () => {
      active = false;
      stop();
    };
  }, [host]);
  const mode = surface?.mode;
  useEffect(() => {
    const back = returning.current;
    if (mode !== 'full' || !back) return;
    returning.current = null;
    const before = view.current;
    view.current = null;
    if (back.openGameId && useApp.getState().state.games.some((game) => game.id === back.openGameId && !game.deleted)) {
      openGame(back.openGameId);
      return;
    }
    const ui = useUI.getState();
    // A game started meanwhile turned the page to it: that page keeps its own place.
    if (!before || ui.tab !== before.tab || ui.focusedGameId !== before.focusedGameId) return;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: before.scrollY, behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, [mode]);
  return surface;
}

/** Start a module that loads after the first screen; stop it, or never start it, on cleanup. */
function startLater<T>(module: Promise<T>, start: (loaded: T) => () => void): () => void {
  let stop: (() => void) | undefined;
  let active = true;
  void module.then((loaded) => {
    if (active) stop = start(loaded);
  });
  return () => {
    active = false;
    stop?.();
  };
}

/**
 * Once the first screen is up and the browser is idle, fetch the other places'
 * chunks, so a first visit to one never waits on "Loading view…". Skipped when
 * the device asks to save data. Off the startup path: they stay async chunks.
 */
function prefetchPlaces(): () => void {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (saveData) return () => undefined;
  const fetchAll = () => {
    for (const chunk of [timelineChunk, notesChunk, settingsChunk]) void chunk().catch(() => undefined);
  };
  if (typeof window.requestIdleCallback === 'function') {
    const idle = window.requestIdleCallback(fetchAll, { timeout: 5000 });
    return () => window.cancelIdleCallback(idle);
  }
  const timer = window.setTimeout(fetchAll, 2000);
  return () => window.clearTimeout(timer);
}

/** Where a typed `?` is text, not a request for the shortcuts. */
function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

/** `?` anywhere outside a field opens the keyboard shortcuts, unless a dialog already has the screen. */
function useShortcutsKey(disabled = false) {
  useEffect(() => {
    if (disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (typingInto(event.target) || useUI.getState().sheet) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      useUI.getState().openSheet({ kind: 'shortcuts' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled]);
}

/**
 * Shift+S starts a screen snip in the Windows app, outside fields and open
 * dialogs. The connectors load only when it is pressed, never at startup.
 */
function useSnipKey(disabled = false) {
  useEffect(() => {
    if (disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 's' || !event.shiftKey || event.repeat || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!window.memoriaDesktop?.connectors?.screenshot?.capture) return;
      if (typingInto(event.target) || useUI.getState().sheet) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      void import('./connectors').then(({ captureScreenshot }) => captureScreenshot('snip'));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled]);
}

type PagePosition = { page: number; board: number };

/** Restore only after the lazy page has mounted, so its content can hold the scroll. */
function PageFrame({
  tab,
  direction,
  positions,
  children,
}: {
  tab: Tab;
  direction: 1 | -1;
  positions: RefObject<Map<string, PagePosition>>;
  children: ReactNode;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const page = pageRef.current;
    const savedPositions = positions.current;
    const positionKey = () => `${tab}:${tab === 'today' ? '' : (useUI.getState().focusedGameId ?? '')}`;
    const saved = savedPositions.get(positionKey()) ?? { page: 0, board: 0 };
    const restore = () => {
      window.scrollTo({ top: saved.page, behavior: 'instant' });
      const board = page?.querySelector<HTMLElement>('.timeline-board');
      if (board) board.scrollTop = saved.board;
    };
    restore();
    // The timeline measures its lanes on mount. Restore once more after that layout.
    const frame = requestAnimationFrame(restore);
    return () => {
      cancelAnimationFrame(frame);
      savedPositions.set(positionKey(), {
        page: window.scrollY,
        board: page?.querySelector<HTMLElement>('.timeline-board')?.scrollTop ?? 0,
      });
    };
  }, [positions, tab]);
  // The page arrives once, as it mounts with its content: what is under its
  // bar fades in (and on the dock glides from the side its place sits on).
  // The bar stays where it rests; content that mounts later never replays it.
  useLayoutEffect(() => arrivePage(pageRef.current, direction), [direction]);
  return (
    <div ref={pageRef} className="page-enter">
      {children}
    </div>
  );
}

/** Keep countdown updates inside the active page, away from editors and the shell. */
function LivePage({ tab }: { tab: 'today' | 'home' | 'timeline' }) {
  const now = useNow(30_000);
  return tab === 'timeline' ? <TimelinePage now={now} /> : <TodayRoute tab={tab} now={now} />;
}

/**
 * Sheets open from the store, not from a Radix trigger, so Radix has nothing to
 * give focus back to when one closes. The control that opened it gets it back,
 * once the sheet has left, if focus was dropped and that control is still here.
 */
function useSheetFocusReturn(open: boolean) {
  const origin = useRef<HTMLElement | null>(null);
  // A layout effect runs before the sheet's focus scope moves focus inside it.
  useLayoutEffect(() => {
    if (!open || origin.current) return;
    const active = document.activeElement;
    origin.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);
  return () => {
    const target = origin.current;
    origin.current = null;
    // After Radix's own close handling, which runs on the next task.
    window.setTimeout(() => {
      const active = document.activeElement;
      if (useUI.getState().sheet || !target?.isConnected || (active && active !== document.body)) return;
      focusSilently(target);
    }, 0);
  };
}

function AppSheets() {
  const sheet = useUI((s) => s.sheet);
  const returnFocus = useSheetFocusReturn(Boolean(sheet));
  const key = sheet ? JSON.stringify(sheet) : null;
  // Whether the last change went from one sheet straight to another (a handoff:
  // sheet-handoff.ts). Stored with the key it was decided on, like the pages'
  // direction in AppScreens, so it holds for the whole exit and entrance.
  const [route, setRoute] = useState({ key, handoff: false });
  if (route.key !== key) setRoute({ key, handoff: route.key !== null && key !== null });
  const handoff = route.handoff;
  return (
    <SheetHandoff value={handoff}>
      <AnimatePresence mode="wait" onExitComplete={() => !useUI.getState().sheet && returnFocus()}>
        {sheet && (
          // A new lazy editor must not suspend the outgoing sheet during its exit.
          // Mid-handoff its fallback is the scrim, so the page never shows between the two.
          <Suspense key={key} fallback={handoff ? <HandoffScrim /> : null}>
            {sheet.kind === 'game' && (
              <GameDetailSheet key={`game-${sheet.gameId}`} open gameId={sheet.gameId} initialSection={sheet.section} />
            )}
            {sheet.kind === 'addGame' && <AddGameSheet key="add-game" open />}
            {sheet.kind === 'event' && (
              <EventSheet key={`event-${sheet.eventId ?? 'new'}`} open eventId={sheet.eventId} gameId={sheet.gameId} />
            )}
            {sheet.kind === 'eventPeek' && <EventPeek key={`peek-${sheet.eventId}`} open eventId={sheet.eventId} />}
            {sheet.kind === 'reminder' && <ReminderSheet key="reminder" open />}
            {sheet.kind === 'guide' && <Guide key="guide" open />}
            {sheet.kind === 'shortcuts' && <ShortcutsSheet key="shortcuts" open />}
          </Suspense>
        )}
      </AnimatePresence>
    </SheetHandoff>
  );
}

/** The scrim alone, while the next sheet's chunk is still on its way. */
function HandoffScrim() {
  return <div aria-hidden className="sheet-scrim fixed inset-0 z-50 bg-scrim-veil backdrop-blur-[2px]" />;
}

/** The update screen and its download code load once a newer version is found. */
function UpdateScreenHost() {
  const found = useAppUpdate((s) => s.release !== null);
  if (!found) return null;
  return (
    <Suspense fallback={null}>
      <UpdateScreen />
    </Suspense>
  );
}

/**
 * The screenshot confirmation sheet. Its module, and the connectors behind it,
 * load only once a screenshot is first waiting, so they stay off the startup path.
 */
function ScreenshotConfirmHost() {
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (wanted) return;
    const want = () => setWanted(true);
    window.addEventListener('memoria:pending-screenshot', want);
    return () => window.removeEventListener('memoria:pending-screenshot', want);
  }, [wanted]);
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <ScreenshotConfirm />
    </Suspense>
  );
}

/**
 * The save-error banner's own way to reload and resync: the rail's Refresh is
 * only down the side of a wide screen, never on the phone's dock.
 */
function RefreshDataButton() {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Btn
      disabled={refreshing}
      aria-busy={refreshing}
      onClick={() => {
        setRefreshing(true);
        void refreshData().finally(() => setRefreshing(false));
      }}
    >
      Refresh data
    </Btn>
  );
}

/**
 * One confirm host, and in the Windows app one title bar, for every screen:
 * recovery, setup and the app itself. The quick card brings its own bar and
 * the full app waits hidden underneath it, still running, with every draft kept.
 */
export default function App() {
  const desktopWindow = window.memoriaDesktop?.window;
  const surface = useDesktopSurface(desktopWindow);
  const card = desktopWindow && surface?.mode === 'compact' ? surface : null;
  return (
    <>
      {desktopWindow && !card && (
        <Suspense fallback={null}>
          <WindowChrome host={desktopWindow} />
        </Suspense>
      )}
      {desktopWindow && card && (
        <Suspense fallback={null}>
          <CompactGameCard host={desktopWindow} surface={card} />
        </Suspense>
      )}
      <SuspendDialogs suspended={Boolean(card)}>
        <AppScreens hidden={Boolean(card)} />
        <ConfirmHost />
      </SuspendDialogs>
    </>
  );
}

/** `hidden`: the quick card has the window. Everything keeps running underneath. */
function AppScreens({ hidden = false }: { hidden?: boolean }) {
  const load = useApp((s) => s.load);
  const loaded = useApp((s) => s.loaded);
  const hasGames = useApp((s) => s.state.games.some((game) => !game.deleted));
  const syncStatus = useApp((s) => s.syncStatus);
  const loadError = useApp((s) => s.loadError);
  const saveError = useApp((s) => s.saveError);
  const [retryingSave, setRetryingSave] = useState(false);
  const clearLocalData = useApp((s) => s.clearLocalData);
  const tab = useUI((s) => s.tab);
  const setTab = useUI((s) => s.setTab);

  const pagePositions = useRef(new Map<string, PagePosition>());

  // Which way the pages travel. The direction belongs to the transition that is
  // happening rather than to the tab, so it is stored WITH the tab it arrived
  // at: derived alone it would be lost the moment the tab settled, and kept in
  // a ref it would be a write during render.
  const [nav, setNav] = useState<{ tab: Tab; direction: 1 | -1 }>({ tab, direction: 1 });
  if (nav.tab !== tab) {
    setNav({ tab, direction: tabRank(tab) > tabRank(nav.tab) ? 1 : -1 });
  }
  const direction = nav.tab === tab ? nav.direction : 1;

  // Only a game's page swipes, through its own tabs. At either end it
  // rubber-bands and stays: never off to another game or place.
  const swipe = useTabSwipe((towards) => {
    const ui = useUI.getState();
    const next = nextGameStop(ui.gameTabs, ui.gameTab, towards);
    if (next) ui.setGameTab(next, towards);
  });

  // The game page is the only thing on the internal `home` route. A deleted
  // game, or a route restored without one, has nothing to show there.
  const focusedGameId = useUI((s) => s.focusedGameId);
  const hasFocusedGame = useApp((s) => s.state.games.some((game) => !game.deleted && game.id === focusedGameId));
  useEffect(() => {
    if (loaded && tab === 'home' && !hasFocusedGame) setTab('today');
  }, [loaded, tab, hasFocusedGame, setTab]);
  const online = useOnline();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const launchNotice = useGameLaunch((s) => s.notice);
  const undoNotice = useUI((s) => s.undoNotice);
  const [connectorNotice, setConnectorNotice, holdConnectorNotice] = useConnectorToast(tab);
  useEffect(() => {
    if (!launchNotice || launchNotice.tone === 'error') return;
    const timer = window.setTimeout(dismissLaunchNotice, 6000);
    return () => window.clearTimeout(timer);
  }, [launchNotice]);
  const autoTourStarted = useRef(false);
  const [setup, setSetup] = useState(false);
  const reportLoadError = (error: unknown) => {
    useApp.setState({ loadError: error instanceof Error ? error.message : 'Local data operation failed.' });
  };

  useEffect(() => {
    void load().catch(reportLoadError);
  }, [load]);

  useEffect(initWorkspaceHistory, []);
  useShortcutsKey(hidden);
  useSnipKey(hidden);
  useEffect(initDesktopHost, []);
  useEffect(initGameLaunch, []);

  useEffect(() => {
    if (loaded) return initPresence();
  }, [loaded]);

  useEffect(() => {
    if (loaded) return initHomeWidget();
  }, [loaded]);

  useEffect(() => {
    // Android keeps a copy in a folder the player chose; the module loads only there.
    if (loaded && isNativeApp) return startLater(import('./auto-backup'), ({ initAutoBackup }) => initAutoBackup());
  }, [loaded]);

  useEffect(() => {
    if (loaded) return startLater(import('./data/remote-feed'), ({ initRemoteFeed }) => initRemoteFeed());
  }, [loaded]);

  useEffect(() => {
    if (loaded) return initNotifications();
  }, [loaded]);

  useEffect(() => {
    if (!loaded) return;
    initSync();
    // Both, deliberately. They write to different places and both land through
    // mergeState, so a launcher window can also keep a copy in a synced folder
    // — which is the only way a second machine ever sees this document.
    initCloudSync();
    initLanSync();
  }, [loaded]);

  useEffect(() => {
    // Live numbers are a native feature; a browser never loads the module.
    if (!loaded || (!window.memoriaDesktop?.connectors && !isNativeApp)) return;
    return startLater(import('./connectors'), ({ initConnectors }) => initConnectors());
  }, [loaded]);

  useEffect(() => {
    if (loaded) return prefetchPlaces();
  }, [loaded]);

  useEffect(() => {
    if (!loaded) return;
    return startLater(import('./app-update'), ({ initAppUpdates }) =>
      initAppUpdates(() => useUI.getState().openSettings('activity')),
    );
  }, [loaded]);

  useEffect(() => {
    const showUpdate = () => setUpdateAvailable(true);
    document.addEventListener('tg-update-available', showUpdate);
    return () => document.removeEventListener('tg-update-available', showUpdate);
  }, []);

  useEffect(() => {
    if (!loaded || loadError || autoTourStarted.current || onboardingComplete()) return;
    if (servedByLauncher() && (syncStatus === 'idle' || syncStatus === 'syncing')) return;
    autoTourStarted.current = true;
    // Existing synced rosters already know the app. A fresh install starts by
    // picking its games; the tour follows, over the real dashboard.
    if (!hasGames) setSetup(true);
  }, [loaded, loadError, syncStatus, hasGames]);

  if (loadError) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-5 py-12" hidden={hidden}>
        <SplashDone />
        <section className="glass gold-hairline w-full max-w-lg rounded-ui-card p-6" role="alert">
          <p className="text-meta font-bold uppercase tracking-widest text-danger-fg">Local data unavailable</p>
          <h1 className="mt-2 text-heading font-black text-fg-soft">Could not open your data</h1>
          <p className="mt-2 text-body text-muted">
            Retry first. Starting fresh deletes the data on this device; synced and exported copies are kept.
          </p>
          <p className="mt-3 rounded-ui-lg bg-scrim-well p-3 text-meta text-dim">{loadError}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Btn kind="primary" onClick={() => void load().catch(reportLoadError)}>
              Retry
            </Btn>
            <Btn
              kind="danger"
              onClick={async () => {
                const clear = await confirmDialog({
                  title: 'Delete all Memoria data on this device and start fresh?',
                  description: 'Synced and exported copies are kept.',
                  confirmLabel: 'Clear local data',
                  danger: true,
                });
                if (clear) {
                  void disconnectLanSync()
                    .then(clearLocalData)
                    .then(() => {
                      if (!useApp.getState().loadError) window.location.reload();
                    })
                    .catch(reportLoadError);
                }
              }}
            >
              Clear local data
            </Btn>
          </div>
        </section>
      </main>
    );
  }

  if (!loaded) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center"
        role="status"
        aria-label="Loading Memoria"
        hidden={hidden}
      >
        <div className="loader-spin h-12 w-12 rounded-ui-xl bg-gradient-to-br from-accent via-accent-2 to-gold" />
      </div>
    );
  }

  // First-run setup is its own chunk: only a fresh install ever downloads it.
  // The intro stays until it has drawn.
  if (setup && !hasGames)
    return (
      <div hidden={hidden}>
        <Suspense fallback={null}>
          <SplashDone />
          <Onboarding
            onComplete={() => {
              markOnboardingComplete();
              setSetup(false);
            }}
          />
        </Suspense>
      </div>
    );

  return (
    <div className="app-frame relative min-h-dvh" hidden={hidden}>
      <a
        href="#main-content"
        className="fixed left-3 top-[calc(0.75rem+var(--desktop-chrome-h))] z-[70] -translate-y-20 rounded-ui-lg bg-fg px-4 py-2 text-body font-bold text-fg-invert transition focus:translate-y-0"
      >
        Skip to content
      </a>

      <AppRail />

      {/* overflow-x-clip, not hidden: `hidden` would make this a scroll
          container and trap the page's own sticky positioning. Clipping keeps
          the outgoing page out of document.scrollWidth mid-transition, which is
          what stops the slide from producing a horizontal scrollbar.
          touch-action lets the browser keep vertical scrolling natively, so a
          scroll never waits on the swipe handler to make up its mind. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="relative overflow-x-clip [touch-action:pan-y_pinch-zoom]"
        {...(tab === 'home' ? swipe : {})}
      >
        {saveError && (
          <section className="mx-4 my-3 space-y-2 rounded-ui-lg bg-danger/10 p-4 text-body" role="alert">
            <p className="font-semibold text-danger-fg">Your latest changes were not saved.</p>
            <p className="text-muted">Keep Memoria open and try again.</p>
            <div className="flex flex-wrap gap-2">
              <Btn
                disabled={retryingSave}
                onClick={() => {
                  setRetryingSave(true);
                  void flushPersist()
                    .catch(() => undefined)
                    .finally(() => setRetryingSave(false));
                }}
              >
                {retryingSave ? 'Saving…' : 'Try saving again'}
              </Btn>
              <RefreshDataButton />
              <Btn onClick={() => useUI.getState().openSettings('data')}>Open backup settings</Btn>
            </div>
            <details className="text-meta text-muted">
              <summary className="cursor-pointer py-2">Save error details</summary>
              <p className="break-words">{saveError}</p>
            </details>
          </section>
        )}
        {/* An entrance re-keyed on the tab, deliberately NOT a motion-library one.
            Every route is a lazy chunk, and a subtree that suspends part-way
            through a JS-driven transition leaves the library holding an element
            it can no longer drive. Both AnimatePresence modes failed that way
            here — popLayout parked both pages at opacity 0, wait never mounted
            the incoming one — and the failure mode of a JS page transition is a
            blank app, which is far worse than the thing it was buying.
            PageFrame's arrival (page-arrival.ts) has no such failure mode: it
            starts once the page has mounted with its content, animates FROM the
            offset with no fill-mode, and the resting state is the plain visible
            page. If it never runs, for any reason, the page is simply there.
            The exit slide is what this gives up; the direction still reads. */}
        <Suspense fallback={<div className="px-5 py-12 text-center text-body text-dim">Loading view…</div>}>
          <PageFrame key={tab} tab={tab} direction={direction} positions={pagePositions}>
            {tab === 'settings' ? <SettingsPage /> : tab === 'notes' ? <NotesPage /> : <LivePage tab={tab} />}
          </PageFrame>
          {/* Commits with the page, once its lazy chunk has arrived. */}
          <SplashDone />
        </Suspense>
      </main>

      {/* Phone notices clear the bottom navigation and the device safe area. */}
      <div className="app-toasts pointer-events-none fixed inset-x-3 z-50 flex flex-col items-center gap-2 lg:left-auto lg:right-4 lg:w-[min(28rem,calc(100vw-2rem))] lg:items-end">
        <AnimatePresence>
          {!online && !saveError && (
            <m.div
              key="offline"
              variants={toastMotion}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="pointer-events-auto w-full rounded-ui-xl bg-popover/95 px-4 py-3 text-center text-meta font-semibold text-warn-fg shadow-float ring-1 ring-warn/25 backdrop-blur-md"
              role="status"
              aria-live="polite"
            >
              Offline. Changes are saved on this device.
            </m.div>
          )}
          {undoNotice && (
            <m.div
              key={`undo-${undoNotice.id}`}
              variants={toastMotion}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="pointer-events-auto flex w-full items-center gap-2 rounded-ui-xl bg-popover/95 px-4 py-2 text-meta font-semibold text-fg-soft shadow-float ring-1 ring-line-strong backdrop-blur-md"
              role="status"
              aria-live="polite"
              {...holdWhileUsed((held) => (held ? useUI.getState().pauseUndo() : useUI.getState().resumeUndo()))}
            >
              <span className="min-w-0 flex-1">{undoNotice.text}</span>
              <button
                type="button"
                className="min-h-9 rounded-ui-md bg-accent/15 px-3 py-1 text-accent-fg ring-1 ring-accent/25"
                onClick={() => {
                  undoNotice.undo();
                  useUI.getState().dismissUndo();
                }}
              >
                Undo
              </button>
            </m.div>
          )}
          {launchNotice && (
            <m.div
              key="launch"
              variants={toastMotion}
              initial="hidden"
              animate="visible"
              exit="exit"
              className={`pointer-events-auto flex w-full items-center gap-2 rounded-ui-xl bg-popover/95 px-4 py-2 text-meta font-semibold shadow-float ring-1 backdrop-blur-md ${
                launchNotice.tone === 'error' ? 'text-danger-fg ring-danger/25' : 'text-fg-soft ring-line-strong'
              }`}
              role={launchNotice.tone === 'error' ? 'alert' : 'status'}
            >
              <span className="min-w-0 flex-1">{launchNotice.text}</span>
              <button type="button" onClick={dismissLaunchNotice} className="min-h-9 px-2">
                Dismiss
              </button>
            </m.div>
          )}
          {connectorNotice && (
            <m.div
              key={`connector-${connectorNotice.id}`}
              variants={toastMotion}
              initial="hidden"
              animate="visible"
              exit="exit"
              className={`pointer-events-auto flex w-full items-center gap-2 rounded-ui-xl bg-popover/95 px-4 py-2 text-meta font-semibold shadow-float ring-1 backdrop-blur-md ${
                connectorNotice.tone === 'error' ? 'text-danger-fg ring-danger/25' : 'text-warn-fg ring-warn/25'
              }`}
              role={connectorNotice.tone === 'error' ? 'alert' : 'status'}
              {...holdWhileUsed(holdConnectorNotice)}
            >
              <span className="min-w-0 flex-1">{connectorNotice.text}</span>
              <button type="button" onClick={() => setConnectorNotice(null)} className="min-h-9 px-2">
                Dismiss
              </button>
            </m.div>
          )}
          {updateAvailable && (
            <m.div
              key="update"
              variants={toastMotion}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="pointer-events-auto flex w-full flex-wrap items-center justify-center gap-2 rounded-ui-xl bg-popover/95 px-4 py-2 text-meta font-semibold text-accent-fg shadow-float ring-1 ring-accent/25 backdrop-blur-md"
              role="status"
              aria-live="polite"
            >
              <span className="min-w-0 flex-1">New version ready.</span>
              <button
                type="button"
                onClick={applyPwaUpdate}
                className="min-h-9 rounded-ui-md bg-accent/15 px-3 py-1 text-accent-fg ring-1 ring-accent/25"
              >
                Update now
              </button>
              <button type="button" onClick={() => setUpdateAvailable(false)} className="min-h-9 px-2 text-accent-fg">
                Later
              </button>
            </m.div>
          )}
        </AnimatePresence>
      </div>

      <AppSheets />
      <ScreenshotConfirmHost />
      <UpdateScreenHost />
    </div>
  );
}
