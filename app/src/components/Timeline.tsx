import { useState } from 'react';
import { DateTime } from 'luxon';
import type { Game, GameEvent } from '@technogg/shared';
import { useApp } from '../store';
import { TYPE_RANK } from '../timeline-sort';
import { useUI } from '../ui-store';
import { endTone, fmtDur, tint } from '../util';
import { planSeedImport, SEED_UPDATED } from '../data/seed-events';
import { TimelineAgenda } from './TimelineAgenda';
import { titleFontFor } from '../fonts';
import { Btn, GameBadge, Page, SectionTitle, Segmented } from './ui';

const DAY = 86_400_000;

function lum(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/**
 * Readable text on a strong two-tone fill: judge the WHOLE gradient (bars run
 * color → color2 at ~0.7 alpha over black). With the brighter fills, any
 * pairing that averages mid-light (GI cream, HSR pink, WuWa silver) flips to
 * dark text so axe contrast holds.
 */
function isLightFill(color: string, color2?: string): boolean {
  return (lum(color) + lum(color2 ?? color)) / 2 > 168;
}

function EventRow({
  ev,
  game,
  now,
  ws,
  we,
  onOpen,
  onToggleDone,
}: {
  ev: GameEvent;
  game: Game;
  now: number;
  ws: number;
  we: number;
  onOpen: () => void;
  onToggleDone: () => void;
}) {
  const span = we - ws;
  const left = (Math.max(ev.start, ws) - ws) / span;
  const width = (Math.min(ev.end, we) - Math.max(ev.start, ws)) / span;
  const displayWidth = Math.min(100, Math.max(width * 100, 8));
  const displayLeft = Math.max(0, Math.min(left * 100, 100 - displayWidth));
  const msLeft = ev.end - now;
  const ended = msLeft <= 0;
  const maint = ev.type === 'maintenance';
  const banner = ev.type === 'banner';
  const cycle = ev.type === 'cycle';
  const tone = maint ? 'rgba(148,163,184,0.6)' : endTone(msLeft);

  return (
    <div
      className={`slide-in group/row relative block h-11 w-full rounded-full text-left ${maint ? 'sm:h-6' : 'sm:h-10'} ${ev.done ? 'opacity-40 saturate-50' : ''}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 z-10 rounded-full"
        aria-label={`Open ${game.name} event: ${ev.name}`}
        title={`${game.name}: ${ev.name}`}
      />
      <div className="absolute inset-0 rounded-full bg-white/[0.03]" />
      <div
        data-event-bar
        className={`absolute inset-y-0 flex items-center gap-1.5 overflow-hidden rounded-full px-2.5 ${
          maint ? 'border border-dashed border-slate-500/50' : ''
        }`}
        style={{
          left: `${displayLeft}%`,
          width: `${displayWidth}%`,
          // Events are the loud ones — banners you've already made your mind up about.
          // Two-tone: color → color2 carries each game's real icon palette.
          background: maint
            ? 'linear-gradient(90deg, rgba(100,116,139,0.12), rgba(148,163,184,0.2))'
            : banner
              ? `linear-gradient(90deg, ${tint(game.color, 0.12)}, ${tint(game.color2 ?? game.color, 0.22)})`
              : `linear-gradient(90deg, ${tint(game.color, 0.68)}, ${tint(game.color2 ?? game.color, 0.82)})`,
          boxShadow: maint
            ? 'inset 0 1px 0 rgba(255,255,255,0.08)'
            : banner
              ? `inset 0 1px 0 ${tint(game.color2 ?? game.color, 0.26)}, inset 0 0 0 1px ${tint(game.color, 0.34)}, 0 6px 18px -12px ${tint(game.color, 0.42)}`
              : `inset 0 1px 0 rgba(255,255,255,0.38), inset 0 0 0 1px ${tint(game.color, 0.9)}, 0 5px 22px -9px ${tint(game.color, 0.72)}`,
          opacity: ended ? 0.35 : 1,
        }}
      >
        {banner && (
          <span className="text-2xs" style={{ color: 'rgba(238,188,99,0.8)' }}>
            ★
          </span>
        )}
        {cycle && (
          <span
            className={`rounded px-1 text-3xs font-black uppercase tracking-wider ${
              isLightFill(game.color, game.color2) ? 'bg-black/15 text-slate-800' : 'bg-black/30 text-white/85'
            }`}
          >
            cycle
          </span>
        )}
        {maint && (
          <span className="rounded bg-white/10 px-1 text-3xs font-black uppercase tracking-wider text-slate-400">
            patch
          </span>
        )}
        <span
          className={`truncate text-xs ${
            maint
              ? 'font-medium text-slate-400'
              : banner
                ? 'font-medium text-slate-400'
                : isLightFill(game.color, game.color2)
                  ? 'font-bold text-slate-900'
                  : 'font-bold text-white'
          }`}
        >
          {ev.name}
        </span>
      </div>
      <span className="pointer-events-none absolute inset-y-0 right-1 z-20 my-auto flex h-fit items-center gap-1">
        <button
          type="button"
          title={ev.done ? 'Marked done — click to bring it back' : 'Done with this — hide it'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone();
          }}
          aria-label={ev.done ? `Restore ${ev.name}` : `Mark ${ev.name} done`}
          className={`pointer-events-auto flex items-center justify-center rounded-full font-black transition ${
            maint ? 'h-9 w-9 text-3xs sm:h-6 sm:w-6' : 'h-9 w-9 text-xs'
          } ${
            ev.done
              ? 'bg-emerald-400/90 text-black'
              : 'bg-black/70 text-slate-400 opacity-60 hover:text-emerald-300 focus-visible:opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100'
          }`}
        >
          ✓
        </button>
        <span
          className={`rounded-full bg-black/80 px-2 py-px text-2xs font-bold tabular-nums ${
            !ended && !maint && !ev.done && msLeft < DAY ? 'warn-pulse' : ''
          }`}
          style={{ color: ev.done ? 'rgb(52,211,153)' : tone }}
        >
          {ev.done
            ? 'done'
            : ended
              ? 'ended'
              : maint
                ? DateTime.fromMillis(ev.start).toFormat('dd LLL HH:mm')
                : `ends ${fmtDur(msLeft)}`}
        </span>
      </span>
    </div>
  );
}

export function TimelinePage({ now }: { now: number }) {
  const state = useApp((s) => s.state);
  const deleteReminder = useApp((s) => s.deleteReminder);
  const upsertEvent = useApp((s) => s.upsertEvent);
  const openSheet = useUI((s) => s.openSheet);
  const timelineView = useUI((s) => s.timelineView);
  const setTimelineView = useUI((s) => s.setTimelineView);

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
          notify: p.seed.type === 'maintenance' ? false : (p.seed.notify ?? true),
          notes: p.seed.notes ?? '',
          sourceKey: p.seed.sourceKey,
        });
      } else {
        // Refresh pass: correct previously imported dates/names (TBC → confirmed).
        upsertEvent({ id: p.eventId, gameId: p.gameId, name: p.seed.name, start: p.start, end: p.end });
      }
    }
  };

  // 28 days ahead so next month's cycle windows (e.g. next Abyss) stay visible;
  // 30-day span / 10 ticks = a readable gridline every 3 days.
  const ws = now - 2 * DAY;
  const we = now + 28 * DAY;
  const span = we - ws;
  const TICKS = 10;

  const games = state.games.filter((g) => !g.deleted);
  const live = state.events.filter((e) => !e.deleted);
  const eventsByGame = new Map<string, GameEvent[]>(
    games.map((g) => [
      g.id,
      live
        .filter((e) => e.gameId === g.id && e.end > ws && e.start < we)
        .sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.end - b.end),
    ]),
  );
  const gameById = new Map(games.map((g) => [g.id, g]));

  // Soonest PLAY deadlines across all games — events and endgame cycles.
  // Banners and things you've marked done are excluded.
  const endingSoon = live
    .filter(
      (e) =>
        (e.type === 'event' || e.type === 'custom' || e.type === 'cycle') &&
        !e.done &&
        e.end > now &&
        e.start <= now &&
        gameById.has(e.gameId),
    )
    .sort((a, b) => a.end - b.end)
    .slice(0, 5);

  const reminders = state.reminders.filter((r) => !r.deleted).sort((a, b) => a.at - b.at);
  const [doneOpen, setDoneOpen] = useState<Set<string>>(new Set());
  const toggleDoneOpen = (gameId: string) =>
    setDoneOpen((s) => {
      const next = new Set(s);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });

  const ticks: DateTime[] = [];
  for (let i = 0; i <= TICKS; i++) ticks.push(DateTime.fromMillis(ws + (span / TICKS) * i));

  // Day bands under the lanes: weekends get a whisper of white, today a wash
  // of astral — the eye finds "this weekend" and "right now" without reading.
  const dayBands: Array<{ left: number; width: number; kind: 'weekend' | 'today' }> = [];
  {
    let d = DateTime.fromMillis(ws).startOf('day');
    const endDt = DateTime.fromMillis(we);
    while (d < endDt) {
      const dayEnd = d.plus({ days: 1 });
      const left = (Math.max(d.toMillis(), ws) - ws) / span;
      const right = (Math.min(dayEnd.toMillis(), we) - ws) / span;
      if (right > left) {
        const today = now >= d.toMillis() && now < dayEnd.toMillis();
        if (today) dayBands.push({ left: left * 100, width: (right - left) * 100, kind: 'today' });
        else if (d.weekday >= 6) dayBands.push({ left: left * 100, width: (right - left) * 100, kind: 'weekend' });
      }
      d = dayEnd;
    }
  }

  return (
    <Page className="pb-28 pt-4 sm:pt-5 lg:pb-8">
      {/* One glass command bar: heading, view toggle, data actions, and the
          gold primary CTA live together instead of floating loose in a row. */}
      <div className="glass gold-hairline gold-hairline-live mb-4 flex flex-wrap items-center gap-2 overflow-hidden rounded-2xl p-2 sm:gap-3 sm:p-2.5">
        <h2 className="min-w-0 flex-1 px-1 text-lg font-black tracking-tight text-slate-100">Event timeline</h2>
        <Segmented
          options={[
            { value: 'lanes', label: 'Lanes' },
            { value: 'agenda', label: 'Agenda' },
          ]}
          value={timelineView}
          onChange={setTimelineView}
          ariaLabel="Timeline view"
        />
        <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
          {seedPlan.length > 0 && (
            <Btn
              onClick={importSeed}
              className="w-full sm:w-auto"
              title={`Bundled with the app (updated ${SEED_UPDATED}) — adds new events, fixes changed dates`}
            >
              Import {seedPlan.length}
            </Btn>
          )}
          <Btn className="w-full sm:w-auto" onClick={() => openSheet({ kind: 'pasteEvents' })}>
            Paste (AI)
          </Btn>
          <Btn
            className={`w-full sm:w-auto ${seedPlan.length > 0 ? 'col-span-2' : ''}`}
            kind="gold"
            onClick={() => openSheet({ kind: 'event' })}
          >
            + Event
          </Btn>
        </div>
      </div>

      {timelineView === 'lanes' && endingSoon.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-2xs font-bold uppercase tracking-widest text-slate-500">Ending soonest</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {endingSoon.map((ev) => {
              const game = gameById.get(ev.gameId)!;
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openSheet({ kind: 'event', eventId: ev.id, gameId: ev.gameId })}
                  className="glass relative flex min-h-11 items-center gap-2.5 overflow-hidden rounded-2xl px-3.5 py-2.5 text-left transition hover:bg-white/[0.06]"
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-2 left-0 w-1 rounded-full"
                    style={{
                      background: `linear-gradient(180deg, ${game.color}, ${game.color2 ?? game.color})`,
                      boxShadow: `0 0 12px ${tint(game.color, 0.85)}`,
                    }}
                  />
                  <GameBadge short={game.short} color={game.color} color2={game.color2} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-200">{ev.name}</div>
                    <div
                      className={`text-xs font-black tabular-nums ${ev.end - now < DAY ? 'warn-pulse' : ''}`}
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

      {timelineView === 'agenda' ? (
        <TimelineAgenda now={now} />
      ) : (
        <div className="glass gold-hairline gold-hairline-live relative rounded-3xl p-4 3xl:p-6">
          <div className="relative mb-2 ml-0 h-4 text-2xs font-semibold text-slate-400">
            {ticks.map((t, i) => (
              <span
                key={i}
                className={`absolute tabular-nums ${i === 0 ? '' : i === TICKS ? '-translate-x-full' : '-translate-x-1/2'} ${i % 2 === 1 ? 'hidden sm:block' : ''}`}
                style={{ left: `${(i / TICKS) * 100}%` }}
              >
                {t.toFormat('dd LLL')}
              </span>
            ))}
          </div>

          <div className="relative py-1">
            {dayBands.map((band, i) => (
              <div
                aria-hidden
                key={`band-${i}`}
                className="pointer-events-none absolute inset-y-0"
                style={{
                  left: `${band.left}%`,
                  width: `${band.width}%`,
                  ...(band.kind === 'today'
                    ? {
                        background:
                          'linear-gradient(90deg, rgba(139,109,255,0.025), rgba(139,109,255,0.1), rgba(139,109,255,0.025))',
                        boxShadow: 'inset 1px 0 rgba(139,109,255,0.08), inset -1px 0 rgba(139,109,255,0.08)',
                      }
                    : { background: 'rgba(255,255,255,0.022)' }),
                }}
              />
            ))}
            {ticks.map((_, i) => (
              <div
                key={i}
                className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.04]"
                style={{ left: `${(i / TICKS) * 100}%` }}
              />
            ))}
            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-gradient-to-b from-rose-100 via-rose-400 to-rose-500/20 shadow-[0_0_12px_rgba(255,111,165,0.8)]"
              style={{ left: `${((now - ws) / span) * 100}%` }}
            >
              <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-rose-200 shadow-[0_0_12px_rgba(255,111,165,0.95)]" />
              <span className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-full border border-rose-300/25 bg-black/90 px-1.5 py-0.5 text-3xs font-black uppercase tracking-widest text-rose-200 shadow-[0_0_14px_rgba(255,111,165,0.22)]">
                now
              </span>
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
                .find((e) => e.end > now && !e.done && e.type !== 'maintenance' && e.type !== 'banner');
              return (
                <div key={game.id} className="relative">
                  <div className="mb-1.5 mt-5 flex items-center gap-2.5 first:mt-0">
                    <GameBadge short={game.short} color={game.color} color2={game.color2} />
                    <span
                      className="truncate text-sm font-bold"
                      style={{ color: game.color, fontFamily: titleFontFor(game) }}
                    >
                      {game.name}
                    </span>
                    <span
                      className="h-0.5 flex-1 rounded-full"
                      style={{
                        background: `linear-gradient(90deg, ${tint(game.color, 0.5)}, ${tint(game.color2 ?? game.color, 0.2)})`,
                      }}
                    />
                    {nextEnd && (
                      <span
                        className="shrink-0 text-2xs font-bold tabular-nums"
                        style={{ color: endTone(nextEnd.end - now) }}
                      >
                        next ends {fmtDur(nextEnd.end - now)}
                      </span>
                    )}
                  </div>
                  {evs.length === 0 ? (
                    <p className="py-1 text-2xs text-slate-600">Nothing in this window — import or add events.</p>
                  ) : (
                    (() => {
                      const open = doneOpen.has(game.id);
                      const active = evs.filter((e) => !e.done);
                      const doneCount = evs.length - active.length;
                      const shown = open ? evs : active;
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
                              onToggleDone={() => upsertEvent({ id: ev.id, gameId: ev.gameId, done: !ev.done })}
                            />
                          ))}
                          {doneCount > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleDoneOpen(game.id)}
                              className="block min-h-11 w-full rounded-lg py-0.5 text-left text-2xs font-semibold text-slate-600 transition hover:text-slate-400"
                            >
                              {open ? '− collapse done events' : `+ ${doneCount} done event${doneCount > 1 ? 's' : ''}`}
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
      )}

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
                <div className="text-2xs tabular-nums text-slate-500">
                  {DateTime.fromMillis(r.at).toFormat('ccc dd LLL HH:mm')}{' '}
                  {due ? '· sent/due' : `· in ${fmtDur(r.at - now)}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteReminder(r.id)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-rose-400/10 hover:text-rose-400"
                aria-label="Delete reminder"
              >
                ✕
              </button>
            </div>
          );
        })}
        {reminders.length === 0 && (
          <p className="rounded-2xl bg-white/[0.025] px-4 py-5 text-sm text-slate-500">
            No reminders yet. Add one for maintenance, shop resets, or anything that does not fit a recurring task.
          </p>
        )}
        <Btn onClick={() => openSheet({ kind: 'reminder' })}>+ Reminder</Btn>
      </div>
    </Page>
  );
}
