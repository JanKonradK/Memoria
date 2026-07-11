import type { AppState, Game, GameEvent, Resource, Snapshot, Task } from '../src/types';
import { emptyState } from '../src/types';

export function makeGame(over: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    name: 'Testland',
    short: 'TL',
    color: '#38bdf8',
    icon: '⚔️',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    paused: false,
    sort: 0,
    updatedAt: 1,
    ...over,
  };
}

export function makeResource(over: Partial<Resource> = {}): Resource {
  return {
    id: 'r1',
    gameId: 'g1',
    name: 'Resin',
    cap: 200,
    regenMinutes: 8,
    reserveCap: 0,
    sort: 0,
    updatedAt: 1,
    ...over,
  };
}

export function makeSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  return { id: 's1', resourceId: 'r1', value: 0, takenAt: 0, ...over };
}

export function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    gameId: 'g1',
    name: 'Dailies',
    cadence: 'daily',
    intervalDays: 1,
    anchorAt: 0,
    sort: 0,
    updatedAt: 1,
    ...over,
  };
}

export function makeEvent(over: Partial<GameEvent> = {}): GameEvent {
  return {
    id: 'e1',
    gameId: 'g1',
    name: 'Banner',
    type: 'banner',
    start: 0,
    end: 0,
    dailyTouch: false,
    notify: true,
    notes: '',
    updatedAt: 1,
    ...over,
  };
}

export function makeState(over: Partial<AppState> = {}): AppState {
  return { ...emptyState(), ...over };
}

/** Epoch ms for an ISO string interpreted as UTC. */
export function utc(iso: string): number {
  return Date.parse(iso + (iso.includes('Z') || iso.includes('+') ? '' : 'Z'));
}
