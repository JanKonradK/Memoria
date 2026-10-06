import type { Game, GameLayoutItem, Resource, Task } from './types';
import { effectiveResourceKind } from './tracking';

const cadenceOrder = { daily: 0, custom: 1, weekly: 2, monthly: 3 } as const;

/** Resolve only against this game's live entities, never its currently active checklist. */
export function resolveGameLayout(game: Game, resources: Resource[], tasks: Task[]): GameLayoutItem[] {
  const defaults: GameLayoutItem[] = [
    ...resources
      .filter((item) => item.gameId === game.id && !item.deleted)
      .sort((a, b) => a.sort - b.sort)
      .map((item): GameLayoutItem => ({
        id: `resource:${item.id}`,
        hidden: effectiveResourceKind(item) === 'counter',
      })),
    { id: 'quick-spend' },
    ...tasks
      .filter((item) => item.gameId === game.id && !item.deleted)
      .sort(
        (a, b) =>
          cadenceOrder[a.cadence] - cadenceOrder[b.cadence] ||
          Number(b.core === true) - Number(a.core === true) ||
          a.sort - b.sort ||
          a.name.localeCompare(b.name),
      )
      .map((item): GameLayoutItem => ({ id: `task:${item.id}` })),
    { id: 'events' },
  ];
  const available = new Set(defaults.map((item) => item.id));
  const seen = new Set<string>();
  const saved = (game.cardLayout ?? []).filter((item) => {
    if (!available.has(item.id) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  // Drop legacy sizing while retaining saved order and visibility.
  return [
    ...saved.map(({ id, hidden }) => ({ id, ...(hidden === undefined ? {} : { hidden }) })),
    ...defaults.filter((item) => !seen.has(item.id)),
  ];
}

export function moveLayoutItem(items: GameLayoutItem[], id: string, to: number): GameLayoutItem[] {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0 || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!);
  return next;
}
