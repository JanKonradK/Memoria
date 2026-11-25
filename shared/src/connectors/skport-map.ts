import { objectRecord } from '../internal';
import { connectorNumber, type ConnectorObservation } from './hoyolab-map';

/**
 * Pure mapper from a SKPORT (GRYPHLINE) Arknights: Endfield card payload to a
 * game-neutral observation. Nothing here talks to the network: the caller
 * fetches `data` from `zonai.skport.com/api/v1/game/endfield/card/detail` and
 * hands it in, and this file only reads numbers out of it.
 *
 * Only fields that land on something Memoria tracks are read. The card also
 * carries a battle pass block (`bpSystem`), but no Endfield preset task counts
 * it, so it is left alone rather than guessed at.
 */

export type SkportPresetKey = 'endfield';

/** Epoch seconds or milliseconds, whichever the payload used, as milliseconds. */
function epochMs(raw: number): number {
  return raw > 1_000_000_000_000 ? raw : raw * 1000;
}

export function mapSkportEndfieldCard(raw: unknown, observedAt: number): ConnectorObservation {
  const out: ConnectorObservation = {
    presetKey: 'endfield',
    observedAt,
    provider: 'skport',
    energies: [],
    tasks: [],
    summary: [],
  };
  const root = objectRecord(raw);
  const detail = objectRecord(root?.detail) ?? root;
  if (!detail) return out;

  const dungeon = objectRecord(detail.dungeon);
  const value = connectorNumber(dungeon?.curStamina);
  if (value !== undefined) {
    const max = connectorNumber(dungeon?.maxStamina) ?? 0;
    const maxTs = connectorNumber(dungeon?.maxTs);
    const recoverySeconds =
      maxTs !== undefined && maxTs > 0 ? Math.max(0, Math.round(epochMs(maxTs) / 1000 - observedAt / 1000)) : undefined;
    out.energies.push({
      primary: true,
      resourceName: 'Sanity',
      value,
      ...(max > 0 ? { cap: max } : {}),
      ...(recoverySeconds !== undefined ? { recoverySeconds } : {}),
    });
    out.summary.push(max > 0 ? `Sanity ${value}/${max}` : `Sanity ${value}`);
  }

  const daily = objectRecord(detail.dailyMission);
  const cur = connectorNumber(daily?.dailyActivation);
  const top = connectorNumber(daily?.maxDailyActivation);
  if (cur !== undefined && top !== undefined && top > 0) {
    const done = cur >= top;
    out.tasks.push({ presetTaskKey: 'endfield-daily-activity', done });
    out.summary.push(`Daily Activity ${cur}/${top}${done ? ' (done)' : ''}`);
  }
  return out;
}

export type SkportErrorKind = 'ok' | 'auth' | 'rate-limit' | 'error';

/** What a SKPORT response `code` means for the player, in words they can act on. */
export function skportErrorGuidance(code: number): { kind: SkportErrorKind; message: string } {
  switch (code) {
    case 0:
      return { kind: 'ok', message: 'Read your live numbers.' };
    case 401:
    case 10001:
    case 10002:
      return {
        kind: 'auth',
        message: 'SKPORT no longer accepts this sign-in. Sign in again to keep reading your numbers.',
      };
    case 10000:
      return { kind: 'error', message: 'SKPORT rejected the request signature. Try again or sign in again.' };
    case 429:
    case 10101:
      return {
        kind: 'rate-limit',
        message: 'SKPORT is limiting how often this account can be read. Wait a while before trying again.',
      };
    default:
      return { kind: 'error', message: `SKPORT returned an error (code ${code}). Try again later.` };
  }
}
