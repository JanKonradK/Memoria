import { render } from '@testing-library/react';
import type { Game } from '@memoria/shared';
import { describe, expect, it } from 'vitest';
import { GameLogo, logoLines, logoRing } from '../src/components/GameLogo';
import { RING_A, RING_B } from '../src/game-logo-ring';

type LogoGame = Pick<Game, 'name' | 'short' | 'presetKey' | 'color' | 'color2' | 'color3' | 'titleFont'>;

const logoGame = (overrides: Partial<LogoGame> = {}): LogoGame => ({
  name: 'Custom Game',
  short: 'CG',
  color: '#112233',
  ...overrides,
});

describe('logoLines', () => {
  it('breaks a colon name after the colon', () => {
    expect(logoLines('Honkai: Star Rail')).toEqual(['Honkai:', 'Star Rail']);
  });

  it('breaks other names after the first word', () => {
    expect(logoLines('Genshin Impact')).toEqual(['Genshin', 'Impact']);
    expect(logoLines('Zenless Zone Zero')).toEqual(['Zenless', 'Zone Zero']);
    expect(logoLines('Neverness to Everness')).toEqual(['Neverness', 'To Everness']);
  });

  it('keeps a single word on one line', () => {
    expect(logoLines('  Lads  ')).toEqual(['Lads']);
  });
});

describe('logoRing', () => {
  it('uses the preset pair for a preset game, ahead of its own colours', () => {
    expect(logoRing(logoGame({ presetKey: 'genshin', color: '#000000', color2: '#ffffff' }))).toEqual([
      '#e8c77a',
      '#2f4078',
    ]);
  });

  it('uses color and color2 for a custom game that has both', () => {
    expect(logoRing(logoGame({ color2: '#222222' }))).toEqual(['#112233', '#222222']);
  });

  it('falls back to color3, then the default ground, for a custom game', () => {
    expect(logoRing(logoGame({ color3: '#333333' }))).toEqual(['#112233', '#333333']);
    expect(logoRing(logoGame())).toEqual(['#112233', '#f2f4f6']);
  });
});

describe('GameLogo', () => {
  it('draws the two ring paths in the ring colours', () => {
    const { container } = render(<GameLogo game={logoGame({ presetKey: 'hsr', name: 'Honkai: Star Rail' })} />);
    const paths = container.querySelectorAll('svg.game-logo-ring path');
    expect(paths).toHaveLength(2);
    expect(paths[0]).toHaveAttribute('d', RING_A);
    expect(paths[0]).toHaveAttribute('fill', '#5aa9ff');
    expect(paths[1]).toHaveAttribute('d', RING_B);
    expect(paths[1]).toHaveAttribute('fill', '#ff8fc0');
  });

  it('sets the two-line name by default', () => {
    const { container } = render(<GameLogo game={logoGame({ name: 'Honkai: Star Rail', short: 'HSR' })} />);
    const lines = Array.from(container.querySelectorAll('.game-logo-name > span.block'), (line) => line.textContent);
    expect(lines).toEqual(['Honkai:', 'Star Rail']);
  });

  it('sets the short name for the short label', () => {
    const { container } = render(
      <GameLogo game={logoGame({ name: 'Honkai: Star Rail', short: 'HSR' })} label="short" />,
    );
    expect(container.querySelector('.game-logo-name')?.textContent).toBe('HSR');
    expect(container.querySelectorAll('.game-logo-name .block')).toHaveLength(0);
  });

  it('sets width and height from size, and is hidden from assistive tech', () => {
    const { container } = render(<GameLogo game={logoGame()} size={72} />);
    const root = container.querySelector('[data-game-logo]');
    expect(root).toHaveStyle({ width: '72px', height: '72px' });
    expect(root).toHaveAttribute('aria-hidden', 'true');
  });
});
