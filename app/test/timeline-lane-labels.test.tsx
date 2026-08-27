import { render, screen } from '@testing-library/react';
import { emptyState, type Game } from '@memoria/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { TimelinePage } from '../src/components/Timeline';
import { useApp } from '../src/store';

const baseGame: Game = {
  id: 'genshin-eu',
  name: 'Genshin Impact',
  short: 'Genshin',
  color: '#f8efdb',
  icon: '',
  platform: 'both',
  tz: 'Etc/GMT-1',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort: 0,
  updatedAt: 1,
};

afterEach(() => useApp.setState({ state: emptyState() }));

describe('Timeline lane identity', () => {
  it('disambiguates same-name games by server and account', () => {
    const games: Game[] = [
      { ...baseGame, accountLabel: 'Main EU' },
      { ...baseGame, id: 'genshin-na', tz: 'Etc/GMT+5', accountLabel: 'Alt NA', sort: 1 },
    ];
    useApp.setState({ state: { ...emptyState(), games } });

    render(<TimelinePage now={Date.UTC(2026, 7, 5, 12)} />);

    expect(screen.getByRole('button', { name: 'Expand Genshin Impact, EU, Main EU lane' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand Genshin Impact, NA, Alt NA lane' })).toBeInTheDocument();
  });
});
