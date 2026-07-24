import { useState } from 'react';
import { urgencyOrder } from '@technogg/shared';
import { useSession } from '../auth';
import { useMediaQuery } from '../hooks';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fmtClock, fmtDur, tint } from '../util';
import { CardsAgendaLayout } from './DashboardLayouts';
import { GameCard } from './GameCard';
import { NexusLayout } from './NexusLayout';
import { GameBadge, Page, Segmented } from './ui';

export function DashboardPage({ now }: { now: number }) {
  const session = useSession();
  // Individual selectors (zustand action refs are stable). Grouped into one
  // object for passing down to the layouts' game-control views.
  const state = useApp((s) => s.state);
  const upsertEvent = useApp((s) => s.upsertEvent);
  const dashboardStore = {
    state,
    upsertEvent,
    setTaskDone: useApp((s) => s.setTaskDone),
    startTaskTimer: useApp((s) => s.startTaskTimer),
    restartTaskTimer: useApp((s) => s.restartTaskTimer),
    setTaskCount: useApp((s) => s.setTaskCount),
    setEnergy: useApp((s) => s.setEnergy),
    adjustEnergy: useApp((s) => s.adjustEnergy),
  };
  const openSheet = useUI((s) => s.openSheet);
  const setTab = useUI((s) => s.setTab);
  const setTimelineView = useUI((s) => s.setTimelineView);
  const dashboardLayout = useUI((s) => s.dashboardLayout);
  const setDashboardLayout = useUI((s) => s.setDashboardLayout);
  const wide = useMediaQuery('(min-width: 1280px)');
  const [setupDismissed, setSetupDismissed] = useState(() => localStorage.getItem('technogg-setup-dismissed') === '1');
  const order = urgencyOrder(state, now);
  const hero = order.find((o) => o.next)?.next ?? null;
  const heroGame = hero ? state.games.find((g) => g.id === hero.gameId) : undefined;

  // Card ORDER is frozen while you're on this page — live re-sorting made
  // cards jump away mid-entry. Values/timers stay live; position changes only
  // via the explicit re-sort button (or when the page is re-entered).
  const liveIds = order.map((o) => o.game.id);
  const [sortedIds, setSortedIds] = useState<string[]>(liveIds);
  const displayIds = [
    ...sortedIds.filter((id) => liveIds.includes(id)),
    ...liveIds.filter((id) => !sortedIds.includes(id)),
  ];
  const entryById = new Map(order.map((o) => [o.game.id, o]));
  const orderStale = displayIds.join('|') !== liveIds.join('|');

  return (
    <Page className="pb-28 pt-4 sm:pt-5 lg:pb-8">
      {session.hosted && !setupDismissed && order.length > 0 && (
        <section className="glass gold-hairline mb-4 rounded-ui-card p-4" aria-label="Account setup checklist">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-body font-black text-slate-100">Finish account setup</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-ui-md bg-ok/10 px-2 py-1 text-emerald-200">✓ Game added</span>
                <span
                  className={`rounded-ui-md px-2 py-1 ${
                    state.snapshots.length > 0 ? 'bg-ok/10 text-emerald-200' : 'bg-white/5 text-muted'
                  }`}
                >
                  {state.snapshots.length > 0 ? '✓' : '○'} Enter energy
                </span>
                <button
                  type="button"
                  onClick={() => setTab('settings')}
                  className="rounded-ui-md bg-white/5 px-2 py-1 text-slate-300"
                >
                  ○ Optional alert channels
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem('technogg-setup-dismissed', '1');
                setSetupDismissed(true);
              }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ui-lg text-muted sm:h-9 sm:w-9"
              aria-label="Dismiss setup checklist"
            >
              ✕
            </button>
          </div>
        </section>
      )}
      {hero && heroGame && (
        <div className="fade-down mb-4 flex items-stretch gap-3">
          <button
            type="button"
            onClick={() => openSheet({ kind: 'gameCard', gameId: heroGame.id })}
            className="relative block min-w-0 flex-1 overflow-hidden rounded-ui-card p-4 text-left"
            style={{
              background: `linear-gradient(120deg, ${tint(heroGame.color, 0.3)}, ${tint(heroGame.color2 ?? heroGame.color, 0.12)} 38%, rgba(0,0,0,0.92) 62%)`,
              boxShadow: `inset 0 0 0 1px ${tint(heroGame.color, 0.35)}, 0 0 44px -16px ${tint(heroGame.color, 0.5)}`,
            }}
          >
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: `radial-gradient(400px 120px at 15% 0%, ${tint(heroGame.color, 0.25)}, transparent 70%)`,
                animation: 'pulseFade 3.6s ease-in-out infinite',
              }}
            />
            <div className="relative flex items-center gap-3">
              <GameBadge short={heroGame.short} color={heroGame.color} color2={heroGame.color2} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="text-label font-bold uppercase tracking-widest text-muted">Up next</div>
                {/* Full game name, not the badge abbreviation — the hero row has the width for it. */}
                <div className="truncate text-title font-black text-fg">
                  <span style={{ fontFamily: heroGame.titleFont }}>{heroGame.name}</span>
                  <span className="font-normal text-dim">{' · '}</span>
                  {hero.label}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xl font-black tabular-nums" style={{ color: heroGame.color }}>
                  {hero.at <= now ? 'NOW' : fmtDur(hero.at - now)}
                </div>
                {hero.at > now && <div className="text-label tabular-nums text-dim">{fmtClock(hero.at)}</div>}
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => openSheet({ kind: 'addGame' })}
            className="flex w-14 shrink-0 items-center justify-center rounded-ui-card bg-white/[0.06] text-3xl font-light leading-none text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white active:scale-95 sm:w-16"
            aria-label="Add game"
          >
            +
          </button>
        </div>
      )}

      {order.length === 0 ? (
        <div className="fade-in mt-16 flex flex-col items-center gap-4 text-center">
          <div
            className="h-14 w-14 rounded-ui-xl bg-gradient-to-br from-accent via-accent-2 to-amber-300"
            style={{ boxShadow: '0 0 40px rgba(124,92,255,0.5)' }}
          />
          <h2 className="text-xl font-black text-slate-100">Track every gacha, waste no energy</h2>
          <p className="max-w-sm text-body text-slate-300">
            Add your games, punch in your current energy after each session, and Techno's Library tells you exactly when
            to log in next.
          </p>
          <button
            type="button"
            onClick={() => openSheet({ kind: 'addGame' })}
            className="rounded-ui-xl bg-gradient-to-br from-accent to-accent-2 px-6 py-3 text-base font-bold text-white shadow-lg shadow-accent-2/30 ring-1 ring-white/15 transition hover:brightness-110 active:scale-95"
          >
            + Add your first game
          </button>
        </div>
      ) : (
        <>
          <div
            className={`mb-3 flex items-center justify-end gap-2 ${
              orderStale || !(hero && heroGame) ? 'min-h-11 sm:min-h-9' : ''
            }`}
          >
            {wide && (
              <div className="mr-auto flex items-center gap-2">
                <span className="hidden text-caption font-bold uppercase tracking-widest text-dim min-[1450px]:inline">
                  Wide layout
                </span>
                <Segmented
                  options={[
                    { value: 'nexus', label: 'Nexus' },
                    { value: 'cards', label: 'Cards' },
                  ]}
                  value={dashboardLayout}
                  onChange={setDashboardLayout}
                  ariaLabel="Wide dashboard layout"
                />
              </div>
            )}
            {orderStale && (
              <button
                type="button"
                onClick={() => setSortedIds(liveIds)}
                className="fade-in flex min-h-11 items-center gap-1.5 rounded-ui-lg bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white sm:min-h-9"
              >
                <span aria-hidden>↻</span> Sort by urgency
              </button>
            )}
            {/* The main add button lives beside the "Up next" hero; keep one here only when there is no hero. */}
            {!(hero && heroGame) && (
              <button
                type="button"
                onClick={() => openSheet({ kind: 'addGame' })}
                className="flex h-11 w-11 items-center justify-center rounded-ui-xl bg-white/[0.06] text-2xl font-light leading-none text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white active:scale-90 sm:h-9 sm:w-9 sm:rounded-ui-lg"
                aria-label="Add game"
              >
                +
              </button>
            )}
          </div>
          {wide ? (
            dashboardLayout === 'nexus' ? (
              <NexusLayout
                state={state}
                entries={order}
                displayIds={displayIds}
                now={now}
                gameControlActions={dashboardStore}
                onEditGame={(gameId) => openSheet({ kind: 'game', gameId })}
                onOpenGameEvent={(eventId, gameId) => openSheet({ kind: 'event', eventId, gameId })}
                onOpenEvent={(event) => openSheet({ kind: 'event', gameId: event.gameId, eventId: event.id })}
                onToggleEvent={(event) => upsertEvent({ id: event.id, gameId: event.gameId, done: !event.done })}
                onOpenReminder={() => openSheet({ kind: 'reminder' })}
                onOpenTimeline={() => {
                  setTimelineView('agenda');
                  setTab('timeline');
                }}
              />
            ) : (
              <CardsAgendaLayout
                state={state}
                entries={order}
                displayIds={displayIds}
                now={now}
                onOpenEvent={(event) => openSheet({ kind: 'event', gameId: event.gameId, eventId: event.id })}
                onToggleEvent={(event) => upsertEvent({ id: event.id, gameId: event.gameId, done: !event.done })}
                onOpenReminder={() => openSheet({ kind: 'reminder' })}
                onOpenTimeline={() => {
                  setTimelineView('agenda');
                  setTab('timeline');
                }}
              />
            )
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {displayIds.map((id) => (
                <GameCard key={id} entry={entryById.get(id)!} now={now} />
              ))}
            </div>
          )}
        </>
      )}
    </Page>
  );
}
