import { presetForGame, type BannerKind, type Game, type GameEvent } from '@memoria/shared';
import { SEED_EVENTS } from './data/seed-feed';

export const EVENT_CATEGORY_LABELS = {
  teyvat: 'Teyvat',
  miliastra: 'Miliastra Wonderland',
  shared: 'Game-wide',
} as const;
const seedCategories = new Map(
  SEED_EVENTS.filter((event) => event.category).map((event) => [event.sourceKey, event.category]),
);
const seedBannerKinds = new Map(
  SEED_EVENTS.filter((event) => event.bannerKind).map((event) => [event.sourceKey, event.bannerKind]),
);

/**
 * What each game calls the world its events happen in, for the heading of its
 * event list. Checked against each publisher's own pages (5 November 2026).
 * Genshin splits into Teyvat and Miliastra Wonderland below instead.
 */
export const WORLD_LABELS: Record<string, string> = {
  hsr: 'The Galaxy',
  zzz: 'New Eridu',
  wuwa: 'Solaris-3',
  nte: 'Hethereau',
  endfield: 'Talos-II',
  lads: 'Linkon City',
  nikke: 'The Ark',
  uma: 'Tracen Academy',
};

/** Source keys classify legacy rows without guessing from user-written names. */
export function eventBannerKind(event: GameEvent): BannerKind | undefined {
  if (event.type !== 'banner') return undefined;
  return event.bannerKind ?? (event.sourceKey ? seedBannerKinds.get(event.sourceKey) : undefined);
}

/** A source fallback classifies older owner-edited rows without rewriting them. */
export function eventCategory(game: Game | undefined, event: GameEvent): 'teyvat' | 'miliastra' | 'shared' | undefined {
  if (!game || presetForGame(game)?.key !== 'genshin') return undefined;
  if (event.type === 'maintenance' || event.type === 'livestream') return 'shared';
  return event.category ?? (event.sourceKey ? seedCategories.get(event.sourceKey) : undefined) ?? 'teyvat';
}

/** Card and editor sections share the same world order and banner classification. */
export function groupGameEvents(
  game: Game,
  events: GameEvent[],
): { key: string; label: string; events: GameEvent[] }[] {
  const preset = presetForGame(game)?.key;
  if (preset !== 'genshin') return [{ key: 'events', label: (preset && WORLD_LABELS[preset]) || 'Events', events }];
  return [
    {
      key: 'teyvat',
      label: 'Teyvat',
      events: events.filter((event) => event.type !== 'banner' && eventCategory(game, event) !== 'miliastra'),
    },
    {
      key: 'miliastra',
      label: 'Miliastra Wonderland',
      events: events.filter((event) => event.type !== 'banner' && eventCategory(game, event) === 'miliastra'),
    },
    { key: 'banners', label: 'Banners', events: events.filter((event) => event.type === 'banner') },
  ].filter((group) => group.events.length > 0);
}
