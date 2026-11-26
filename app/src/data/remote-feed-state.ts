import type { FeedCode } from '@memoria/shared';
import { create } from 'zustand';

/**
 * What screens read about the public calendar. Kept apart from remote-feed.ts,
 * which carries the signature check and loads after the first screen.
 */
export const useRemoteFeed = create<{
  status: 'idle' | 'checking' | 'ok' | 'error';
  error: string;
  lastSuccessAt: number | null;
  /** Reward codes from the latest verified feed. */
  codes: FeedCode[];
}>(() => ({ status: 'idle', error: '', lastSuccessAt: null, codes: [] }));
