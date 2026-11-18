import { create } from 'zustand';
import {
  checklistFor,
  effectiveResourceKind,
  latestSnapshots,
  type AppState,
  type Game,
  type Resource,
} from '@memoria/shared';

/**
 * A game running on this PC right now. Its page puts one thing forward at a
 * time, in the order a session goes: the energy reading, then the reserve, then
 * the dailies. Nothing pops up; the page itself shows what is next.
 */
export interface PlaySession {
  gameId: string;
  startedAt: number;
  /** Steps the player has dealt with or moved past. */
  passed: Partial<Record<SessionNeed, true>>;
  /** Set a minute in when something is still owed: the step starts pulsing. */
  nudged: boolean;
}

export type SessionNeed = 'energy' | 'reserve' | 'dailies';

export const useSession = create<{ session: PlaySession | null }>(() => ({ session: null }));

export function startSession(gameId: string, at = Date.now()): void {
  useSession.setState({ session: { gameId, startedAt: at, passed: {}, nudged: false } });
}

export function endSession(gameId?: string): void {
  const { session } = useSession.getState();
  if (session && (gameId == null || session.gameId === gameId)) useSession.setState({ session: null });
}

/** The player dealt with a step, or moved past it by doing the next one. */
export function passSession(gameId: string, ...steps: SessionNeed[]): void {
  const { session } = useSession.getState();
  if (!session || session.gameId !== gameId) return;
  if (steps.every((step) => session.passed[step])) return;
  const passed = { ...session.passed };
  for (const step of steps) passed[step] = true;
  useSession.setState({ session: { ...session, passed } });
}

export function nudgeSession(gameId: string): void {
  const { session } = useSession.getState();
  if (session?.gameId === gameId && !session.nudged) useSession.setState({ session: { ...session, nudged: true } });
}

/** The regenerating bar a session starts with: the game's first one. */
export function sessionResource(state: AppState, gameId: string): Resource | undefined {
  return state.resources
    .filter((item) => item.gameId === gameId && !item.deleted && effectiveResourceKind(item) === 'regen')
    .sort((a, b) => a.sort - b.sort)[0];
}

/** What the running game still needs, first thing first; null once nothing is owed. */
export function sessionNeed(state: AppState, game: Game, session: PlaySession, now: number): SessionNeed | null {
  const resource = sessionResource(state, game.id);
  if (resource && !session.passed.energy) {
    const snap = latestSnapshots(state.snapshots).get(resource.id);
    // A reading taken since the game started, here or on a synced phone, is the step done.
    const fresh = snap && snap.takenAt >= session.startedAt && snap.provenance?.kind !== 'estimate';
    if (!fresh) return 'energy';
  }
  if (resource && resource.reserveCap > 0 && !session.passed.reserve) return 'reserve';
  const owed = checklistFor(state, game, now).some((item) => item.cadence === 'daily' && !item.done);
  return owed ? 'dailies' : null;
}

/** The one-minute notice, or nothing when the game needs nothing. */
export function nudgeLine(state: AppState, game: Game, session: PlaySession, now: number): string {
  const need = sessionNeed(state, game, session, now);
  if (!need) return '';
  const left = checklistFor(state, game, now).filter((item) => item.cadence === 'daily' && !item.done).length;
  const dailies = left ? `${left} ${left === 1 ? 'daily' : 'dailies'} left` : '';
  const resource = sessionResource(state, game.id);
  if (need === 'energy' && resource) return [`${resource.name}?`, dailies].filter(Boolean).join(' · ');
  if (need === 'reserve' && resource)
    return [`${resource.reserveLabel ?? 'Reserve'}?`, dailies].filter(Boolean).join(' · ');
  return dailies;
}
