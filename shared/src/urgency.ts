import type { AppState, Game } from './types';
import { latestSnapshots, projectEnergy } from './energy';
import { checklistFor } from './checklist';
import { effectiveResourceKind } from './tracking';

export type ActionKind = 'energy_full' | 'energy_soon' | 'daily' | 'weekly' | 'monthly' | 'custom' | 'event';

export interface NextAction {
  kind: ActionKind;
  gameId: string;
  /** Deadline, epoch ms. For an already-capped resource this is `now` (max urgency). */
  at: number;
  label: string;
}

/** All time-sensitive actions for one game, soonest first. */
export function gameActions(state: AppState, game: Game, now: number): NextAction[] {
  const actions: NextAction[] = [];
  const snaps = latestSnapshots(state.snapshots);

  for (const res of state.resources) {
    if (res.gameId !== game.id || res.deleted || effectiveResourceKind(res) !== 'regen') continue;
    const proj = projectEnergy(res, snaps.get(res.id), now, game);
    if (!proj.hasSnapshot) continue;
    if (proj.isFull) {
      actions.push({ kind: 'energy_full', gameId: game.id, at: now, label: `${res.name} is FULL` });
    } else if (proj.fullAt != null) {
      actions.push({ kind: 'energy_soon', gameId: game.id, at: proj.fullAt, label: `${res.name} caps` });
    }
  }

  for (const item of checklistFor(state, game, now)) {
    if (item.done) continue;
    const kind =
      item.cadence === 'daily'
        ? 'daily'
        : item.cadence === 'weekly'
          ? 'weekly'
          : item.cadence === 'monthly'
            ? 'monthly'
            : 'custom';
    actions.push({ kind, gameId: game.id, at: item.resetAt, label: `${item.name} resets` });
  }

  for (const ev of state.events) {
    if (ev.gameId !== game.id || ev.deleted || !ev.notify) continue;
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
export function urgencyOrder(state: AppState, now: number): GameUrgency[] {
  const live = state.games.filter((g) => !g.deleted);
  const entries: GameUrgency[] = live.map((game) => {
    const actions = game.paused ? [] : gameActions(state, game, now);
    return { game, next: actions[0] ?? null, actions };
  });
  return entries.sort((a, b) => {
    if (a.game.paused !== b.game.paused) return a.game.paused ? 1 : -1;
    const aAt = a.next?.at ?? Infinity;
    const bAt = b.next?.at ?? Infinity;
    return aAt - bAt || a.game.sort - b.game.sort;
  });
}
