/** The place icons' sets (drawn in nav-icons.tsx), kept apart so the UI store can read them without a cycle. */
export type IconSet = 'outline' | 'solid' | 'colour' | 'tiles' | 'minimal' | 'pixel';

export const ICON_SETS: readonly { id: IconSet; name: string; blurb: string }[] = [
  { id: 'outline', name: 'Outline', blurb: 'Fine lines' },
  { id: 'solid', name: 'Solid', blurb: 'Filled shapes' },
  { id: 'colour', name: 'Colour', blurb: 'Lines over a colour fill' },
  { id: 'tiles', name: 'Tiles', blurb: 'Each place on its own coloured tile' },
  { id: 'minimal', name: 'Minimal', blurb: 'Abstract marks: dots, lines, sliders' },
  { id: 'pixel', name: 'Pixel', blurb: 'Eight-bit pixel art' },
];
export const DEFAULT_ICON_SET: IconSet = 'outline';
export function isIconSet(value: unknown): value is IconSet {
  return ICON_SETS.some((set) => set.id === value);
}
