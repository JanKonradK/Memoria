import { presetForGame, type AppState, type Game } from '@memoria/shared';
import { digestsForGame, unreadDigests, type VersionDigest } from './data/catch-up';
import { useApp } from './store';

/** How many versions of a game the player has notes for, and how many they have not read. */
export function useCatchUpUnread(game: Game | undefined): { total: number; unread: number } {
  const preset = game ? presetForGame(game)?.key : undefined;
  const seen = useApp((store) => (preset ? store.state.settings.catchUpSeen?.[preset] : undefined));
  const digests = digestsForGame(preset);
  return { total: digests.length, unread: unreadDigests(digests, seen).length };
}

/** The game's next livestream, from its own events, so owner edits and deletions win. */
export function nextBroadcast(state: AppState, gameId: string, now: number) {
  return state.events
    .filter(
      (event) =>
        event.gameId === gameId && event.type === 'livestream' && !event.deleted && !event.done && event.end > now,
    )
    .sort((a, b) => a.start - b.start)
    .map((event) => ({ event, estimated: /predicted window/i.test(event.name) }))[0];
}

/** The newest version whose livestream has aired, whether or not the version is out yet. */
export function lastAiredStream(presetKey: string | undefined, now: number): VersionDigest | undefined {
  return digestsForGame(presetKey)
    .filter((digest) => digest.stream && Date.parse(digest.stream.aired) <= now)
    .sort((a, b) => Date.parse(b.stream!.aired) - Date.parse(a.stream!.aired))[0];
}
