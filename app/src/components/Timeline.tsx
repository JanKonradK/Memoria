import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import type { Game, GameEvent } from '@void/shared';
import { AnimatePresence, useReducedMotionConfig } from 'motion/react';
import { m } from 'motion/react';
import { useApp } from '../store';
import { TYPE_RANK } from '../timeline-sort';
import { TIMELINE_RANGE_DAYS, useUI, type TimelineRange } from '../ui-store';
import { duration, easing, slideIn } from '../motion';
import { endTone, fmtDur, luminance, tint } from '../util';
import { planSeedImport, SEED_UPDATED } from '../data/seed-events';
import { Disclosure } from './Disclosure';
import { TimelineAgenda } from './TimelineAgenda';
import { Pill, ProgressBar } from './primitives';
import { Btn, GameBadge, Page, SectionTitle, Segmented, Tooltip } from './ui';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN_TICK_GAP_PX = 64;

const viewFade = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.fast, ease: easing.out } },
  exit: { opacity: 0, transition: { duration: duration.fast, ease: easing.out } },
};

function useElementWidth() {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState(0);

  const setElement = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;
    const updateWidth = (nextWidth: number) => setWidth(Math.round(nextWidth));
    updateWidth(element.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [setElement, width] as const;
}

function buildGridTicks(rangeStart: number, rangeEnd: number, range: TimelineRange, width: number): DateTime[] {
  const rangeSpan = rangeEnd - rangeStart;

  if (range === '90d') {
    const tickMillis = [rangeStart];
    let lastPosition = 0;
    let boundary = DateTime.fromMillis(rangeStart).startOf('month').plus({ months: 1 });

    while (boundary.toMillis() < rangeEnd) {
      const boundaryMillis = boundary.toMillis();
      const position = width > 0 ? ((boundaryMillis - rangeStart) / rangeSpan) * width : 0;
      if (width > 0 && position - lastPosition >= MIN_TICK_GAP_PX && width - position >= MIN_TICK_GAP_PX) {
        tickMillis.push(boundaryMillis);
        lastPosition = position;
      }
      boundary = boundary.plus({ months: 1 });
    }

    tickMillis.push(rangeEnd);
    return tickMillis.map((millis) => DateTime.fromMillis(millis));
  }

  const maxIntervals = range === '7d' ? 7 : 10;
  const intervalCount = Math.max(1, Math.min(maxIntervals, Math.floor(width / MIN_TICK_GAP_PX)));
  return Array.from({ length: intervalCount + 1 }, (_, index) =>
    DateTime.fromMillis(rangeStart + (rangeSpan / intervalCount) * index),
  );
}

function tickLabelFormat(range: TimelineRange): string {
  if (range === '7d') return 'ccc d';
  if (range === '90d') return 'LLL';
  return 'dd LLL';
}

/**
 * Readable text on a strong two-tone fill: judge the WHOLE gradient (bars run
 * color → color2 at ~0.5 alpha over black), so only pairings that stay light
 * end-to-end (GI's cream→tan) get dark text.
 */
function isLightFill(color: string, color2?: string): boolean {
  const primary = luminance(color) ?? 0;
  const secondary = luminance(color2 ?? color) ?? primary;
  // WCAG weighting lifts NTE's teal→yellow pair just above the old 200/255
  // boundary; 210/255 keeps GI's cream→tan dark-text treatment without flips.
  return (primary + secondary) / 2 > 210 / 255;
}

const EventRow = memo(function EventRow({
  ev,
  game,
  now,
  ws,
  we,
  onOpenEvent,
  onToggleEvent,
}: {
  ev: GameEvent;
  game: Game;
  now: number;
  ws: number;
  we: number;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
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
  const doneButtonSize = maint
    ? 'min(var(--lane-row-h-maint), 2.25rem)'
    : 'min(calc(var(--lane-row-h) - 0.25rem), 2.25rem)';

  return (
    <m.div variants={slideIn} initial="hidden" animate="visible">
      <div
        className={`group/row relative block w-full rounded-ui-lg text-left ${
          maint ? 'h-[var(--lane-row-h-maint)]' : 'h-[var(--lane-row-h)]'
        } ${ev.done ? 'opacity-40' : ''}`}
      >
        <button
          type="button"
          onClick={() => onOpenEvent(ev)}
          className="absolute inset-0 z-10 rounded-ui-lg"
          aria-label={`Open ${game.name} event: ${ev.name}`}
        />
        <div className="absolute inset-0 rounded-ui-lg bg-fill-1" />
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
            className={`truncate text-meta ${
              maint
                ? 'font-medium text-muted'
                : banner
                  ? 'font-medium text-muted'
                  : isLightFill(game.color, game.color2)
                    ? 'font-bold text-fg-invert'
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
              onToggleEvent(ev);
            }}
            aria-label={ev.done ? `Restore ${ev.name}` : `Mark ${ev.name} done`}
            className={`pointer-events-auto flex items-center justify-center rounded-ui-full font-black transition ${
              maint ? 'text-caption' : 'text-meta'
            } ${
              ev.done
                ? 'bg-ok/90 text-black'
                : 'bg-scrim-veil text-muted opacity-60 hover:text-ok-fg focus-visible:opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100'
            }`}
            style={{ height: doneButtonSize, width: doneButtonSize }}
          >
            ✓
          </button>
          <Tooltip content="d = days · h = hours · m = minutes">
            <span
              className={`rounded-ui-sm bg-scrim-veil px-1.5 py-px text-caption font-bold tabular-nums ${
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
    </m.div>
  );
});

export function TimelinePage({ now }: { now: number }) {
  const state = useApp((s) => s.state);
  const deleteReminder = useApp((s) => s.deleteReminder);
  const upsertEvent = useApp((s) => s.upsertEvent);
  const upsertEvents = useApp((s) => s.upsertEvents);
  const openSheet = useUI((s) => s.openSheet);
  const timelineView = useUI((s) => s.timelineView);
  const setTimelineView = useUI((s) => s.setTimelineView);
  const timelineRange = useUI((s) => s.timelineRange);
  const setTimelineRange = useUI((s) => s.setTimelineRange);
  const reducedMotion = useReducedMotionConfig();
  const [timelineScaleRef, timelineWidth] = useElementWidth();
  const openEvent = useCallback(
    (event: GameEvent) => openSheet({ kind: 'event', eventId: event.id, gameId: event.gameId }),
    [openSheet],
  );
  const toggleEvent = useCallback(
    (event: GameEvent) => upsertEvent({ id: event.id, gameId: event.gameId, done: !event.done }),
    [upsertEvent],
  );

  const hourBucket = Math.floor(now / HOUR);
  // Seed expiry only needs to invalidate once per hour; state changes still
  // recompute against the current raw clock value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const seedPlan = useMemo(() => planSeedImport(state, now), [hourBucket, state]);
  const importSeed = () => {
    upsertEvents(
      seedPlan.map((p) => {
        if (p.kind === 'add') {
          return {
            gameId: p.gameId,
            name: p.seed.name,
            type: p.seed.type,
            start: p.start,
            end: p.end,
            dailyTouch: p.seed.dailyTouch ?? false,
            notify: p.seed.type === 'maintenance' ? false : (p.seed.notify ?? true),
            notes: p.seed.notes ?? '',
            sourceKey: p.seed.sourceKey,
          };
        }
        // Refresh pass: correct previously imported dates/names (TBC → confirmed).
        return {
          id: p.eventId,
          gameId: p.gameId,
          name: p.seed.name,
          start: p.start,
          end: p.end,
        };
      }),
    );
  };

  const { games, eventsByGame, gameById, endingSoon, ticks, ws, we, span } = useMemo(() => {
    const rangeNow = now;
    const rangeStart = rangeNow - 2 * DAY;
    const rangeEnd = rangeStart + TIMELINE_RANGE_DAYS[timelineRange] * DAY;
    const rangeSpan = rangeEnd - rangeStart;
    const live = state.events.filter((event) => !event.deleted);
    const activeGames = state.games.filter((game) => !game.deleted);
    const byGame = new Map<string, GameEvent[]>(
      activeGames.map((game) => [
        game.id,
        live
          .filter((event) => event.gameId === game.id && event.end > rangeStart && event.start < rangeEnd)
          .sort(
            (a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.end - b.end,
          ),
      ]),
    );
    const gamesById = new Map(activeGames.map((game) => [game.id, game]));

    // Soonest PLAY deadlines across all games — events and endgame cycles.
    // Banners and things you've marked done are excluded.
    const soon = live
      .filter(
        (event) =>
          (event.type === 'event' || event.type === 'custom' || event.type === 'cycle') &&
          !event.done &&
          event.end > rangeNow &&
          event.start <= rangeNow &&
          gamesById.has(event.gameId),
      )
      .sort((a, b) => a.end - b.end)
      .slice(0, 5);
    const gridTicks = buildGridTicks(rangeStart, rangeEnd, timelineRange, timelineWidth);

    return {
      games: activeGames,
      eventsByGame: byGame,
      gameById: gamesById,
      endingSoon: soon,
      ticks: gridTicks,
      ws: rangeStart,
      we: rangeEnd,
      span: rangeSpan,
    };
    // Timeline membership and grid construction intentionally invalidate on
    // the hour bucket; the red playhead below continues to use raw `now`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourBucket, state.events, state.games, timelineRange, timelineWidth]);

  const reminders = state.reminders.filter((r) => !r.deleted).sort((a, b) => a.at - b.at);
  const [doneOpen, setDoneOpen] = useState<Set<string>>(new Set());
  const [laneOpen, setLaneOpen] = useState<Record<string, boolean>>({});
  const toggleDoneOpen = (gameId: string) =>
    setDoneOpen((s) => {
      const next = new Set(s);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });

  return (
    <Page>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-title font-black tracking-tight text-fg-soft">Event timeline</h1>
        <Segmented
          options={[
            { value: 'lanes', label: 'Lanes' },
            { value: 'agenda', label: 'Agenda' },
          ]}
          value={timelineView}
          onChange={setTimelineView}
          ariaLabel="Timeline view"
        />
        <Segmented
          options={[
            { value: '7d', label: '7d' },
            { value: '30d', label: '30d' },
            { value: '90d', label: '90d' },
          ]}
          value={timelineRange}
          onChange={setTimelineRange}
          ariaLabel="Timeline range"
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

      {endingSoon.length > 0 && (
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
                  className="glass flex min-h-11 items-center gap-2 rounded-ui-lg px-3 py-2 text-left transition hover:bg-fill-2"
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

      <AnimatePresence mode="wait" initial={false}>
        {timelineView === 'agenda' ? (
          <m.div key="agenda" variants={viewFade} initial="hidden" animate="visible" exit="exit">
            <TimelineAgenda now={now} range={timelineRange} />
          </m.div>
        ) : (
          <m.div key="lanes" variants={viewFade} initial="hidden" animate="visible" exit="exit">
            <div className="glass gold-hairline relative rounded-ui-card p-4">
              <div ref={timelineScaleRef} data-timeline-scale>
                <div className="relative mb-2 ml-0 h-4 text-caption text-dim">
                  {ticks.map((tick, index) => {
                    const first = index === 0;
                    const last = index === ticks.length - 1;
                    return (
                      <span
                        key={tick.toMillis()}
                        data-timeline-tick
                        className={`absolute tabular-nums ${
                          first ? 'translate-x-0' : last ? '-translate-x-full' : '-translate-x-1/2'
                        }`}
                        style={{ left: `${((tick.toMillis() - ws) / span) * 100}%` }}
                      >
                        {tick.toFormat(tickLabelFormat(timelineRange))}
                      </span>
                    );
                  })}
                </div>

                <div className="relative py-1">
                  {ticks.map((tick) => (
                    <div
                      key={tick.toMillis()}
                      className="pointer-events-none absolute inset-y-0 w-px bg-fill-2"
                      style={{ left: `${((tick.toMillis() - ws) / span) * 100}%` }}
                    />
                  ))}
                  <m.div
                    initial={false}
                    animate={{ left: `${((now - ws) / span) * 100}%` }}
                    transition={{ duration: reducedMotion ? 0 : 0.6, ease: 'linear' }}
                    className="pointer-events-none absolute inset-y-0 z-10 w-px bg-danger/80"
                  >
                    <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-ui-full bg-danger" />
                  </m.div>

                  {games.length === 0 && (
                    <p className="py-8 text-center text-body text-dim">
                      No events yet — add banners and events so nothing ends without you noticing.
                    </p>
                  )}

                  {games.map((game) => {
                    const evs = eventsByGame.get(game.id) ?? [];
                    const open = laneOpen[game.id] ?? evs.length > 0;
                    const nextEnd = [...evs]
                      .sort((a, b) => a.end - b.end)
                      .find((e) => e.end > now && !e.done && e.type !== 'maintenance' && e.type !== 'banner');
                    const doneEventsOpen = doneOpen.has(game.id);
                    const active = evs.filter((event) => !event.done);
                    const doneCount = evs.length - active.length;
                    const shown = doneEventsOpen ? evs : active;
                    return (
                      <Disclosure
                        key={game.id}
                        open={open}
                        onOpenChange={(nextOpen) => setLaneOpen((current) => ({ ...current, [game.id]: nextOpen }))}
                        title={
                          <span className="flex min-w-0 items-center gap-2">
                            <GameBadge short={game.short} color={game.color} color2={game.color2} />
                            <span
                              className="truncate text-label font-black uppercase tracking-wider"
                              style={{ color: game.color }}
                            >
                              {game.name}
                            </span>
                            <span
                              className="h-px flex-1"
                              style={{
                                background: `linear-gradient(90deg, ${tint(game.color, 0.3)}, ${tint(game.color2 ?? game.color, 0.12)})`,
                              }}
                            />
                          </span>
                        }
                        summary={
                          !open ? (
                            <span className="flex flex-col text-caption font-semibold tabular-nums text-muted">
                              <span>
                                {evs.length} {evs.length === 1 ? 'event' : 'events'}
                              </span>
                              <span>
                                {nextEnd ? (
                                  <span style={{ color: endTone(nextEnd.end - now) }}>
                                    next ends {fmtDur(nextEnd.end - now)}
                                  </span>
                                ) : (
                                  'no upcoming deadline'
                                )}
                              </span>
                            </span>
                          ) : undefined
                        }
                        triggerLabel={`${open ? 'Collapse' : 'Expand'} ${game.name} lane`}
                        className="relative"
                        triggerClassName="relative z-20 mt-2 rounded-ui-lg px-1 transition hover:bg-fill-1"
                        contentClassName="pb-1"
                      >
                        {evs.length === 0 ? (
                          <p className="py-1 text-label text-muted">Nothing in this window — import or add events.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {shown.map((ev) => (
                              <EventRow
                                key={ev.id}
                                ev={ev}
                                game={game}
                                now={now}
                                ws={ws}
                                we={we}
                                onOpenEvent={openEvent}
                                onToggleEvent={toggleEvent}
                              />
                            ))}
                            {doneCount > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleDoneOpen(game.id)}
                                className="block min-h-11 w-full rounded-ui-md py-0.5 text-left text-caption font-semibold text-muted transition hover:text-fg-soft sm:min-h-8"
                              >
                                {doneEventsOpen
                                  ? '− collapse done events'
                                  : `+ ${doneCount} done event${doneCount > 1 ? 's' : ''}`}
                              </button>
                            )}
                          </div>
                        )}
                      </Disclosure>
                    );
                  })}
                </div>
              </div>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      <SectionTitle level={2}>One-off reminders</SectionTitle>
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
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ui-lg text-dim transition hover:bg-danger/10 hover:text-danger sm:h-9 sm:w-9"
                aria-label="Delete reminder"
              >
                ✕
              </button>
            </div>
          );
        })}
        {reminders.length === 0 && (
          <p className="rounded-ui-xl bg-fill-1 px-4 py-5 text-body text-muted">
            No reminders yet. Add one for maintenance, shop resets, or anything that does not fit a recurring task.
          </p>
        )}
        <Btn onClick={() => openSheet({ kind: 'reminder' })}>+ Reminder</Btn>
      </div>
    </Page>
  );
}
