import { DateTime } from 'luxon';
import type { AppState, GameEvent, GameUrgency } from '@void/shared';
import { m } from 'motion/react';
import { useDerived } from '../selectors';
import { fmtDur } from '../util';
import { cardEnter } from '../motion';
import { GameCard } from './GameCard';
import { AgendaList } from './TimelineAgenda';
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
  const agenda = useDerived(now).agenda('dashboard');
  const eventRows = agenda.live.length + agenda.upcoming.length + agenda.endingSoon.length;
  const reminders = state.reminders
    .filter((reminder) => !reminder.deleted && reminder.at > now - 86_400_000)
    .sort((a, b) => a.at - b.at)
    .slice(0, 3);
  const gameById = agenda.games;
  // The horizon scrolls and sticks now, so next actions no longer have to give
  // their room back to the event rails — they just tail the list.
  const actionLimit = 4;
  const nextActions = entries
    .flatMap((entry) => entry.actions.map((action) => ({ action, game: entry.game })))
    .filter(({ action }) => action.kind !== 'event' && action.at >= now)
    .sort((a, b) => a.action.at - b.action.at)
    .slice(0, actionLimit);

  return (
    <m.aside
      // Sticky: the outer columns of game cards are usually taller than this, so
      // the cross-game view stays on screen while you scroll them.
      className="scrollbar-thin sticky top-4 flex h-full max-h-[calc(100dvh-8rem)] flex-col overflow-y-auto rounded-ui-card p-4"
      variants={cardEnter}
      initial="hidden"
      animate="visible"
      aria-label="Event horizon"
      style={{
        background:
          'linear-gradient(155deg, rgba(232,180,90,0.2), transparent 46%), linear-gradient(335deg, rgba(255,111,165,0.09), transparent 42%), #0a0805',
        boxShadow:
          'inset 0 0 0 1.5px color-mix(in oklab, var(--gold) 70%, transparent), inset 0 1px 0 var(--color-line-hairline)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-4 top-0 h-[3px] rounded-ui-full"
        style={{
          background:
            'linear-gradient(90deg, transparent, color-mix(in oklab, var(--gold) 90%, transparent), var(--color-gold-hi), transparent)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(460px 150px at 50% 0%, rgba(232,180,90,0.34), transparent 70%)',
          animation: 'pulseFade 4.2s ease-in-out infinite',
        }}
      />
      <div className="relative mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-caption font-bold uppercase tracking-[0.2em] text-gold">Event horizon</p>
          {/* No text glow. Emphasis here comes from weight and the gold eyebrow
              above it; a halo behind a heading is decoration, and it was the
              last one left in the app. */}
          <h2 className="text-title font-black text-fg">Across every game</h2>
        </div>
        <span className="rounded-ui-full bg-gold/20 px-2 py-1 text-caption font-black tabular-nums text-warn-fg ring-1 ring-gold/50">
          {eventRows}
        </span>
      </div>

      <div className="relative">
        <AgendaList
          data={agenda}
          now={now}
          mode="dashboard"
          onOpenEvent={onOpenEvent}
          onToggleEvent={onToggleEvent}
          onOpenTimeline={onOpenTimeline}
        />
      </div>

      <section className="relative mt-4">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h3 className="text-caption font-bold uppercase tracking-widest text-dim">Reminders</h3>
          <button
            type="button"
            onClick={onOpenReminder}
            className="rounded-ui-md px-2 py-1 text-caption font-semibold text-muted transition hover:bg-fill-2 hover:text-white"
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
                <div key={reminder.id} className="flex items-start gap-2 rounded-ui-lg bg-fill-1 px-2.5 py-2">
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
                    <p className="truncate text-meta font-medium text-fg-soft">{reminder.message}</p>
                    <p className={`mt-0.5 text-caption tabular-nums ${due ? 'text-danger-fg' : 'text-dim'}`}>
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
          <p className="rounded-ui-lg bg-fill-1 px-3 py-2 text-label text-faint">No upcoming reminders.</p>
        )}
      </section>

      {nextActions.length > 0 && (
        <section className="relative mt-4">
          <h3 className="mb-1.5 text-caption font-bold uppercase tracking-widest text-dim">Next actions</h3>
          <div className="space-y-1">
            {nextActions.map(({ action, game }) => (
              <div
                key={`${game.id}-${action.kind}-${action.at}-${action.label}`}
                className="flex items-center gap-2 rounded-ui-lg bg-fill-1 px-2.5 py-2"
              >
                <GameBadge short={game.short} color={game.color} color2={game.color2} size="sm" />
                <span className="min-w-0 flex-1 truncate text-meta text-fg-soft">{action.label}</span>
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
          <p className="text-body font-bold text-ok-fg">Horizon clear</p>
          <p className="mt-1 text-label text-muted">No deadlines need attention in the next 28 days.</p>
        </div>
      )}

      <button
        type="button"
        onClick={onOpenTimeline}
        className="relative mt-4 min-h-10 w-full rounded-ui-lg bg-gradient-to-r from-gold/20 to-gold-hi/10 px-3 py-2 text-meta font-bold text-warn-fg ring-1 ring-gold/35 transition hover:brightness-125"
      >
        Open full timeline →
      </button>
    </m.aside>
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
  // INDEPENDENT columns, not a grid of rows. In a grid every card in a row is as
  // tall as the tallest thing in it — which was the horizon — so short cards were
  // stretched with hundreds of pixels of nothing inside them while the row below
  // fell off the screen. Here each card is its own height.
  //
  // The lead gets a quiet column of its own. Dealing the rest across the paired
  // columns preserves urgency across each visual row without padding either stack.
  const pairedColumns: string[][] = [[], []];
  cards.slice(1).forEach((id, index) => pairedColumns[index % pairedColumns.length].push(id));
  const columns = [cards.length > 0 ? [cards[0]] : [], ...pairedColumns];

  return (
    <div
      className="grid items-stretch gap-4"
      style={{
        gridTemplateColumns:
          '[lead] minmax(0, 1fr) [paired-one] minmax(0, 1fr) [paired-two] minmax(0, 1fr) [horizon] minmax(0, 1.2fr) [end]',
      }}
    >
      {columns.map((ids, index) => (
        <div key={index} className="flex min-w-0 flex-col gap-4">
          {ids.map((id) => (
            <GameCard key={id} entry={entryById.get(id)!} now={now} />
          ))}
        </div>
      ))}
      {/* Size containment keeps dense horizon rows from making the board taller
          than its games; the stretched cell still gives the scroller a real cap. */}
      <div className="min-h-0 min-w-0 contain-size">
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
    </div>
  );
}
