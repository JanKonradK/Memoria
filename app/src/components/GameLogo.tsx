import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Game } from '@memoria/shared';
import { titleStyle } from '../fonts';
import { LOGO_ART } from '../game-logo-art';
import { RING_A, RING_B } from '../game-logo-ring';
import { useUI } from '../ui-store';
import '../game-logo.css';

type LogoGame = Pick<Game, 'name' | 'short' | 'color' | 'color2' | 'color3' | 'titleFont'> &
  Partial<Pick<Game, 'id' | 'presetKey'>>;

/** Ring colours per preset, as [colour of RING_A, colour of RING_B] in docs/logos. */
const PRESET_RINGS = new Map<string, [string, string]>([
  ['genshin', ['#e8c77a', '#2f4078']],
  ['hsr', ['#5aa9ff', '#ff8fc0']],
  ['zzz', ['#f07e0f', '#f2f4f6']],
  ['wuwa', ['#d3dae0', '#27396f']],
  ['nte', ['#3b7cff', '#ffde40']],
  ['lads', ['#78b9dd', '#f4f7fb']],
  ['uma', ['#f05a8a', '#23b6a7']],
  ['nikke', ['#e31b2d', '#f2f2f4']],
  ['endfield', ['#f0b900', '#f2f2f0']],
]);

/** The coin sits inside the ring: its disc in the artwork's 1024 box, and that disc as a share of the logo. */
const COIN_BOX = '116 116 792 792';
const COIN_SHARE = 792 / 1024;

/** The two ring colours for a game: its preset's pair, else its own accents. */
export function logoRing(game: Pick<LogoGame, 'presetKey' | 'color' | 'color2' | 'color3'>): [string, string] {
  const preset = game.presetKey ? PRESET_RINGS.get(game.presetKey) : undefined;
  return preset ?? [game.color, game.color2 ?? game.color3 ?? '#f2f4f6'];
}

/**
 * Breaks a game name over the two lines of its logo: after the first colon when
 * there is one, otherwise after the first word.
 */
export function logoLines(name: string): [string] | [string, string] {
  const text = name.trim();
  const colon = text.indexOf(':');
  if (colon !== -1) {
    const head = text.slice(0, colon + 1);
    const rest = text.slice(colon + 1).trim();
    return rest === '' ? [head] : [head, rest];
  }
  const [first = '', ...others] = text.split(/\s+/);
  if (others.length === 0) return [first];
  const rest = others.join(' ');
  return [first, rest.charAt(0).toUpperCase() + rest.slice(1)];
}

/**
 * What a flip is remembered against. Every account of one preset game is the
 * same coin, so they turn together wherever that game is drawn.
 */
export function logoKey(game: Pick<LogoGame, 'presetKey' | 'id' | 'name'>): string {
  return game.presetKey ?? game.id ?? game.name;
}

/**
 * A name set in the game's face for a coin with no artwork (a custom game).
 * Faces differ too much in width to size a name by its letter count, so it is
 * set at the largest size that suits the coin and scaled down to the room inside.
 */
function FaceText({
  lines,
  font,
  room,
  size,
}: {
  lines: string[];
  font: string | undefined;
  room: number;
  size: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState(1);
  const text = lines.join(' ');
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let live = true;
    const measure = () => {
      if (live && node.offsetWidth > 0) setFit(Math.min(1, room / node.offsetWidth));
    };
    measure();
    // The first measure can land before the game's face has loaded.
    void document.fonts?.ready.then(measure);
    return () => {
      live = false;
    };
  }, [room, text, font, size]);
  const style: CSSProperties = {
    ...titleStyle(font),
    paddingInline: 0,
    fontSize: size,
    lineHeight: 1.05,
    textAlign: 'center',
    whiteSpace: 'nowrap',
    transform: `scale(${fit})`,
  };
  return (
    <span ref={ref} className="game-logo-name" style={style}>
      {lines.map((line, index) => (
        <span key={index} className="block">
          {line}
        </span>
      ))}
    </span>
  );
}

/**
 * The round game logo: a two-colour ring that turns slowly around a coin. The
 * coin's front carries the game's full name and its back the short one; a flip
 * is remembered and shown everywhere that game's logo appears.
 *
 * Decorative unless `flippable`, where it is the button that turns the coin.
 * Rows and other buttons draw it plain, since a button cannot hold a button.
 */
export function GameLogo({
  game,
  size = 56,
  flippable = false,
  className = '',
}: {
  game: LogoGame;
  /** Rendered diameter in CSS pixels. */
  size?: number;
  /** Lets this logo be pressed to turn the coin. */
  flippable?: boolean;
  className?: string;
}) {
  const key = logoKey(game);
  const flipped = useUI((ui) => Boolean(ui.logoFlipped[key]));
  const flipLogo = useUI((ui) => ui.flipLogo);
  // Which way the coin is spinning to reach its side. Null at rest, and on first render.
  const [side, setSide] = useState(flipped);
  const [spin, setSpin] = useState<'back' | 'front' | null>(null);
  if (side !== flipped) {
    setSide(flipped);
    setSpin(flipped ? 'back' : 'front');
  }

  const [ringA, ringB] = logoRing(game);
  const art = game.presetKey ? LOGO_ART[game.presetKey] : undefined;
  const coin = size * COIN_SHARE;
  const face = (which: 'front' | 'back') => (
    <span className={`game-logo-face game-logo-${which}`}>
      {art ? (
        <svg viewBox={COIN_BOX} className="game-logo-art">
          <path d={art[which]} fill="currentColor" />
        </svg>
      ) : (
        <FaceText
          lines={which === 'front' ? logoLines(game.name) : [game.short]}
          font={game.titleFont}
          room={coin * 0.82}
          size={coin * (which === 'front' ? 0.24 : 0.34)}
        />
      )}
    </span>
  );
  const body = (
    <>
      <svg viewBox="0 0 1024 1024" className="game-logo-ring">
        <path d={RING_A} fill={ringA} />
        <path d={RING_B} fill={ringB} />
      </svg>
      <span
        className="game-logo-coin"
        data-flipped={flipped || undefined}
        data-spin={spin ?? undefined}
        onAnimationEnd={() => setSpin(null)}
      >
        {face('front')}
        {face('back')}
      </span>
    </>
  );
  const style = { width: size, height: size, '--logo-size': `${size}px` } as CSSProperties;

  if (!flippable)
    return (
      <span data-game-logo className={`game-logo ${className}`} style={style} aria-hidden>
        {body}
      </span>
    );
  return (
    <button
      type="button"
      data-game-logo
      className={`game-logo game-logo-button ${className}`}
      style={style}
      aria-pressed={flipped}
      aria-label={`Flip the ${game.name} logo to its ${flipped ? 'full' : 'short'} name`}
      onClick={() => flipLogo(key)}
    >
      {body}
    </button>
  );
}
