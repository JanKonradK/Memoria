import { useState } from 'react';
import { DateTime } from 'luxon';
import type { Game, GameEvent } from '@technogg/shared';
import { useApp } from '../store';
import { TYPE_RANK } from '../timeline-sort';
import { useUI } from '../ui-store';
import { endTone, fmtDur, tint } from '../util';
import { planSeedImport, SEED_UPDATED } from '../data/seed-events';
import { TimelineAgenda } from './TimelineAgenda';
import { Pill, ProgressBar } from './primitives';
import { Btn, GameBadge, Page, SectionTitle, Segmented, Tooltip } from './ui';

const DAY = 86_400_000;

function lum(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/**
 * Readable text on a strong two-tone fill: judge the WHOLE gradient (bars run
 * color → color2 at ~0.5 alpha over black), so only pairings that stay light
 * end-to-end (GI's cream→tan) get dark text.
 */
function isLightFill(color: string, color2?: string): boolean {
  return (lum(color) + lum(color2 ?? color)) / 2 > 200;
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
      className={`slide-in group/row relative block h-11 w-full rounded-ui-lg text-left ${maint ? 'sm:h-6' : 'sm:h-9'} ${ev.done ? 'opacity-40' : ''}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 z-10 rounded-ui-lg"
        aria-label={`Open ${game.name} event: ${ev.name}`}
      />
      <div className="absolute inset-0 rounded-ui-lg bg-white/[0.03]" />
      <ProgressBar
        variant="timeline"
        value={displayWidth / 100}
        start={displayLeft / 100}
        color={game.color}
        data-event-bar
        className={`absolute inset-y-0 flex items-center gap-1.5 overflow-hidden rounded-ui-lg px-2 ${
          maint ? 'border border-dashed border-dim/50' : ''
        }`}
        style={{
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
        {banner && (
          <span className="text-caption" style={{ color: 'rgba(232,180,90,0.45)' }}>
            ★
          </span>
        )}
        {cycle && <Pill variant={isLightFill(game.color, game.color2) ? 'light' : 'dark'}>cycle</Pill>}
        {maint && <Pill variant="muted">patch</Pill>}
        <span
          className={`truncate text-xs ${
            maint
              ? 'font-medium text-muted'
              : banner
                ? 'font-medium text-muted'
                : isLightFill(game.color, game.color2)
                  ? 'font-bold text-slate-900'
                  : 'font-bold text-white'
          }`}
        >
          {ev.name}
        </span>
      </ProgressBar>
      <span className="pointer-events-none absolute inset-y-0 right-1 z-20 my-auto flex h-fit items-center gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone();
          }}
          aria-label={ev.done ? `Restore ${ev.name}` : `Mark ${ev.name} done`}
          className={`pointer-events-auto flex items-center justify-center rounded-ui-full font-black transition ${
            maint ? 'h-9 w-9 text-[0.5625rem] sm:h-6 sm:w-6' : 'h-9 w-9 text-xs sm:h-8 sm:w-8'
          } ${
            ev.done
              ? 'bg-ok/90 text-black'
              : 'bg-black/70 text-muted opacity-60 hover:text-emerald-300 focus-visible:opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100'
          }`}
        >
          ✓
        </button>
        <Tooltip content="d = days · h = hours · m = minutes">
          <span
            className={`rounded-ui-sm bg-black/70 px-1.5 py-px text-caption font-bold tabular-nums ${
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
        </Tooltip>
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

  return (
    <Page className="pb-28 pt-4 sm:pt-5 lg:pb-8">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-title font-black tracking-tight text-slate-100">Event timeline</h2>
        <Segmented
          options={[
            { value: 'lanes', label: 'Lanes' },
            { value: 'agenda', label: 'Agenda' },
          ]}
          value={timelineView}
          onChange={setTimelineView}
          ariaLabel="Timeline view"
        />
        <div className="ml-auto grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
          {seedPlan.length > 0 && (
            <Tooltip content={`Bundled with the app (updated ${SEED_UPDATED}) — adds new events, fixes changed dates`}>
              {/* Btn takes a fixed prop set, so the trigger props land on a box-less wrapper. */}
              <span className="contents">
                <Btn onClick={importSeed}>Import {seedPlan.length}</Btn>
              </span>
            </Tooltip>
          )}
          <Btn onClick={() => openSheet({ kind: 'pasteEvents' })}>Paste (AI)</Btn>
          <Btn kind="primary" onClick={() => openSheet({ kind: 'event' })}>
            + Event
          </Btn>
        </div>
      </div>

      {timelineView === 'lanes' && endingSoon.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-caption font-bold uppercase tracking-widest text-dim">Ending soonest</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {endingSoon.map((ev) => {
              const game = gameById.get(ev.gameId)!;
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openSheet({ kind: 'event', eventId: ev.id, gameId: ev.gameId })}
                  className="glass flex min-h-11 items-center gap-2 rounded-ui-lg px-3 py-2 text-left transition hover:bg-white/[0.06]"
                >
                  <GameBadge short={game.short} color={game.color} color2={game.color2} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-label font-semibold text-fg-soft">{ev.name}</div>
                    <Tooltip content="d = days · h = hours · m = minutes">
                      <div
                        className={`text-caption font-bold tabular-nums ${ev.end - now < DAY ? 'warn-pulse' : ''}`}
                        style={{ color: endTone(ev.end - now) }}
                      >
                        {fmtDur(ev.end - now)}
                      </div>
                    </Tooltip>
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
        <div className="glass gold-hairline relative rounded-ui-card p-4">
          <div className="relative mb-2 ml-0 h-4 text-caption text-dim">
            {ticks.map((t, i) => (
              <span
                key={i}
                className="absolute -translate-x-1/2 tabular-nums"
                style={{ left: `${(i / TICKS) * 100}%` }}
              >
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
              <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-ui-full bg-rose-400" />
            </div>

            {games.length === 0 && (
              <p className="py-8 text-center text-body text-dim">
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
                  <div className="mb-1.5 mt-4 flex items-center gap-2 first:mt-0">
                    <GameBadge short={game.short} color={game.color} color2={game.color2} />
                    <span className="text-label font-black uppercase tracking-wider" style={{ color: game.color }}>
                      {game.name}
                    </span>
                    <span
                      className="h-px flex-1"
                      style={{
                        background: `linear-gradient(90deg, ${tint(game.color, 0.3)}, ${tint(game.color2 ?? game.color, 0.12)})`,
                      }}
                    />
                    {nextEnd && (
                      <Tooltip content="d = days · h = hours · m = minutes">
                        <span
                          className="text-caption font-semibold tabular-nums"
                          style={{ color: endTone(nextEnd.end - now) }}
                        >
                          next ends {fmtDur(nextEnd.end - now)}
                        </span>
                      </Tooltip>
                    )}
                  </div>
                  {evs.length === 0 ? (
                    <p className="py-1 text-label text-faint">Nothing in this window — import or add events.</p>
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
                              className="block min-h-11 w-full rounded-ui-md py-0.5 text-left text-caption font-semibold text-faint transition hover:text-muted sm:min-h-8"
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
              className={`glass flex items-center gap-3 rounded-ui-xl px-4 py-3 ${due ? 'opacity-60' : ''}`}
            >
              {game ? (
                <GameBadge short={game.short} color={game.color} color2={game.color2} />
              ) : (
                <span className="h-2 w-2 shrink-0 rounded-ui-full bg-dim" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-body text-fg-soft">{r.message}</div>
                <div className="text-label tabular-nums text-dim">
                  {DateTime.fromMillis(r.at).toFormat('ccc dd LLL HH:mm')}{' '}
                  {due ? '· sent/due' : `· in ${fmtDur(r.at - now)}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteReminder(r.id)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ui-lg text-dim transition hover:bg-rose-400/10 hover:text-rose-400 sm:h-9 sm:w-9"
                aria-label="Delete reminder"
              >
                ✕
              </button>
            </div>
          );
        })}
        {reminders.length === 0 && (
          <p className="rounded-ui-xl bg-white/[0.025] px-4 py-5 text-body text-dim">
            No reminders yet. Add one for maintenance, shop resets, or anything that does not fit a recurring task.
          </p>
        )}
        <Btn onClick={() => openSheet({ kind: 'reminder' })}>+ Reminder</Btn>
      </div>
    </Page>
  );
}
