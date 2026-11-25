/**
 * Memoria Pro: what the Microsoft Store and Google Play releases will sell, set
 * out ahead of time so the gates exist before the billing does.
 *
 * Nothing is locked today. Every option works for everyone, and stays working,
 * until a store entitlement (Microsoft Store `StoreContext`, Google Play
 * Billing) is wired in behind `isLockedByStorePreview`. The one switch that
 * changes anything is Settings → Appearance → "Preview Store locks", which
 * shows a player which options would be Pro. It never takes a choice away.
 */

import { findPalette } from './palettes';
import type { LookId } from './looks';

export type FeatureTier = 'free' | 'pro';

export interface StoreFeatureMeta {
  /** A stable key, and the entitlement id the store SKU will carry. */
  id: string;
  /** Appearance items exist now; app features are planned. */
  kind: 'appearance' | 'app';
  status: 'preview' | 'planned';
  label: string;
  /** One line on what it covers. */
  blurb: string;
}

export const STORE_PRO_FEATURES: readonly StoreFeatureMeta[] = [
  {
    id: 'pro.logo-colours',
    kind: 'appearance',
    status: 'preview',
    label: 'Logo colours',
    blurb: 'Astral, Rose Gold, Amethyst, Jade, Crimson and Prism',
  },
  {
    id: 'pro.logo-shading',
    kind: 'appearance',
    status: 'preview',
    label: 'Logo shading',
    blurb: 'Sculpted relief, chiselled facets and celestial glow',
  },
  {
    id: 'pro.logo-tiles',
    kind: 'appearance',
    status: 'preview',
    label: 'Logo tiles',
    blurb: 'Surface glass and the gilded rim',
  },
  {
    id: 'pro.backdrops',
    kind: 'appearance',
    status: 'preview',
    label: 'App backdrops',
    blurb: 'Celestial Dust, Void Nebula, Drafting Matrix and Gilded Horizon',
  },
  {
    id: 'pro.looks',
    kind: 'appearance',
    status: 'preview',
    label: 'Looks',
    blurb: 'Soft HUD, Glass, Arcade and Neon',
  },
  {
    id: 'pro.palettes',
    kind: 'appearance',
    status: 'preview',
    label: 'Palettes',
    blurb: 'Kanagawa, Rosé Pine and Tokyo Night',
  },
  {
    id: 'pro.background-schedules',
    kind: 'app',
    status: 'planned',
    label: 'Background schedules',
    blurb: 'Resin and check-in reminders kept on schedule while the app is closed',
  },
  {
    id: 'pro.archive',
    kind: 'app',
    status: 'planned',
    label: 'Snapshots and archives',
    blurb: 'Multi-account snapshots and encrypted archive export',
  },
  {
    id: 'pro.card-themes',
    kind: 'app',
    status: 'planned',
    label: 'Card themes',
    blurb: 'Your own colours and finishes for game cards',
  },
];

const PRO_LOOKS: ReadonlySet<LookId> = new Set<LookId>(['hud', 'glass', 'arcade', 'neon']);
/** By palette family: every flavour of a family shares its tier. */
const PRO_PALETTE_FAMILIES: ReadonlySet<string> = new Set(['kanagawa', 'rose-pine', 'tokyo-night']);

/** Classic (the default), Instrument, Clean and Paper are free. */
export const tierForLook = (lookId: LookId): FeatureTier => (PRO_LOOKS.has(lookId) ? 'pro' : 'free');

/** Memoria (the default), Catppuccin and Gruvbox are free; an unknown id falls back to Memoria's tier. */
export const tierForPalette = (paletteId: string): FeatureTier =>
  PRO_PALETTE_FAMILIES.has(findPalette(paletteId).family.id) ? 'pro' : 'free';

/** Locked only while the player previews the store tiers. Off, nothing is ever locked. */
export const isLockedByStorePreview = (tier: FeatureTier, previewStoreLocks: boolean): boolean =>
  tier === 'pro' && previewStoreLocks;

export const STORE_PRO_BADGE = 'Pro';
export const STORE_PRO_HINT =
  'Included with Memoria Pro when Microsoft Store & Google Play tiers launch — turn off "Preview Store locks" below to keep trying it now.';
