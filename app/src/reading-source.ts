import type { Snapshot } from '@memoria/shared';
import { fmtDur } from './util';

export type ReadingKind = NonNullable<Snapshot['provenance']>['kind'];

const LABEL: Record<ReadingKind, string> = {
  account: 'Account',
  screenshot: 'Screenshot',
  estimate: 'Starting estimate',
  manual: 'Manual',
};

/** Display names for account adapters; anything else reads as "your account". */
const PROVIDER: Record<string, string> = {
  hoyolab: 'HoYoLAB',
  skport: 'SKPORT',
};

/** The adapter that read a value, as a player would name it, e.g. `SKPORT`. */
export function providerLabel(provider: string | undefined): string | undefined {
  return provider ? PROVIDER[provider] : undefined;
}

export interface ReadingSource {
  kind: ReadingKind;
  /** `SKPORT` or `HoYoLAB` for an account reading from a known adapter, else the kind. */
  label: string;
  /** The account adapter's display name, when it has one. */
  provider?: string;
  /** "13m ago", or "just now" inside the first minute. */
  age: string;
  /** The same age without "ago", for places too narrow for the word. */
  shortAge: string;
}

/**
 * Where a reading came from and how old it is.
 *
 * Age is measured from when the value was observed, not from when it reached
 * this device, and is clamped at zero so a clock that moved back cannot produce
 * a reading from the future.
 */
export function readingSource(snapshot: Snapshot | undefined, now: number): ReadingSource | null {
  if (!snapshot) return null;
  const kind = snapshot.provenance?.kind ?? 'manual';
  const elapsed = Math.max(0, now - (snapshot.provenance?.observedAt ?? snapshot.takenAt));
  const fresh = elapsed < 60_000;
  const provider = kind === 'account' ? providerLabel(snapshot.provenance?.provider) : undefined;
  return {
    kind,
    label: provider ?? LABEL[kind],
    ...(provider ? { provider } : {}),
    age: fresh ? 'just now' : `${fmtDur(elapsed)} ago`,
    shortAge: fresh ? 'now' : fmtDur(elapsed),
  };
}
