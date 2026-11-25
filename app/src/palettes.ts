/**
 * Colour palettes a player can pick in Settings → General, the way an editor
 * offers colour themes. Each family has one or more dark flavours, one light
 * variant and a set of named accents. Light or dark still follows the Theme
 * setting.
 *
 * Memoria's own palette lives in index.css; picking it only re-points the
 * accent. Every other palette is written onto the root element as custom
 * properties, derived from a few base colours. The derivation lifts any colour
 * that would read below WCAG AA on the palette's own surfaces, so a pastel
 * accent on a cream ground still clears 4.5:1 as text (palettes.test.ts checks
 * every combination).
 */

import { contrast, legible, mix } from './game-color';

export type Theme = 'dark' | 'light';

/** The colours a variant names; the rest is derived. */
interface Variant {
  /** The page ground. */
  ground: string;
  /** Sheets and panels. Defaults to a step from the ground toward `raised`. */
  panel?: string;
  /** Hover, popovers and raised chrome. */
  raised: string;
  /** Wells: inputs, tracks, chip fills. Defaults to a step below the ground. */
  inset?: string;
  fg: string;
  /** Defaults to between `fg` and `muted`. */
  soft?: string;
  muted: string;
  /** Decorative strokes only. */
  faint: string;
  hues: {
    green: string;
    orange: string;
    red: string;
    pink: string;
    yellow: string;
    blue: string;
    violet: string;
    teal: string;
  };
  /** Accent id to colour. Ids match the family's `accents`. */
  accents: Record<string, string>;
}

export interface Flavour {
  /** The stored palette id. */
  id: string;
  name: string;
  dark: Variant;
}

export interface Family {
  id: string;
  name: string;
  flavours: Flavour[];
  lightName: string;
  light: Variant;
  /** In display order; `mono` (the text colour) is appended to every family. */
  accents: { id: string; name: string }[];
  defaultAccent: string;
}

export const MONO = 'mono';

const CATPPUCCIN_ACCENTS = [
  ['rosewater', 'Rosewater'],
  ['flamingo', 'Flamingo'],
  ['pink', 'Pink'],
  ['mauve', 'Mauve'],
  ['red', 'Red'],
  ['maroon', 'Maroon'],
  ['peach', 'Peach'],
  ['yellow', 'Yellow'],
  ['green', 'Green'],
  ['teal', 'Teal'],
  ['sky', 'Sky'],
  ['sapphire', 'Sapphire'],
  ['blue', 'Blue'],
  ['lavender', 'Lavender'],
] as const;

/** Catppuccin's fourteen accents, in its own order, from one row of hexes. */
function catppuccin(hexes: string): Record<string, string> {
  const list = hexes.split(' ');
  return Object.fromEntries(CATPPUCCIN_ACCENTS.map(([id], index) => [id, `#${list[index]}`]));
}

function catppuccinDark(
  [ground, mantle, surface0, text, subtext1, subtext0, overlay0]: string[],
  accents: Record<string, string>,
): Variant {
  return {
    ground: `#${ground}`,
    raised: `#${surface0}`,
    inset: `#${mantle}`,
    fg: `#${text}`,
    soft: `#${subtext1}`,
    muted: `#${subtext0}`,
    faint: `#${overlay0}`,
    hues: {
      green: accents.green!,
      orange: accents.peach!,
      red: accents.red!,
      pink: accents.pink!,
      yellow: accents.yellow!,
      blue: accents.blue!,
      violet: accents.mauve!,
      teal: accents.teal!,
    },
    accents,
  };
}

const mocha = catppuccin(
  'f5e0dc f2cdcd f5c2e7 cba6f7 f38ba8 eba0ac fab387 f9e2af a6e3a1 94e2d5 89dceb 74c7ec 89b4fa b4befe',
);
const macchiato = catppuccin(
  'f4dbd6 f0c6c6 f5bde6 c6a0f6 ed8796 ee99a0 f5a97f eed49f a6da95 8bd5ca 91d7e3 7dc4e4 8aadf4 b7bdf8',
);
const frappe = catppuccin(
  'f2d5cf eebebe f4b8e4 ca9ee6 e78284 ea999c ef9f76 e5c890 a6d189 81c8be 99d1db 85c1dc 8caaee babbf1',
);
const latte = catppuccin(
  'dc8a78 dd7878 ea76cb 8839ef d20f39 e64553 fe640b df8e1d 40a02b 179299 04a5e5 209fb5 1e66f5 7287fd',
);

const KANAGAWA_ACCENTS = [
  ['blue', 'Crystal blue'],
  ['violet', 'Oni violet'],
  ['pink', 'Sakura pink'],
  ['red', 'Wave red'],
  ['orange', 'Surimi orange'],
  ['yellow', 'Carp yellow'],
  ['green', 'Spring green'],
  ['aqua', 'Wave aqua'],
] as const;

function kanagawa(variant: Omit<Variant, 'hues' | 'accents'>, hexes: string): Variant {
  const [blue, violet, pink, red, orange, yellow, green, aqua] = hexes.split(' ').map((hex) => `#${hex}`) as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    ...variant,
    hues: { green, orange, red, pink, yellow, blue, violet, teal: aqua },
    accents: { blue, violet, pink, red, orange, yellow, green, aqua },
  };
}

function rosePine(
  variant: Omit<Variant, 'hues' | 'accents'>,
  { love, gold, rose, pine, foam, iris }: Record<'love' | 'gold' | 'rose' | 'pine' | 'foam' | 'iris', string>,
): Variant {
  return {
    ...variant,
    hues: { green: foam, orange: gold, red: love, pink: rose, yellow: gold, blue: pine, violet: iris, teal: foam },
    accents: { love, gold, rose, pine, foam, iris },
  };
}

const TOKYO_ACCENTS = [
  ['blue', 'Blue'],
  ['cyan', 'Cyan'],
  ['magenta', 'Magenta'],
  ['purple', 'Purple'],
  ['red', 'Red'],
  ['orange', 'Orange'],
  ['yellow', 'Yellow'],
  ['green', 'Green'],
  ['teal', 'Teal'],
] as const;

function tokyo(variant: Omit<Variant, 'hues' | 'accents'>, hexes: string): Variant {
  const accents = Object.fromEntries(
    hexes.split(' ').map((hex, index) => [TOKYO_ACCENTS[index]![0], `#${hex}`]),
  ) as Record<(typeof TOKYO_ACCENTS)[number][0], string>;
  return {
    ...variant,
    hues: {
      green: accents.green,
      orange: accents.orange,
      red: accents.red,
      pink: accents.magenta,
      yellow: accents.yellow,
      blue: accents.blue,
      violet: accents.purple,
      teal: accents.teal,
    },
    accents,
  };
}

const tokyoNight = 'c0caf5 a9b1d6 737aa2 565f89';
const tokyoDarkAccents = '7aa2f7 7dcfff bb9af7 9d7cd8 f7768e ff9e64 e0af68 9ece6a 73daca';
function tokyoDark(ground: string, inset: string, raised: string): Variant {
  const [fg, soft, muted, faint] = tokyoNight.split(' ').map((hex) => `#${hex}`) as [string, string, string, string];
  return tokyo({ ground, inset, raised, fg, soft, muted, faint }, tokyoDarkAccents);
}

/**
 * Memoria's own surfaces. Must match index.css, THEME_GROUND in ui-store.ts and
 * THEME_INSET/THEME_PANEL in theme.ts; palettes.test.ts checks.
 */
const MEMORIA_DARK = { ground: '#0c0d0f', panel: '#151619', raised: '#202126', inset: '#101114' };
const MEMORIA_LIGHT = { ground: '#f6f7f9', panel: '#ffffff', raised: '#f0f1f4', inset: '#edeef2' };

export const FAMILIES: Family[] = [
  {
    id: 'memoria',
    name: 'Memoria',
    flavours: [
      {
        id: 'memoria',
        name: 'Graphite',
        dark: {
          ...MEMORIA_DARK,
          fg: '#f4f4f6',
          soft: '#dcdce2',
          muted: '#9a9aa4',
          faint: '#63636d',
          hues: {
            green: '#46c795',
            orange: '#f0a83c',
            red: '#ff5a48',
            pink: '#ff6fa5',
            yellow: '#d9b871',
            blue: '#5b8def',
            violet: '#c084fc',
            teal: '#80f4ff',
          },
          accents: {
            blue: '#80c3ff',
            violet: '#b9a2ff',
            green: '#6fd6a8',
            amber: '#f0b45a',
            rose: '#ff8fb8',
          },
        },
      },
    ],
    lightName: 'Paper',
    light: {
      ...MEMORIA_LIGHT,
      fg: '#202127',
      soft: '#353740',
      muted: '#5b5e69',
      faint: '#938c7b',
      hues: {
        green: '#2c7a57',
        orange: '#8a5e0a',
        red: '#b8341f',
        pink: '#b03566',
        yellow: '#785b1a',
        blue: '#2f5bb0',
        violet: '#7b3fb5',
        teal: '#1c6b78',
      },
      accents: { blue: '#005bbf', violet: '#6a4bc4', green: '#1f7a55', amber: '#8a5e0a', rose: '#b03566' },
    },
    accents: [
      { id: 'blue', name: 'Blue' },
      { id: 'violet', name: 'Violet' },
      { id: 'green', name: 'Green' },
      { id: 'amber', name: 'Amber' },
      { id: 'rose', name: 'Rose' },
    ],
    defaultAccent: 'blue',
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    flavours: [
      {
        id: 'catppuccin-mocha',
        name: 'Mocha',
        dark: catppuccinDark('1e1e2e 181825 313244 cdd6f4 bac2de a6adc8 6c7086'.split(' '), mocha),
      },
      {
        id: 'catppuccin-macchiato',
        name: 'Macchiato',
        dark: catppuccinDark('24273a 1e2030 363a4f cad3f5 b8c0e0 a5adcb 6e738d'.split(' '), macchiato),
      },
      {
        id: 'catppuccin-frappe',
        name: 'Frappé',
        dark: catppuccinDark('303446 292c3c 414559 c6d0f5 b5bfe2 a5adce 737994'.split(' '), frappe),
      },
    ],
    lightName: 'Latte',
    light: {
      ground: '#eff1f5',
      panel: '#f7f8fa',
      raised: '#e6e9ef',
      inset: '#e6e9ef',
      fg: '#4c4f69',
      soft: '#5c5f77',
      muted: '#6c6f85',
      faint: '#9ca0b0',
      hues: {
        green: latte.green!,
        orange: latte.peach!,
        red: latte.red!,
        pink: latte.pink!,
        yellow: latte.yellow!,
        blue: latte.blue!,
        violet: latte.mauve!,
        teal: latte.teal!,
      },
      accents: latte,
    },
    accents: CATPPUCCIN_ACCENTS.map(([id, name]) => ({ id, name })),
    defaultAccent: 'mauve',
  },
  {
    id: 'kanagawa',
    name: 'Kanagawa',
    flavours: [
      {
        id: 'kanagawa-wave',
        name: 'Wave',
        dark: kanagawa(
          {
            ground: '#1f1f28',
            raised: '#2a2a37',
            inset: '#16161d',
            fg: '#dcd7ba',
            soft: '#c8c093',
            muted: '#9a988c',
            faint: '#54546d',
          },
          '7e9cd8 957fb8 d27e99 e46876 ffa066 e6c384 98bb6c 7aa89f',
        ),
      },
      {
        id: 'kanagawa-dragon',
        name: 'Dragon',
        dark: kanagawa(
          {
            ground: '#181616',
            raised: '#282727',
            inset: '#12120f',
            fg: '#c5c9c5',
            soft: '#a6a69c',
            muted: '#9e9b93',
            faint: '#625e5a',
          },
          '8ba4b0 8992a7 a292a3 c4746e b6927b c4b28a 87a987 8ea4a2',
        ),
      },
    ],
    lightName: 'Lotus',
    light: kanagawa(
      {
        ground: '#f2ecbc',
        panel: '#f6f1cc',
        raised: '#e5ddb0',
        inset: '#e7dba0',
        fg: '#545464',
        soft: '#43436c',
        muted: '#716e61',
        faint: '#8a8980',
      },
      '4d699b 624c83 b35b79 c84053 cc6d00 77713f 6f894e 597b75',
    ),
    accents: KANAGAWA_ACCENTS.map(([id, name]) => ({ id, name })),
    defaultAccent: 'blue',
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    flavours: [
      {
        id: 'rose-pine',
        name: 'Main',
        dark: rosePine(
          { ground: '#191724', panel: '#1f1d2e', raised: '#26233a', fg: '#e0def4', muted: '#908caa', faint: '#6e6a86' },
          { love: '#eb6f92', gold: '#f6c177', rose: '#ebbcba', pine: '#31748f', foam: '#9ccfd8', iris: '#c4a7e7' },
        ),
      },
      {
        id: 'rose-pine-moon',
        name: 'Moon',
        dark: rosePine(
          { ground: '#232136', panel: '#2a273f', raised: '#393552', fg: '#e0def4', muted: '#908caa', faint: '#6e6a86' },
          { love: '#eb6f92', gold: '#f6c177', rose: '#ea9a97', pine: '#3e8fb0', foam: '#9ccfd8', iris: '#c4a7e7' },
        ),
      },
    ],
    lightName: 'Dawn',
    light: rosePine(
      {
        ground: '#faf4ed',
        panel: '#fffaf3',
        raised: '#f2e9e1',
        inset: '#f2e9e1',
        fg: '#575279',
        muted: '#797593',
        faint: '#9893a5',
      },
      { love: '#b4637a', gold: '#ea9d34', rose: '#d7827e', pine: '#286983', foam: '#56949f', iris: '#907aa9' },
    ),
    accents: [
      { id: 'iris', name: 'Iris' },
      { id: 'foam', name: 'Foam' },
      { id: 'pine', name: 'Pine' },
      { id: 'rose', name: 'Rose' },
      { id: 'love', name: 'Love' },
      { id: 'gold', name: 'Gold' },
    ],
    defaultAccent: 'iris',
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    flavours: [
      {
        id: 'gruvbox',
        name: 'Medium',
        dark: {
          ground: '#282828',
          panel: '#32302f',
          raised: '#3c3836',
          inset: '#1d2021',
          fg: '#ebdbb2',
          soft: '#d5c4a1',
          muted: '#a89984',
          faint: '#665c54',
          hues: {
            green: '#b8bb26',
            orange: '#fe8019',
            red: '#fb4934',
            pink: '#d3869b',
            yellow: '#fabd2f',
            blue: '#83a598',
            violet: '#d3869b',
            teal: '#8ec07c',
          },
          accents: {
            yellow: '#fabd2f',
            orange: '#fe8019',
            red: '#fb4934',
            purple: '#d3869b',
            blue: '#83a598',
            aqua: '#8ec07c',
            green: '#b8bb26',
          },
        },
      },
    ],
    lightName: 'Light',
    light: {
      ground: '#fbf1c7',
      panel: '#f9f5d7',
      raised: '#ebdbb2',
      inset: '#f2e5bc',
      fg: '#3c3836',
      soft: '#504945',
      muted: '#7c6f64',
      faint: '#bdae93',
      hues: {
        green: '#79740e',
        orange: '#af3a03',
        red: '#9d0006',
        pink: '#8f3f71',
        yellow: '#b57614',
        blue: '#076678',
        violet: '#8f3f71',
        teal: '#427b58',
      },
      accents: {
        yellow: '#b57614',
        orange: '#af3a03',
        red: '#9d0006',
        purple: '#8f3f71',
        blue: '#076678',
        aqua: '#427b58',
        green: '#79740e',
      },
    },
    accents: [
      { id: 'yellow', name: 'Yellow' },
      { id: 'orange', name: 'Orange' },
      { id: 'red', name: 'Red' },
      { id: 'purple', name: 'Purple' },
      { id: 'blue', name: 'Blue' },
      { id: 'aqua', name: 'Aqua' },
      { id: 'green', name: 'Green' },
    ],
    defaultAccent: 'yellow',
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    flavours: [
      { id: 'tokyo-night', name: 'Night', dark: tokyoDark('#1a1b26', '#16161e', '#292e42') },
      { id: 'tokyo-night-storm', name: 'Storm', dark: tokyoDark('#24283b', '#1f2335', '#2f344d') },
    ],
    lightName: 'Day',
    light: tokyo(
      {
        ground: '#e1e2e7',
        panel: '#e9e9ed',
        raised: '#d0d5e3',
        inset: '#d0d5e3',
        fg: '#3760bf',
        soft: '#4a5a9a',
        muted: '#6172b0',
        faint: '#a8aecb',
      },
      '2e7de9 007197 9854f1 7847bd f52a65 b15c00 8c6c3e 587539 118c74',
    ),
    accents: TOKYO_ACCENTS.map(([id, name]) => ({ id, name })),
    defaultAccent: 'blue',
  },
];

export const DEFAULT_PALETTE = 'memoria';

/** The family and flavour a stored palette id names; Memoria for anything unknown. */
export function findPalette(id: string | null | undefined): { family: Family; flavour: Flavour } {
  for (const family of FAMILIES) {
    const flavour = family.flavours.find((candidate) => candidate.id === id);
    if (flavour) return { family, flavour };
  }
  return { family: FAMILIES[0]!, flavour: FAMILIES[0]!.flavours[0]! };
}

export function isPaletteId(id: unknown): id is string {
  return typeof id === 'string' && FAMILIES.some((family) => family.flavours.some((flavour) => flavour.id === id));
}

/** The accents offered for a family, with Mono (the text colour) last. */
export function accentChoices(family: Family): { id: string; name: string }[] {
  return [...family.accents, { id: MONO, name: 'Mono' }];
}

export function resolveAccent(family: Family, accent: string | null | undefined): string {
  return accentChoices(family).some((choice) => choice.id === accent) ? accent! : family.defaultAccent;
}

function variantOf(palette: string, theme: Theme): Variant {
  const { family, flavour } = findPalette(palette);
  return theme === 'dark' ? flavour.dark : family.light;
}

export interface Surfaces {
  ground: string;
  panel: string;
  raised: string;
  inset: string;
}

/** The hexes game colours are judged against. */
export function surfacesOf(palette: string, theme: Theme): Surfaces {
  const variant = variantOf(palette, theme);
  const toward = theme === 'dark' ? '#000000' : '#ffffff';
  return {
    ground: variant.ground,
    panel: variant.panel ?? mix(variant.raised, variant.ground, 0.4),
    raised: variant.raised,
    inset: variant.inset ?? mix(variant.ground, toward, 0.8),
  };
}

/** Lifts a colour until it reads at `minimum` on every given surface. */
function ink(color: string, grounds: string[], minimum = 4.5): string {
  let result = color;
  for (let pass = 0; pass < 3; pass += 1) for (const ground of grounds) result = legible(result, ground, minimum);
  return result;
}

/** The accent's raw colour, for a swatch. Mono is the text colour. */
export function accentSwatch(palette: string, theme: Theme, accent: string): string {
  const variant = variantOf(palette, theme);
  return accent === MONO ? variant.fg : (variant.accents[accent] ?? variant.fg);
}

function accentVars(palette: string, theme: Theme, accent: string): Record<string, string> {
  const { family } = findPalette(palette);
  const surfaces = surfacesOf(palette, theme);
  const grounds = [surfaces.ground, surfaces.panel, surfaces.raised];
  const swatch = accentSwatch(palette, theme, resolveAccent(family, accent));
  // One strength for marks and text: a primary button is filled with the accent
  // and carries text, so the fill must leave room for 4.5:1 on top of it.
  const mark = ink(swatch, grounds, 4.5);
  const text = mark;
  return {
    '--color-accent': mark,
    '--color-accent-2': mark,
    '--color-accent-fg': text,
    '--color-on-accent': contrast(mark, '#0a0a0b') >= contrast(mark, '#f4f4f6') ? '#0a0a0b' : '#f4f4f6',
    '--nav-ink': text,
    '--focus-ring-color': mark,
  };
}

/**
 * The custom properties to set on the root element for a palette, theme and
 * accent. Memoria's surfaces come from index.css, so for it only the accent is set.
 */
export function paletteVars(palette: string, theme: Theme, accent: string | null | undefined): Record<string, string> {
  const { family, flavour } = findPalette(palette);
  const resolved = resolveAccent(family, accent);
  if (family.id === 'memoria') return accentVars(flavour.id, theme, resolved);

  const variant = variantOf(flavour.id, theme);
  const surfaces = surfacesOf(flavour.id, theme);
  const { ground, panel, raised, inset } = surfaces;
  const grounds = [ground, panel, raised, inset];
  const dark = theme === 'dark';
  const text = (color: string) => ink(color, grounds);
  const line = (share: number) => mix(variant.fg, ground, share);
  const { hues } = variant;
  const red = text(hues.red);
  const orange = text(hues.orange);
  const dangerBg = mix(hues.red, ground, dark ? 0.14 : 0.1);
  const warnBg = mix(hues.orange, ground, dark ? 0.14 : 0.1);
  const muted = text(variant.muted);
  const soft = text(variant.soft ?? mix(variant.fg, variant.muted, 0.6));

  return {
    '--color-surface-0': ground,
    '--color-surface-1': panel,
    '--color-surface-2': raised,
    '--color-inset': inset,
    '--color-popover': dark ? raised : panel,
    '--panel-hi': panel,
    '--panel-lo': panel,
    '--color-fg': text(variant.fg),
    '--color-fg-soft': soft,
    '--color-muted': muted,
    '--color-dim': muted,
    '--color-faint': variant.faint,
    '--color-fg-invert': ground,
    '--color-ok': text(hues.green),
    '--color-ok-fg': text(hues.green),
    '--color-warn': orange,
    '--color-warn-fg': ink(orange, [...grounds, warnBg]),
    '--color-danger': red,
    '--color-danger-fg': ink(red, [...grounds, dangerBg]),
    '--color-later': muted,
    '--color-danger-bg': dangerBg,
    '--color-warn-bg': warnBg,
    '--color-gold': text(hues.yellow),
    '--color-rose': text(hues.pink),
    '--color-tag-event': text(hues.blue),
    '--color-tag-banner': text(hues.violet),
    '--color-tag-cycle': text(hues.green),
    '--color-tag-patch': muted,
    '--color-tag-maintenance': red,
    '--color-tag-daily': orange,
    '--color-tag-weekly': text(hues.teal),
    '--color-line-hairline': line(dark ? 0.07 : 0.08),
    '--color-line': line(dark ? 0.1 : 0.12),
    '--color-line-edge': line(dark ? 0.14 : 0.17),
    '--color-line-strong': line(dark ? 0.19 : 0.25),
    '--glass-bg': `color-mix(in srgb, ${raised} 82%, transparent)`,
    ...accentVars(flavour.id, theme, resolved),
  };
}

/** Every property `paletteVars` can set, so switching palettes clears the last one. */
export const PALETTE_PROPERTIES = Object.keys(paletteVars('catppuccin-mocha', 'dark', null));
