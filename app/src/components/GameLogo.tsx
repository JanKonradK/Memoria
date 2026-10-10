import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Game } from '@memoria/shared';
import { titleStyle } from '../fonts';
import { RING_A, RING_B } from '../game-logo-ring';
import '../game-logo.css';

type LogoGame = Pick<Game, 'name' | 'short' | 'presetKey' | 'color' | 'color2' | 'color3' | 'titleFont'>;

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

/** The two ring colours for a game: its preset's pair, else its own accents. */
export function logoRing(game: Pick<Game, 'presetKey' | 'color' | 'color2' | 'color3'>): [string, string] {
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
 * The round game logo: a two-colour ring that turns slowly, with the name
 * inside it. Decorative, so the caller always writes the game's name beside it.
 */
export function GameLogo({
  game,
  size = 56,
  label = 'full',
  className = '',
}: {
  game: LogoGame;
  /** Rendered diameter in CSS pixels. */
  size?: number;
  /** 'full' sets the two-line name; 'short' sets game.short, for sizes too small to read a name. */
  label?: 'full' | 'short';
  className?: string;
}) {
  const [ringA, ringB] = logoRing(game);
  const lines: string[] = label === 'full' ? logoLines(game.name) : [game.short];
  const text = lines.join(' ');
  // Faces differ too much in width to size a name by its letter count. Set it at
  // the largest size that suits the ring, then scale it down to the room inside.
  const nameRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const node = nameRef.current;
    if (!node) return;
    let live = true;
    const measure = () => {
      if (live && node.offsetWidth > 0) setFit(Math.min(1, (size * 0.66) / node.offsetWidth));
    };
    measure();
    // The first measure can land before the game's face has loaded.
    void document.fonts?.ready.then(measure);
    return () => {
      live = false;
    };
  }, [size, text, game.titleFont]);
  const nameStyle: CSSProperties = {
    ...titleStyle(game.titleFont),
    paddingInline: 0,
    fontSize: size * (label === 'full' ? 0.2 : 0.28),
    lineHeight: 1.05,
    color: 'var(--color-fg)',
    textAlign: 'center',
    whiteSpace: 'nowrap',
    transform: `scale(${fit})`,
  };

  return (
    <span data-game-logo className={`game-logo ${className}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 1024 1024" className="game-logo-ring">
        <path d={RING_A} fill={ringA} />
        <path d={RING_B} fill={ringB} />
      </svg>
      <span ref={nameRef} className="game-logo-name" style={nameStyle}>
        {label === 'full'
          ? lines.map((line, index) => (
              <span key={index} className="block">
                {line}
              </span>
            ))
          : game.short}
      </span>
    </span>
  );
}
