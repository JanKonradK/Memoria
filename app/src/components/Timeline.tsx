import { motion } from 'framer-motion';
import { DateTime } from 'luxon';
import type { Game, GameEvent } from '@technogg/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fmtDur, tint } from '../util';
import { planSeedImport, SEED_UPDATED } from '../data/seed-events';
import { Btn, GameBadge, SectionTitle } from './ui';

const DAY = 86_400_000;

/** Countdown urgency: rose <24h, gold <72h, muted beyond that / after the end. */
function endTone(msLeft: number): string {
  if (msLeft <= 0) return 'rgba(148,163,184,0.6)';
  if (msLeft < DAY) return 'var(--color-rose)';
  if (msLeft < 3 * DAY) return 'var(--color-gold)';
  return 'rgb(148,163,184)';
}

function EventRow({
  ev,
  game,
  now,
  ws,
  we,
  onOpen,
}: {
  ev: GameEvent;
  game: Game;
  now: number;
  ws: number;
  we: number;
  onOpen: () => void;
}) {
  const span = we - ws;
  const left = (Math.max(ev.start, ws) - ws) / span;
  const width = (Math.min(ev.end, we) - Math.max(ev.start, ws)) / span;
  const msLeft = ev.end - now;
  const ended = msLeft <= 0;
  const maint = ev.type === 'maintenance';
  const banner = ev.type === 'banner';
  const tone = maint ? 'rgba(148,163,184,0.6)' : endTone(msLeft);

  return (
    <motion.button
      key={ev.id}
      type="button"
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      onClick={onOpen}
      className={`relative block w-full rounded-xl text-left ${maint ? 'h-6' : 'h-9'}`}
      title={`${game.name}: ${ev.name}`}
    >
      <div className="absolute inset-0 rounded-xl bg-white/[0.03]" />
      <motion.div
        layout
        className={`absolute inset-y-0 flex items-center gap-1.5 overflow-hidden rounded-xl px-2 ${
          maint ? 'border border-dashed border-slate-500/50' : ''
        }`}
        style={{
          left: `${left * 100}%`,
          width: `${Math.max(width * 100, 8)}%`,
          background: maint
            ? 'rgba(148,163,184,0.08)'
            : banner
              ? `linear-gradient(90deg, ${tint(game.color, 0.4)}, ${tint(game.color, 0.7)})`
              : `linear-gradient(90deg, ${tint(game.color, 0.14)}, ${tint(game.color, 0.32)})`,
          boxShadow: maint ? undefined : `inset 0 0 0 1px ${tint(game.color, banner ? 0.85 : 0.35)}`,
          opacity: ended ? 0.35 : 1,
        }}
      >
        {banner && <span className="text-[10px]" style={{ color: 'var(--color-gold)' }}>★</span>}
        {maint && (
          <span className="rounded bg-white/10 px-1 text-[8px] font-black uppercase tracking-wider text-slate-400">
            patch
          </span>
        )}
        <span
          className={`truncate text-xs ${
            maint ? 'font-medium text-slate-400' : banner ? 'font-bold text-white' : 'font-semibold text-slate-200'
          }`}
        >
          {ev.name}
        </span>
      </motion.div>
      <span
        className={`absolute inset-y-0 right-1 z-10 my-auto flex h-fit items-center rounded-md bg-black/70 px-1.5 py-px text-[10px] font-bold tabular-nums ${
          !ended && !maint && msLeft < DAY ? 'warn-pulse' : ''
        }`}
        style={{ color: tone }}
      >
        {ended ? 'ended' : maint ? DateTime.fromMillis(ev.start).toFormat('dd LLL HH:mm') : `ends ${fmtDur(msLeft)}`}
      </span>
    </motion.button>
  );
}

export function TimelinePage({ now }: { now: number }) {
  const state = useApp((s) => s.state);
  const deleteReminder = useApp((s) => s.deleteReminder);
  const upsertEvent = useApp((s) => s.upsertEvent);
  const openSheet = useUI((s) => s.openSheet);

  const seedPlan = planSeedImport(state, now);
  const importSeed = () => {
    for (const p of seedPlan) {
      if (p.kind === 'add') {
        upsertEvent({
          gameId: p.gameId,
          name: p.seed.name,
          type: p.seed.type,
          start: p.start,
          end: p.end,
          dailyTouch: p.seed.dailyTouch ?? false,
          notify: p.seed.type === 'maintenance' ? false : p.seed.notify ?? true,
          notes: p.seed.notes ?? '',
          sourceKey: p.seed.sourceKey,
        });
      } else {
        // Refresh pass: correct previously imported dates/names (TBC → confirmed).
        upsertEvent({ id: p.eventId, gameId: p.gameId, name: p.seed.name, start: p.start, end: p.end });
      }
    }
  };

  const ws = now - 2 * DAY;
  const we = now + 16 * DAY;
  const span = we - ws;

  const games = state.games.filter((g) => !g.deleted);
  const live = state.events.filter((e) => !e.deleted);
  const eventsByGame = new Map<string, GameEvent[]>(
    games.map((g) => [
      g.id,
      live.filter((e) => e.gameId === g.id && e.end >= ws && e.start <= we).sort((a, b) => a.end - b.end),
    ]),
  );
  const gameById = new Map(games.map((g) => [g.id, g]));

  // Soonest deadlines across all games — banners/events only, still running.
  const endingSoon = live
    .filter((e) => e.type !== 'maintenance' && e.end > now && e.start <= now && gameById.has(e.gameId))
    .sort((a, b) => a.end - b.end)
    .slice(0, 5);

  const reminders = state.reminders.filter((r) => !r.deleted).sort((a, b) => a.at - b.at);

  const ticks: DateTime[] = [];
  for (let i = 0; i <= 6; i++) ticks.push(DateTime.fromMillis(ws + (span / 6) * i));

  return (
    <div className="mx-auto w-full max-w-4xl px-5 pb-28 pt-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-black tracking-tight text-slate-100">Event timeline</h2>
        <div className="flex gap-2">
          {seedPlan.length > 0 && (
            <Btn onClick={importSeed} title={`Bundled with the app (updated ${SEED_UPDATED}) — adds new events, fixes changed dates`}>
              Import {seedPlan.length}
            </Btn>
          )}
          {state.settings.hoyolabLinks.length > 0 && (
            <Btn onClick={() => openSheet({ kind: 'hoyoImport' })}>⤓ HoYoLAB</Btn>
          )}
          <Btn onClick={() => openSheet({ kind: 'pasteEvents' })}>Paste (AI)</Btn>
          <Btn kind="primary" onClick={() => openSheet({ kind: 'event' })}>
            + Event
          </Btn>
        </div>
      </div>

      {endingSoon.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">Ending soonest</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {endingSoon.map((ev) => {
              const game = gameById.get(ev.gameId)!;
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openSheet({ kind: 'event', eventId: ev.id, gameId: ev.gameId })}
                  className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.06]"
                >
                  <GameBadge short={game.short} color={game.color} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold text-slate-200">{ev.name}</div>
                    <div
                      className={`text-[10px] font-bold tabular-nums ${ev.end - now < DAY ? 'warn-pulse' : ''}`}
                      style={{ color: endTone(ev.end - now) }}
                    >
                      {fmtDur(ev.end - now)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="glass gold-hairline relative rounded-3xl p-4">
        <div className="relative mb-2 ml-0 h-4 text-[10px] text-slate-500">
          {ticks.map((t, i) => (
            <span key={i} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${(i / 6) * 100}%` }}>
              {t.toFormat('dd LLL')}
            </span>
          ))}
        </div>

        <div className="relative py-1">
          {ticks.map((_, i) => (
            <div
              key={i}
              className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.04]"
              style={{ left: `${(i / 6) * 100}%` }}
            />
          ))}
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-rose-400/80"
            style={{ left: `${((now - ws) / span) * 100}%` }}
          >
            <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-rose-400" />
          </div>

          {games.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">
              No events yet — add banners and events so nothing ends without you noticing.
            </p>
          )}

          {games.map((game) => {
            const evs = eventsByGame.get(game.id) ?? [];
            const nextEnd = evs.find((e) => e.end > now && e.type !== 'maintenance');
            return (
              <div key={game.id} className="relative">
                <div className="mb-1.5 mt-4 flex items-center gap-2 first:mt-0">
                  <GameBadge short={game.short} color={game.color} />
                  <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: game.color }}>
                    {game.name}
                  </span>
                  <span className="h-px flex-1" style={{ background: tint(game.color, 0.2) }} />
                  {nextEnd && (
                    <span className="text-[10px] font-semibold tabular-nums" style={{ color: endTone(nextEnd.end - now) }}>
                      next ends {fmtDur(nextEnd.end - now)}
                    </span>
                  )}
                </div>
                {evs.length === 0 ? (
                  <p className="py-1 text-[11px] text-slate-600">Nothing in this window — import or add events.</p>
                ) : (
                  <div className="space-y-1.5">
                    {evs.map((ev) => (
                      <EventRow
                        key={ev.id}
                        ev={ev}
                        game={game}
                        now={now}
                        ws={ws}
                        we={we}
                        onOpen={() => openSheet({ kind: 'event', eventId: ev.id, gameId: ev.gameId })}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <SectionTitle>One-off reminders</SectionTitle>
      <div className="space-y-2">
        {reminders.map((r) => {
          const game = r.gameId ? gameById.get(r.gameId) : undefined;
          const due = r.at <= now;
          return (
            <div
              key={r.id}
              className={`glass flex items-center gap-3 rounded-2xl px-4 py-3 ${due ? 'opacity-60' : ''}`}
            >
              {game ? (
                <GameBadge short={game.short} color={game.color} />
              ) : (
                <span className="h-2 w-2 shrink-0 rounded-full bg-slate-500" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-200">{r.message}</div>
                <div className="text-[11px] tabular-nums text-slate-500">
                  {DateTime.fromMillis(r.at).toFormat('ccc dd LLL HH:mm')} {due ? '· sent/due' : `· in ${fmtDur(r.at - now)}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteReminder(r.id)}
                className="text-slate-500 transition hover:text-rose-400"
                aria-label="Delete reminder"
              >
                ✕
              </button>
            </div>
          );
        })}
        <Btn onClick={() => openSheet({ kind: 'reminder' })}>+ Reminder</Btn>
      </div>
    </div>
  );
}
