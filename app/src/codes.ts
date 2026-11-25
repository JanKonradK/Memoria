import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { defaultRedeemUrl, presetForGame, redemptionCodeStatus, type FeedCode, type Game } from '@memoria/shared';
import { VERSION_DIGESTS } from './data/catch-up';
import { SEED_CODES } from './data/seed-feed';
import { useRemoteFeed } from './data/remote-feed';
import { useApp } from './store';
import { useUI } from './ui-store';

const REDEEMED_KEY = 'memoria-redeemed-codes';

export interface LiveCode {
  game: Game;
  /** The feed's game key, which the redeemed list uses. */
  key: string;
  code: string;
  rewards: string;
  expiresAt?: number;
  redeemUrl?: string;
  /** The saved code's id when the player added it; absent for a feed code. */
  customId?: string;
  /** When the player saved it. */
  addedAt?: number;
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

/** The game key feed codes and the redeemed list use: its preset, or its own id for a custom game. */
function gameCodeKey(game: Game): string {
  return game.presetKey ?? presetForGame(game)?.key ?? game.id;
}

/** Soonest to expire first; among the rest, the newest added first. */
function byExpiry(a: { expiresAt?: number; addedAt?: number }, b: { expiresAt?: number; addedAt?: number }): number {
  return (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) || (b.addedAt ?? 0) - (a.addedAt ?? 0);
}

/**
 * Codes that still work and are not marked redeemed, for the games on the
 * roster. A feed code with no known expiry never reads as working, so it is
 * left out; a code the player saved without one stays until it is marked
 * redeemed or removed. A saved code wins over the feed's copy of it.
 */
export function liveCodes(games: Game[], codes: FeedCode[], redeemed: readonly string[], now: number): LiveCode[] {
  const out: LiveCode[] = [];
  const saved = new Set<string>();
  for (const game of games) {
    if (game.deleted || game.paused) continue;
    const key = gameCodeKey(game);
    for (const item of game.codes ?? []) {
      saved.add(`${game.id}:${item.code.toUpperCase()}`);
      if (item.redeemed || redemptionCodeStatus(item.expiresAt, now) === 'expired') continue;
      out.push({
        game,
        key,
        code: item.code,
        rewards: item.rewards ?? '',
        expiresAt: item.expiresAt,
        redeemUrl: item.redeemUrl ?? defaultRedeemUrl(key, item.code),
        customId: item.id,
        addedAt: item.addedAt,
      });
    }
  }
  for (const code of codes) {
    const expiresAt = code.expiresAt ? Date.parse(code.expiresAt) : undefined;
    if (redemptionCodeStatus(expiresAt, now) !== 'available') continue;
    if (redeemed.includes(`${code.game}:${code.code.toUpperCase()}`)) continue;
    const game = games.find((item) => !item.deleted && !item.paused && gameCodeKey(item) === code.game);
    if (game && !saved.has(`${game.id}:${code.code.toUpperCase()}`))
      out.push({
        game,
        key: code.game,
        code: code.code,
        rewards: code.rewards,
        expiresAt,
        redeemUrl: code.redeemUrl ?? defaultRedeemUrl(code.game, code.code),
      });
  }
  return out.sort(byExpiry);
}

/** One code on a game's page, saved by the player or from the feed. */
export interface GameCodeItem {
  code: string;
  rewards?: string;
  expiresAt?: number;
  redeemUrl?: string;
  /** The feed's game key, which the redeemed list uses. */
  key: string;
  /** The saved code's id; absent for a feed code. */
  customId?: string;
  addedAt?: number;
}

/** How long an expired feed code still shows under a game, so the list stays short. */
const RECENTLY_EXPIRED_MS = 14 * 24 * 60 * 60_000;

/** One game's codes, saved and from the feed, split into what works, what was redeemed and what expired. */
export function codesForGame(
  game: Game,
  feedCodes: FeedCode[],
  redeemed: readonly string[],
  now: number,
): { active: GameCodeItem[]; redeemed: GameCodeItem[]; expired: GameCodeItem[] } {
  const key = gameCodeKey(game);
  const active: GameCodeItem[] = [];
  const used: GameCodeItem[] = [];
  const expired: GameCodeItem[] = [];
  const saved = new Set<string>();
  const linkFor = (code: string, url: string | undefined) => {
    const redeemUrl = url || defaultRedeemUrl(key, code);
    return redeemUrl ? { redeemUrl } : {};
  };
  for (const item of game.codes ?? []) {
    saved.add(item.code.toUpperCase());
    const entry: GameCodeItem = {
      code: item.code,
      key,
      customId: item.id,
      addedAt: item.addedAt,
      ...(item.rewards ? { rewards: item.rewards } : {}),
      ...(item.expiresAt !== undefined ? { expiresAt: item.expiresAt } : {}),
      ...linkFor(item.code, item.redeemUrl),
    };
    if (item.redeemed) used.push(entry);
    else if (redemptionCodeStatus(item.expiresAt, now) === 'expired') expired.push(entry);
    else active.push(entry);
  }
  for (const code of feedCodes) {
    if (code.game !== key || saved.has(code.code.toUpperCase())) continue;
    const expiresAt = code.expiresAt ? Date.parse(code.expiresAt) : undefined;
    const status = redemptionCodeStatus(expiresAt, now);
    if (status === 'unknown' || (status === 'expired' && now - expiresAt! > RECENTLY_EXPIRED_MS)) continue;
    const entry: GameCodeItem = {
      code: code.code,
      key,
      expiresAt,
      ...(code.rewards ? { rewards: code.rewards } : {}),
      ...linkFor(code.code, code.redeemUrl),
    };
    if (redeemed.includes(`${key}:${code.code.toUpperCase()}`)) used.push(entry);
    else if (status === 'expired') expired.push(entry);
    else active.push(entry);
  }
  const newestFirst = (a: GameCodeItem, b: GameCodeItem) =>
    (b.expiresAt ?? b.addedAt ?? 0) - (a.expiresAt ?? a.addedAt ?? 0);
  return { active: active.sort(byExpiry), redeemed: used.sort(newestFirst), expired: expired.sort(newestFirst) };
}

/** One game's codes, kept current with the feed and this device's redeemed list. */
export function useGameCodes(game: Game, now: number): ReturnType<typeof codesForGame> {
  const remote = useRemoteFeed((s) => s.codes);
  const redeemed = useRedeemed((s) => s.redeemed);
  return codesForGame(game, allCodes(remote), redeemed, now);
}

/** How many of a game's codes still work and are not redeemed; 0 without a game. */
export function useActiveCodeCount(game: Game | undefined, now: number): number {
  const remote = useRemoteFeed((s) => s.codes);
  const redeemed = useRedeemed((s) => s.redeemed);
  return game ? codesForGame(game, allCodes(remote), redeemed, now).active.length : 0;
}

export function useLiveCodes(games: Game[], now: number): LiveCode[] {
  const remote = useRemoteFeed((s) => s.codes);
  const redeemed = useRedeemed((s) => s.redeemed);
  return liveCodes(games, allCodes(remote), redeemed, now);
}

/**
 * Runs one store change and offers Undo for exactly the history entry it
 * wrote. `text` may read the change's result. Returns that result.
 */
export function withUndo<T>(text: string | ((result: T) => string), change: () => T): T {
  const before = useApp.getState().history.journal.at(-1)?.id;
  const result = change();
  const entry = useApp.getState().history.journal.at(-1);
  if (entry && entry.id !== before)
    useUI
      .getState()
      .showUndo(typeof text === 'string' ? text : text(result), () => useApp.getState().undoActivity(entry.id));
  return result;
}

/** Copies a code to the clipboard; `copied` names it for a moment so its button can say so. */
export function useCopyCode(): { copied: string | null; message: string; copy(code: string): Promise<void> } {
  const [copied, setCopied] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (code: string) => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setMessage(`Copied ${code}`);
      timer.current = setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
      setMessage(`Could not copy ${code}`);
    }
  };
  return { copied, message, copy };
}
