import type { EnergyProjection, Game, Resource } from '@void/shared';
import { describe, expect, it } from 'vitest';
import { conduitVisual } from '../src/components/nexus/conduit-visual';

const NOW = 1_000_000;

const resource: Resource = {
  id: 'energy',
  gameId: 'game',
  name: 'Energy',
  cap: 200,
  regenMinutes: 8,
  reserveCap: 0,
  sort: 0,
  kind: 'regen',
  updatedAt: NOW,
};

const game: Game = {
  id: 'game',
  name: 'Game',
  short: 'GG',
  color: '#7c5cff',
  color2: '#d946ef',
  icon: '',
  platform: 'both',
  tz: 'UTC',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort: 0,
  updatedAt: NOW,
};

function projection(precise: number, hasSnapshot = true): EnergyProjection {
  return {
    value: Math.floor(precise),
    precise,
    isFull: precise >= resource.cap,
    fullAt: precise >= resource.cap ? null : NOW + 60_000,
    msToFull: precise >= resource.cap ? 0 : 60_000,
    overflow: 0,
    hasSnapshot,
    reserve: null,
  };
}

describe('conduitVisual', () => {
  it.each([
    [0, 0],
    [50, 0.25],
    [200, 1],
  ])('maps %s of 200 energy to a %s fill fraction', (precise, fill) => {
    expect(conduitVisual(resource, projection(precise), game, NOW).fill).toBe(fill);
  });

  it('marks a full resource capped with a danger-shifted static tone', () => {
    expect(conduitVisual(resource, projection(240), game, NOW)).toMatchObject({
      fill: 1,
      state: 'capped',
      core: 'var(--color-rose)',
      tone: 'var(--danger)',
    });
  });

  it('marks a snapshotted resource paused when its game is paused', () => {
    expect(conduitVisual(resource, projection(80), { ...game, paused: true }, NOW).state).toBe('paused');
  });

  it('marks a resource unknown when it has no snapshot', () => {
    expect(conduitVisual(resource, projection(0, false), game, NOW).state).toBe('unknown');
  });

  it('marks a game unknown when it has no primary regen resource', () => {
    expect(conduitVisual(undefined, undefined, game, NOW).state).toBe('unknown');
  });

  it('maps an ordinary regen interval to pulse period', () => {
    expect(conduitVisual(resource, projection(80), game, NOW).flowMs).toBe(2_000);
  });

  it('clamps very fast regeneration to a 1200ms flow period', () => {
    expect(conduitVisual({ ...resource, regenMinutes: 1 }, projection(80), game, NOW).flowMs).toBe(1_200);
  });

  it('clamps very slow regeneration to a 4000ms flow period', () => {
    expect(conduitVisual({ ...resource, regenMinutes: 60 }, projection(80), game, NOW).flowMs).toBe(4_000);
  });
});
