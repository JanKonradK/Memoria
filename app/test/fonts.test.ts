import { describe, expect, it } from 'vitest';
import { PRESETS } from '@memoria/shared';
import { FONT_OPTIONS, titleFontOption, titleStyle } from '../src/fonts';

describe('title faces', () => {
  it('ships the face every preset game is set in', () => {
    for (const preset of PRESETS) expect(FONT_OPTIONS.map((font) => font.css)).toContain(preset.titleFont);
  });

  it('draws a game stored on a retired face in the face its logo uses now, and the picker says so', () => {
    expect(titleStyle("'Cinzel', serif").fontFamily).toBe("'Cinzel Decorative', serif");
    expect(titleStyle("'Rajdhani', sans-serif").fontFamily).toBe("'Bungee', sans-serif");
    expect(titleStyle("'Exo 2', sans-serif").fontFamily).toBe("'Vujahday Script', 'DM Sans', sans-serif");
    expect(titleFontOption("'Saira', sans-serif")).toBe("'Share Tech Mono', monospace");
  });

  it('keeps a shipped face, and leaves a face it has never heard of alone', () => {
    expect(titleStyle("'Cinzel Decorative', serif")).toMatchObject({
      fontFamily: "'Cinzel Decorative', serif",
      fontWeight: 700,
    });
    expect(titleFontOption("'Comic Neue', cursive")).toBe("'Comic Neue', cursive");
    expect(titleFontOption(undefined)).toBe('');
  });
});
