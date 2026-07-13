import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { urgencyOrder } from '@technogg/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fmtClock, fmtDur, tint } from '../util';
import { GameCard } from './GameCard';
import { GameBadge } from './ui';

export function DashboardPage({ now }: { now: number }) {
  const state = useApp((s) => s.state);
  const openSheet = useUI((s) => s.openSheet);
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
    <div className="mx-auto w-full max-w-7xl px-5 pb-28 pt-5">
      {hero && heroGame && (
        <motion.button
          type="button"
          layout
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => openSheet({ kind: 'game', gameId: heroGame.id })}
          className="relative mb-4 block w-full overflow-hidden rounded-3xl p-4 text-left"
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
              <div className="truncate text-lg font-black text-slate-50">
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
        </motion.button>
      )}

      {order.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-16 flex flex-col items-center gap-4 text-center"
        >
          <div
            className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-300"
            style={{ boxShadow: '0 0 40px rgba(124,92,255,0.5)' }}
          />
          <h2 className="text-xl font-black text-slate-100">Track every gacha, waste no energy</h2>
          <p className="max-w-sm text-sm text-slate-400">
            Add your games, punch in your current energy after each session, and TechnoGG tells you exactly when to log
            in next.
          </p>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => openSheet({ kind: 'addGame' })}
            className="rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 px-6 py-3 text-base font-bold text-white shadow-lg shadow-fuchsia-500/30 ring-1 ring-white/15 transition hover:brightness-110"
          >
            + Add your first game
          </motion.button>
        </motion.div>
      ) : (
        <>
        <AnimatePresence>
          {orderStale && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mb-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSortedIds(liveIds)}
                  className="flex items-center gap-1.5 rounded-xl bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
                  title="Urgency changed — click to re-order the cards"
                >
                  <span aria-hidden>↻</span> Sort by urgency
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div layout className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {displayIds.map((id) => (
              <GameCard key={id} entry={entryById.get(id)!} now={now} />
            ))}
          </AnimatePresence>
          <motion.button
            layout
            type="button"
            onClick={() => openSheet({ kind: 'addGame' })}
            className="flex min-h-28 items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-white/10 text-sm font-semibold text-slate-500 transition hover:border-white/25 hover:text-slate-300"
          >
            <span className="text-xl">+</span> Add game
          </motion.button>
        </motion.div>
        </>
      )}
    </div>
  );
}
