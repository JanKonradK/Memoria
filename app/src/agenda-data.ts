import type { AppState, Game, GameEvent } from '@memoria/shared';
import {
  agendaCompare,
  agendaRank,
  groupVersionUpdates,
  selectDashboardAgendaSections,
  type AgendaRow,
} from './timeline-sort';

/**
 * What the agenda is, independent of anything that draws it.
 *
 * This lived in TimelineAgenda.tsx alongside the components that rendered it.
 * Those components are gone — the timeline is lanes only now — but the selector
 * is still the source for the dashboard's Tonight panel, so it moves here as a
 * pure module rather than dying with its former UI.
 */

const DAY = 86_400_000;

export type AgendaMode = 'full' | 'dashboard';

export interface AgendaData {
  games: Map<string, Game>;
  live: AgendaRow[];
  upcoming: AgendaRow[];
  endingSoon: AgendaRow[];
  past: GameEvent[];
}

/**
 * Upcoming keeps a fortnight of candidates before its hard cap is applied.
 * Fresh and ending events use their own windows in the pure dashboard selector.
 */
export const DASHBOARD_AGENDA_DAYS = 14;

/**
 * Full mode's window. This used to read the timeline's selectable range; the
 * range control is gone and the ruler is fixed at 40 days, so the value is
 * inlined here and must stay in step with RANGE_DAYS in Timeline.tsx.
 */
const FULL_AGENDA_DAYS = 40;

export function selectAgendaData(state: AppState, now: number, mode: AgendaMode = 'full'): AgendaData {
  const windowStart = mode === 'dashboard' ? now : now - 2 * DAY;
  const windowEnd = mode === 'dashboard' ? now + DASHBOARD_AGENDA_DAYS * DAY : windowStart + FULL_AGENDA_DAYS * DAY;
  const games = new Map(state.games.filter((game) => !game.deleted).map((game) => [game.id, game]));
  const availableEvents = state.events.filter((event) => !event.deleted && games.has(event.gameId));

  if (mode === 'dashboard') {
    const sections = selectDashboardAgendaSections(
      availableEvents.filter((event) => event.start < windowEnd),
      now,
    );
    return {
      games,
      live: sections.newArrivals.map((event) => ({ kind: 'event', event })),
      upcoming: groupVersionUpdates(sections.upcoming, games, now),
      endingSoon: sections.endingSoon.map((event) => ({ kind: 'event', event })),
      past: [],
    };
  }

  const events = availableEvents
    .filter((event) => event.end > windowStart && event.start < windowEnd)
    .sort((a, b) => agendaCompare(a, b, now));
  const live = events.filter((event) => agendaRank(event, now) === 0);
  const upcoming = events.filter((event) => agendaRank(event, now) === 1);

  return {
    games,
    live: live.map((event) => ({ kind: 'event', event })),
    upcoming: upcoming.map((event) => ({ kind: 'event', event })),
    endingSoon: [],
    past: events.filter((event) => agendaRank(event, now) >= 2),
  };
}
