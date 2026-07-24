import type { CSSProperties } from 'react';
import { DateTime } from 'luxon';
import type { AppState, GameEvent, GameUrgency } from '@technogg/shared';
import { fmtDur } from '../util';
import { GameCard } from './GameCard';
import { AgendaList, selectAgendaData } from './TimelineAgenda';
import { GameBadge } from './ui';

/** The horizon is a card among the game cards — same shell, gold instead of a game colour. */
function EventHorizonCard({
  state,
  entries,
  now,
  onOpenEvent,
  onToggleEvent,
  onOpenReminder,
  onOpenTimeline,
}: {
  state: AppState;
  entries: GameUrgency[];
  now: number;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
  onOpenReminder: () => void;
  onOpenTimeline: () => void;
}) {
  const agenda = selectAgendaData(state, now, 'dashboard');
  const eventRows = agenda.live.length + agenda.upcoming.length;
  const reminders = state.reminders
    .filter((reminder) => !reminder.deleted && reminder.at > now - 86_400_000)
    .sort((a, b) => a.at - b.at)
    .slice(0, 3);
  const gameById = agenda.games;
  const actionLimit = Math.max(0, 5 - Math.min(5, eventRows + reminders.length));
  const nextActions = entries
    .flatMap((entry) => entry.actions.map((action) => ({ action, game: entry.game })))
    .filter(({ action }) => action.kind !== 'event' && action.at >= now)
    .sort((a, b) => a.action.at - b.action.at)
    .slice(0, actionLimit);

  return (
    <aside
      className="cards-horizon card-enter scrollbar-thin relative flex flex-col overflow-y-auto rounded-ui-card p-4 xl:max-h-[calc(100dvh-11rem)]"
      aria-label="Event horizon"
      style={{
        background:
          'linear-gradient(155deg, rgba(232,180,90,0.2), transparent 46%), linear-gradient(335deg, rgba(255,111,165,0.09), transparent 42%), #0a0805',
        boxShadow:
          'inset 0 0 0 1px rgba(232,180,90,0.4), inset 0 1px 0 rgba(255,255,255,0.07), 0 0 70px -18px rgba(232,180,90,0.6)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-4 top-0 h-[3px] rounded-ui-full"
        style={{ background: 'linear-gradient(90deg, transparent, var(--color-gold), #ffe9bb, transparent)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(460px 150px at 50% 0%, rgba(232,180,90,0.22), transparent 70%)',
          animation: 'pulseFade 4.2s ease-in-out infinite',
        }}
      />
      <div className="relative mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-caption font-bold uppercase tracking-[0.2em] text-gold/70">Event horizon</p>
          <h2
            className="text-title font-black text-fg"
            style={{ textShadow: '0 0 24px rgba(232,180,90,0.45), 0 1px 0 rgba(0,0,0,0.4)' }}
          >
            Across every game
          </h2>
        </div>
        <span className="rounded-ui-full bg-gold/10 px-2 py-1 text-caption font-black tabular-nums text-amber-100 ring-1 ring-gold/30">
          {eventRows}
        </span>
      </div>

      <div className="relative">
        <AgendaList data={agenda} now={now} mode="dashboard" onOpenEvent={onOpenEvent} onToggleEvent={onToggleEvent} />
      </div>

      <section className="relative mt-4">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h3 className="text-caption font-bold uppercase tracking-widest text-dim">Reminders</h3>
          <button
            type="button"
            onClick={onOpenReminder}
            className="rounded-ui-md px-2 py-1 text-caption font-semibold text-muted transition hover:bg-white/[0.06] hover:text-white"
          >
            + Add
          </button>
        </div>
        {reminders.length > 0 ? (
          <div className="space-y-1">
            {reminders.map((reminder) => {
              const game = reminder.gameId ? gameById.get(reminder.gameId) : undefined;
              const due = reminder.at <= now;
              return (
                <div key={reminder.id} className="flex items-start gap-2 rounded-ui-lg bg-white/[0.025] px-2.5 py-2">
                  {game ? (
                    <GameBadge
                      short={game.short}
                      color={game.color}
                      color2={game.color2}
                      size="sm"
                      className="mt-0.5"
                    />
                  ) : (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-ui-full bg-gold" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-fg-soft">{reminder.message}</p>
                    <p className={`mt-0.5 text-caption tabular-nums ${due ? 'text-rose-300' : 'text-dim'}`}>
                      {due
                        ? 'due now'
                        : `${DateTime.fromMillis(reminder.at).toFormat('dd LLL · HH:mm')} · in ${fmtDur(reminder.at - now)}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-ui-lg bg-white/[0.02] px-3 py-2 text-label text-faint">No upcoming reminders.</p>
        )}
      </section>

      {nextActions.length > 0 && (
        <section className="relative mt-4">
          <h3 className="mb-1.5 text-caption font-bold uppercase tracking-widest text-dim">Next actions</h3>
          <div className="space-y-1">
            {nextActions.map(({ action, game }) => (
              <div
                key={`${game.id}-${action.kind}-${action.at}-${action.label}`}
                className="flex items-center gap-2 rounded-ui-lg bg-white/[0.025] px-2.5 py-2"
              >
                <GameBadge short={game.short} color={game.color} color2={game.color2} size="sm" />
                <span className="min-w-0 flex-1 truncate text-xs text-fg-soft">{action.label}</span>
                <span className="shrink-0 text-caption font-bold tabular-nums text-muted">
                  {action.at <= now ? 'NOW' : fmtDur(action.at - now)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {eventRows === 0 && reminders.length === 0 && nextActions.length === 0 && (
        <div className="relative mt-4 rounded-ui-xl bg-ok/[0.06] px-3 py-4 text-center ring-1 ring-ok/15">
          <p className="text-body font-bold text-emerald-200">Horizon clear</p>
          <p className="mt-1 text-label text-muted">No deadlines need attention in the next 28 days.</p>
        </div>
      )}

      <button
        type="button"
        onClick={onOpenTimeline}
        className="relative mt-4 min-h-10 w-full rounded-ui-lg bg-gradient-to-r from-gold/20 to-amber-200/10 px-3 py-2 text-xs font-bold text-amber-100 ring-1 ring-gold/35 transition hover:brightness-125"
      >
        Open full timeline →
      </button>
    </aside>
  );
}

type SharedLayoutProps = {
  state: AppState;
  entries: GameUrgency[];
  displayIds: string[];
  now: number;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
  onOpenReminder: () => void;
  onOpenTimeline: () => void;
};

export function CardsAgendaLayout({
  state,
  entries,
  displayIds,
  now,
  onOpenEvent,
  onToggleEvent,
  onOpenReminder,
  onOpenTimeline,
}: SharedLayoutProps) {
  const entryById = new Map(entries.map((entry) => [entry.game.id, entry]));
  const cards = displayIds.filter((id) => entryById.has(id));
  // Three columns so column 2 is a real middle; the horizon takes the centre
  // cell of the middle row and the game cards flow around it.
  const rows = Math.ceil((cards.length + 1) / 3);
  const horizonRow = Math.max(1, Math.ceil(rows / 2));

  return (
    <div
      className="cards-grid grid grid-cols-3 items-start gap-4"
      style={{ '--horizon-row': horizonRow } as CSSProperties}
    >
      {cards.map((id) => (
        <GameCard key={id} entry={entryById.get(id)!} now={now} />
      ))}
      <EventHorizonCard
        state={state}
        entries={entries}
        now={now}
        onOpenEvent={onOpenEvent}
        onToggleEvent={onToggleEvent}
        onOpenReminder={onOpenReminder}
        onOpenTimeline={onOpenTimeline}
      />
    </div>
  );
}
