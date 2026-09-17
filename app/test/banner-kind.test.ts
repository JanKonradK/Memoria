import { describe, expect, it } from 'vitest';
import { emptyState, safeParseAppState, type BannerKind } from '@memoria/shared';
import { makeEvent, makeGame, makeState } from '../../shared/test/helpers';
import { eventBannerKind } from '../src/event-category';
import { eventFingerprint, SEED_EVENTS } from '../src/data/seed-events';
import { seedBundledEvents } from '../src/store';

describe('banner classification', () => {
  it('classifies old source rows, honors overrides, and avoids guessing from names', () => {
    const legacy = makeEvent({ type: 'banner', sourceKey: 'genshin:21808', name: 'My renamed banner' });
    expect(eventBannerKind(legacy)).toBe('weapon');
    expect(eventBannerKind({ ...legacy, bannerKind: 'character' })).toBe('character');
    expect(eventBannerKind({ ...legacy, bannerKind: 'other' })).toBe('other');
    expect(eventBannerKind({ ...legacy, type: 'event' })).toBeUndefined();
    expect(eventBannerKind({ ...legacy, sourceKey: undefined })).toBeUndefined();
    expect(eventBannerKind({ ...legacy, sourceKey: 'seed:nikke:2026-09-17-sugar' })).toBeUndefined();
  });

  it('keeps support scouts and memories distinct from weapons', () => {
    const kind = (sourceKey: string) => eventBannerKind(makeEvent({ type: 'banner', sourceKey }));
    expect(kind('seed:uma:scout-2026-09-15')).toBe('character');
    expect(kind('seed:uma:scout-2026-09-15:supports')).toBe('support');
    expect(kind('seed:lads:where-silverwings-rest-2026-09')).toBe('memory');
    expect(kind('seed:nte:1.3-voyager')).toBe('weapon');
    expect(kind('seed:hsr:4.5-p2-lc')).toBe('weapon');
    expect(kind('seed:zzz:3.2-p1-engines')).toBe('weapon');
    expect(kind('seed:wuwa:3.6-p2-weapons')).toBe('weapon');
    expect(kind('seed:endfield:1.5-tag-artist')).toBe('weapon');
    expect(
      SEED_EVENTS.filter((event) => event.type === 'banner' && !event.bannerKind).map((event) => event.sourceKey),
    ).toEqual(['seed:nikke:phantom-saint-thief-costume', 'seed:nikke:2026-09-17-sugar']);
  });

  it('updates pristine legacy seeds but preserves manual classifications and positions', () => {
    const at = Date.parse('2026-09-17T00:00:00Z');
    const game = makeGame({ presetKey: 'genshin' });
    const seeded = seedBundledEvents({ ...emptyState(), games: [game] }, at);
    const weapon = seeded.events.find((event) => event.sourceKey === 'genshin:21808')!;
    expect(weapon.bannerKind).toBe('weapon');
    const legacy = { ...weapon, bannerKind: undefined, sort: 11 };
    legacy.seedHash = eventFingerprint(legacy);
    const adopted = seedBundledEvents({ ...seeded, events: [legacy] }, at).events.find(
      (event) => event.id === weapon.id,
    )!;
    expect(adopted).toMatchObject({ bannerKind: 'weapon', sort: 11 });
    const edited = { ...adopted, bannerKind: 'support' as const };
    const after = seedBundledEvents({ ...seeded, events: [edited] }, at);
    expect(after.events.find((event) => event.id === weapon.id)).toEqual(edited);
  });

  it('preserves the optional classification through backup validation', () => {
    for (const bannerKind of [undefined, 'character', 'weapon', 'support', 'memory', 'other'] as const) {
      const parsed = safeParseAppState(makeState({ events: [makeEvent({ type: 'banner', bannerKind })] }));
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.events[0]!.bannerKind).toBe(bannerKind);
    }
    expect(safeParseAppState(makeState({ events: [makeEvent({ bannerKind: 'invalid' as BannerKind })] })).success).toBe(
      false,
    );
  });
});
