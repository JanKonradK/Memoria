import { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useApp } from './store';
import { initSync } from './sync';
import { useUI } from './ui-store';
import { useNow, useOnline } from './hooks';
import { applyPwaUpdate } from './pwa';
import { useSession } from './auth';
import { easing, pageEnter, duration } from './motion';
import { NavRail } from './components/NavRail';
import { Onboarding } from './components/Onboarding';
import { migrateLegacyStorageKeyForIdentity } from './storage-identity';

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
const GameCardSheet = lazy(() =>
  import('./components/GameCardSheet').then((module) => ({ default: module.GameCardSheet })),
);
const AddGameSheet = lazy(() => import('./components/AddGame').then((module) => ({ default: module.AddGameSheet })));
const EventSheet = lazy(() => import('./components/EventSheet').then((module) => ({ default: module.EventSheet })));
const ReminderSheet = lazy(() =>
  import('./components/ReminderSheet').then((module) => ({ default: module.ReminderSheet })),
);
const PasteEventsSheet = lazy(() =>
  import('./components/PasteEvents').then((module) => ({ default: module.PasteEventsSheet })),
);

export default function App() {
  const session = useSession();
  const load = useApp((s) => s.load);
  const loaded = useApp((s) => s.loaded);
  const hasGames = useApp((s) => s.state.games.some((game) => !game.deleted));
  const syncStatus = useApp((s) => s.syncStatus);
  const loadError = useApp((s) => s.loadError);
  const clearLocalData = useApp((s) => s.clearLocalData);
  const tab = useUI((s) => s.tab);
  const sheet = useUI((s) => s.sheet);
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
    if (!loaded) return;
    initSync();
  }, [loaded, session.hosted]);

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
          <h1 className="mt-2 text-heading font-black text-fg-soft">Void could not open this device's data.</h1>
          <p className="mt-2 text-body text-muted">
            Retry first. Starting fresh permanently clears this browser's local Void database; synced or exported copies
            are not affected.
          </p>
          <p className="mt-3 rounded-ui-lg bg-scrim-well p-3 text-meta text-dim">{loadError}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load().catch(reportLoadError)}
              className="min-h-11 rounded-ui-lg bg-gradient-to-br from-accent to-accent-2 px-4 py-2 text-body font-semibold text-white ring-1 ring-line-edge"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Permanently clear Void data stored in this browser and start fresh?')) {
                  void clearLocalData()
                    .then(() => {
                      if (!useApp.getState().loadError) window.location.reload();
                    })
                    .catch(reportLoadError);
                }
              }}
              className="min-h-11 rounded-ui-lg bg-danger/15 px-4 py-2 text-body font-semibold text-danger-fg ring-1 ring-danger/30"
            >
              Clear local data
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!loaded) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading Void">
        <div className="loader-spin h-12 w-12 rounded-ui-xl bg-gradient-to-br from-accent via-accent-2 to-gold" />
      </div>
    );
  }

  const onboardingKey = session.userId
    ? (migrateLegacyStorageKeyForIdentity(
        'void-onboarding',
        `user:${session.userId}`,
        'technogg-onboarding',
        `technogg-onboarding:${session.userId}`,
      ) ?? '')
    : '';
  const showOnboarding =
    session.hosted && !hasGames && syncStatus !== 'idle' && !onboardingDone && !localStorage.getItem(onboardingKey);
  if (showOnboarding) {
    return (
      <Onboarding
        onComplete={() => {
          localStorage.setItem(onboardingKey, 'complete');
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

      <main id="main-content" tabIndex={-1}>
        <Suspense fallback={<div className="px-5 py-12 text-center text-body text-dim">Loading view…</div>}>
          <m.div key={tab} variants={pageEnter} initial="hidden" animate="visible">
            {tab === 'home' && <DashboardPage now={now} />}
            {tab === 'timeline' && <TimelinePage now={now} />}
            {tab === 'settings' && <SettingsPage />}
          </m.div>
        </Suspense>
      </main>

      <div className="pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 lg:bottom-28 lg:left-4 lg:right-auto lg:w-[min(28rem,calc(100vw-2rem))] lg:items-start">
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
              <span className="min-w-0 flex-1">A new Void version is ready.</span>
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

      <NavRail />

      <Suspense fallback={null}>
        {sheet?.kind === 'game' && <GameDetailSheet open gameId={sheet.gameId} />}
        {sheet?.kind === 'gameCard' && <GameCardSheet open gameId={sheet.gameId} />}
        {sheet?.kind === 'addGame' && <AddGameSheet open />}
        {sheet?.kind === 'event' && <EventSheet open eventId={sheet.eventId} gameId={sheet.gameId} />}
        {sheet?.kind === 'reminder' && <ReminderSheet open />}
        {sheet?.kind === 'pasteEvents' && <PasteEventsSheet open />}
      </Suspense>
    </div>
  );
}
