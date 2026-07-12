import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { useEffect } from 'react';
import { useApp } from './store';
import { initSync } from './sync';
import { initHoyolab } from './hoyolab-client';
import { useUI, type Tab } from './ui-store';
import { useNow } from './hooks';
import { DashboardPage } from './components/Dashboard';
import { TimelinePage } from './components/Timeline';
import { SettingsPage } from './components/Settings';
import { GameDetailSheet } from './components/GameDetail';
import { AddGameSheet } from './components/AddGame';
import { EventSheet } from './components/EventSheet';
import { ReminderSheet } from './components/ReminderSheet';
import { HoyoImportSheet } from './components/HoyoImport';
import { PasteEventsSheet } from './components/PasteEvents';
import { StatsPage } from './components/Stats';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'home', label: 'Games' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'stats', label: 'Stats' },
  { id: 'settings', label: 'Settings' },
];

function SyncDot() {
  const status = useApp((s) => s.syncStatus);
  const color = { idle: 'bg-slate-600', syncing: 'bg-violet-400', ok: 'bg-emerald-400', error: 'bg-rose-400' }[status];
  return (
    <span className="relative flex h-2.5 w-2.5" title={`Sync: ${status}`}>
      {status === 'syncing' && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-60`} />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}

export default function App() {
  const load = useApp((s) => s.load);
  const loaded = useApp((s) => s.loaded);
  const tab = useUI((s) => s.tab);
  const setTab = useUI((s) => s.setTab);
  const sheet = useUI((s) => s.sheet);
  const now = useNow(1000);

  useEffect(() => {
    void load().then(() => {
      initSync();
      initHoyolab();
    });
  }, [load]);

  if (!loaded) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <motion.div
          className="h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-300"
          animate={{ rotate: 360, borderRadius: ['30%', '45%', '30%'] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
          style={{ boxShadow: '0 0 40px rgba(124,92,255,0.5)' }}
        />
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user" transition={{ type: 'spring', stiffness: 300, damping: 30, mass: 0.8 }}>
    <div className="relative min-h-dvh">
      {/* True-black canvas — no ambient washes; color belongs to the cards (OLED). */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-black/85 backdrop-blur-xl gold-hairline">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-5">
          <h1 className="flex items-center gap-2 text-lg font-black tracking-tight">
            <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-amber-200 bg-clip-text text-transparent drop-shadow-[0_0_12px_rgba(168,85,247,0.35)]">
              TechnoGG
            </span>
          </h1>
          <SyncDot />
          <nav className="ml-auto hidden gap-1 sm:flex">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative rounded-xl px-4 py-1.5 text-sm font-semibold transition ${
                  tab === t.id ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab === t.id && (
                  <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-xl bg-white/10 ring-1 ring-white/15" />
                )}
                <span className="relative">{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
          >
            {tab === 'home' && <DashboardPage now={now} />}
            {tab === 'timeline' && <TimelinePage now={now} />}
            {tab === 'stats' && <StatsPage now={now} />}
            {tab === 'settings' && <SettingsPage />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg sm:hidden">
        <div className="flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center py-3.5 text-xs font-semibold transition ${
                tab === t.id ? 'text-fuchsia-300' : 'text-slate-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <GameDetailSheet open={sheet?.kind === 'game'} gameId={sheet?.kind === 'game' ? sheet.gameId : null} />
      <AddGameSheet open={sheet?.kind === 'addGame'} />
      <EventSheet
        open={sheet?.kind === 'event'}
        eventId={sheet?.kind === 'event' ? sheet.eventId : undefined}
        gameId={sheet?.kind === 'event' ? sheet.gameId : undefined}
      />
      <ReminderSheet open={sheet?.kind === 'reminder'} />
      <HoyoImportSheet open={sheet?.kind === 'hoyoImport'} />
      <PasteEventsSheet open={sheet?.kind === 'pasteEvents'} />
    </div>
    </MotionConfig>
  );
}
