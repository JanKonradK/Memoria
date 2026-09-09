import { DateTime } from 'luxon';
import type { AppState, Game, GameEvent, GameUrgency } from '@memoria/shared';
import { gameIdentityKey, type GameColors } from '../../game-color';
import { ENDING_SOON_DAYS, type AgendaRow } from '../../timeline-sort';
import { useDerived } from '../../selectors';
import { fmtDur } from '../../util';
import { serverRegionLabel } from '../NexusLayout';
import { ProgressBar } from '../primitives';
import { useIdentityColors } from '../roster';
import { GameBadge, ServerChip } from '../ui';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

type Ticket = {
  key: string;
  gameId: string;
  name: string;
  /** The moment this ticket counts down to. */
  at: number;
  event?: GameEvent;
};

export interface TicketDisambiguation {
  serverLabel: string;
  accountTag?: string;
  accountDescription?: string;
}

/**
 * Adds only the account detail that the visible ticket set needs.
 *
 * The roster is deliberately not an input to the conflict rule. A second
 * account with no ticket cannot make the Tonight rail noisier. Repeated tickets
 * for one account are collapsed by id for the same reason.
 */
export function decideTicketDisambiguation(
  ticketGameIds: readonly string[],
  games: ReadonlyMap<string, Game>,
  now: number,
): Map<string, TicketDisambiguation> {
  const visibleGames = [...new Set(ticketGameIds)].flatMap((gameId) => {
    const game = games.get(gameId);
    return game ? [game] : [];
  });
  const identityGroups = new Map<string, Game[]>();

  for (const game of visibleGames) {
    const identity = gameIdentityKey(game);
    const group = identityGroups.get(identity) ?? [];
    group.push(game);
    identityGroups.set(identity, group);
  }

  const result = new Map<string, TicketDisambiguation>();
  for (const identityGroup of identityGroups.values()) {
    if (identityGroup.length < 2) continue;

    const serverGroups = new Map<string, Game[]>();
    for (const game of identityGroup) {
      const serverLabel = serverRegionLabel(game.tz, now);
      const group = serverGroups.get(serverLabel) ?? [];
      group.push(game);
      serverGroups.set(serverLabel, group);
    }

    for (const [serverLabel, serverGroup] of serverGroups) {
      const ordered = [...serverGroup].sort((a, b) => a.id.localeCompare(b.id));
      const unlabelled = ordered.filter((game) => !game.accountLabel?.trim());
      const tagBases = ordered.map((game) => {
        const label = game.accountLabel?.trim();
        if (label) return Array.from(label).slice(0, 3).join('');
        return `#${unlabelled.findIndex((candidate) => candidate.id === game.id) + 1}`;
      });
      const baseCounts = new Map<string, number>();
      tagBases.forEach((tag) => baseCounts.set(tag, (baseCounts.get(tag) ?? 0) + 1));
      const baseIndexes = new Map<string, number>();

      ordered.forEach((game, index) => {
        const decision: TicketDisambiguation = { serverLabel };
        if (ordered.length > 1) {
          const base = tagBases[index]!;
          const duplicateIndex = (baseIndexes.get(base) ?? 0) + 1;
          baseIndexes.set(base, duplicateIndex);
          decision.accountTag = (baseCounts.get(base) ?? 0) > 1 ? `${base}·${duplicateIndex}` : base;

          const label = game.accountLabel?.trim();
          decision.accountDescription = label
            ? `${label} account${(baseCounts.get(base) ?? 0) > 1 ? ` ${duplicateIndex}` : ''}`
            : `unlabelled account ${unlabelled.findIndex((candidate) => candidate.id === game.id) + 1}`;
        }
        result.set(game.id, decision);
      });
    }
  }

  return result;
}

function ticketsFrom(rows: AgendaRow[], useStart: boolean): Ticket[] {
  return rows.map((row) =>
    row.kind === 'event'
      ? {
          key: row.event.id,
          gameId: row.event.gameId,
          name: row.event.name,
          at: useStart ? row.event.start : row.event.end,
          event: row.event,
        }
      : { key: `${row.gameId}-${row.at}`, gameId: row.gameId, name: row.label, at: row.at },
  );
}

/**
 * One band of the attention rail.
 *
 * The complete band stack shares one scroll area. The three collapsible sections
 * this replaced were each `fill`, so on a quiet evening the hub spent six hundred
 * vertical pixels saying "Nothing" three times — the panel was mostly an empty
 * state with headings on it.
 */
function Band({
  title,
  tone,
  subtitle,
  tickets,
  games,
  disambiguation,
  identityColors,
  now,
  countdownFrom,
  onOpenEvent,
}: {
  title: string;
  tone: string;
  subtitle?: string;
  tickets: Ticket[];
  games: Map<string, Game>;
  disambiguation: ReadonlyMap<string, TicketDisambiguation>;
  identityColors: Readonly<Record<string, GameColors>>;
  now: number;
  countdownFrom: 'start' | 'end';
  onOpenEvent: (event: GameEvent) => void;
}) {
  return (
    <section className="flex shrink-0 flex-col gap-1.5" aria-label={title}>
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-px w-2.5 shrink-0" style={{ background: tone }} />
        <span className="text-caption uppercase tracking-[0.09em]" style={{ color: tone }}>
          {title}
        </span>
        <span className="numeral text-caption text-muted">{tickets.length}</span>
        {subtitle && <span className="ml-auto text-caption text-muted">{subtitle}</span>}
      </div>

      {tickets.length === 0 ? (
        <p className="px-1 text-caption text-muted">—</p>
      ) : (
        <div className="flex flex-col gap-px">
          {tickets.map((ticket) => {
            const game = games.get(ticket.gameId);
            const colors = game ? (identityColors[game.id] ?? game) : undefined;
            const left = ticket.at - now;
            const countdown = left <= 0 ? 'now' : fmtDur(left);
            const distinction = disambiguation.get(ticket.gameId);
            const accessibleName =
              game && distinction
                ? `${game.name}, ${distinction.serverLabel} server${
                    distinction.accountDescription ? `, ${distinction.accountDescription}` : ''
                  }: ${ticket.name}${ticket.event?.type === 'banner' ? ', Banner' : ''}, ${countdown}`
                : undefined;
            return (
              <button
                key={ticket.key}
                type="button"
                disabled={!ticket.event}
                onClick={() => ticket.event && onOpenEvent(ticket.event)}
                aria-label={accessibleName}
                className="flex min-h-8 items-center gap-2 rounded-ui-sm px-1 py-1 text-left transition-colors enabled:hover:bg-fill-2 disabled:cursor-default"
              >
                {game && (
                  <span className="flex shrink-0 items-center gap-1">
                    <GameBadge short={game.short} {...colors!} size="sm" />
                    {distinction && (
                      <>
                        <ServerChip aria-hidden label={distinction.serverLabel} size="sm" />
                        {distinction.accountTag && (
                          <span
                            aria-hidden
                            className="rounded-ui-sm border border-line-edge bg-inset px-1 py-px text-caption font-semibold text-dim"
                          >
                            {distinction.accountTag}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                )}
                {ticket.event?.type === 'banner' && (
                  <span className="shrink-0 rounded-ui-sm bg-fill-2 px-1 py-px text-caption font-semibold text-muted">
                    Banner
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-body text-fg-soft">{ticket.name}</span>
                <span
                  className="numeral shrink-0 text-meta"
                  style={{ color: countdownFrom === 'end' && left < DAY ? 'var(--color-danger)' : undefined }}
                >
                  {countdown}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * The stage's centre column: what needs attention tonight, across every game.
 *
 * It is an attention RAIL, not a stack of panels. Three bands in a fixed order —
 * what is closing, what just landed, what is coming — over one status line.
 * Everything below that line is a ticket of the same shape, so the eye runs down
 * a single column instead of re-learning a layout per section.
 */
export function NexusHub({
  state,
  entries,
  now,
  onOpenEvent,
  onOpenTimeline,
}: {
  state: AppState;
  entries: GameUrgency[];
  now: number;
  onOpenEvent: (event: GameEvent) => void;
  onOpenTimeline: () => void;
}) {
  const derived = useDerived(now);
  const horizon = now + WEEK;
  const agenda = derived.agenda('dashboard');

  const checklistEntries = entries.map((entry) => ({
    entry,
    items: derived.checklistByGame.get(entry.game.id) ?? [],
  }));
  const dailyItems = checklistEntries.flatMap(({ items }) => items.filter((item) => item.cadence === 'daily'));
  const dailiesDone = dailyItems.filter((item) => item.done).length;
  const capsDuringSleep = entries.filter((entry) => !entry.game.paused && derived.sleepFor(entry.game.id).caps);

  // Reminders are attention too, and they were buried in a third disclosure that
  // was collapsed by default — so a due reminder said nothing until you opened it.
  // A reminder inside the day joins Closing; anything further out is Arriving.
  const dueReminders: Ticket[] = [];
  const laterReminders: Ticket[] = [];
  for (const reminder of state.reminders) {
    if (reminder.deleted || !(reminder.at > now - DAY && reminder.at <= horizon)) continue;
    const ticket: Ticket = {
      key: reminder.id,
      gameId: reminder.gameId ?? '',
      name: reminder.message,
      at: reminder.at,
    };
    (reminder.at - now < DAY ? dueReminders : laterReminders).push(ticket);
  }

  const closing = [...ticketsFrom(agenda.endingSoon, false), ...dueReminders].sort((a, b) => a.at - b.at);
  const arrived = ticketsFrom(agenda.live, false);
  const arriving = [...ticketsFrom(agenda.upcoming, true), ...laterReminders].sort((a, b) => a.at - b.at);
  const ticketDisambiguation = decideTicketDisambiguation(
    [...closing, ...arrived, ...arriving].map((ticket) => ticket.gameId),
    agenda.games,
    now,
  );
  const identityColors = useIdentityColors(state.games);

  const dailiesComplete = dailyItems.length > 0 && dailiesDone === dailyItems.length;
  const sleepSafe = capsDuringSleep.length === 0;
  // Everything the three bands share; only the title, tone, tickets and which
  // end of the window they count to differ.
  const bandContext = {
    games: agenda.games,
    disambiguation: ticketDisambiguation,
    identityColors,
    now,
    onOpenEvent,
  };

  return (
    <section
      className="nexus-hub card-shell relative z-10 flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden rounded-ui-card p-3"
      aria-label="Across every game"
    >
      {/* This column is the answer to "what do I do now", so it gets to be the
          loudest thing on the stage. It was set at the same size as a card
          heading, which made the most important panel read as one of five. */}
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-display font-semibold text-fg">Tonight</h2>
        <span className="numeral text-meta text-muted">
          {DateTime.fromMillis(now, { zone: state.settings.localTz }).toFormat('ccc dd LLL')}
        </span>
      </header>

      {/* One status line, not two bordered boxes. Both facts are yes/no, and a
          yes/no deserves a sentence and a colour rather than a card. */}
      <div className="flex flex-col gap-2 border-y border-line-hairline py-2.5">
        <div className="flex items-center gap-2.5">
          <ProgressBar
            variant="ring"
            value={dailyItems.length > 0 ? dailiesDone / dailyItems.length : 0}
            color={dailiesComplete ? 'var(--color-ok)' : 'var(--color-fg)'}
            size={26}
            stroke={2.5}
          />
          <span className="min-w-0 flex-1 text-body text-fg-soft">
            <span className="numeral text-fg">
              {dailiesDone}/{dailyItems.length}
            </span>{' '}
            dailies done
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={`ml-[0.6875rem] h-1.5 w-1.5 shrink-0 rounded-ui-full ${sleepSafe ? 'bg-ok' : 'warn-pulse bg-danger'}`}
          />
          <span className={`min-w-0 flex-1 text-body ${sleepSafe ? 'text-fg-soft' : 'text-danger'}`}>
            {sleepSafe ? (
              <>
                Sleep safe for <span className="numeral">{state.settings.sleepHours}h</span>
              </>
            ) : (
              <>
                <span className="numeral">{capsDuringSleep.length}</span>{' '}
                {capsDuringSleep.length === 1 ? 'game caps' : 'games cap'} overnight —{' '}
                {capsDuringSleep.map((entry) => entry.game.short).join(' · ')}
              </>
            )}
          </span>
        </div>
      </div>

      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {closing.length + arrived.length + arriving.length === 0 ? (
          <p className="pt-6 text-body text-muted">
            Nothing closes in the next 10 days or arrives in the next two weeks.
          </p>
        ) : (
          <>
            <Band
              title="Closing"
              subtitle={`Next ${ENDING_SOON_DAYS} days`}
              tone="var(--color-danger)"
              tickets={closing}
              countdownFrom="end"
              {...bandContext}
            />
            <Band title="Just arrived" tone="var(--color-ok)" tickets={arrived} countdownFrom="end" {...bandContext} />
            <Band
              title="Arriving"
              tone="var(--color-later)"
              tickets={arriving}
              countdownFrom="start"
              {...bandContext}
            />
          </>
        )}
      </div>

      {/* Adding a reminder used to sit here as well. It is one of three things
          you can add, and it now lives with the other two under the app bar's
          "+", so this footer is only the way out of the panel. */}
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onOpenTimeline}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-ui-md border border-line bg-inset px-3 py-1.5 text-meta text-fg-soft transition-colors hover:border-line-strong hover:text-fg sm:min-h-8"
        >
          Full timeline
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className="icon h-3 w-3" aria-hidden>
            <path d="M4 10h11m-4-4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </section>
  );
}
