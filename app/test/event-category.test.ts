import { describe, expect, it } from 'vitest';
import { emptyState } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';
import { eventCategory } from '../src/event-category';
import { seedBundledEvents } from '../src/store';
import { eventFingerprint } from '../src/data/seed-events';

describe('Genshin world classification', () => {
  const game = makeGame({ presetKey: 'genshin' });
  const seeded = seedBundledEvents({ ...emptyState(), games: [game] }, Date.parse('2026-08-01T00:00:00Z'));
  const mw = seeded.events.find((event) => event.sourceKey === 'seed:genshin:7.0-event-ode')!;

  it('classifies old owner-edited MW rows without replacing their notes', () => {
    const legacy = { ...mw, category: undefined, notes: 'My reward plan' };
    expect(eventCategory(game, legacy)).toBe('miliastra');
    expect(eventCategory(game, { ...legacy, category: 'teyvat' })).toBe('teyvat');
    expect(eventCategory(game, { ...legacy, type: 'maintenance' })).toBe('shared');
    expect(eventCategory(makeGame({ presetKey: 'hsr' }), legacy)).toBeUndefined();
  });

  it('adopts category on pristine older rows, preserves manual order and later owner changes', () => {
    const legacy = { ...mw, category: undefined, sort: 7 };
    legacy.seedHash = eventFingerprint(legacy);
    const before = { ...seeded, events: [legacy] };
    const adopted = seedBundledEvents(before, Date.parse('2026-09-17T00:00:00Z')).events.find(
      (event) => event.id === mw.id,
    )!;
    expect(adopted.category).toBe('miliastra');
    expect(adopted.sort).toBe(7);
    const edited = { ...adopted, category: 'teyvat' as const, notes: 'Keep my classification' };
    const after = seedBundledEvents({ ...before, events: [edited] }, Date.parse('2026-09-17T00:00:00Z'));
    expect(after.events.find((event) => event.id === edited.id)).toEqual(edited);
  });
});
