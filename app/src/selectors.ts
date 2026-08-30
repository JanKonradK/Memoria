import type {
  AppState,
  ChecklistItem,
  GameEvent,
  GameUrgency,
  SleepCheck,
  Snapshot,
  UrgencyContext,
} from '@memoria/shared';
import { buildChecklistIndex, checklistFor, latestSnapshots, sleepCheck, urgencyOrder } from '@memoria/shared';
import { useApp } from './store';
import { selectAgendaData, type AgendaData, type AgendaMode } from './agenda-data';

export interface Derived {
  state: AppState;
  now: number;
  snaps: Map<string, Snapshot>;
  order: GameUrgency[];
  entryById: Map<string, GameUrgency>;
  checklistByGame: Map<string, ChecklistItem[]>;
  sleepFor(gameId: string): SleepCheck;
  agenda(mode: AgendaMode): AgendaData;
}

let cache: { state: AppState; now: number; derived: Derived } | undefined;

function createDerived(state: AppState, now: number): Derived {
  const snaps = latestSnapshots(state.snapshots);
  const checklistIndex = buildChecklistIndex(state);
  const checklistByGame = new Map<string, ChecklistItem[]>();
  const gameById = new Map(state.games.filter((game) => !game.deleted).map((game) => [game.id, game]));
  for (const game of gameById.values()) {
    checklistByGame.set(game.id, checklistFor(state, game, now, checklistIndex));
  }

  // Urgency historically considers every event row and applies deleted/notify
  // checks in gameActions, so its grouped input deliberately differs from the
  // live, unfinished event map in ChecklistIndex.
  const eventsByGame = new Map<string, GameEvent[]>();
  for (const event of state.events) {
    const events = eventsByGame.get(event.gameId);
    if (events) events.push(event);
    else eventsByGame.set(event.gameId, [event]);
  }
  const urgencyContext: UrgencyContext = { snaps, checklistByGame, eventsByGame };
  const order = urgencyOrder(state, now, urgencyContext);
  const entryById = new Map(order.map((entry) => [entry.game.id, entry]));
  const sleepByGame = new Map<string, SleepCheck>();
  const agendaByMode = new Map<AgendaMode, AgendaData>();

  return {
    state,
    now,
    snaps,
    order,
    entryById,
    checklistByGame,
    sleepFor(gameId) {
      const cached = sleepByGame.get(gameId);
      if (cached) return cached;
      const game = gameById.get(gameId);
      const result = game
        ? sleepCheck(state, game, state.settings.sleepHours, now, snaps)
        : { caps: false, fullAt: null };
      sleepByGame.set(gameId, result);
      return result;
    },
    agenda(mode) {
      const cached = agendaByMode.get(mode);
      if (cached) return cached;
      const result = selectAgendaData(state, now, mode);
      agendaByMode.set(mode, result);
      return result;
    },
  };
}

/** Shared one-entry derived-data cache keyed by Zustand state and clock identity. */
export function useDerived(now: number): Derived {
  const state = useApp((store) => store.state);
  if (!cache || cache.state !== state || cache.now !== now) {
    const derived = createDerived(state, now);
    // Required shared one-entry cache: every caller observes the same derived
    // object for an identical immutable Zustand state/clock pair.
    // eslint-disable-next-line react-hooks/globals
    cache = { state, now, derived };
  }
  return cache.derived;
}
