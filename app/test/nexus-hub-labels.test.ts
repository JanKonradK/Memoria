import type { Game } from '@memoria/shared';
import { describe, expect, it } from 'vitest';
import { decideTicketDisambiguation } from '../src/components/nexus/NexusHub';
import { gameIdentityKey } from '../src/game-color';

const NOW = Date.UTC(2026, 7, 5, 12);

function game(id: string, overrides: Partial<Game> = {}): Game {
  return {
    id,
    name: 'Genshin Impact',
    presetKey: 'genshin',
    accountLabel: 'Main',
    short: 'GI',
    color: '#c9a55c',
    icon: '',
    platform: 'both',
    tz: 'Etc/GMT-1',
    dailyResetHour: 4,
    weeklyResetDay: 1,
    monthlyResetDay: 1,
    paused: false,
    sort: 0,
    updatedAt: NOW,
    ...overrides,
  };
}

function decisions(visibleIds: string[], roster: Game[]) {
  return decideTicketDisambiguation(visibleIds, new Map(roster.map((item) => [item.id, item])), NOW);
}

describe('decideTicketDisambiguation', () => {
  it('keeps the badge bare when no visible account conflicts', () => {
    const eu = game('genshin-eu');
    const hiddenNa = game('genshin-na', { tz: 'Etc/GMT+5' });
    const starRail = game('star-rail', { name: 'Honkai: Star Rail', presetKey: 'star-rail', short: 'HSR' });

    expect(decisions([eu.id, eu.id, starRail.id], [eu, hiddenNa, starRail])).toEqual(new Map());
  });

  it('adds server tags for the same game on two visible servers', () => {
    const eu = game('genshin-eu');
    const na = game('genshin-na', { tz: 'Etc/GMT+5' });
    const result = decisions([eu.id, na.id], [eu, na]);

    expect(result.get(eu.id)).toEqual({ serverLabel: 'EU' });
    expect(result.get(na.id)).toEqual({ serverLabel: 'NA' });
  });

  it('matches a legacy Genshin account to a preset-keyed account', () => {
    const eu = game('genshin-eu', { presetKey: undefined, short: 'GI' });
    const na = game('genshin-na', { presetKey: 'genshin', tz: 'Etc/GMT+5' });
    const result = decisions([eu.id, na.id], [eu, na]);

    expect(gameIdentityKey(eu)).toBe('preset:genshin');
    expect(gameIdentityKey(eu)).toBe(gameIdentityKey(na));
    expect(result.get(eu.id)?.serverLabel).toBe('EU');
    expect(result.get(na.id)?.serverLabel).toBe('NA');
  });

  it('adds label prefixes for two visible accounts on one server', () => {
    const main = game('genshin-main', { accountLabel: 'Main' });
    const alt = game('genshin-alt', { accountLabel: 'Alternate' });
    const result = decisions([main.id, alt.id], [main, alt]);

    expect(result.get(main.id)).toEqual({ serverLabel: 'EU', accountTag: 'Mai', accountDescription: 'Main account' });
    expect(result.get(alt.id)).toEqual({
      serverLabel: 'EU',
      accountTag: 'Alt',
      accountDescription: 'Alternate account',
    });
  });

  it('stacks same-server account prefixes on top of the server conflict', () => {
    const euMain = game('genshin-eu-main', { accountLabel: 'Main' });
    const euAlt = game('genshin-eu-alt', { accountLabel: 'Alternate' });
    const na = game('genshin-na', { accountLabel: 'America', tz: 'Etc/GMT+5' });
    const result = decisions([euMain.id, euAlt.id, na.id], [euMain, euAlt, na]);

    expect(result.get(euMain.id)).toEqual({
      serverLabel: 'EU',
      accountTag: 'Mai',
      accountDescription: 'Main account',
    });
    expect(result.get(euAlt.id)).toEqual({
      serverLabel: 'EU',
      accountTag: 'Alt',
      accountDescription: 'Alternate account',
    });
    expect(result.get(na.id)).toEqual({ serverLabel: 'NA' });
  });

  it('gives unlabelled same-server accounts stable honest numbers', () => {
    const first = game('genshin-a', { accountLabel: undefined });
    const second = game('genshin-b', { accountLabel: undefined });
    const result = decisions([second.id, first.id], [first, second]);

    expect(result.get(first.id)).toEqual({
      serverLabel: 'EU',
      accountTag: '#1',
      accountDescription: 'unlabelled account 1',
    });
    expect(result.get(second.id)).toEqual({
      serverLabel: 'EU',
      accountTag: '#2',
      accountDescription: 'unlabelled account 2',
    });
  });

  it('falls back to the normalized game name when no preset key exists', () => {
    const eu = game('custom-eu', { name: 'Custom Game', presetKey: undefined });
    const na = game('custom-na', { name: ' custom game ', presetKey: undefined, tz: 'Etc/GMT+5' });
    const result = decisions([eu.id, na.id], [eu, na]);

    expect(result.get(eu.id)?.serverLabel).toBe('EU');
    expect(result.get(na.id)?.serverLabel).toBe('NA');
  });
});
