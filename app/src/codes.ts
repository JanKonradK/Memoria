import { create } from 'zustand';
import { presetForGame, redemptionCodeStatus, type FeedCode, type Game } from '@memoria/shared';
import { VERSION_DIGESTS } from './data/catch-up';
import { SEED_CODES } from './data/seed-feed';
import { useRemoteFeed } from './data/remote-feed';

const REDEEMED_KEY = 'memoria-redeemed-codes';

export interface LiveCode {
  game: Game;
  /** The feed's game key, which the redeemed list uses. */
  key: string;
  code: string;
  rewards: string;
  expiresAt?: number;
  redeemUrl?: string;
}

function readRedeemed(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(REDEEMED_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(-500) : [];
  } catch {
    return [];
  }
}

/** Codes this device has marked redeemed, as `game:CODE`. */
export const useRedeemed = create<{ redeemed: string[]; mark(game: string, code: string): void }>((set, get) => ({
  redeemed: readRedeemed(),
  mark(game, code) {
    const key = `${game}:${code.toUpperCase()}`;
    if (get().redeemed.includes(key)) return;
    const redeemed = [...get().redeemed, key].slice(-500);
    set({ redeemed });
    try {
      localStorage.setItem(REDEEMED_KEY, JSON.stringify(redeemed));
    } catch {
      // The list still holds for this session.
    }
  },
}));

/** Every known code: the signed feed's, this build's, and the version digests'. */
export function allCodes(remote: FeedCode[]): FeedCode[] {
  const fromDigests: FeedCode[] = VERSION_DIGESTS.flatMap((digest) =>
    (digest.codes?.codes ?? []).map((entry) => ({
      game: digest.game,
      code: entry.code,
      rewards: entry.rewards,
      ...(digest.codes?.expiresAt ? { expiresAt: new Date(digest.codes.expiresAt).toISOString() } : {}),
      ...(entry.redeemUrl ? { redeemUrl: entry.redeemUrl } : {}),
    })),
  );
  const byKey = new Map<string, FeedCode>();
  // Later sources win: the signed feed is the newest word on a code.
  for (const code of [...fromDigests, ...SEED_CODES, ...remote])
    byKey.set(`${code.game}:${code.code.toUpperCase()}`, code);
  return [...byKey.values()];
}

/**
 * Codes that still work and are not marked redeemed, for the games on the
 * roster. A code with no known expiry never reads as working, so it is left out.
 */
export function liveCodes(games: Game[], codes: FeedCode[], redeemed: readonly string[], now: number): LiveCode[] {
  const out: LiveCode[] = [];
  for (const code of codes) {
    const expiresAt = code.expiresAt ? Date.parse(code.expiresAt) : undefined;
    if (redemptionCodeStatus(expiresAt, now) !== 'available') continue;
    if (redeemed.includes(`${code.game}:${code.code.toUpperCase()}`)) continue;
    const game = games.find(
      (item) => !item.deleted && !item.paused && (item.presetKey ?? presetForGame(item)?.key) === code.game,
    );
    if (game)
      out.push({ game, key: code.game, code: code.code, rewards: code.rewards, expiresAt, redeemUrl: code.redeemUrl });
  }
  return out.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
}

export function useLiveCodes(games: Game[], now: number): LiveCode[] {
  const remote = useRemoteFeed((s) => s.codes);
  const redeemed = useRedeemed((s) => s.redeemed);
  return liveCodes(games, allCodes(remote), redeemed, now);
}
