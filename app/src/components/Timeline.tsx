import { motion } from 'framer-motion';
import { useState } from 'react';
import { DateTime } from 'luxon';
import type { Game, GameEvent } from '@technogg/shared';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { fmtDur, tint } from '../util';
import { planSeedImport, SEED_UPDATED } from '../data/seed-events';
import { Btn, GameBadge, SectionTitle } from './ui';

const DAY = 86_400_000;

/**
 * Within a game: things to PLAY first (events), then endgame windows, then
 * banners (you already know whether you're pulling), maintenance last.
 */
const TYPE_RANK = { event: 0, custom: 0, cycle: 1, banner: 2, maintenance: 3 } as const;

/** Countdown urgency: rose <24h, gold <72h, muted beyond that / after the end. */
function endTone(msLeft: number): string {
  if (msLeft <= 0) return 'rgba(148,163,184,0.6)';
  if (msLeft < DAY) return 'var(--color-rose)';
  if (msLeft < 3 * DAY) return 'var(--color-gold)';
  return 'rgb(148,163,184)';
}

/** Readable text on a strong game-color fill (GI is near-white — needs dark text). */
function isLightColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  // Bars are the color at 0.4–0.7 alpha over black, so only near-white
  // accents (GI) actually produce a light surface.
  const n = parseInt(m[1]!, 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 200;
}

/**
 * Version-long ambient filler (no alert, no daily claim) — collapsed behind a
 * per-game toggle so the timeline stays about actual deadlines.
 */
function isQuiet(ev: GameEvent, now: number): boolean {
  return (ev.type === 'event' || ev.type === 'custom') && !ev.notify && !ev.dailyTouch && ev.end > now;
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
  const cycle = ev.type === 'cycle';
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
          // Events are the loud ones — banners you've already made your mind up about.
          // Two-tone: color → color2 carries each game's real icon palette.
          background: maint
            ? 'rgba(148,163,184,0.08)'
            : banner
              ? `linear-gradient(90deg, ${tint(game.color, 0.08)}, ${tint(game.color2 ?? game.color, 0.16)})`
              : `linear-gradient(90deg, ${tint(game.color, 0.5)}, ${tint(game.color2 ?? game.color, 0.62)})`,
          boxShadow: maint ? undefined : `inset 0 0 0 1px ${tint(game.color, banner ? 0.3 : 0.85)}`,
          opacity: ended ? 0.35 : 1,
        }}
      >
        {banner && <span className="text-[10px]" style={{ color: 'rgba(232,180,90,0.45)' }}>★</span>}
        {cycle && (
          <span
            className={`rounded px-1 text-[8px] font-black uppercase tracking-wider ${
              isLightColor(game.color) ? 'bg-black/15 text-slate-800' : 'bg-black/30 text-white/85'
            }`}
          >
            cycle
          </span>
        )}
        {maint && (
          <span className="rounded bg-white/10 px-1 text-[8px] font-black uppercase tracking-wider text-slate-400">
            patch
          </span>
        )}
        <span
          className={`truncate text-xs ${
            maint
              ? 'font-medium text-slate-400'
              : banner
                ? 'font-medium text-slate-400'
                : isLightColor(game.color)
                  ? 'font-bold text-slate-900'
                  : 'font-bold text-white'
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

  // 30 days ahead so next month's cycle windows (e.g. August Abyss) are visible.
  const ws = now - 2 * DAY;
  const we = now + 30 * DAY;
  const span = we - ws;
  const TICKS = 8;

  const games = state.games.filter((g) => !g.deleted);
  const live = state.events.filter((e) => !e.deleted);
  const eventsByGame = new Map<string, GameEvent[]>(
    games.map((g) => [
      g.id,
      live
        .filter((e) => e.gameId === g.id && e.end >= ws && e.start <= we)
        .sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.end - b.end),
    ]),
  );
  const gameById = new Map(games.map((g) => [g.id, g]));

  // Soonest PLAY deadlines across all games — events and endgame cycles.
  // Banners and quiet filler are excluded: you already know if you're pulling.
  const endingSoon = live
    .filter(
      (e) =>
        (e.type === 'event' || e.type === 'custom' || e.type === 'cycle') &&
        (e.notify || e.dailyTouch) &&
        e.end > now &&
        e.start <= now &&
        gameById.has(e.gameId),
    )
    .sort((a, b) => a.end - b.end)
    .slice(0, 5);

  const reminders = state.reminders.filter((r) => !r.deleted).sort((a, b) => a.at - b.at);
  const [quietOpen, setQuietOpen] = useState<Set<string>>(new Set());
  const toggleQuiet = (gameId: string) =>
    setQuietOpen((s) => {
      const next = new Set(s);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });

  const ticks: DateTime[] = [];
  for (let i = 0; i <= TICKS; i++) ticks.push(DateTime.fromMillis(ws + (span / TICKS) * i));

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
                  <GameBadge short={game.short} color={game.color} color2={game.color2} size="sm" />
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
            <span key={i} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${(i / TICKS) * 100}%` }}>
              {t.toFormat('dd LLL')}
            </span>
          ))}
        </div>

        <div className="relative py-1">
          {ticks.map((_, i) => (
            <div
              key={i}
              className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.04]"
              style={{ left: `${(i / TICKS) * 100}%` }}
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
            const nextEnd = [...evs]
              .sort((a, b) => a.end - b.end)
              .find((e) => e.end > now && e.type !== 'maintenance' && e.type !== 'banner' && !isQuiet(e, now));
            return (
              <div key={game.id} className="relative">
                <div className="mb-1.5 mt-4 flex items-center gap-2 first:mt-0">
                  <GameBadge short={game.short} color={game.color} color2={game.color2} />
                  <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: game.color }}>
                    {game.name}
                  </span>
                  <span
                    className="h-px flex-1"
                    style={{ background: `linear-gradient(90deg, ${tint(game.color, 0.3)}, ${tint(game.color2 ?? game.color, 0.12)})` }}
                  />
                  {nextEnd && (
                    <span className="text-[10px] font-semibold tabular-nums" style={{ color: endTone(nextEnd.end - now) }}>
                      next ends {fmtDur(nextEnd.end - now)}
                    </span>
                  )}
                </div>
                {evs.length === 0 ? (
                  <p className="py-1 text-[11px] text-slate-600">Nothing in this window — import or add events.</p>
                ) : (
                  (() => {
                    const open = quietOpen.has(game.id);
                    const shown = open ? evs : evs.filter((e) => !isQuiet(e, now));
                    const hidden = evs.length - evs.filter((e) => !isQuiet(e, now)).length;
                    return (
                      <div className="space-y-1.5">
                        {shown.map((ev) => (
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
                        {hidden > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleQuiet(game.id)}
                            className="block w-full rounded-lg py-0.5 text-left text-[10px] font-semibold text-slate-600 transition hover:text-slate-400"
                          >
                            {open ? '− hide quiet events' : `+ ${hidden} quiet event${hidden > 1 ? 's' : ''} (no deadline pressure)`}
                          </button>
                        )}
                      </div>
                    );
                  })()
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
                <GameBadge short={game.short} color={game.color} color2={game.color2} />
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
