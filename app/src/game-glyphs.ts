/**
 * Symbols a player can give a game's icon (Settings → Appearance → Game icons),
 * filled on a 24px grid with the even-odd rule. Generic shapes, chosen by the
 * player: none stands for a particular game.
 */
export const GAME_GLYPHS = {
  star: { name: 'Star', d: 'M12 2.6l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9Z' },
  sparkle: {
    name: 'Sparkle',
    d: 'M12 2c1.1 6 3.9 8.9 10 10-6.1 1.1-8.9 3.9-10 10-1.1-6.1-3.9-8.9-10-10 6.1-1.1 8.9-4 10-10Z',
  },
  moon: { name: 'Moon', d: 'M20.5 14.6A8.8 8.8 0 0 1 9.4 3.5a8.8 8.8 0 1 0 11.1 11.1Z' },
  bolt: { name: 'Bolt', d: 'M13.8 2 4.5 13.6h6.6L10 22l9.5-11.8h-6.7Z' },
  flame: {
    name: 'Flame',
    d: 'M12 2.2c.9 3.4 4.2 5.3 5.8 8.6A6.6 6.6 0 1 1 5.6 11.2c1 1.6 2.3 2.4 3.6 2.6-.7-4.4 1.2-8.4 2.8-11.6Z',
  },
  drop: { name: 'Drop', d: 'M12 2.6c3.8 4.8 6.8 8.5 6.8 12.1a6.8 6.8 0 1 1-13.6 0c0-3.6 3-7.3 6.8-12.1Z' },
  gem: { name: 'Gem', d: 'M7 3.5h10l4.5 5.8L12 21 2.5 9.3Zm-1.7 5.8h13.4L16 5.5H8Z' },
  crown: { name: 'Crown', d: 'M3 7.2l4.8 4.2L12 4.6l4.2 6.8L21 7.2l-1.9 11.3H4.9Z' },
  heart: {
    name: 'Heart',
    d: 'M12 20.8s-8.8-5.2-8.8-11.4A4.9 4.9 0 0 1 12 6.6a4.9 4.9 0 0 1 8.8 2.8c0 6.2-8.8 11.4-8.8 11.4Z',
  },
  shield: { name: 'Shield', d: 'M12 2.3 20.3 5.4v6.2c0 5.2-3.5 8.9-8.3 10.4-4.8-1.5-8.3-5.2-8.3-10.4V5.4Z' },
  sword: {
    name: 'Sword',
    d: 'M20.8 2.2 21.8 3.2 11.4 15.9l1.6 1.6-1.5 1.5-1.8-1.8-3 3 .4 1.5-1.4 1L2.3 19.3l1-1.4 1.5.4 3-3-1.8-1.8 1.5-1.5 1.6 1.6Z',
  },
  leaf: {
    name: 'Leaf',
    d: 'M20.8 3.2C11 3.2 3.8 7.8 3.8 15.5c0 1.6.4 3 1 4.1l1.7-1.7C8.2 13 12 9.9 16.2 8.3c-3.7 2.3-6.7 5.5-8.4 10.7 1.1.5 2.4.7 3.8.7 7.8 0 9.2-8.8 9.2-16.5Z',
  },
  music: {
    name: 'Note',
    d: 'M9.2 18.2a3.2 3.2 0 1 1-2.2-3V5.1L19 2.8v12.7a3.2 3.2 0 1 1-2.2-3V6.7L9.2 8.1Z',
  },
  spade: {
    name: 'Spade',
    d: 'M12 2.4S3.6 9.2 3.6 13.8a4.2 4.2 0 0 0 6.8 3.3L9.4 21.6h5.2l-1-4.5a4.2 4.2 0 0 0 6.8-3.3C20.4 9.2 12 2.4 12 2.4Z',
  },
  hexagon: { name: 'Hexagon', d: 'M12 2.2 20.5 7.1v9.8L12 21.8l-8.5-4.9V7.1Z' },
  target: {
    name: 'Target',
    d: 'M12 2.3a9.7 9.7 0 1 1 0 19.4 9.7 9.7 0 0 1 0-19.4Zm0 3.8a5.9 5.9 0 1 0 0 11.8 5.9 5.9 0 0 0 0-11.8Zm0 3.2a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4Z',
  },
  mountain: { name: 'Peak', d: 'M1.8 19.8 8.9 7.4l3.8 6.5 2.7-4.3 6.8 10.2Z' },
  wave: {
    name: 'Wave',
    d: 'M2 12.2c2.6 0 3.6-4.2 6.7-4.2s4.1 4.2 6.6 4.2 3.6-4.2 6.7-4.2v4.6c-2.6 0-3.6 4.2-6.7 4.2s-4.1-4.2-6.6-4.2-3.6 4.2-6.7 4.2Z',
  },
} as const;

export type GlyphId = keyof typeof GAME_GLYPHS;
export const GLYPH_IDS = Object.keys(GAME_GLYPHS) as GlyphId[];
export function isGlyphId(value: unknown): value is GlyphId {
  return typeof value === 'string' && value in GAME_GLYPHS;
}

/** How a game's icon is drawn. */
export type LogoStyle = 'coin' | 'badge' | 'monogram' | 'symbol';
export const LOGO_STYLES: readonly { id: LogoStyle; name: string; blurb: string }[] = [
  { id: 'coin', name: 'Coin', blurb: 'The ringed coin with the game’s name' },
  { id: 'badge', name: 'Badge', blurb: 'A soft-cornered tile in the game’s colours' },
  { id: 'monogram', name: 'Initial', blurb: 'The first letter on a disc' },
  { id: 'symbol', name: 'Symbol', blurb: 'A symbol you pick, on a disc' },
];
export function isLogoStyle(value: unknown): value is LogoStyle {
  return LOGO_STYLES.some((style) => style.id === value);
}
