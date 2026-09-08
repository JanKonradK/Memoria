import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { useNow, useReducedMotion } from '../hooks';
import { useApp } from '../store';
import { initSync } from '../sync';
import { useUI, type Tab } from '../ui-store';
import { AddMenu } from './AddMenu';
import { HEADER_ACTIONS_SLOT } from './HeaderActions';
import { Logo } from './Logo';
import { GameScope } from './GameScope';

const ROUTES: Array<{ id: Tab; label: string }> = [
  { id: 'home', label: 'Dashboard' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'settings', label: 'Settings' },
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
  idle: 'Not synced',
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
      initSync();
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
        className={`icon h-3.5 w-3.5 ${refreshing && !reducedMotion ? 'loader-spin' : ''}`}
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
 * The shell. One fixed row carrying the wordmark, the clock, the route control,
 * the urgency counts and the theme control — the same geometry on every route,
 * so the wordmark cluster cannot shift as the user moves between them.
 *
 * This replaces two separate pieces of chrome: an "Up next" hero band that
 * restated the countdown every card already carried, and a floating rail in the
 * bottom-left corner whose clearance the page had to reserve on every route.
 * Neither earned the vertical space it cost.
 */
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
      if (!active) return;
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
  const syncStatus = useApp((s) => s.syncStatus);
  const barRef = useMeasuredBarHeight();

  return (
    <header
      ref={barRef}
      className="app-bar sticky top-0 z-40 border-b border-line bg-surface-0/92 px-3 py-2 backdrop-blur-sm sm:px-4"
    >
      {/* Tabular clock digits keep the brand width stable while time changes. */}
      <div className="app-brand flex items-center gap-2.5">
        <Logo className="[&>svg]:h-4 [&>svg]:w-8" />
        <span className="text-body font-semibold tracking-[0.12em] text-fg">MEMORIA</span>
        <span className="hidden sm:inline">
          <AppBarClock />
        </span>
      </div>

      <nav
        ref={navRef}
        aria-label="Primary"
        data-tour="pages"
        className="app-nav relative flex rounded-ui-full border border-line-hairline bg-inset p-px"
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
            className="nav-slider absolute rounded-ui-full bg-surface-2 ring-1 ring-line-strong"
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
          const active = tab === route.id;
          return (
            <button
              key={route.id}
              type="button"
              onClick={() => setTab(route.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative z-10 min-h-11 flex-1 rounded-ui-full border border-transparent px-3 text-body font-medium transition-colors sm:min-h-9 sm:flex-none sm:text-meta ${
                active ? 'text-fg' : 'text-muted hover:text-fg-soft'
              }`}
            >
              {route.label}
            </button>
          );
        })}
      </nav>

      {/* Every route's actions land here — see HeaderActions. */}
      <div className="app-route-actions scrollbar-thin flex min-w-0 items-center gap-2 overflow-x-auto">
        <GameScope />
        <div id={HEADER_ACTIONS_SLOT} className="min-w-0 shrink-0" />
      </div>

      <div className="app-utilities flex items-center justify-end gap-1 sm:gap-2">
        <span className="flex items-center gap-1.5" role="status" aria-live="polite">
          <span className="sr-only">{SYNC_ANNOUNCEMENT[syncStatus]}</span>
          <span aria-hidden className={`h-1.5 w-1.5 rounded-ui-full ${SYNC_TONE[syncStatus]}`} />
        </span>
        <AddMenu />
        <RefreshButton />
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
