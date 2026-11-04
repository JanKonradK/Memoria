import type { GameEvent, GameUrgency } from '@memoria/shared';

/**
 * What happens across every game in the next day, soonest first: energy that
 * is full or will cap, routines about to reset with work left, and events that
 * end or begin. Built from the urgency actions the shared layer already
 * computed, so the times always agree with the rows above it.
 */
export type TodayAgendaItem =
  | { kind: 'energy'; key: string; at: number; gameIds: string[]; label: string; full: boolean; count: number }
  | { kind: 'reset'; key: string; at: number; gameIds: string[]; cadence: string; left: number }
  | { kind: 'event'; key: string; at: number; gameIds: string[]; event: GameEvent; edge: 'ends' | 'starts' };

export const TODAY_AGENDA_HOURS = 24;

const CADENCE_ORDER = ['daily', 'weekly', 'monthly', 'custom'];

export function selectTodayAgenda(order: GameUrgency[], events: GameEvent[], now: number): TodayAgendaItem[] {
  const until = now + TODAY_AGENDA_HOURS * 3_600_000;
  const items: TodayAgendaItem[] = [];
  const active = new Set<string>();
  // Routines that reset at the same moment read as one line, whichever games they belong to.
  const resets = new Map<string, Extract<TodayAgendaItem, { kind: 'reset' }>>();
  // Energy that is already full is one line: the rows above already name each bar.
  const full: Extract<TodayAgendaItem, { kind: 'energy' }> = {
    kind: 'energy',
    key: 'energy:full',
    at: now,
    gameIds: [],
    label: '',
    full: true,
    count: 0,
  };

  for (const { game, actions } of order) {
    if (game.paused) continue;
    active.add(game.id);
    for (const action of actions) {
      if (action.at > until) break;
      if (action.kind === 'energy_full') {
        if (!full.gameIds.includes(game.id)) full.gameIds.push(game.id);
        full.count += 1;
        full.label =
          full.count === 1 ? action.label.replace(/ is FULL$/, ' is full') : `${full.count} energy bars full`;
      } else if (action.kind === 'energy_soon') {
        items.push({
          kind: 'energy',
          key: `energy:${game.id}:${action.label}`,
          at: action.at,
          gameIds: [game.id],
          label: action.label,
          full: false,
          count: 1,
        });
      } else if (action.kind !== 'event') {
        const key = `reset:${action.kind}:${action.at}`;
        const row = resets.get(key) ?? {
          kind: 'reset',
          key,
          at: action.at,
          gameIds: [],
          cadence: action.kind,
          left: 0,
        };
        if (!row.gameIds.includes(game.id)) row.gameIds.push(game.id);
        row.left += 1;
        resets.set(key, row);
      }
    }
  }
  items.push(...resets.values());
  if (full.count > 0) items.push(full);

  for (const event of events) {
    if (event.deleted || event.done || !active.has(event.gameId)) continue;
    if (event.start <= now && event.end > now && event.end <= until) {
      items.push({
        kind: 'event',
        key: `end:${event.id}`,
        at: event.end,
        gameIds: [event.gameId],
        event,
        edge: 'ends',
      });
    } else if (event.start > now && event.start <= until) {
      items.push({
        kind: 'event',
        key: `start:${event.id}`,
        at: event.start,
        gameIds: [event.gameId],
        event,
        edge: 'starts',
      });
    }
  }

  const rank = (item: TodayAgendaItem) =>
    item.kind === 'energy' ? 0 : item.kind === 'reset' ? 1 + CADENCE_ORDER.indexOf(item.cadence) : 9;
  return items.sort((a, b) => a.at - b.at || rank(a) - rank(b) || a.key.localeCompare(b.key));
}
