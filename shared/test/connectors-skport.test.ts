import { describe, expect, it } from 'vitest';
import { applyConnectorObservation, mapSkportEndfieldCard, skportErrorGuidance } from '../src/connectors';
import * as shared from '../src';
import { completionId } from '../src/checklist';
import { projectEnergy } from '../src/energy';
import { taskPeriodKey } from '../src/periods';
import { makeGame, makeResource, makeState, makeTask, utc } from './helpers';

const AT = utc('2026-11-21T12:00:00');
const AT_SECS = AT / 1000;

describe('mapSkportEndfieldCard', () => {
  const detail = {
    dungeon: { curStamina: 200, maxStamina: 360, maxTs: AT_SECS + 69_020 },
    dailyMission: { dailyActivation: 60, maxDailyActivation: 100 },
    bpSystem: { curLevel: 12, maxLevel: 60 },
  };

  it('reads Sanity and Daily Activity from a data.detail payload', () => {
    const obs = mapSkportEndfieldCard({ detail }, AT);
    expect(obs).toEqual({
      presetKey: 'endfield',
      observedAt: AT,
      provider: 'skport',
      energies: [{ primary: true, resourceName: 'Sanity', value: 200, cap: 360, recoverySeconds: 69_020 }],
      tasks: [{ presetTaskKey: 'endfield-daily-activity', done: false }],
      summary: ['Sanity 200/360', 'Daily Activity 60/100'],
    });
  });

  it('reads the same numbers from a flat payload and numeric strings', () => {
    const flat = mapSkportEndfieldCard(detail, AT);
    expect(flat.energies).toEqual(mapSkportEndfieldCard({ detail }, AT).energies);
    const strings = mapSkportEndfieldCard(
      {
        dungeon: { curStamina: '200', maxStamina: '360', maxTs: String(AT_SECS + 69_020) },
        dailyMission: { dailyActivation: '100', maxDailyActivation: '100' },
      },
      AT,
    );
    expect(strings.energies[0]).toEqual({
      primary: true,
      resourceName: 'Sanity',
      value: 200,
      cap: 360,
      recoverySeconds: 69_020,
    });
    expect(strings.tasks).toEqual([{ presetTaskKey: 'endfield-daily-activity', done: true }]);
    expect(strings.summary).toContain('Daily Activity 100/100 (done)');
  });

  it('accepts maxTs in seconds or milliseconds and never goes negative', () => {
    const secs = mapSkportEndfieldCard({ dungeon: { curStamina: 10, maxStamina: 360, maxTs: AT_SECS + 600 } }, AT);
    const ms = mapSkportEndfieldCard({ dungeon: { curStamina: 10, maxStamina: 360, maxTs: AT + 600_000 } }, AT);
    expect(secs.energies[0]!.recoverySeconds).toBe(600);
    expect(ms.energies[0]!.recoverySeconds).toBe(600);
    const past = mapSkportEndfieldCard({ dungeon: { curStamina: 360, maxStamina: 360, maxTs: AT_SECS - 50 } }, AT);
    expect(past.energies[0]!.recoverySeconds).toBe(0);
    const none = mapSkportEndfieldCard({ dungeon: { curStamina: 360, maxStamina: 360, maxTs: 0 } }, AT);
    expect(none.energies[0]).not.toHaveProperty('recoverySeconds');
  });

  it('leaves out a missing cap and a Daily Activity without a maximum', () => {
    const obs = mapSkportEndfieldCard(
      { dungeon: { curStamina: 42 }, dailyMission: { dailyActivation: 40, maxDailyActivation: 0 } },
      AT,
    );
    expect(obs.energies).toEqual([{ primary: true, resourceName: 'Sanity', value: 42 }]);
    expect(obs.summary).toEqual(['Sanity 42']);
    expect(obs.tasks).toEqual([]);
  });

  it('returns an empty observation for empty or invalid input', () => {
    for (const raw of [null, undefined, 'nope', 7, [], {}, { detail: null }, { dungeon: { curStamina: 'lots' } }]) {
      const obs = mapSkportEndfieldCard(raw, AT);
      expect(obs.energies).toEqual([]);
      expect(obs.tasks).toEqual([]);
      expect(obs.summary).toEqual([]);
      expect(obs.provider).toBe('skport');
    }
  });

  it('is exported from the package root', () => {
    expect(shared.mapSkportEndfieldCard).toBe(mapSkportEndfieldCard);
    expect(shared.skportErrorGuidance).toBe(skportErrorGuidance);
  });
});

describe('applyConnectorObservation with a SKPORT reading', () => {
  const game = makeGame({ id: 'g1', presetKey: 'endfield', tz: 'Etc/GMT+5' });
  const sanity = makeResource({ id: 'sanity', name: 'Sanity', cap: 300, regenMinutes: 7.2, kind: 'regen' });
  const daily = makeTask({ id: 'daily', presetTaskKey: 'endfield-daily-activity', mode: 'check' });
  const base = makeState({ games: [game], resources: [sanity], tasks: [daily] });
  let n = 0;
  const makeId = () => `id${++n}`;

  it('writes a backdated Sanity snapshot, adopts the cap and ticks Daily Activity', () => {
    // 200/360 with 69,020 s to full: 160 points × 432 s = 69,120 s, so 100 s into the current point.
    const obs = mapSkportEndfieldCard(
      {
        detail: {
          dungeon: { curStamina: 200, maxStamina: 360, maxTs: AT_SECS + 69_020 },
          dailyMission: { dailyActivation: 100, maxDailyActivation: 100 },
        },
      },
      AT,
    );
    const result = applyConnectorObservation(base, 'g1', obs, AT + 5, 'batch', makeId);
    expect(result.applied).toBe(2);
    expect(result.state.resources.find((r) => r.id === 'sanity')!.cap).toBe(360);
    const snap = result.state.snapshots.find((s) => s.resourceId === 'sanity')!;
    expect(snap.value).toBe(200);
    expect(snap.takenAt).toBe(AT - 100_000);
    expect(snap.provenance).toEqual({
      kind: 'account',
      provider: 'skport',
      observedAt: AT,
      importedAt: AT + 5,
      batchId: 'batch',
    });
    const updated = result.state.resources.find((r) => r.id === 'sanity')!;
    expect(projectEnergy(updated, snap, AT).fullAt).toBe(AT + 69_020_000);

    const id = completionId('daily', taskPeriodKey(game, daily, AT));
    const row = result.state.completions.find((c) => c.id === id)!;
    expect(row.done).toBe(true);
    expect(row.provenance?.provider).toBe('skport');
  });

  it('leaves Daily Activity alone while it is still open', () => {
    const obs = mapSkportEndfieldCard({ dailyMission: { dailyActivation: 30, maxDailyActivation: 100 } }, AT);
    const result = applyConnectorObservation(base, 'g1', obs, AT, 'b2', makeId);
    expect(result.applied).toBe(0);
    expect(result.state).toBe(base);
  });
});

describe('skportErrorGuidance', () => {
  it('maps known codes to what the player should do', () => {
    expect(skportErrorGuidance(0).kind).toBe('ok');
    for (const code of [10001, 10002, 401]) {
      expect(skportErrorGuidance(code)).toEqual({
        kind: 'auth',
        message: 'SKPORT no longer accepts this sign-in. Sign in again to keep reading your numbers.',
      });
    }
    expect(skportErrorGuidance(10000)).toEqual({
      kind: 'error',
      message: 'SKPORT rejected the request signature. Try again or sign in again.',
    });
    for (const code of [10101, 429]) {
      expect(skportErrorGuidance(code)).toEqual({
        kind: 'rate-limit',
        message: 'SKPORT is limiting how often this account can be read. Wait a while before trying again.',
      });
    }
    expect(skportErrorGuidance(-1)).toEqual({
      kind: 'error',
      message: 'SKPORT returned an error (code -1). Try again later.',
    });
  });
});
