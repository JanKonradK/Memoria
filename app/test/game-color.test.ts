import { describe, expect, it } from 'vitest';
import { PRESETS } from '@memoria/shared';
import { assignGameInks, contrast, gameTitleInk, mix, resolveGameIdentityColors } from '../src/game-color';
import { THEME_GROUND, THEME_PANEL } from '../src/theme';

/**
 * A title is the largest piece of identity on a card, so these are the colours
 * a user reads the app by. The rule under test is that a game's own palette is
 * preferred over a derived one: lifting is what happens when the owner gave us
 * nothing that works, not the first thing we try.
 */

const DARK = THEME_GROUND.dark;
const LIGHT = THEME_GROUND.light;
/** Titles sit on a panel, not on the page. Check the harder surface too. */
const DARK_PANEL = THEME_PANEL.dark[0];
const LIGHT_PANEL = THEME_PANEL.light[1];

describe('gameTitleInk', () => {
  it('keeps a colour the owner supplied when that colour already reads', () => {
    const game = { color: '#3b7cff' }; // Neverness to Everness: clears both grounds
    expect(gameTitleInk(game, DARK)).toBe('#3b7cff');
    expect(gameTitleInk(game, LIGHT)).toBe('#3b7cff');
  });

  it('steps to the secondary rather than muddying a pale primary', () => {
    // Wuthering Waves. The pale primary is jewelry on charcoal and invisible on
    // cream; the navy secondary is the member that was always right for light.
    // Lifting the primary instead produced a grey belonging to no game.
    const wuwa = { color: '#d3dae0', color2: '#27396f', color3: '#27396f' };
    expect(gameTitleInk(wuwa, DARK)).toBe('#d3dae0');
    expect(gameTitleInk(wuwa, LIGHT)).toBe('#27396f');
  });

  it('still lifts when no member of the trio reads', () => {
    // Honkai: Star Rail is pink over blue — both too light for cream.
    const hsr = { color: '#ff8fc0', color2: '#5aa9ff', color3: '#ff8fc0' };
    const ink = gameTitleInk(hsr, LIGHT);
    expect(ink).not.toBe('#ff8fc0');
    expect(contrast(ink, LIGHT)).toBeGreaterThanOrEqual(3);
    // Lifted, not bleached: the result is still recognisably a pink.
    expect(ink).not.toBe(mix('#ff8fc0', '#000000', 0));
    const [r, , b] = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(b!);
  });

  it('gives every preset a readable title on every surface it can land on', () => {
    // The page ground is not the whole story — a card title sits on the panel
    // gradient, which is the lower-contrast case in both themes.
    for (const preset of PRESETS) {
      for (const ground of [DARK, LIGHT, DARK_PANEL, LIGHT_PANEL]) {
        const ink = gameTitleInk(preset, ground);
        expect(contrast(ink, ground), `${preset.name} on ${ground} → ${ink}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('assignGameInks', () => {
  const palette = { color: '#ff0000', color2: '#00ff00', color3: '#0000ff' };

  it('gives two accounts of one preset the same ink', () => {
    const inks = assignGameInks(
      [
        { id: 'genshin-eu', name: 'Genshin Europe', presetKey: 'genshin', ...palette },
        { id: 'genshin-us', name: 'Genshin America', presetKey: 'genshin', ...palette },
      ],
      DARK,
    );

    expect(inks['genshin-eu']).toBe(inks['genshin-us']);
  });

  it('steps genuinely different games apart', () => {
    const inks = assignGameInks(
      [
        { id: 'first', name: 'First', presetKey: 'first', ...palette },
        { id: 'second', name: 'Second', presetKey: 'second', ...palette },
      ],
      DARK,
    );

    expect(inks.first).toBe('#ff0000');
    expect(inks.second).toBe('#00ff00');
  });

  it('uses the normalized name when a custom game has no preset', () => {
    const inks = assignGameInks(
      [
        { id: 'custom-main', name: 'Custom Game', ...palette },
        { id: 'custom-alt', name: ' custom game ', ...palette },
      ],
      DARK,
    );

    expect(inks['custom-main']).toBe(inks['custom-alt']);
  });
});

describe('resolveGameIdentityColors', () => {
  it("uses the preset-matching account's trio for every account of that game", () => {
    const genshin = PRESETS.find((preset) => preset.key === 'genshin')!;
    const games = [
      {
        id: 'genshin-eu',
        name: 'Genshin Impact',
        short: 'GI-EU',
        presetKey: 'genshin',
        sort: 2,
        color: genshin.color,
        color2: genshin.color2,
        color3: genshin.color3,
      },
      {
        id: 'genshin-na',
        name: 'Genshin Impact',
        short: 'GI-NA',
        presetKey: 'genshin',
        sort: 0,
        color: '#123456',
        color2: '#654321',
        color3: '#abcdef',
      },
      {
        id: 'genshin-asia',
        name: 'Genshin Impact',
        short: 'GI-AS',
        presetKey: 'genshin',
        sort: 1,
        color: '#112233',
        color2: '#445566',
        color3: '#778899',
      },
    ];

    const resolved = resolveGameIdentityColors(games);
    const presetTrio = { color: genshin.color, color2: genshin.color2, color3: genshin.color3 };

    expect(resolved['genshin-eu']).toEqual(presetTrio);
    expect(resolved['genshin-na']).toEqual(presetTrio);
    expect(resolved['genshin-asia']).toEqual(presetTrio);
  });
});
