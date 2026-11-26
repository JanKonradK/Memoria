import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { Game } from '@memoria/shared';
import { prefersReducedMotion } from '../flip';
import { titleStyle } from '../fonts';
import { contrast } from '../game-color';
import { LOGO_ART } from '../game-logo-art';
import { RING_A, RING_B } from '../game-logo-ring';
import { logoRing } from '../game-logo-colors';
import { useUI } from '../ui-store';
import { GAME_GLYPHS, type GlyphId, type LogoStyle } from '../game-glyphs';
import '../game-logo.css';

type LogoGame = Pick<Game, 'name' | 'short' | 'color' | 'color2' | 'color3' | 'titleFont'> &
  Partial<Pick<Game, 'id' | 'presetKey'>>;

/** The coin sits inside the ring: its disc in the artwork's 1024 box, and that disc as a share of the logo. */
const COIN_BOX = '116 116 792 792';
const COIN_SHARE = 792 / 1024;

/** Near-black or white, whichever reads better on a coin filled with `fill`. */
function inkOn(fill: string): string {
  return contrast(fill, '#0b0b0d') >= contrast(fill, '#ffffff') ? '#0b0b0d' : '#ffffff';
}

/**
 * The full names on large coins' fronts: a third of the logo artwork, kept off
 * the startup path because a list draws only small coins. Fetched the first
 * time a large preset coin is drawn; until then its front shows the short name.
 */
let fronts: Record<string, string> | null = null;
let frontsRequested = false;
const frontsListeners = new Set<() => void>();
function requestFronts() {
  if (frontsRequested) return;
  frontsRequested = true;
  void import('../game-logo-fronts')
    .then((module) => {
      fronts = module.LOGO_FRONTS;
      frontsListeners.forEach((listener) => listener());
    })
    .catch(() => {
      frontsRequested = false;
    });
}
function useLogoFronts(wanted: boolean): Record<string, string> | null {
  useEffect(() => {
    if (wanted) requestFronts();
  }, [wanted]);
  return useSyncExternalStore(
    (listener) => {
      frontsListeners.add(listener);
      return () => frontsListeners.delete(listener);
    },
    () => fronts,
  );
}

const TOSS_MS = 800;
/** Each coin's leap toward you, while it is in the air. */
const leaps = new WeakMap<Element, Animation>();

/**
 * Tosses the coin onto the side it now rests on: it leaps toward you, turns two
 * and a half times and lands, while the ring hurries one extra turn round.
 *
 * Every move is added on top of what is already there (the coin's resting turn,
 * a toss still in the air) and ends a whole number of
 * turns from where it began. So nothing jumps when a toss starts or lands, the
 * ring settles back exactly where it was, and a coin flipped
 * again in the air turns on from where it is.
 */
function toss(coin: HTMLElement | null, ring: SVGSVGElement | null, toBack: boolean) {
  // jsdom has no Web Animations API; there the coin simply changes side.
  if (!coin || typeof coin.animate !== 'function' || prefersReducedMotion()) return;
  // The resting turn has just moved half a turn, so the toss starts half a turn back.
  const from = toBack ? -180 : 180;
  coin.animate([{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${from + 900}deg)` }], {
    duration: TOSS_MS,
    easing: 'cubic-bezier(0.2, 0.65, 0.3, 1)',
    composite: 'add',
  });
  // A coin already in the air turns on but does not leap again: two leaps
  // would multiply and carry it out past the ring.
  if (leaps.get(coin)?.playState !== 'running')
    leaps.set(
      coin,
      coin.animate(
        [
          { transform: 'scale(1)', easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' },
          { transform: 'scale(1.28)', offset: 0.38, easing: 'cubic-bezier(0.5, 0, 0.7, 0.4)' },
          { transform: 'scale(0.97)', offset: 0.8, easing: 'ease-out' },
          { transform: 'scale(1)' },
        ],
        { duration: TOSS_MS, composite: 'add' },
      ),
    );
  if (typeof ring?.animate !== 'function') return;
  // Eased at both ends, so the ring gathers speed and settles back where it rests.
  ring.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
    duration: TOSS_MS,
    easing: 'cubic-bezier(0.45, 0, 0.25, 1)',
    composite: 'add',
  });
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
      {/* Drawn letters, not text: the name is already beside the coin (or in the
          flip button's label), so it must not be read or matched a second time. */}
      {lines.map((line, index) => (
        <span key={index} className="game-logo-line block" data-line={line} />
      ))}
    </span>
  );
}

/**
 * The round game logo: a two-colour ring around a coin. The
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
  variant,
  glyph: glyphOverride,
}: {
  game: LogoGame;
  /** Rendered diameter in CSS pixels. */
  size?: number;
  /** Lets this logo be pressed to turn the coin. */
  flippable?: boolean;
  className?: string;
  /** Draws this style whatever the player chose (Settings' previews). */
  variant?: LogoStyle;
  glyph?: GlyphId;
}) {
  const key = logoKey(game);
  const choice = useUI((ui) => ui.gameIcons[key]);
  const defaultStyle = useUI((ui) => ui.logoStyle);
  const logoStyle = variant ?? choice?.style ?? defaultStyle;
  const flipped = useUI((ui) => Boolean(ui.logoFlipped[key]));
  const flipLogo = useUI((ui) => ui.flipLogo);
  const coinRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<SVGSVGElement>(null);
  // The side last shown, so a logo that comes up already flipped is not tossed.
  const shown = useRef(flipped);
  // Before paint, so the coin is never seen resting on its new side before the toss.
  useLayoutEffect(() => {
    if (shown.current === flipped) return;
    shown.current = flipped;
    toss(coinRef.current, ringRef.current, flipped);
  }, [flipped]);

  const [ringA, ringB] = logoRing(game);
  const art = game.presetKey ? LOGO_ART[game.presetKey] : undefined;
  const coin = size * COIN_SHARE;
  // A full name set small enough to fit a list-sized coin is unreadable, so a
  // small coin shows the short name (ZZZ, NTE, WuWa) on both faces.
  const small = size < 44;
  const loadedFronts = useLogoFronts(Boolean(art) && !small);
  const lines = (which: 'front' | 'back'): string[] =>
    small ? [game.short.trim() || game.name.trim() || '?'] : which === 'front' ? logoLines(game.name) : [game.short];
  const face = (which: 'front' | 'back') => (
    <span className={`game-logo-face game-logo-${which}`}>
      {art ? (
        <svg viewBox={small ? art.backBox : COIN_BOX} className="game-logo-art">
          <path
            d={which === 'front' && !small ? (loadedFronts?.[game.presetKey!] ?? art.back) : art.back}
            fill="currentColor"
          />
        </svg>
      ) : (
        <FaceText
          lines={lines(which)}
          font={game.titleFont}
          room={coin * 0.82}
          size={coin * (small ? 0.4 : which === 'front' ? 0.24 : 0.34)}
        />
      )}
    </span>
  );
  const body = (
    <>
      {/* The ring turns with the toss, never on its own: a perpetual turn kept a phone redrawing. */}
      <svg ref={ringRef} viewBox="0 0 1024 1024" className="game-logo-ring">
        <path d={RING_A} fill={ringA} />
        <path d={RING_B} fill={ringB} />
      </svg>
      <span ref={coinRef} className="game-logo-coin" data-flipped={flipped || undefined}>
        {face('front')}
        {face('back')}
      </span>
    </>
  );
  const style = {
    width: size,
    height: size,
    '--logo-size': `${size}px`,
    // For looks that paint the coin in the game's colours (Clean) or glow them.
    '--logo-a': ringA,
    '--logo-b': ringB,
    '--logo-on-a': inkOn(ringA),
    '--logo-on-b': inkOn(ringB),
  } as CSSProperties;

  if (logoStyle !== 'coin')
    return (
      <AltLogo
        game={game}
        size={size}
        className={className}
        logoStyle={logoStyle}
        glyph={glyphOverride ?? choice?.glyph ?? 'star'}
        art={art}
        vars={style}
      />
    );
  if (!flippable)
    return (
      <span
        data-game-logo
        data-small={small || undefined}
        className={`game-logo ${className}`}
        style={style}
        aria-hidden
      >
        {body}
      </span>
    );
  return (
    <button
      type="button"
      data-game-logo
      data-small={small || undefined}
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

/**
 * A game's icon in a style the player chose instead of the coin: a soft-cornered
 * badge with its short name, its initial on a disc, or a symbol on a disc, all
 * in the game's two colours. Decorative, like a plain coin.
 */
function AltLogo({
  game,
  size,
  className,
  logoStyle,
  glyph,
  art,
  vars,
}: {
  game: LogoGame;
  size: number;
  className: string;
  logoStyle: Exclude<LogoStyle, 'coin'>;
  glyph: GlyphId;
  art: { back: string; backBox: string } | undefined;
  vars: CSSProperties;
}) {
  const short = game.short.trim() || game.name.trim() || '?';
  const initial = (game.name.trim() || short).charAt(0).toUpperCase();
  return (
    <span
      data-game-logo
      data-logo-style={logoStyle}
      data-small={size < 44 || undefined}
      className={`game-logo game-logo-alt ${className}`}
      style={vars}
      aria-hidden
    >
      {logoStyle === 'symbol' ? (
        <svg viewBox="0 0 24 24" className="game-logo-glyph">
          <path d={GAME_GLYPHS[glyph].d} fill="currentColor" fillRule="evenodd" />
        </svg>
      ) : logoStyle === 'monogram' ? (
        <span className="game-logo-initial" style={{ ...titleStyle(game.titleFont), fontSize: size * 0.52 }}>
          {initial}
        </span>
      ) : art ? (
        <svg viewBox={art.backBox} className="game-logo-badge-art">
          <path d={art.back} fill="currentColor" />
        </svg>
      ) : (
        <FaceText lines={[short]} font={game.titleFont} room={size * 0.78} size={size * 0.36} />
      )}
    </span>
  );
}
