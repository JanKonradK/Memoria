import { useState } from 'react';
import { DateTime } from 'luxon';
import type { Game, GameEvent } from '@technogg/shared';
import { useApp } from '../store';
import { agendaCompare, agendaRank } from '../timeline-sort';
import { useUI } from '../ui-store';
import { endTone, fmtDur } from '../util';
import { GameBadge } from './ui';

const DAY = 86_400_000;

function TypeTags({ event }: { event: GameEvent }) {
  const label = event.type === 'maintenance' ? 'patch' : event.type === 'custom' ? 'event' : event.type;
  return (
    <>
      <span
        className={`shrink-0 rounded px-1 text-3xs font-black uppercase tracking-wider ${
          event.type === 'maintenance' ? 'bg-white/10 text-slate-400' : 'bg-white/5 text-slate-500'
        }`}
      >
        {label}
      </span>
      {event.dailyTouch && (
        <span
          className="shrink-0 rounded bg-amber-400/10 px-1 text-3xs font-black uppercase tracking-wider text-amber-300/90"
          title="Needs a daily login/claim"
        >
          daily
        </span>
      )}
    </>
  );
}

function AgendaRow({ event, game, now }: { event: GameEvent; game: Game; now: number }) {
  const openSheet = useUI((state) => state.openSheet);
  const upsertEvent = useApp((state) => state.upsertEvent);
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
    <div className="group/agenda relative flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.04]">
      <button
        type="button"
        onClick={() => openSheet({ kind: 'event', gameId: event.gameId, eventId: event.id })}
        className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
        aria-label={`Open ${game.name} event: ${event.name}, ${status}`}
        title={`${game.name}: ${event.name}`}
      />
      <span className="absolute inset-y-2 left-0 w-[3px] rounded-full" style={{ backgroundColor: game.color }} />
      <div className="pointer-events-none relative z-20 flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex-nowrap">
        <GameBadge short={game.short} color={game.color} color2={game.color2} size="sm" />
        <TypeTags event={event} />
        <span
          className={`min-w-24 flex-1 truncate text-xs font-medium ${
            event.done ? 'text-slate-500 line-through' : 'text-slate-200'
          }`}
        >
          {event.name}
        </span>
        <span className="ml-auto shrink-0 text-2xs tabular-nums text-slate-500">
          {DateTime.fromMillis(event.start).toFormat('dd LLL')} → {DateTime.fromMillis(event.end).toFormat('dd LLL')}
        </span>
        {rank === 0 && (
          <span
            className={`shrink-0 text-2xs font-bold tabular-nums ${remaining < DAY ? 'warn-pulse' : ''}`}
            style={{ color: endTone(remaining) }}
          >
            ends {fmtDur(remaining)}
          </span>
        )}
        {rank === 1 && (
          <span className="shrink-0 text-2xs font-semibold tabular-nums text-slate-400">
            starts in {fmtDur(event.start - now)}
          </span>
        )}
      </div>
      <button
        type="button"
        title={event.done ? 'Marked done — click to bring it back' : 'Done with this — hide it'}
        onClick={(clickEvent) => {
          clickEvent.stopPropagation();
          upsertEvent({ id: event.id, gameId: event.gameId, done: !event.done });
        }}
        aria-label={event.done ? `Restore ${event.name}` : `Mark ${event.name} done`}
        className={`relative z-30 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-black transition ${
          event.done
            ? 'bg-emerald-400/90 text-black'
            : 'bg-black/70 text-slate-400 opacity-60 hover:text-emerald-300 focus-visible:opacity-100 sm:opacity-0 sm:group-hover/agenda:opacity-100'
        }`}
      >
        ✓
      </button>
    </div>
  );
}

function AgendaSection({
  title,
  events,
  games,
  now,
  emptyLabel,
}: {
  title: string;
  events: GameEvent[];
  games: Map<string, Game>;
  now: number;
  emptyLabel: string;
}) {
  return (
    <section>
      <h3 className="mb-1.5 text-2xs font-bold uppercase tracking-widest text-slate-500">{title}</h3>
      {events.length > 0 ? (
        <div className="space-y-1">
          {events.map((event) => (
            <AgendaRow key={event.id} event={event} game={games.get(event.gameId)!} now={now} />
          ))}
        </div>
      ) : (
        <p className="px-3 py-1 text-2xs text-slate-600">{emptyLabel}</p>
      )}
    </section>
  );
}

export function TimelineAgenda({ now }: { now: number }) {
  const state = useApp((store) => store.state);
  const [pastOpen, setPastOpen] = useState(false);
  const windowStart = now - 2 * DAY;
  const windowEnd = now + 28 * DAY;
  const games = new Map(state.games.filter((game) => !game.deleted).map((game) => [game.id, game]));
  const events = state.events
    .filter((event) => !event.deleted && games.has(event.gameId) && event.end > windowStart && event.start < windowEnd)
    .sort((a, b) => agendaCompare(a, b, now));
  const live = events.filter((event) => agendaRank(event, now) === 0);
  const upcoming = events.filter((event) => agendaRank(event, now) === 1);
  const past = events.filter((event) => agendaRank(event, now) >= 2);

  return (
    <div className="glass gold-hairline relative rounded-3xl p-4">
      {events.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No events in this window — import or add events so nothing ends without you noticing.
        </p>
      ) : (
        <div className="space-y-4">
          <AgendaSection title="Live now" events={live} games={games} now={now} emptyLabel="Nothing live right now." />
          <AgendaSection
            title="Upcoming"
            events={upcoming}
            games={games}
            now={now}
            emptyLabel="Nothing upcoming in this window."
          />
          <section>
            <h3 className="mb-1.5 text-2xs font-bold uppercase tracking-widest text-slate-500">Ended · done</h3>
            {past.length > 0 ? (
              <button
                type="button"
                onClick={() => setPastOpen((open) => !open)}
                className="block min-h-11 w-full rounded-lg py-0.5 text-left text-2xs font-semibold text-slate-600 transition hover:text-slate-400"
                aria-expanded={pastOpen}
              >
                {pastOpen ? '− collapse past events' : `+ ${past.length} past event${past.length === 1 ? '' : 's'}`}
              </button>
            ) : (
              <p className="px-3 py-1 text-2xs text-slate-600">No past events in this window.</p>
            )}
            {pastOpen && (
              <div className="mt-1 space-y-1">
                {past.map((event) => (
                  <AgendaRow key={event.id} event={event} game={games.get(event.gameId)!} now={now} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
