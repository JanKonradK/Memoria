import {
  CalendarInboxSchema,
  collectCalendarChanges,
  parseServerDateTime,
  presetForGame,
  type AppState,
  type CalendarInbox,
  type CalendarObservation,
  type GameEvent,
  type RemoteEventFeed,
} from '@memoria/shared';
import { create } from 'zustand';
import { eventFingerprint, planSeedImport, seedFingerprint } from './seed-events';
import { SEED_EVENTS, SEED_UPDATED, SEED_WITHDRAWN_KEYS } from './seed-feed';

const KEY = 'memoria-calendar-changes';
const empty = (): CalendarInbox => ({ baseline: {}, unread: [] });
function read(): CalendarInbox {
  try {
    return CalendarInboxSchema.parse(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return empty();
  }
}
export const useCalendarChanges = create<CalendarInbox>(read);
function save(inbox: CalendarInbox) {
  try {
    localStorage.setItem(KEY, JSON.stringify(inbox));
  } catch {
    /* Keep unread changes in memory. */
  }
  useCalendarChanges.setState(inbox);
}
export function confirmCalendarChange(id: string) {
  const inbox = useCalendarChanges.getState();
  save({ ...inbox, unread: inbox.unread.filter((change) => change.id !== id) });
}
export function clearCalendarChanges() {
  save(empty());
}
function value(event: GameEvent) {
  return { name: event.name, start: event.start, end: event.end, notes: event.notes, hash: eventFingerprint(event) };
}

/** Store-only hook: the original planner remains pure and owns all write decisions. */
export function planCalendarImport(state: AppState, now: number, feed?: RemoteEventFeed) {
  const plan = planSeedImport(state, now, feed);
  if (!feed && state.settings.remoteFeedVersion && state.settings.remoteFeedVersion.seedUpdated >= SEED_UPDATED)
    return plan;
  const rows: CalendarObservation[] = [];
  const withdrawn = feed?.withdrawn ?? SEED_WITHDRAWN_KEYS;
  const events = feed?.events ?? SEED_EVENTS;
  for (const game of state.games.filter((game) => !game.deleted)) {
    const preset = presetForGame(game)?.key;
    const existing = new Map<string, GameEvent>();
    for (const event of state.events) {
      if (event.gameId !== game.id || !event.sourceKey) continue;
      if (!existing.has(event.sourceKey) || !event.deleted) existing.set(event.sourceKey, event);
    }
    const seen = new Set<string>();
    for (const seed of events.filter((seed) => seed.game === preset)) {
      seen.add(seed.sourceKey);
      const old = existing.get(seed.sourceKey);
      if (old?.deleted) continue;
      const start = parseServerDateTime(seed.start, seed.startTimezone ?? seed.timezone ?? game.tz);
      const end = parseServerDateTime(seed.end, seed.endTimezone ?? seed.timezone ?? game.tz);
      if (start == null || end == null || end <= start || (!old && end <= now)) continue;
      const applied = plan.some(
        (item) => item.gameId === game.id && item.seed?.sourceKey === seed.sourceKey && item.kind !== 'stamp',
      );
      rows.push({
        key: JSON.stringify([game.id, seed.sourceKey]),
        game: game.accountLabel ? `${game.name} · ${game.accountLabel}` : game.name,
        before: old ? value(old) : undefined,
        seedHash: old?.seedHash,
        kept: old ? value(old) : undefined,
        after: { name: seed.name, start, end, notes: seed.notes ?? '', hash: seedFingerprint(seed, start, end) },
        applied,
      });
    }
    for (const old of existing.values()) {
      if (old.deleted || !old.seedHash || seen.has(old.sourceKey!)) continue;
      const removed = plan.some((item) => item.kind === 'remove' && item.eventId === old.id);
      // Remote deliveries are partial. Bundled expiry/archiving is not news.
      if (
        !withdrawn.includes(old.sourceKey!) &&
        !(old.end > now && (removed || (!feed && state.settings.seedImportedVersion !== SEED_UPDATED)))
      )
        continue;
      rows.push({
        key: JSON.stringify([game.id, old.sourceKey]),
        game: game.name,
        before: value(old),
        seedHash: old.seedHash,
        kept: value(old),
        applied: removed,
      });
    }
  }
  save(collectCalendarChanges(useCalendarChanges.getState(), rows, feed?.seedUpdated ?? SEED_UPDATED));
  return plan;
}
