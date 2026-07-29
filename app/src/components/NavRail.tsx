import { useEffect, useState, type ReactNode } from 'react';
import { m } from 'motion/react';
import { useMediaQuery } from '../hooks';
import { useApp } from '../store';
import { useUI, type Tab } from '../ui-store';
import { springs } from '../motion';
import { AddGameButton } from './AddGameCell';
import { Ring } from './Ring';
import { Logo } from './Logo';
import { Segmented } from './ui';

const TABS: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  {
    id: 'home',
    label: 'Games',
    icon: (
      <svg aria-hidden viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7.2 8.2h9.6a4 4 0 0 1 3.8 5.2l-1 3.2a2 2 0 0 1-3.2 1l-2.1-1.7H9.7l-2.1 1.7a2 2 0 0 1-3.2-1l-1-3.2a4 4 0 0 1 3.8-5.2Z" />
        <path d="M8 11v4M6 13h4M16.5 12h.01M18 14h.01" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'timeline',
    label: 'Timeline',
    icon: (
      <svg aria-hidden viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 5v14M5 8h8M5 16h14M13 8v4M19 12v4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg aria-hidden viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3.8 14 5l2.3-.2.9 2.1 2 1.3-.6 2.3.6 2.3-2 1.3-.9 2.1L14 16l-2 1.2-2-1.2-2.3.2-.9-2.1-2-1.3.6-2.3-.6-2.3 2-1.3.9-2.1L10 5l2-1.2Z" />
        <circle cx="12" cy="10.5" r="2.5" />
      </svg>
    ),
  },
];

const STATUS_COLOR = {
  idle: 'rgba(148,163,184,0.48)',
  syncing: '#a78bfa',
  ok: '#34d399',
  error: '#fb7185',
} as const;
const activeFillMotion = {
  layoutId: 'primary-nav-active-fill',
  transition: springs.snappy,
};

function SyncLogo() {
  const status = useApp((state) => state.syncStatus);
  const color = STATUS_COLOR[status];

  return (
    <span
      className="pointer-events-auto relative flex min-h-11 min-w-11 items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label={`Sync status: ${status}`}
    >
      {status === 'syncing' && (
        <Ring
          size={52}
          strokeWidth={2}
          sweep={0.7}
          stroke={color}
          className="pointer-events-none absolute animate-ping opacity-50"
        />
      )}
      {/* The status ring closes as sync completes, so the indicator is the same
          incomplete-ring language as everything else rather than a bare dot. */}
      <Ring
        size={52}
        strokeWidth={2}
        sweep={status === 'ok' ? 1 : status === 'syncing' ? 0.55 : 0.8}
        stroke={color}
        track="rgba(255,255,255,0.07)"
        fill="rgba(6,5,10,0.94)"
        glow={status !== 'idle' ? color : undefined}
      >
        <Logo className="[&>svg]:h-4 [&>svg]:w-8" />
      </Ring>
    </span>
  );
}

export function NavRail() {
  const tab = useUI((state) => state.tab);
  const setTab = useUI((state) => state.setTab);
  const dashboardLayout = useUI((state) => state.dashboardLayout);
  const setDashboardLayout = useUI((state) => state.setDashboardLayout);
  const openSheet = useUI((state) => state.openSheet);
  const hasGames = useApp((state) => state.state.games.some((game) => !game.deleted));
  const wide = useMediaQuery('(min-width: 1280px)');
  // The wide dashboard's own chrome lives here instead of above the stage: the
  // layout switch and "add another game" are the only page-level controls the
  // Nexus/Cards views have, and a header row for two buttons cost a whole band
  // of vertical space on the one breakpoint where the stage wants it most.
  const showDashboardTools = wide && tab === 'home' && hasGames;
  const [attention, setAttention] = useState(true);

  useEffect(() => {
    setAttention(true);
    const timer = window.setTimeout(() => setAttention(false), 900);
    return () => window.clearTimeout(timer);
  }, [tab]);

  return (
    <div
      data-nav-rail
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[env(safe-area-inset-bottom)] lg:inset-x-auto lg:bottom-4 lg:left-4 lg:pb-0"
    >
      {/* The idle fade is on a background LAYER, never on the container. Fading the
          container multiplies into the 8px label text — white collapses to #666 (3.65:1)
          and text-muted to #3b414a (2.04:1), which is 100+ serious axe violations. The
          chrome recedes; the labels keep the AA contrast the tokens were tuned for. */}
      {/* The rail box itself stays click-through; only the controls below opt in. A
          floating rail overlaps page content by design, and an interactive container
          steals clicks from whatever sits under it. */}
      <div className="group pointer-events-none relative flex items-end gap-1 px-2 pb-1 pt-2 lg:pb-2">
        {/* Decorative only — must not swallow clicks. It spans the whole rail, so with
            pointer-events it intercepted controls that the floating rail happens to
            overlap (Settings' export button on a short window). */}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 rounded-t-ui-card bg-scrim-modal shadow-float ring-1 ring-line-strong backdrop-blur-md transition-opacity duration-(--dur-base) lg:rounded-ui-card ${
            attention ? 'opacity-100' : 'opacity-40 group-focus-within:opacity-100 group-hover:opacity-100'
          }`}
        />
        <SyncLogo />
        <nav className="pointer-events-auto relative flex items-end gap-0.5" aria-label="Primary">
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-h-11 min-w-11 flex-col items-center justify-end rounded-ui-lg px-0.5 text-muted transition-colors sm:min-w-12 ${
                  active ? '-translate-y-0.5 text-white' : 'hover:text-fg-soft'
                }`}
              >
                <span className="relative">
                  {active && (
                    <m.div {...activeFillMotion} data-nav-active-fill className="absolute inset-0">
                      <Ring
                        size={42}
                        strokeWidth={2.25}
                        sweep={1}
                        stroke={['#f5d68a', '#e8b45a', '#c78a2e']}
                        fill="rgba(232,180,90,0.16)"
                        glow="rgba(232,180,90,0.7)"
                      />
                    </m.div>
                  )}
                  {/* Inactive cells sit at a partial sweep; the active one completes. */}
                  <Ring
                    size={42}
                    strokeWidth={2}
                    sweep={active ? 1 : 0.62}
                    stroke={active ? 'transparent' : 'rgba(200,180,255,0.28)'}
                    fill={active ? 'transparent' : 'rgba(255,255,255,0.035)'}
                  >
                    <span className="relative">{item.icon}</span>
                  </Ring>
                </span>
                <span className="mt-0.5 text-caption font-bold uppercase tracking-wider">{item.label}</span>
              </button>
            );
          })}
        </nav>
        {showDashboardTools && (
          <div className="pointer-events-auto relative flex items-center gap-2 self-center pl-1">
            <span aria-hidden className="h-9 w-px bg-fill-3" />
            <Segmented
              options={[
                { value: 'nexus', label: 'Nexus' },
                { value: 'cards', label: 'Cards' },
              ]}
              value={dashboardLayout}
              onChange={setDashboardLayout}
              ariaLabel="Wide dashboard layout"
            />
            <AddGameButton onAdd={() => openSheet({ kind: 'addGame' })} size={40} />
          </div>
        )}
      </div>
    </div>
  );
}
