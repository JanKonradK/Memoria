import { DateTime } from 'luxon';
import type { AppState, EventType, Game, GameEvent } from '@memoria/shared';
import { presetForGame } from '@memoria/shared';
import { SEED_EVENTS, SEED_UPDATED, type SeedEvent } from './seed-feed';

// Keep the public import path stable. Update event facts in seed-feed.ts.
export { SEED_EVENTS, SEED_UPDATED, SEED_RETENTION_MS, type SeedEvent } from './seed-feed';

export interface PlannedSeed {
  /** 'stamp' records the fingerprint on an existing row WITHOUT rewriting it. */
  kind: 'add' | 'update' | 'stamp' | 'remove';
  /** Set for updates and removals — the id of the already-imported event. */
  eventId?: string;
  gameId: string;
  /** Absent on removals: the row is gone from the bundle, so there is no seed. */
  seed?: SeedEvent;
  start?: number;
  end?: number;
  /** The fingerprint to stamp on the event — set for adds and updates. */
  hash?: string;
}

/**
 * A short, stable digest of exactly the fields the bundle owns.
 *
 * This is the whole mechanism behind "refresh my dates, keep my edits". The
 * importer stamps this on every row it writes; on the next refresh it hashes
 * the row again and compares. Equal means untouched since the feed wrote it, so
 * a correction is safe. Unequal means a human edited the row, and the feed
 * stops touching it — permanently, and for every field, because it cannot tell
 * WHICH field you meant to own.
 *
 * `done` is deliberately excluded: ticking something off is not an edit to the
 * event, and a done row should still get a corrected end date.
 */
function fingerprint(fields: {
  name: string;
  type: EventType;
  start: number;
  end: number;
  dailyTouch: boolean;
  notify: boolean;
  notes: string;
}): string {
  const payload = [
    fields.name,
    fields.type,
    String(fields.start),
    String(fields.end),
    fields.dailyTouch ? '1' : '0',
    fields.notify ? '1' : '0',
    fields.notes,
  ].join('\u0000');
  // FNV-1a. Not cryptographic and does not need to be: it guards against
  // accidental collision between two versions of the same row, not an attacker.
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** What the bundle says this row should be. */
function seedFingerprint(seed: SeedEvent, start: number, end: number): string {
  return fingerprint({
    name: seed.name,
    type: seed.type,
    start,
    end,
    dailyTouch: seed.dailyTouch ?? false,
    notify: seed.notify ?? true,
    notes: seed.notes ?? '',
  });
}

/**
 * What the stored row actually is right now, edits included. Exported because it
 * IS the contract: a row whose `seedHash` still equals this is the bundle's to
 * correct, and a row where it does not is yours.
 */
export function eventFingerprint(event: GameEvent): string {
  return fingerprint(event);
}

/** True when nobody has edited the row since the bundle stamped it. */
function isPristine(event: GameEvent): boolean {
  return event.seedHash !== undefined && event.seedHash === eventFingerprint(event);
}

function parseServerTime(s: string, tz: string): number | null {
  const dt = DateTime.fromFormat(s, 'yyyy-LL-dd HH:mm', { zone: tz });
  return dt.isValid ? dt.toMillis() : null;
}

function sourceIdentity(gameId: string, sourceKey: string): string {
  return `${gameId}\u0000${sourceKey}`;
}

/**
 * What importing the bundle would do right now: new events for games that
 * exist locally, plus date/name fixes for previously imported seeds (how TBC
 * dates get corrected on a refresh). Already-ended events and name twins
 * (e.g. the same banner imported via ⤓ HoYoLAB under another key) are skipped.
 */
/**
 * Forget bundled events that finished more than SEED_RETENTION_MS ago.
 *
 * Deleted outright rather than tombstoned. A tombstone would defeat the point —
 * it is the same row count — and resurrection is not a risk here, because the
 * add branch of planSeedImport already refuses anything that has already ended.
 */
export function pruneRetiredSeedEvents(state: AppState, before: number): AppState {
  const kept = state.events.filter((event) => event.seedHash === undefined || event.end >= before);
  return kept.length === state.events.length ? state : { ...state, events: kept };
}

export function planSeedImport(state: AppState, now: number): PlannedSeed[] {
  const out: PlannedSeed[] = [];
  const live = state.events.filter((e) => !e.deleted);
  // Resolve each account once, rather than matching the roster for every seed.
  const gamesByPreset = new Map<string, Game[]>();
  for (const game of state.games) {
    if (game.deleted) continue;
    const key = presetForGame(game)?.key;
    if (!key) continue;
    const games = gamesByPreset.get(key) ?? [];
    games.push(game);
    gamesByPreset.set(key, games);
  }
  // Built from ALL events, tombstones included. Filtering to live events makes a
  // deleted seed invisible here, so the add branch below re-creates it — which
  // was survivable while importing was a button you pressed, and would mean
  // resurrecting everything you deleted on every launch now that it is automatic.
  // Keep sourceKey unchanged on the event: HoYoLAB dedupes against that value.
  // Only this lookup needs an account scope, or one account hides another's seed.
  const byKey = new Map(
    state.events
      .filter((event) => event.sourceKey)
      .map((event) => [sourceIdentity(event.gameId, event.sourceKey!), event]),
  );
  const refreshSeeds = state.settings.seedImportedVersion !== SEED_UPDATED;
  // Ids the current bundle still accounts for; anything stamped and missing from
  // this set has been dropped upstream.
  const seenKeys = new Set<string>();
  for (const seed of SEED_EVENTS) {
    for (const game of gamesByPreset.get(seed.game) ?? []) {
      const start = parseServerTime(seed.start, seed.startTimezone ?? seed.timezone ?? game.tz);
      const end = parseServerTime(seed.end, seed.timezone ?? game.tz);
      if (start == null || end == null || end <= start) continue;
      const hash = seedFingerprint(seed, start, end);
      const existing = byKey.get(sourceIdentity(game.id, seed.sourceKey));
      if (existing) {
        seenKeys.add(existing.id);
        if (!refreshSeeds || existing.deleted) continue;
        if (existing.seedHash === undefined) {
          // Imported before fingerprints existed, so there is no baseline to
          // compare against and no way to tell an edit from an older bundle.
          // Apply the rule that was in force when the row was written — dates and
          // name only, the objective facts — and stamp it either way, so this is
          // the LAST refresh that has to guess about this row.
          if (existing.start !== start || existing.end !== end || existing.name !== seed.name) {
            out.push({ kind: 'update', eventId: existing.id, gameId: game.id, seed, start, end, hash });
          } else {
            // Values already agree, so record the baseline without touching the
            // row: any note or muted alert the user added here survives, and is
            // what marks the row as theirs from the next refresh on.
            out.push({ kind: 'stamp', eventId: existing.id, gameId: game.id, hash });
          }
          continue;
        }
        // Dates and name are not all a refresh corrects: a row promoted from
        // community estimate to official notice keeps its window and changes only
        // `notify`. So the comparison is the whole fingerprint — but it is gated
        // on the row being untouched, or that same breadth would overwrite the
        // edits it is meant to protect.
        if (existing.seedHash !== hash && isPristine(existing)) {
          out.push({ kind: 'update', eventId: existing.id, gameId: game.id, seed, start, end, hash });
        }
        continue;
      }
      if (end <= now) continue;
      const name = seed.name.trim().toLowerCase();
      const twin = live.some(
        (event) =>
          event.gameId === game.id &&
          event.name.trim().toLowerCase() === name &&
          event.start <= end &&
          start <= event.end,
      );
      if (twin) continue;
      out.push({ kind: 'add', gameId: game.id, seed, start, end, hash });
    }
  }

  // Rows the bundle used to carry and no longer does — a cancelled event, or one
  // that was simply wrong. Left alone they would sit on the timeline forever,
  // because nothing else ever deletes them.
  //
  // Only rows the bundle demonstrably wrote (they carry a stamp) and that nobody
  // has since edited or ticked off are withdrawn. A ⤓ HoYoLAB import has no
  // stamp and is never touched; neither is anything you changed.
  //
  // One-cycle warm-up: a row already orphaned BEFORE fingerprints shipped never
  // gets stamped, so it can never be withdrawn here. Everything still in the
  // bundle today is stamped by the pass above, so from the next bundle onward
  // withdrawal is complete. The gap is bounded and shrinks to nothing.
  if (refreshSeeds) {
    for (const event of state.events) {
      if (event.deleted || event.done || seenKeys.has(event.id)) continue;
      if (!isPristine(event)) continue;
      out.push({ kind: 'remove', eventId: event.id, gameId: event.gameId });
    }
  }
  return out;
}
