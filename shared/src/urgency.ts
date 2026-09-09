import type { AppState, Game, GameEvent, Resource, Snapshot } from './types';
import { latestSnapshots, projectEnergy } from './energy';
import { buildChecklistIndex, checklistFor, type ChecklistItem } from './checklist';
import { groupBy } from './internal';
import { effectiveResourceKind } from './tracking';

export type ActionKind = 'energy_full' | 'energy_soon' | 'daily' | 'weekly' | 'monthly' | 'custom' | 'event';

export interface NextAction {
  kind: ActionKind;
  gameId: string;
  /** Deadline, epoch ms. For an already-capped resource this is `now` (max urgency). */
  at: number;
  label: string;
}

export interface UrgencyContext {
  snaps: Map<string, Snapshot>;
  checklistByGame: Map<string, ChecklistItem[]>;
  /** Every resource row, live or not — `gameActions` still applies its own filters. */
  resourcesByGame: Map<string, Resource[]>;
  eventsByGame: Map<string, GameEvent[]>;
}

export function buildUrgencyContext(state: AppState, now: number, requestedGame?: Game): UrgencyContext {
  const checklistIndex = buildChecklistIndex(state);
  const checklistByGame = new Map<string, ChecklistItem[]>();
  for (const game of state.games) {
    if (!game.deleted) checklistByGame.set(game.id, checklistFor(state, game, now, checklistIndex));
  }
  if (requestedGame && !checklistByGame.has(requestedGame.id)) {
    checklistByGame.set(requestedGame.id, checklistFor(state, requestedGame, now, checklistIndex));
  }

  // Keep the same rows as the old gameActions scans. In particular, they checked
  // deleted/notify/kind themselves but did not exclude done events.
  return {
    snaps: latestSnapshots(state.snapshots),
    checklistByGame,
    resourcesByGame: groupBy(state.resources, (resource) => resource.gameId),
    eventsByGame: groupBy(state.events, (event) => event.gameId),
  };
}

/** All time-sensitive actions for one game, soonest first. */
export function gameActions(state: AppState, game: Game, now: number, ctx?: UrgencyContext): NextAction[] {
  const actions: NextAction[] = [];
  const context = ctx ?? buildUrgencyContext(state, now, game);

  for (const res of context.resourcesByGame.get(game.id) ?? []) {
    if (res.deleted || effectiveResourceKind(res) !== 'regen') continue;
    const proj = projectEnergy(res, context.snaps.get(res.id), now, game);
    if (!proj.hasSnapshot) continue;
    if (proj.isFull) {
      actions.push({ kind: 'energy_full', gameId: game.id, at: now, label: `${res.name} is FULL` });
    } else if (proj.fullAt != null) {
      actions.push({ kind: 'energy_soon', gameId: game.id, at: proj.fullAt, label: `${res.name} caps` });
    }
  }

  for (const item of context.checklistByGame.get(game.id) ?? []) {
    if (item.done) continue;
    // Every Cadence is also an ActionKind; the compiler holds that true.
    actions.push({ kind: item.cadence, gameId: game.id, at: item.resetAt, label: `${item.name} resets` });
  }

  for (const ev of context.eventsByGame.get(game.id) ?? []) {
    if (ev.deleted || !ev.notify) continue;
    if (ev.end > now && ev.start <= now) {
      actions.push({ kind: 'event', gameId: game.id, at: ev.end, label: `${ev.name} ends` });
    }
  }

  return actions.sort((a, b) => a.at - b.at);
}

export interface GameUrgency {
  game: Game;
  next: NextAction | null;
  actions: NextAction[];
}

/** Active games sorted by urgency (soonest deadline first, paused last). */
export function urgencyOrder(state: AppState, now: number, ctx?: UrgencyContext): GameUrgency[] {
  const context = ctx ?? buildUrgencyContext(state, now);
  const live = state.games.filter((g) => !g.deleted);
  const entries: GameUrgency[] = live.map((game) => {
    const actions = game.paused ? [] : gameActions(state, game, now, context);
    return { game, next: actions[0] ?? null, actions };
  });
  return entries.sort((a, b) => {
    if (a.game.paused !== b.game.paused) return a.game.paused ? 1 : -1;
    const aAt = a.next?.at ?? Infinity;
    const bAt = b.next?.at ?? Infinity;
    return aAt - bAt || a.game.sort - b.game.sort;
  });
}
