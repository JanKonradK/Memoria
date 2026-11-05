import type { PublicFeedEvent } from '@memoria/shared';
import current from './feed/current.json' with { type: 'json' };

/**
 * Bundled event feed: banners and events for the current and next version of
 * each game. The facts live in `feed/current.json`; how to read each
 * publisher's notices, and why particular rows look the way they do, is in
 * docs/feed-notes.md. Read its rules before changing a date.
 *
 * Times are strings in the game's SERVER time, converted with the game's
 * configured tz at import. Versions that have ended move to
 * `feed/history.json` with `npm run feed:archive`, so the timeline never loads
 * old patches.
 */
export type SeedEvent = PublicFeedEvent;

export const SEED_UPDATED: string = current.updated;
/** Invalid source windows withdrawn even from an earlier build on the same day. */
export const SEED_WITHDRAWN_KEYS: string[] = current.withdrawn;
// The JSON is checked against PublicFeedEventSchema in seed-events.test.ts.
export const SEED_EVENTS = current.events as SeedEvent[];

/**
 * How long a finished event is worth keeping. Two months.
 *
 * This is one rule with two halves that have to agree. The bundle ships no row
 * that ended longer ago than this (there is a test), and the importer drops
 * imported rows once they pass it, so a document cannot accumulate years of dead
 * banners. The timeline only draws about thirteen days of history anyway
 * (RANGE_DAYS / 3), so everything this removes has been invisible for weeks.
 *
 * Only rows the feed created are swept: they carry a `seedHash`. Anything you
 * wrote yourself, and anything pulled in through ⤓ HoYoLAB, is never touched by
 * age — those are your records, and their lifetime is your call.
 */
export const SEED_RETENTION_MS = 60 * 86_400_000;
