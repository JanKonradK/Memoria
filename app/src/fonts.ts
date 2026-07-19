/**
 * Title fonts bundled with the app (@fontsource imports live in main.tsx).
 * Each game carries its own personality — the value is a CSS font-family
 * stored on Game.titleFont and editable per game in the game editor.
 */
export const FONT_OPTIONS: Array<{ label: string; css: string }> = [
  { label: 'Marcellus — fantasy serif', css: "'Marcellus', serif" },
  { label: 'Rajdhani — sci-fi condensed', css: "'Rajdhani', sans-serif" },
  { label: 'Archivo Black — heavy urban', css: "'Archivo Black', sans-serif" },
  { label: 'Michroma — wide tech', css: "'Michroma', sans-serif" },
  { label: 'Baloo 2 — playful rounded', css: "'Baloo 2', sans-serif" },
];
