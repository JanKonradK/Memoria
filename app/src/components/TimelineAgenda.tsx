import { useState } from 'react';
import { DateTime } from 'luxon';
import type { AppState, Game, GameEvent } from '@technogg/shared';
import { useApp } from '../store';
import { agendaCompare, agendaRank, budgetAgenda, groupVersionUpdates, type AgendaRow } from '../timeline-sort';
import { useUI } from '../ui-store';
import { endTone, fmtDur } from '../util';
import { Pill } from './primitives';
import { GameBadge } from './ui';

const DAY = 86_400_000;

export type AgendaMode = 'full' | 'dashboard';

export interface AgendaData {
  games: Map<string, Game>;
  live: AgendaRow[];
  upcoming: AgendaRow[];
  past: GameEvent[];
}

/** Shared timeline window/ranking. Dashboard mode deliberately drops history and caps its rails. */
export function selectAgendaData(state: AppState, now: number, mode: AgendaMode = 'full'): AgendaData {
  const windowStart = mode === 'dashboard' ? now : now - 2 * DAY;
  const windowEnd = now + (mode === 'dashboard' ? 7 : 28) * DAY;
  const games = new Map(state.games.filter((game) => !game.deleted).map((game) => [game.id, game]));
  const events = state.events
    .filter((event) => !event.deleted && games.has(event.gameId) && event.end > windowStart && event.start < windowEnd)
    .sort((a, b) => agendaCompare(a, b, now));
  const live = events.filter((event) => agendaRank(event, now) === 0);
  const upcoming = events.filter((event) => agendaRank(event, now) === 1);

  if (mode === 'dashboard') {
    const budgeted = budgetAgenda(
      live.map((event) => ({ kind: 'event', event })),
      groupVersionUpdates(upcoming, games, now),
      9,
    );
    return { games, ...budgeted, past: [] };
  }

  return {
    games,
    live: live.map((event) => ({ kind: 'event', event })),
    upcoming: upcoming.map((event) => ({ kind: 'event', event })),
    past: events.filter((event) => agendaRank(event, now) >= 2),
  };
}

function TypeTags({ event }: { event: GameEvent }) {
  const label = event.type === 'maintenance' ? 'patch' : event.type === 'custom' ? 'event' : event.type;
  return (
    <>
      <Pill variant={event.type === 'maintenance' ? 'muted' : 'neutral'}>{label}</Pill>
      {event.dailyTouch && <Pill variant="warn">daily</Pill>}
    </>
  );
}

function AgendaEventRow({
  event,
  game,
  now,
  mode,
  onOpenEvent,
  onToggleEvent,
}: {
  event: GameEvent;
  game: Game;
  now: number;
  mode: AgendaMode;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
}) {
  const rank = agendaRank(event, now);
  const remaining = event.end - now;
  const status =
    rank === 0
      ? `ends in ${fmtDur(remaining)}`
      : rank === 1
        ? `starts in ${fmtDur(event.start - now)}`
        : event.done
          ? 'done'
          : 'ended';

  return (
    <div
      className={`group/agenda relative flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-ui-lg text-left transition hover:bg-white/[0.04] ${
        mode === 'dashboard' ? 'px-2.5 py-2' : 'px-3 py-2'
      }`}
    >
      <button
        type="button"
        onClick={() => onOpenEvent(event)}
        className="absolute inset-0 z-10 rounded-ui-lg"
        aria-label={`Open ${game.name} event: ${event.name}, ${status}`}
      />
      <span className="absolute inset-y-2 left-0 w-[3px] rounded-ui-full" style={{ backgroundColor: game.color }} />
      <div
        className={`pointer-events-none relative z-20 flex min-w-0 flex-1 ${
          mode === 'dashboard' ? 'items-start gap-2' : 'flex-wrap items-center gap-1.5 sm:flex-nowrap'
        }`}
      >
        <GameBadge short={game.short} color={game.color} color2={game.color2} size="sm" className="mt-0.5" />
        <div className={mode === 'dashboard' ? 'min-w-0 flex-1' : 'contents'}>
          <div className={mode === 'dashboard' ? 'flex min-w-0 items-center gap-1.5' : 'contents'}>
            <TypeTags event={event} />
            <span
              className={`min-w-24 flex-1 truncate text-xs font-medium ${
                event.done ? 'text-dim line-through' : 'text-fg-soft'
              }`}
            >
              {event.name}
            </span>
          </div>
          {mode === 'full' && (
            <span className="ml-auto shrink-0 text-caption tabular-nums text-dim">
              {DateTime.fromMillis(event.start).toFormat('dd LLL')} →{' '}
              {DateTime.fromMillis(event.end).toFormat('dd LLL')}
            </span>
          )}
          {rank === 0 && (
            <span
              className={`shrink-0 text-caption font-bold tabular-nums ${
                remaining < DAY ? 'warn-pulse' : ''
              } ${mode === 'dashboard' ? 'mt-1 block' : ''}`}
              style={{ color: endTone(remaining) }}
            >
              ends {fmtDur(remaining)}
            </span>
          )}
          {rank === 1 && (
            <span
              className={`shrink-0 text-caption font-semibold tabular-nums text-muted ${
                mode === 'dashboard' ? 'mt-1 block' : ''
              }`}
            >
              starts in {fmtDur(event.start - now)}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={(clickEvent) => {
          clickEvent.stopPropagation();
          onToggleEvent(event);
        }}
        aria-label={event.done ? `Restore ${event.name}` : `Mark ${event.name} done`}
        className={`relative z-30 flex shrink-0 items-center justify-center rounded-ui-full text-xs font-black transition ${
          mode === 'dashboard' ? 'h-8 w-8' : 'h-9 w-9 sm:h-8 sm:w-8'
        } ${
          event.done
            ? 'bg-ok/90 text-black'
            : 'bg-black/70 text-muted opacity-60 hover:text-emerald-300 focus-visible:opacity-100 sm:opacity-0 sm:group-hover/agenda:opacity-100'
        }`}
      >
        ✓
      </button>
    </div>
  );
}

function AgendaGroupRow({
  row,
  game,
  now,
  onOpenTimeline,
}: {
  row: Extract<AgendaRow, { kind: 'group' }>;
  game: Game;
  now: number;
  onOpenTimeline?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpenTimeline}
      aria-label={`Open the timeline: ${row.label}, ${row.count} items`}
      className="relative flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-ui-lg bg-gold/10 px-2.5 py-2 text-left text-gold ring-1 ring-inset ring-gold/30 transition hover:bg-gold/15"
    >
      <span className="absolute inset-y-2 left-0 w-[3px] rounded-ui-full" style={{ backgroundColor: game.color }} />
      <GameBadge short={game.short} color={game.color} color2={game.color2} size="sm" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-amber-100">{row.label}</span>
      <span className="shrink-0 text-caption text-muted">{row.count} items</span>
      <span className="shrink-0 text-caption font-bold tabular-nums text-gold">in {fmtDur(row.at - now)}</span>
    </button>
  );
}

function AgendaSection({
  title,
  rows,
  games,
  now,
  mode,
  emptyLabel,
  onOpenEvent,
  onToggleEvent,
  onOpenTimeline,
}: {
  title: string;
  rows: AgendaRow[];
  games: Map<string, Game>;
  now: number;
  mode: AgendaMode;
  emptyLabel: string;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
  onOpenTimeline?: () => void;
}) {
  return (
    <section>
      <h3 className="mb-1.5 text-caption font-bold uppercase tracking-widest text-dim">{title}</h3>
      {rows.length > 0 ? (
        <div className="space-y-1">
          {rows.map((row) =>
            row.kind === 'group' ? (
              <AgendaGroupRow
                key={`group-${row.gameId}-${row.at}`}
                row={row}
                game={games.get(row.gameId)!}
                now={now}
                onOpenTimeline={onOpenTimeline}
              />
            ) : (
              <AgendaEventRow
                key={row.event.id}
                event={row.event}
                game={games.get(row.event.gameId)!}
                now={now}
                mode={mode}
                onOpenEvent={onOpenEvent}
                onToggleEvent={onToggleEvent}
              />
            ),
          )}
        </div>
      ) : (
        <p className="px-3 py-1 text-label text-faint">{emptyLabel}</p>
      )}
    </section>
  );
}

/** Shared event list. Dashboard mode omits history and uses the capped selector above. */
export function AgendaList({
  data,
  now,
  mode = 'full',
  onOpenEvent,
  onToggleEvent,
  onOpenTimeline,
}: {
  data: AgendaData;
  now: number;
  mode?: AgendaMode;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
  onOpenTimeline?: () => void;
}) {
  const [pastOpen, setPastOpen] = useState(false);
  return (
    <div className={mode === 'dashboard' ? 'space-y-3.5' : 'space-y-4'}>
      <AgendaSection
        title="Live now"
        rows={data.live}
        games={data.games}
        now={now}
        mode={mode}
        emptyLabel="Nothing live right now."
        onOpenEvent={onOpenEvent}
        onToggleEvent={onToggleEvent}
        onOpenTimeline={onOpenTimeline}
      />
      <AgendaSection
        title="Upcoming"
        rows={data.upcoming}
        games={data.games}
        now={now}
        mode={mode}
        emptyLabel="Nothing upcoming in this window."
        onOpenEvent={onOpenEvent}
        onToggleEvent={onToggleEvent}
        onOpenTimeline={onOpenTimeline}
      />
      {mode === 'full' && (
        <section>
          <h3 className="mb-1.5 text-caption font-bold uppercase tracking-widest text-dim">Ended · done</h3>
          {data.past.length > 0 ? (
            <button
              type="button"
              onClick={() => setPastOpen((open) => !open)}
              className="block min-h-11 w-full rounded-ui-md py-0.5 text-left text-caption font-semibold text-faint transition hover:text-muted sm:min-h-8"
              aria-expanded={pastOpen}
            >
              {pastOpen
                ? '− collapse past events'
                : `+ ${data.past.length} past event${data.past.length === 1 ? '' : 's'}`}
            </button>
          ) : (
            <p className="px-3 py-1 text-label text-faint">No past events in this window.</p>
          )}
          {pastOpen && (
            <div className="mt-1 space-y-1">
              {data.past.map((event) => (
                <AgendaEventRow
                  key={event.id}
                  event={event}
                  game={data.games.get(event.gameId)!}
                  now={now}
                  mode={mode}
                  onOpenEvent={onOpenEvent}
                  onToggleEvent={onToggleEvent}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export function TimelineAgenda({ now }: { now: number }) {
  const state = useApp((s) => s.state);
  const upsertEvent = useApp((s) => s.upsertEvent);
  const openSheet = useUI((store) => store.openSheet);
  const data = selectAgendaData(state, now);
  const eventsExist = data.live.length + data.upcoming.length + data.past.length > 0;

  return (
    <div className="glass gold-hairline relative rounded-ui-card p-4">
      {eventsExist ? (
        <AgendaList
          data={data}
          now={now}
          onOpenEvent={(event) => openSheet({ kind: 'event', gameId: event.gameId, eventId: event.id })}
          onToggleEvent={(event) => upsertEvent({ id: event.id, gameId: event.gameId, done: !event.done })}
        />
      ) : (
        <p className="py-8 text-center text-body text-dim">
          No events in this window — import or add events so nothing ends without you noticing.
        </p>
      )}
    </div>
  );
}
