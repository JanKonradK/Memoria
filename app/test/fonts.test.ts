import { describe, expect, it } from 'vitest';
import { PRESETS } from '@technogg/shared';
import { titleFontFor } from '../src/fonts';

describe('titleFontFor', () => {
  const genshin = PRESETS.find((p) => p.key === 'genshin')!;

  it('prefers an explicitly stored titleFont', () => {
    expect(titleFontFor({ titleFont: "'Michroma', sans-serif", name: 'Genshin Impact', short: 'GI' })).toBe(
      "'Michroma', sans-serif",
    );
  });

  it('falls back to the preset font by exact name for pre-titleFont games', () => {
    expect(titleFontFor({ titleFont: undefined, name: 'Genshin Impact', short: 'XX' })).toBe(genshin.titleFont);
  });

  it('falls back to the preset font by short code, case-insensitively', () => {
    expect(titleFontFor({ titleFont: undefined, name: 'My Renamed Game', short: 'gi' })).toBe(genshin.titleFont);
  });

  it('returns undefined when nothing matches', () => {
    expect(titleFontFor({ titleFont: undefined, name: 'Unknown Game', short: '??' })).toBeUndefined();
  });
});
