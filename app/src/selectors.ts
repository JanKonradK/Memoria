import type {
  AppState,
  EnergyBank,
  EnergyProjection,
  Resource,
  ChecklistItem,
  GameUrgency,
  Snapshot,
  TodayPlan,
} from '@memoria/shared';
import {
  buildUrgencyContext,
  effectiveResourceKind,
  energyBank,
  measuredSnapshot,
  projectEnergy,
  todaySteps,
  urgencyOrder,
} from '@memoria/shared';
import { useApp } from './store';
import { selectAgendaData, type AgendaData, type AgendaMode } from './agenda-data';

interface PrimaryEnergy {
  resource: Resource | undefined;
  projection: EnergyProjection | null;
  /** What banks the bar: its reserve, or the counter crafted from it. */
  bank: EnergyBank | null;
}

export interface Derived {
  state: AppState;
  now: number;
  snaps: Map<string, Snapshot>;
  order: GameUrgency[];
  entryById: Map<string, GameUrgency>;
  checklistByGame: Map<string, ChecklistItem[]>;
  primaryEnergy(gameId: string): PrimaryEnergy;
  agenda(mode: AgendaMode): AgendaData;
  /** Today's steps across every game: ordered, grouped, with the week after. */
  todaySteps(): TodayPlan;
}

let cache: { state: AppState; now: number; derived: Derived } | undefined;

function createDerived(state: AppState, now: number): Derived {
  const urgencyContext = buildUrgencyContext(state, now);
  const { snaps, checklistByGame } = urgencyContext;
  const gameById = new Map(state.games.filter((game) => !game.deleted).map((game) => [game.id, game]));
  const order = urgencyOrder(state, now, urgencyContext);
  const entryById = new Map(order.map((entry) => [entry.game.id, entry]));
  const energyByGame = new Map<string, PrimaryEnergy>();
  const primaryByGame = new Map<string, Resource>();
  for (const resource of state.resources) {
    if (resource.deleted || effectiveResourceKind(resource) !== 'regen') continue;
    const current = primaryByGame.get(resource.gameId);
    if (!current || resource.sort < current.sort) primaryByGame.set(resource.gameId, resource);
  }
  const agendaByMode = new Map<AgendaMode, AgendaData>();
  let plan: TodayPlan | undefined;

  return {
    state,
    now,
    snaps,
    order,
    entryById,
    checklistByGame,
    primaryEnergy(gameId) {
      const cached = energyByGame.get(gameId);
      if (cached) return cached;
      const resource = primaryByGame.get(gameId);
      const game = gameById.get(gameId);
      const projection =
        resource && game
          ? projectEnergy(resource, measuredSnapshot(resource, snaps.get(resource.id)), now, game)
          : null;
      const siblings = urgencyContext.resourcesByGame.get(gameId) ?? [];
      const result = {
        resource,
        projection,
        bank: resource && projection ? energyBank(resource, projection, siblings, snaps, now, game) : null,
      };
      energyByGame.set(gameId, result);
      return result;
    },
    agenda(mode) {
      const cached = agendaByMode.get(mode);
      if (cached) return cached;
      const result = selectAgendaData(state, now, mode);
      agendaByMode.set(mode, result);
      return result;
    },
    todaySteps() {
      plan ??= todaySteps(state, now, urgencyContext);
      return plan;
    },
  };
}

/** The steps still open on Today, for the rail's Today badge. */
export function todayStepsLeft(derived: Derived): number {
  return derived.todaySteps().open;
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
