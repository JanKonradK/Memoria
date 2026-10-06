import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { useNow, useReducedMotion } from '../hooks';
import { useApp } from '../store';
import { syncNow } from '../sync';
import { cloudSyncNow } from '../cloud-sync';
import { syncLanNow, useLanSync } from '../lan-sync';
import { useUI, type Tab } from '../ui-store';
import { AddMenu } from './AddMenu';
import { HEADER_ACTIONS_SLOT } from './HeaderActions';
import { Logo } from './Logo';
import { GameScope } from './GameScope';

const ROUTES: Array<{ id: Tab; label: string; icon: string }> = [
  {
    id: 'today',
    label: 'Today',
    icon: 'M10 2v2m0 12v2M2 10h2m12 0h2M4.3 4.3l1.4 1.4m8.6 8.6 1.4 1.4M4.3 15.7l1.4-1.4m8.6-8.6 1.4-1.4M14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  },
  { id: 'home', label: 'Games', icon: 'M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z' },
  { id: 'timeline', label: 'Calendar', icon: 'M3 5h14v12H3zM6 3v4M14 3v4M3 9h14M6 12h3M11 14h3' },
];

/**
 * Publishes the bar's real height as --app-bar-h, which the stage subtracts from
 * the viewport.
 *
 * The height is not a constant anyone can write down: it follows the tallest
 * control in the bar, and the bar wraps to two rows below the lg breakpoint. A
 * hard-coded guess overflowed the document by 2px the moment the route control
 * became a pill, and would be wrong again on the next control that grows.
 */
function useMeasuredBarHeight() {
  const ref = useRef<HTMLElement | null>(null);
  const publish = useCallback((height: number) => {
    document.documentElement.style.setProperty('--app-bar-h', `${height}px`);
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // getBoundingClientRect, not contentRect: the border box is what the stage
    // has to clear, and contentRect drops the padding and the 1px bottom border —
    // which is the exact 2px that overflowed the document.
    const measure = () => publish(node.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [publish]);

  return ref;
}

const SYNC_ANNOUNCEMENT = {
  idle: 'Local mode',
  syncing: 'Syncing',
  ok: 'Synced',
  error: 'Sync failed',
} as const;

const SYNC_TONE = {
  idle: 'bg-faint',
  syncing: 'bg-warn',
  ok: 'bg-ok',
  error: 'bg-danger',
} as const;

function AppBarClock() {
  const now = useNow(30_000);
  const localTz = useApp((state) => state.state.settings.localTz);
  return (
    <span className="numeral text-meta text-muted">
      {DateTime.fromMillis(now, { zone: localTz }).toFormat('HH:mm')}
    </span>
  );
}

function SyncIndicator() {
  const desktop = useApp((s) => s.syncStatus);
  const desktopError = useApp((s) => s.syncError);
  const cloud = useApp((s) => s.cloudStatus);
  const cloudError = useApp((s) => s.cloudError);
  const lan = useLanSync((s) => s.status);
  const lanError = useLanSync((s) => s.error);
  const issue =
    desktop === 'error'
      ? desktopError || 'PC sync failed'
      : cloud === 'error' || cloud === 'needs-permission'
        ? cloudError || 'Sync file needs attention'
        : lan === 'error' || lan === 'offline'
          ? lanError || 'Phone sync needs attention'
          : '';
  const statuses = [desktop, cloud, lan];
  const status = issue
    ? 'error'
    : statuses.includes('syncing') || lan === 'pairing'
      ? 'syncing'
      : statuses.includes('ok')
        ? 'ok'
        : 'idle';

  return (
    <span
      className="flex items-center gap-1.5"
      role="status"
      aria-live="polite"
      title={issue || SYNC_ANNOUNCEMENT[status]}
    >
      <span className="sr-only">{issue || SYNC_ANNOUNCEMENT[status]}</span>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-ui-md ${SYNC_TONE[status]}`} />
    </span>
  );
}

/**
 * Bring what you are looking at up to date.
 *
 * This also reseals the dashboard's card order, which used to be a second button
 * ("↻ Sort by urgency") that the dashboard grew whenever the frozen order went
 * stale. Two controls for one idea. Card order stays frozen while you work —
 * live re-sorting threw cards away mid-interaction — and this is the moment you
 * have asked for it to catch up.
 *
 * The bump goes through ui-store's orderEpoch rather than a prop, because the
 * frozen order is local to DashboardPage and this button is in the app bar.
 */
function RefreshButton() {
  const load = useApp((s) => s.load);
  const bumpOrderEpoch = useUI((s) => s.bumpOrderEpoch);
  const reducedMotion = useReducedMotion();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
      const { loaded, loadError, saveError } = useApp.getState();
      if (!loaded || loadError || saveError) return;
      await Promise.all([syncNow(), cloudSyncNow(), syncLanNow()]);
      // Only after a successful load: a refresh that failed has nothing newer to
      // sort by, and reshuffling the cards anyway would look like a response.
      bumpOrderEpoch();
    } catch (error) {
      useApp.setState({ loadError: error instanceof Error ? error.message : 'Local data operation failed.' });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={refreshing}
      aria-label="Refresh data"
      aria-busy={refreshing}
      className="shell-control disabled:cursor-wait"
    >
      <svg
        viewBox="0 0 20 20"
        aria-hidden
        className={`icon h-4 w-4 ${refreshing && !reducedMotion ? 'loader-spin' : ''}`}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M16.25 6.25V2.5m0 3.75H12.5" />
        <path d="M15.2 5.15A7 7 0 1 0 17 11" />
      </svg>
      <span className="hidden sm:inline">{refreshing ? 'Refreshing' : 'Refresh'}</span>
    </button>
  );
}

/**
 * Geometry of the active route button, so one pill can slide between them.
 *
 * useLayoutEffect, so the first paint already has the pill in the right place —
 * measuring after paint would flash it at the left edge on every load. The
 * observer keeps it honest when the bar wraps to two rows or a font finishes
 * loading and the labels change width underneath it.
 */
function useRouteSlider(tab: Tab) {
  const navRef = useRef<HTMLElement | null>(null);
  const [slider, setSlider] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('button[aria-current="page"]');
      if (!active) {
        setSlider(null);
        return;
      }
      setSlider({ x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [tab]);

  return { navRef, slider };
}

export function AppBar() {
  const tab = useUI((s) => s.tab);
  const setTab = useUI((s) => s.setTab);
  const { navRef, slider } = useRouteSlider(tab);
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const barRef = useMeasuredBarHeight();

  return (
    <header
      ref={barRef}
      className="app-bar sticky top-0 z-40 border-b border-line bg-surface-0/92 px-3 py-2 backdrop-blur-sm sm:px-4"
    >
      {/* Tabular clock digits keep the brand width stable while time changes. */}
      <div className="app-brand flex items-center gap-2.5">
        <Logo className="[&>svg]:h-4 [&>svg]:w-8" />
        <span className="text-body font-semibold tracking-[-0.02em] text-fg">Memoria</span>
        <span className="hidden sm:inline">
          <AppBarClock />
        </span>
      </div>

      <nav
        ref={navRef}
        aria-label="Primary"
        data-tour="pages"
        className="app-nav relative flex gap-1 rounded-ui-md p-px"
      >
        {/* One persistent element that slides between the tabs, rather than a
            highlight that blinks out of one button and into the next.
            Deliberately not a motion `layoutId`: that has to unmount the pill
            from one button and remount it in another, and the projection it left
            behind stuck the pill under the previously active tab. Measuring the
            active button and moving one box is both cheaper and predictable. */}
        {slider && (
          <span
            aria-hidden
            className="nav-slider absolute rounded-ui-md bg-fill-2"
            style={{
              transform: `translateX(${slider.x}px)`,
              width: slider.w,
              top: slider.y,
              height: slider.h,
              left: 0,
            }}
          />
        )}
        {ROUTES.map((route) => {
          const active = tab === route.id || (route.id === 'timeline' && tab === 'livestreams');
          return (
            <button
              key={route.id}
              type="button"
              onClick={() => setTab(route.id)}
              aria-current={active ? 'page' : undefined}
              className={`app-nav-button relative z-10 min-h-11 min-w-0 flex-1 rounded-ui-md border border-transparent px-1.5 text-meta font-medium transition-colors md:min-h-9 md:flex-none md:px-3 ${
                active ? 'text-fg' : 'text-fg-soft hover:text-fg'
              }`}
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className="h-5 w-5 md:hidden"
              >
                <path d={route.icon} />
              </svg>
              <span>{route.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Every route's actions land here — see HeaderActions. */}
      <div className="app-route-actions scrollbar-thin flex min-w-0 items-center gap-2 overflow-x-auto">
        {(tab === 'timeline' || tab === 'livestreams') && (
          <nav aria-label="Calendar views" className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="shell-control"
              aria-current={tab === 'timeline' ? 'page' : undefined}
              onClick={() => setTab('timeline')}
            >
              Events
            </button>
            <button
              type="button"
              className="shell-control"
              aria-current={tab === 'livestreams' ? 'page' : undefined}
              onClick={() => setTab('livestreams')}
            >
              Livestreams
            </button>
          </nav>
        )}
        {tab !== 'home' && tab !== 'today' && <GameScope />}
        <div id={HEADER_ACTIONS_SLOT} className="min-w-0 shrink-0" />
      </div>

      <div className="app-utilities flex items-center justify-end gap-1 sm:gap-2">
        <SyncIndicator />
        <AddMenu />
        <RefreshButton />
        <button
          type="button"
          onClick={() => setTab('settings')}
          aria-label="Settings"
          aria-current={tab === 'settings' ? 'page' : undefined}
          className="shell-control"
        >
          <svg
            viewBox="0 0 20 20"
            aria-hidden
            className="icon h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
          >
            <path d="M3 5h14M3 10h14M3 15h14M6 3v4M14 8v4M8 13v4" />
          </svg>
          <span className="hidden sm:inline">Settings</span>
        </button>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          className="shell-control"
        >
          <svg
            key={theme}
            aria-hidden
            viewBox="0 0 20 20"
            className="theme-icon icon h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {theme === 'dark' ? (
              <>
                <circle cx="10" cy="10" r="3.25" />
                <path d="M10 1.5v1.25m0 14.5v1.25M1.5 10h1.25m14.5 0h1.25M4 4l1 1m10 10 1 1M4 16l1-1M15 5l1-1" />
              </>
            ) : (
              <path d="M17 12A7.5 7.5 0 0 1 8 3a7.5 7.5 0 1 0 9 9Z" />
            )}
          </svg>
          <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </div>
    </header>
  );
}
