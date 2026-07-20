import { lazy, Suspense, useEffect, useState } from 'react';
import { emptyState } from '@technogg/shared';
import { useApp } from './store';
import { initSync } from './sync';
import { useUI, type Tab } from './ui-store';
import { useNow, useOnline } from './hooks';
import { applyPwaUpdate } from './pwa';
import { useSession } from './auth';
import { Onboarding } from './components/Onboarding';

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
const PasteEventsSheet = lazy(() =>
  import('./components/PasteEvents').then((module) => ({ default: module.PasteEventsSheet })),
);

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'home', label: 'Games' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'settings', label: 'Settings' },
];

function SyncDot() {
  const status = useApp((s) => s.syncStatus);
  const color = { idle: 'bg-slate-600', syncing: 'bg-violet-400', ok: 'bg-emerald-400', error: 'bg-rose-400' }[status];
  return (
    <span
      className="relative flex h-2.5 w-2.5"
      title={`Sync: ${status}`}
      role="status"
      aria-live="polite"
      aria-label={`Sync status: ${status}`}
    >
      {status === 'syncing' && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-60`} />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}

export default function App() {
  const session = useSession();
  const load = useApp((s) => s.load);
  const loaded = useApp((s) => s.loaded);
  const appState = useApp((s) => s.state);
  const syncStatus = useApp((s) => s.syncStatus);
  const loadError = useApp((s) => s.loadError);
  const clearLocalData = useApp((s) => s.clearLocalData);
  const tab = useUI((s) => s.tab);
  const setTab = useUI((s) => s.setTab);
  const sheet = useUI((s) => s.sheet);
  // 30s tick: nothing on screen shows seconds, and a 1s tick re-rendered every
  // card + projection 60x/min for no visible benefit.
  const now = useNow(30_000);
  const online = useOnline();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [migrationChoice, setMigrationChoice] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const migrationKey = session.userId ? `technogg-account-migrated:${session.userId}` : '';
  const hasLocalData =
    loaded &&
    (useApp.getState().state.games.some((game) => !game.deleted) ||
      useApp.getState().state.events.some((event) => !event.deleted));
  const migrationPending =
    session.hosted &&
    Boolean(session.userId) &&
    hasLocalData &&
    !migrationChoice &&
    !localStorage.getItem(migrationKey);

  useEffect(() => {
    if (!loaded || migrationPending) return;
    if (session.hosted && migrationKey && !localStorage.getItem(migrationKey)) {
      localStorage.setItem(migrationKey, 'empty');
    }
    initSync();
  }, [loaded, migrationKey, migrationPending, session.hosted]);

  useEffect(() => {
    const showUpdate = () => setUpdateAvailable(true);
    document.addEventListener('tg-update-available', showUpdate);
    return () => document.removeEventListener('tg-update-available', showUpdate);
  }, []);

  if (loadError) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-5 py-12">
        <section className="glass gold-hairline w-full max-w-lg rounded-3xl p-6" role="alert">
          <p className="text-xs font-bold uppercase tracking-widest text-rose-300">Local data unavailable</p>
          <h1 className="mt-2 text-xl font-black text-slate-100">
            Techno's Library could not open this device's data.
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Retry first. Starting fresh permanently clears this browser's local Techno's Library database; synced or
            exported copies are not affected.
          </p>
          <p className="mt-3 rounded-xl bg-black/30 p-3 text-xs text-slate-500">{loadError}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="min-h-11 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Permanently clear Techno's Library data stored in this browser and start fresh?")) {
                  void clearLocalData().then(() => {
                    if (!useApp.getState().loadError) window.location.reload();
                  });
                }
              }}
              className="min-h-11 rounded-xl bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-200 ring-1 ring-rose-400/30"
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
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading Techno's Library">
        <div
          className="loader-spin h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-300"
          style={{ boxShadow: '0 0 40px rgba(124,92,255,0.5)' }}
        />
      </div>
    );
  }

  if (migrationPending) {
    const local = useApp.getState().state;
    const games = local.games.filter((game) => !game.deleted).length;
    const events = local.events.filter((event) => !event.deleted).length;
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 py-12">
        <section className="glass gold-hairline w-full max-w-xl rounded-3xl p-6" aria-labelledby="migration-title">
          <p className="text-xs font-bold uppercase tracking-widest text-violet-300">First sign-in on this device</p>
          <h1 id="migration-title" className="mt-2 text-2xl font-black text-slate-100">
            Bring your local data into your account?
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            This browser contains {games} game{games === 1 ? '' : 's'} and {events} event
            {events === 1 ? '' : 's'}. You can explicitly merge them into your private cloud document, or load only what
            is already stored in the account.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                localStorage.setItem(migrationKey, 'merged');
                setMigrationChoice(true);
              }}
              className="min-h-11 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-bold text-white"
            >
              Merge local data
            </button>
            <button
              type="button"
              onClick={() => {
                useApp.getState().replaceState(emptyState());
                localStorage.setItem(migrationKey, 'cloud-only');
                setMigrationChoice(true);
              }}
              className="min-h-11 rounded-xl bg-white/[0.06] px-4 py-2 text-sm font-semibold text-slate-200 ring-1 ring-white/15"
            >
              Use account data only
            </button>
          </div>
        </section>
      </main>
    );
  }

  const onboardingKey = session.userId ? `technogg-onboarding:${session.userId}` : '';
  const showOnboarding =
    session.hosted &&
    !appState.games.some((game) => !game.deleted) &&
    syncStatus !== 'idle' &&
    !onboardingDone &&
    !localStorage.getItem(onboardingKey);
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
        className="fixed left-3 top-3 z-[70] -translate-y-20 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-950 transition focus:translate-y-0"
      >
        Skip to content
      </a>
      {/* True-black canvas — no ambient washes; color belongs to the cards (OLED). */}
      <header className="gold-hairline !fixed inset-x-0 top-0 z-30 border-b border-white/5 bg-black/95 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.8)] supports-[backdrop-filter]:bg-black/80 supports-[backdrop-filter]:backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[1800px] items-center gap-2 px-3 sm:gap-4 sm:px-6 3xl:h-16 3xl:max-w-[2080px] 3xl:px-10">
          <h1 className="flex items-center gap-2 text-lg font-black tracking-tight">
            <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-amber-200 bg-clip-text text-transparent drop-shadow-[0_0_12px_rgba(168,85,247,0.35)]">
              Techno's Library
            </span>
          </h1>
          <div className="ml-auto flex h-full items-center gap-3">
            <nav className="hidden h-full gap-1 lg:flex" aria-label="Primary">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? 'page' : undefined}
                  className={`relative h-full px-4 text-sm font-semibold transition ${
                    tab === t.id ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                  {tab === t.id && (
                    <span className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" />
                  )}
                </button>
              ))}
            </nav>
            <SyncDot />
          </div>
        </div>
      </header>
      <div className="h-14 3xl:h-16" aria-hidden />

      {!online && (
        <div
          className="sticky top-14 z-20 border-b border-amber-300/15 bg-amber-300/10 px-4 py-2 text-center text-xs font-semibold text-amber-100 3xl:top-16"
          role="status"
          aria-live="polite"
        >
          Offline — changes stay on this device and sync when your connection returns.
        </div>
      )}
      {updateAvailable && (
        <div
          className={`sticky ${online ? 'top-14' : 'top-[88px]'} z-20 flex items-center justify-center gap-3 border-b border-violet-300/15 bg-violet-300/10 px-4 py-2 text-xs font-semibold text-violet-100`}
          role="status"
        >
          <span>A new Techno's Library version is ready.</span>
          <button
            type="button"
            onClick={applyPwaUpdate}
            className="min-h-9 rounded-lg bg-violet-300/15 px-3 py-1 text-violet-50 ring-1 ring-violet-200/25"
          >
            Update now
          </button>
          <button type="button" onClick={() => setUpdateAvailable(false)} className="min-h-9 px-2 text-violet-200">
            Later
          </button>
        </div>
      )}

      <main id="main-content" tabIndex={-1}>
        <Suspense fallback={<div className="px-5 py-12 text-center text-sm text-slate-500">Loading view…</div>}>
          <div key={tab} className="page-enter">
            {tab === 'home' && <DashboardPage now={now} />}
            {tab === 'timeline' && <TimelinePage now={now} />}
            {tab === 'settings' && <SettingsPage />}
          </div>
        </Suspense>
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-black/95 pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Primary"
      >
        <div className="mx-auto flex max-w-xl">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`flex min-h-11 flex-1 items-center justify-center py-3.5 text-xs font-semibold transition ${
                tab === t.id ? 'text-fuchsia-300' : 'text-slate-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <Suspense fallback={null}>
        {sheet?.kind === 'game' && <GameDetailSheet open gameId={sheet.gameId} />}
        {sheet?.kind === 'addGame' && <AddGameSheet open />}
        {sheet?.kind === 'event' && <EventSheet open eventId={sheet.eventId} gameId={sheet.gameId} />}
        {sheet?.kind === 'reminder' && <ReminderSheet open />}
        {sheet?.kind === 'pasteEvents' && <PasteEventsSheet open />}
      </Suspense>
    </div>
  );
}
