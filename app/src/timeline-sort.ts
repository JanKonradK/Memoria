import type { Game, GameEvent } from '@void/shared';

const DAY = 86_400_000;

export const NEW_ARRIVAL_DAYS = 2;
export const ENDING_SOON_DAYS = 9;
export const DASHBOARD_UPCOMING_LIMIT = 3;

/** Playable events first, followed by cycles, banners, then maintenance. */
export const TYPE_RANK = { event: 0, custom: 0, cycle: 1, banner: 2, maintenance: 3 } as const;

export function agendaRank(event: GameEvent, now: number): 0 | 1 | 2 | 3 {
  if (event.done) return 3;
  if (event.start <= now && now < event.end) return 0;
  if (event.start > now) return 1;
  return 2;
}

export function agendaCompare(a: GameEvent, b: GameEvent, now: number): number {
  const aRank = agendaRank(a, now);
  const bRank = agendaRank(b, now);
  if (aRank !== bRank) return aRank - bRank;

  // Final id tiebreak keeps the order a total order, so synced devices agree
  // even when events tie on every displayed field.
  if (aRank === 0) {
    return (
      a.end - b.end || TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    );
  }
  if (aRank === 1) {
    return a.start - b.start || a.end - b.end || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  }
  return b.end - a.end || a.id.localeCompare(b.id);
}

export type AgendaRow =
  | { kind: 'event'; event: GameEvent }
  | { kind: 'group'; gameId: string; label: string; at: number; count: number; events: GameEvent[] };

export interface DashboardAgendaSections {
  newArrivals: GameEvent[];
  upcoming: GameEvent[];
  endingSoon: GameEvent[];
}

/**
 * The three dashboard sections partition the events between them — nothing
 * appears twice.
 *
 * New arrivals wins the overlap. A short event (a 7-day banner, say) is both
 * "just dropped" and "ends within 9 days" from the moment it lands, and showing
 * it in both places reads as a duplicate rather than as two signals. For its
 * first two days the useful thing to say is that it is NEW; after that the
 * useful thing is that the clock is running, and it moves to Ending soon on its
 * own as the arrival window passes it by.
 *
 * Permanent rotations (cycles) belong only on the full timeline: the end of one
 * cycle is the start of the next, so they are never new and never ending.
 */
export function selectDashboardAgendaSections(events: GameEvent[], now: number): DashboardAgendaSections {
  const eligible = events.filter((event) => !event.deleted && !event.done && event.type !== 'cycle');
  const active = eligible.filter((event) => event.start <= now && event.end > now);

  const newArrivals = active
    .filter((event) => event.start >= now - NEW_ARRIVAL_DAYS * DAY)
    .sort(
      (a, b) =>
        Number(b.type === 'banner') - Number(a.type === 'banner') ||
        b.start - a.start ||
        a.end - b.end ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  const upcoming = eligible
    .filter((event) => event.start > now)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, DASHBOARD_UPCOMING_LIMIT);
  const arrived = new Set(newArrivals.map((event) => event.id));
  const endingSoon = active
    .filter((event) => !arrived.has(event.id) && event.end <= now + ENDING_SOON_DAYS * DAY)
    .sort((a, b) => a.end - b.end || b.start - a.start || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  return { newArrivals, upcoming, endingSoon };
}

/** Patch launches read as one milestone instead of a burst of simultaneous rows. */
export function groupVersionUpdates(events: GameEvent[], games: Map<string, Game>, now: number): AgendaRow[] {
  const sixHours = 6 * 60 * 60 * 1_000;
  const consumed = new Set<GameEvent>();
  const groups = new Map<number, AgendaRow>();

  for (const maintenance of events) {
    if (maintenance.type !== 'maintenance' || agendaRank(maintenance, now) !== 1) continue;

    const absorbed = events.filter(
      (event) =>
        event.type !== 'maintenance' &&
        event.gameId === maintenance.gameId &&
        !consumed.has(event) &&
        event.start >= maintenance.start &&
        event.start <= maintenance.end + sixHours,
    );
    if (absorbed.length < 2) continue;

    const groupedEvents = [maintenance, ...absorbed].sort((a, b) => a.start - b.start);
    const firstIndex = Math.min(...groupedEvents.map((event) => events.indexOf(event)));
    const version = maintenance.name.match(/v?(\d+\.\d+)/i)?.[1];
    const game = games.get(maintenance.gameId)!;

    consumed.add(maintenance);
    absorbed.forEach((event) => consumed.add(event));
    groups.set(firstIndex, {
      kind: 'group',
      gameId: maintenance.gameId,
      label: version ? `${game.short} ${version} Update` : `${game.short} update`,
      at: maintenance.end,
      count: absorbed.length,
      events: groupedEvents,
    });
  }

  return events.flatMap((event, index) => {
    const group = groups.get(index);
    if (group) return [group];
    return consumed.has(event) ? [] : [{ kind: 'event' as const, event }];
  });
}

/** A shared row budget keeps the dashboard useful without hiding the next milestones. */
export function budgetAgenda(
  live: AgendaRow[],
  upcoming: AgendaRow[],
  max = 9,
): { live: AgendaRow[]; upcoming: AgendaRow[] } {
  const limit = Math.max(0, max);
  const upcomingReserve = Math.min(3, upcoming.length, limit);
  const budgetedLive = live.slice(0, limit - upcomingReserve);
  const budgetedUpcoming = upcoming.slice(0, limit - budgetedLive.length);

  return { live: budgetedLive, upcoming: budgetedUpcoming };
}
