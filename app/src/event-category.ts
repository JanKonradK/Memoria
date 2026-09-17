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
