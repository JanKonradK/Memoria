import type { AppState, GameEvent } from './types';

/** cyrb53: a fast 53-bit string hash, run twice with different seeds for 106 bits. */
function cyrb53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * The id an imported event gets on every device.
 *
 * Each device imports the event feed by itself. With random ids, the PC, the
 * phone and the tablet each made their own copy, and sync (which merges by id)
 * kept all of them. The same game and source now always give the same id.
 */
export function sourceEventId(gameId: string, sourceKey: string): string {
  const key = JSON.stringify([gameId, sourceKey]);
  return `src-${cyrb53(key, 1)}-${cyrb53(key, 2)}`;
}

function laterClock(at: number, current: number): number {
  return Math.max(at, current + 1);
}

/**
 * Collapse live events that share a game and source key into one.
 *
 * The survivor is the smallest id, so devices that run this on their own never
 * delete each other's survivor: the smallest id anywhere is never deleted. The
 * others are tombstoned (so the deletion syncs) and what the player did to them
 * — ticked, pinned, parts, notes, order, muted — moves onto the survivor.
 */
export function collapseSourceTwins(state: AppState, at: number): AppState {
  const groups = new Map<string, GameEvent[]>();
  for (const event of state.events) {
    if (event.deleted || !event.sourceKey) continue;
    const key = `${event.gameId}\u0000${event.sourceKey}`;
    const group = groups.get(key);
    if (group) group.push(event);
    else groups.set(key, [event]);
  }

  const replaced = new Map<string, GameEvent>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const [first, ...twins] = group as [GameEvent, ...GameEvent[]];
    const survivor: GameEvent = { ...first };
    for (const twin of twins) {
      if (twin.done) survivor.done = true;
      if (twin.pinned) survivor.pinned = true;
      if (twin.notify === false) survivor.notify = false;
      if (survivor.parts === undefined && twin.parts !== undefined) survivor.parts = twin.parts;
      if ((twin.partsDone ?? 0) > (survivor.partsDone ?? 0)) survivor.partsDone = twin.partsDone;
      if (survivor.sort === undefined && twin.sort !== undefined) survivor.sort = twin.sort;
      if (!survivor.notes.trim() && twin.notes.trim()) survivor.notes = twin.notes;
      replaced.set(twin.id, { ...twin, deleted: true, updatedAt: laterClock(at, twin.updatedAt) });
    }
    const changed = (Object.keys(survivor) as (keyof GameEvent)[]).some((field) => survivor[field] !== first[field]);
    if (changed) replaced.set(first.id, { ...survivor, updatedAt: laterClock(at, first.updatedAt) });
  }

  if (replaced.size === 0) return state;
  return { ...state, events: state.events.map((event) => replaced.get(event.id) ?? event) };
}
