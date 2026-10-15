import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGame } from '../../shared/test/helpers';
import { GameLogo, logoKey, logoLines, logoRing } from '../src/components/GameLogo';
import { LOGO_ART } from '../src/game-logo-art';
import { useUI } from '../src/ui-store';

const genshin = makeGame({ id: 'eu', name: 'Genshin Impact', short: 'Genshin', presetKey: 'genshin' });
const custom = makeGame({ id: 'mine', name: 'My Custom Game', short: 'MCG', color: '#112233', color2: '#445566' });

const coins = (container: HTMLElement) => [...container.querySelectorAll('.game-logo-coin')];

type Move = { node: Element; frames: Keyframe[]; options: KeyframeAnimationOptions };
let moves: Move[] = [];
const movesOf = (node: Element) => moves.filter((move) => move.node === node);

beforeEach(() => {
  useUI.setState({ logoFlipped: {} });
  moves = [];
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
      moves.push({ node: this, frames, options });
    }),
  });
  // The shared setup reports reduced motion for any unrecognised query; these tests want motion allowed.
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({ matches: false }) as MediaQueryList);
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, 'animate');
});

describe('logoLines', () => {
  it('breaks after a colon, else after the first word', () => {
    expect(logoLines('Honkai: Star Rail')).toEqual(['Honkai:', 'Star Rail']);
    expect(logoLines('Genshin Impact')).toEqual(['Genshin', 'Impact']);
    expect(logoLines('Zenless Zone Zero')).toEqual(['Zenless', 'Zone Zero']);
    expect(logoLines('Neverness to Everness')).toEqual(['Neverness', 'To Everness']);
    expect(logoLines('  Wuthering Waves ')).toEqual(['Wuthering', 'Waves']);
  });

  it('keeps a single word, or a name that ends in a colon, on one line', () => {
    expect(logoLines('Nikke')).toEqual(['Nikke']);
    expect(logoLines('Honkai:')).toEqual(['Honkai:']);
  });
});

describe('logoRing', () => {
  it("uses a preset's logo colours", () => {
    expect(logoRing(genshin)).toEqual(['#e8c77a', '#2f4078']);
  });

  it("uses a custom game's own accents, with a pale partner when it has one colour", () => {
    expect(logoRing(custom)).toEqual(['#112233', '#445566']);
    expect(logoRing({ color: '#112233' })).toEqual(['#112233', '#f2f4f6']);
  });
});

describe('logoKey', () => {
  it('is the preset for a preset game, so every account of it turns together', () => {
    expect(logoKey(genshin)).toBe('genshin');
    expect(logoKey(makeGame({ id: 'asia', name: 'Genshin Impact', presetKey: 'genshin' }))).toBe('genshin');
  });

  it("is a custom game's own id", () => {
    expect(logoKey(custom)).toBe('mine');
  });
});

describe('GameLogo', () => {
  it('draws the ring in the two colours at the asked size', () => {
    const { container } = render(<GameLogo game={genshin} size={64} />);
    const logo = container.querySelector<HTMLElement>('[data-game-logo]')!;
    expect(logo).toHaveStyle({ width: '64px', height: '64px' });
    const fills = [...container.querySelectorAll('.game-logo-ring path')].map((path) => path.getAttribute('fill'));
    expect(fills).toEqual(['#e8c77a', '#2f4078']);
  });

  it("carries a preset's outlined full name on the front and short name on the back", () => {
    const { container } = render(<GameLogo game={genshin} />);
    expect(container.querySelector('.game-logo-front path')).toHaveAttribute('d', LOGO_ART.genshin!.front);
    expect(container.querySelector('.game-logo-back path')).toHaveAttribute('d', LOGO_ART.genshin!.back);
  });

  it('sets a custom game in text: two lines in front, its short name behind', () => {
    const { container } = render(<GameLogo game={custom} />);
    const front = [...container.querySelectorAll('.game-logo-front .game-logo-name > span')];
    expect(front.map((line) => line.textContent)).toEqual(['My', 'Custom Game']);
    expect(container.querySelector('.game-logo-back .game-logo-name')).toHaveTextContent('MCG');
  });

  it('shows the full name until it is flipped, and is decorative unless it can be', () => {
    const { container } = render(<GameLogo game={genshin} />);
    expect(coins(container)[0]).not.toHaveAttribute('data-flipped');
    expect(container.querySelector('[data-game-logo]')).toHaveAttribute('aria-hidden');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('flips every logo of that game, wherever it is drawn, and remembers it', () => {
    const { container } = render(
      <>
        <GameLogo game={genshin} flippable />
        <GameLogo game={genshin} size={40} />
        <GameLogo game={makeGame({ id: 'asia', name: 'Genshin Impact', presetKey: 'genshin' })} />
        <GameLogo game={custom} />
      </>,
    );
    const flip = screen.getByRole('button', { name: 'Flip the Genshin Impact logo to its short name' });
    expect(flip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(flip);
    expect(coins(container).map((coin) => coin.hasAttribute('data-flipped'))).toEqual([true, true, true, false]);
    // Each one is tossed to its back; a logo that was already showing that side would not be.
    expect(coins(container).map((coin) => movesOf(coin).length > 0)).toEqual([true, true, true, false]);
    expect(useUI.getState().logoFlipped).toEqual({ genshin: true });
    expect(screen.getByRole('button', { name: 'Flip the Genshin Impact logo to its full name' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('comes up already flipped, without a toss, when the flip was made earlier', () => {
    useUI.setState({ logoFlipped: { genshin: true } });
    const { container } = render(<GameLogo game={genshin} />);
    expect(coins(container)[0]).toHaveAttribute('data-flipped');
    expect(moves).toEqual([]);
  });

  it('flips back to the full name', () => {
    useUI.setState({ logoFlipped: { genshin: true } });
    const { container } = render(<GameLogo game={genshin} flippable />);
    fireEvent.click(screen.getByRole('button'));
    expect(coins(container)[0]).not.toHaveAttribute('data-flipped');
    expect(movesOf(coins(container)[0]!)).not.toEqual([]);
    expect(useUI.getState().logoFlipped).toEqual({});
  });

  // A toss is added to the coin's resting turn: 0deg in front, 180deg behind.
  it.each([
    ['front', 'back', 0, 180],
    ['back', 'front', 180, 0],
  ])('tosses from the %s, two and a half turns, onto the %s', (_from, _to, wasResting, nowResting) => {
    useUI.setState({ logoFlipped: wasResting === 180 ? { genshin: true } : {} });
    const { container } = render(<GameLogo game={genshin} flippable />);
    fireEvent.click(screen.getByRole('button'));
    const [turn, leap] = movesOf(coins(container)[0]!);
    const degrees = (frame: Keyframe) => Number(/rotateY\((-?\d+)deg\)/.exec(String(frame.transform))![1]);
    const start = degrees(turn!.frames[0]!);
    const end = degrees(turn!.frames.at(-1)!);
    const side = (turned: number) => (((nowResting + turned) % 360) + 360) % 360;
    expect(side(start)).toBe(wasResting);
    expect(side(end)).toBe(nowResting);
    expect(end - start).toBe(900);
    expect(turn!.options.composite).toBe('add');
    expect([leap!.frames[0]!.transform, leap!.frames.at(-1)!.transform]).toEqual(['scale(1)', 'scale(1)']);
  });

  it('hurries the ring round by whole turns, so it carries on from where it would have been', () => {
    const { container } = render(<GameLogo game={genshin} flippable />);
    fireEvent.click(screen.getByRole('button'));
    const [hurry] = movesOf(container.querySelector('.game-logo-ring')!);
    expect(hurry!.frames).toEqual([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }]);
    expect(hurry!.options.composite).toBe('add');
  });

  it('just changes side when the reader prefers reduced motion', () => {
    vi.mocked(window.matchMedia).mockImplementation(() => ({ matches: true }) as MediaQueryList);
    const { container } = render(<GameLogo game={genshin} flippable />);
    fireEvent.click(screen.getByRole('button'));
    expect(coins(container)[0]).toHaveAttribute('data-flipped');
    expect(moves).toEqual([]);
  });
});
