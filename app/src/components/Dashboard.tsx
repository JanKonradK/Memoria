import { useState } from 'react';
import { urgencyOrder } from '@technogg/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fmtClock, fmtDur, tint } from '../util';
import { GameCard } from './GameCard';
import { GameBadge } from './ui';
import { useSession } from '../auth';

export function DashboardPage({ now }: { now: number }) {
  const session = useSession();
  const state = useApp((s) => s.state);
  const openSheet = useUI((s) => s.openSheet);
  const setTab = useUI((s) => s.setTab);
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
    <div className="mx-auto w-full max-w-[1800px] px-3 pb-28 pt-4 sm:px-5 sm:pt-5 lg:pb-8">
      {session.hosted && !setupDismissed && order.length > 0 && (
        <section className="glass gold-hairline mb-4 rounded-3xl p-4" aria-label="Account setup checklist">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-slate-100">Finish account setup</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-lg bg-emerald-400/10 px-2 py-1 text-emerald-200">✓ Game added</span>
                <span
                  className={`rounded-lg px-2 py-1 ${
                    state.snapshots.length > 0 ? 'bg-emerald-400/10 text-emerald-200' : 'bg-white/5 text-slate-400'
                  }`}
                >
                  {state.snapshots.length > 0 ? '✓' : '○'} Enter energy
                </span>
                <button
                  type="button"
                  onClick={() => setTab('settings')}
                  className="rounded-lg bg-white/5 px-2 py-1 text-slate-300"
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
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 sm:h-9 sm:w-9"
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
            onClick={() => openSheet({ kind: 'game', gameId: heroGame.id })}
            className="relative block min-w-0 flex-1 overflow-hidden rounded-3xl p-4 text-left"
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
                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Up next</div>
                <div className="truncate text-lg font-black text-slate-50" style={{ fontFamily: heroGame.titleFont }}>
                  {heroGame.short}: {hero.label}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xl font-black tabular-nums" style={{ color: heroGame.color }}>
                  {hero.at <= now ? 'NOW' : fmtDur(hero.at - now)}
                </div>
                {hero.at > now && <div className="text-[11px] tabular-nums text-slate-500">{fmtClock(hero.at)}</div>}
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => openSheet({ kind: 'addGame' })}
            className="flex w-14 shrink-0 items-center justify-center rounded-3xl bg-white/[0.06] text-3xl font-light leading-none text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white active:scale-95 sm:w-16"
            aria-label="Add game"
            title="Add game"
          >
            +
          </button>
        </div>
      )}

      {order.length === 0 ? (
        <div className="fade-in mt-16 flex flex-col items-center gap-4 text-center">
          <div
            className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-300"
            style={{ boxShadow: '0 0 40px rgba(124,92,255,0.5)' }}
          />
          <h2 className="text-xl font-black text-slate-100">Track every gacha, waste no energy</h2>
          <p className="max-w-sm text-sm text-slate-300">
            Add your games, punch in your current energy after each session, and TechnoGG tells you exactly when to log
            in next.
          </p>
          <button
            type="button"
            onClick={() => openSheet({ kind: 'addGame' })}
            className="rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 px-6 py-3 text-base font-bold text-white shadow-lg shadow-fuchsia-500/30 ring-1 ring-white/15 transition hover:brightness-110 active:scale-95"
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
            {orderStale && (
              <button
                type="button"
                onClick={() => setSortedIds(liveIds)}
                className="fade-in flex min-h-11 items-center gap-1.5 rounded-xl bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white sm:min-h-9"
                title="Urgency changed — click to re-order the cards"
              >
                <span aria-hidden>↻</span> Sort by urgency
              </button>
            )}
            {/* The main add button lives beside the "Up next" hero; keep one here only when there is no hero. */}
            {!(hero && heroGame) && (
              <button
                type="button"
                onClick={() => openSheet({ kind: 'addGame' })}
                className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.06] text-2xl font-light leading-none text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white active:scale-90 sm:h-9 sm:w-9 sm:rounded-xl"
                aria-label="Add game"
                title="Add game"
              >
                +
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {displayIds.map((id) => (
              <GameCard key={id} entry={entryById.get(id)!} now={now} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
