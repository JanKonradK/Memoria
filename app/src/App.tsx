import { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useApp } from './store';
import { initCloudSync } from './cloud-sync';
import { initSync } from './sync';
import { useUI, type Tab } from './ui-store';
import { useNow, useOnline } from './hooks';
import { applyPwaUpdate } from './pwa';
import { servedByLauncher } from './launcher';
import { easing, duration } from './motion';
import { useTabSwipe } from './gestures';
import { AppBar } from './components/AppBar';
import { Onboarding } from './components/Onboarding';
import { Btn } from './components/ui';

/** Left to right, matching the route pill in the app bar. */
const TAB_ORDER = ['home', 'timeline', 'settings'] as const;

const ONBOARDING_KEY = 'memoria-onboarding';
/** The key this flag shipped under before the rename; still honoured on read. */
const LEGACY_ONBOARDING_KEY = 'void-onboarding';

function onboardingComplete(): boolean {
  return localStorage.getItem(ONBOARDING_KEY) !== null || localStorage.getItem(LEGACY_ONBOARDING_KEY) !== null;
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

const DashboardPage = lazy(() =>
  import('./components/Dashboard').then((module) => ({ default: module.DashboardPage })),
);
const TimelinePage = lazy(() => import('./components/Timeline').then((module) => ({ default: module.TimelinePage })));
const SettingsPage = lazy(() => import('./components/Settings').then((module) => ({ default: module.SettingsPage })));
const GameDetailSheet = lazy(() =>
  import('./components/GameDetail').then((module) => ({ default: module.GameDetailSheet })),
);
const AddGameSheet = lazy(() => import('./components/AddGame').then((module) => ({ default: module.AddGameSheet })));
const EventSheet = lazy(() => import('./components/EventSheet').then((module) => ({ default: module.EventSheet })));
const ReminderSheet = lazy(() =>
  import('./components/ReminderSheet').then((module) => ({ default: module.ReminderSheet })),
);

export default function App() {
  const load = useApp((s) => s.load);
  const loaded = useApp((s) => s.loaded);
  const hasGames = useApp((s) => s.state.games.some((game) => !game.deleted));
  const syncStatus = useApp((s) => s.syncStatus);
  const loadError = useApp((s) => s.loadError);
  const clearLocalData = useApp((s) => s.clearLocalData);
  const tab = useUI((s) => s.tab);
  const setTab = useUI((s) => s.setTab);
  const sheet = useUI((s) => s.sheet);

  // Which way the pages travel. The direction belongs to the transition that is
  // happening rather than to the tab, so it is stored WITH the tab it arrived
  // at: derived alone it would be lost the moment the tab settled, and kept in
  // a ref it would be a write during render.
  const [nav, setNav] = useState<{ tab: Tab; direction: 1 | -1 }>({ tab, direction: 1 });
  if (nav.tab !== tab) {
    setNav({ tab, direction: TAB_ORDER.indexOf(tab) > TAB_ORDER.indexOf(nav.tab) ? 1 : -1 });
  }
  const direction = nav.tab === tab ? nav.direction : 1;

  const swipe = useTabSwipe((towards) => {
    const next = TAB_ORDER[TAB_ORDER.indexOf(tab) + towards];
    if (next) setTab(next);
  });
  // 30s tick: nothing on screen shows seconds, and a 1s tick re-rendered every
  // card + projection 60x/min for no visible benefit.
  const now = useNow(30_000);
  const online = useOnline();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const reportLoadError = (error: unknown) => {
    useApp.setState({ loadError: error instanceof Error ? error.message : 'Local data operation failed.' });
  };

  useEffect(() => {
    void load().catch(reportLoadError);
  }, [load]);

  useEffect(() => {
    if (!loaded) return;
    initSync();
    // Both, deliberately. They write to different places and both land through
    // mergeState, so a launcher window can also keep a copy in a synced folder
    // — which is the only way a second machine ever sees this document.
    initCloudSync();
  }, [loaded]);

  useEffect(() => {
    const showUpdate = () => setUpdateAvailable(true);
    document.addEventListener('tg-update-available', showUpdate);
    return () => document.removeEventListener('tg-update-available', showUpdate);
  }, []);

  if (loadError) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-5 py-12">
        <section className="glass gold-hairline w-full max-w-lg rounded-ui-card p-6" role="alert">
          <p className="text-meta font-bold uppercase tracking-widest text-danger-fg">Local data unavailable</p>
          <h1 className="mt-2 text-heading font-black text-fg-soft">Memoria could not open this device's data.</h1>
          <p className="mt-2 text-body text-muted">
            Retry first. Starting fresh permanently clears this browser's local Memoria database; synced or exported
            copies are not affected.
          </p>
          <p className="mt-3 rounded-ui-lg bg-scrim-well p-3 text-meta text-dim">{loadError}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Btn kind="primary" onClick={() => void load().catch(reportLoadError)}>
              Retry
            </Btn>
            <Btn
              kind="danger"
              onClick={() => {
                if (window.confirm('Permanently clear Memoria data stored in this browser and start fresh?')) {
                  void clearLocalData()
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
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading Memoria">
        <div className="loader-spin h-12 w-12 rounded-ui-xl bg-gradient-to-br from-accent via-accent-2 to-gold" />
      </div>
    );
  }

  // Under the launcher the first sync can still bring games in from state.json,
  // so waiting for it to resolve keeps onboarding from flashing over real data.
  const dataSettled = !servedByLauncher() || syncStatus !== 'idle';
  const showOnboarding = !hasGames && dataSettled && !onboardingDone && !onboardingComplete();
  if (showOnboarding) {
    return (
      <Onboarding
        onComplete={() => {
          localStorage.setItem(ONBOARDING_KEY, 'complete');
          setOnboardingDone(true);
        }}
      />
    );
  }

  return (
    <div className="relative min-h-dvh">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[70] -translate-y-20 rounded-ui-lg bg-fg px-4 py-2 text-body font-bold text-fg-invert transition focus:translate-y-0"
      >
        Skip to content
      </a>

      <AppBar />

      {/* overflow-x-clip, not hidden: `hidden` would make this a scroll
          container and trap the page's own sticky positioning. Clipping keeps
          the outgoing page out of document.scrollWidth mid-transition, which is
          what stops the slide from producing a horizontal scrollbar.
          touch-action lets the browser keep vertical scrolling natively, so a
          scroll never waits on the swipe handler to make up its mind. */}
      <main id="main-content" tabIndex={-1} className="relative overflow-x-clip [touch-action:pan-y]" {...swipe}>
        {/* A CSS entrance, re-keyed on the tab, deliberately NOT a motion one.
            Every route is a lazy chunk, and a subtree that suspends part-way
            through a JS-driven transition leaves the library holding an element
            it can no longer drive. Both AnimatePresence modes failed that way
            here — popLayout parked both pages at opacity 0, wait never mounted
            the incoming one — and the failure mode of a JS page transition is a
            blank app, which is far worse than the thing it was buying.
            A keyframe has no such failure mode: it animates FROM the offset with
            no fill-mode, so the resting state is the plain visible one. If the
            animation never runs, for any reason, the page is simply there.
            The exit slide is what this gives up; the direction still reads. */}
        <Suspense fallback={<div className="px-5 py-12 text-center text-body text-dim">Loading view…</div>}>
          <div key={tab} className="page-enter" data-direction={direction}>
            {tab === 'home' && <DashboardPage now={now} />}
            {tab === 'timeline' && <TimelinePage now={now} />}
            {tab === 'settings' && <SettingsPage />}
          </div>
        </Suspense>
      </main>

      {/* The floating rail this used to clear is gone, so the toasts sit on the
          bottom edge itself. */}
      <div className="pointer-events-none fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 lg:left-auto lg:right-4 lg:w-[min(28rem,calc(100vw-2rem))] lg:items-end">
        <AnimatePresence>
          {!online && (
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
              Offline — changes stay on this device and sync when your connection returns.
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
              <span className="min-w-0 flex-1">A new Memoria version is ready.</span>
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

      <Suspense fallback={null}>
        {sheet?.kind === 'game' && <GameDetailSheet open gameId={sheet.gameId} />}
        {sheet?.kind === 'addGame' && <AddGameSheet open />}
        {sheet?.kind === 'event' && <EventSheet open eventId={sheet.eventId} gameId={sheet.gameId} />}
        {sheet?.kind === 'reminder' && <ReminderSheet open />}
      </Suspense>
    </div>
  );
}
