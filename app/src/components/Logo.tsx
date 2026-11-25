import { useId, type CSSProperties } from 'react';
import {
  ACCENT_INK_STOPS,
  ACCENT_STOPS,
  findMarkColour,
  type MarkBackingId,
  type MarkColourId,
  type MarkShadingId,
  type MarkStops,
} from '../brand';
import { useUI } from '../ui-store';
import {
  MARK_BODY_PATH,
  MARK_CROSS_SHADOW_PATH,
  MARK_HEIGHT,
  MARK_OVER_PATH,
  MARK_PATH,
  MARK_SHARDS,
  MARK_UNDER_PATH,
  MARK_WIDTH,
} from './mark-path';

/** The light's run across and down the mark, as the app icons light it (scripts/draw-icon.mjs): x 0.38, y 0.62. */
const RAMP_END = { x: 12.34, y: 34.26 };
const RAMP_OFFSETS = [0, 0.42, 0.8, 1] as const;
/** Where the ribbons cross. */
const CROSSING = { x: 20.45, y: 10.46 };
/** A square tile with the mark centred in it. */
const TILE = 56;
const TILE_INSET = { x: (TILE - MARK_WIDTH) / 2, y: (TILE - MARK_HEIGHT) / 2 };
/** A squircle: each corner's handles meet at the corner, which reads smoother than a circular arc. */
const SQUIRCLE =
  'M20.5 0.5H35.5C55.5 0.5 55.5 0.5 55.5 20.5V35.5C55.5 55.5 55.5 55.5 35.5 55.5H20.5C0.5 55.5 0.5 55.5 0.5 35.5V20.5C0.5 0.5 0.5 0.5 20.5 0.5Z';

/** How opaque each shard tier is, per lighting: the farther a piece drifted, the fainter. */
const TIER_ALPHA: Record<Exclude<MarkShadingId, 'flat'>, readonly [number, number, number, number]> = {
  luminous: [1, 0.94, 0.82, 0.68],
  sculpted: [1, 0.86, 0.66, 0.46],
  chiseled: [1, 0.92, 0.78, 0.62],
  celestial: [1, 0.96, 0.9, 0.84],
};

const paint = (colour: string): CSSProperties => ({ fill: colour });

export interface LogoProps {
  wordmark?: string;
  className?: string;
  /** Each defaults to the player's choice in Settings → Appearance. */
  colour?: MarkColourId;
  shading?: MarkShadingId;
  backing?: MarkBackingId;
  /** A live preview: lets the Celestial stardust shimmer. */
  interactive?: boolean;
}

/**
 * The Memoria mark: a wide infinity sign whose lower half has shattered. Its
 * upper arches stand as an M; its two ribbons cross over and under at an
 * extended centre crossing; the lost bowls drift below as eighteen shards in
 * four tiers, the farthest the faintest.
 *
 * The layers come from mark-path.ts, generated from the same geometry as the
 * app icons and the intro (app/scripts/mobius.mjs), so every mark agrees.
 * Flat fills the one silhouette; every other lighting stacks the ribbons, the
 * shadow the over ribbon casts at the crossing, and the shards. Each instance
 * keys its own gradients and clips, so two marks on one page never share them.
 */
export function Logo({ wordmark, className = '', colour, shading, backing, interactive = false }: LogoProps) {
  const chosenColour = useUI((s) => s.markColour);
  const chosenShading = useUI((s) => s.markShading);
  const chosenBacking = useUI((s) => s.markBacking);
  const theme = useUI((s) => s.theme);
  const uid = `mark-${useId().replace(/[^\w-]/g, '')}`;
  const metal = findMarkColour(colour ?? chosenColour);
  const lighting = shading ?? chosenShading;
  const tile = backing ?? chosenBacking;

  // A black tile is dark in every theme; the bare mark and the glass tile sit on the theme's ground.
  const onLight = theme === 'light' && (tile === 'bare' || tile === 'tinted');
  const preset = onLight ? metal.inkStops : metal.stops;
  const stops: MarkStops = preset === 'accent' ? (onLight ? ACCENT_INK_STOPS : ACCENT_STOPS) : preset;
  const shade = metal.shadowTint;
  const glint = onLight ? 0.5 : 1;
  const ramp = `url(#${uid}-ramp)`;

  const body =
    lighting === 'flat' ? (
      <path d={MARK_PATH} style={paint(stops[2])} />
    ) : (
      <>
        {lighting === 'celestial' && (
          <ellipse cx={CROSSING.x} cy={CROSSING.y + 2} rx={16} ry={11} fill={`url(#${uid}-bloom)`} />
        )}
        <path d={MARK_BODY_PATH} fill={ramp} />
        {/* The under ribbon dims as it dives, and takes the over ribbon's shadow. */}
        <g clipPath={`url(#${uid}-under)`}>
          {lighting === 'sculpted' && <path d={MARK_UNDER_PATH} fill={`url(#${uid}-dive)`} />}
          <path
            d={MARK_CROSS_SHADOW_PATH}
            style={paint(shade)}
            opacity={lighting === 'sculpted' ? 0.62 : lighting === 'celestial' ? 0.28 : 0.4}
          />
        </g>
        <path d={MARK_OVER_PATH} fill={ramp} />
        <g clipPath={`url(#${uid}-body)`}>
          {lighting === 'sculpted' && (
            <rect width={MARK_WIDTH} height={7} fill={`url(#${uid}-sheen)`} opacity={0.7 * glint} />
          )}
          {lighting === 'chiseled' && (
            <>
              <rect width={MARK_WIDTH} height={MARK_HEIGHT} fill={`url(#${uid}-facet)`} opacity={glint} />
              <path
                d={MARK_BODY_PATH}
                fill="none"
                stroke={`url(#${uid}-edge)`}
                strokeWidth={0.5}
                opacity={0.8 * glint}
              />
              <path d={MARK_OVER_PATH} fill="none" stroke={`url(#${uid}-edge)`} strokeWidth={0.36} opacity={glint} />
            </>
          )}
          {lighting === 'celestial' && (
            <ellipse cx={CROSSING.x} cy={8} rx={18} ry={9} fill={`url(#${uid}-core)`} opacity={onLight ? 0.3 : 1} />
          )}
        </g>
      </>
    );

  const shards =
    lighting === 'flat'
      ? null
      : MARK_SHARDS.map((shard, index) => {
          const alpha = TIER_ALPHA[lighting][shard.tier - 1];
          const stardust = lighting === 'celestial' && shard.tier >= 3;
          return (
            <path
              key={index}
              d={shard.d}
              fill={stardust ? undefined : ramp}
              style={stardust ? paint(onLight ? stops[1] : stops[0]) : undefined}
              opacity={alpha}
              className={stardust ? 'brand-mark-dust' : undefined}
              stroke={lighting === 'chiseled' && shard.tier <= 2 ? `url(#${uid}-edge)` : undefined}
              strokeWidth={lighting === 'chiseled' && shard.tier <= 2 ? 0.22 : undefined}
            />
          );
        });

  const backed = tile !== 'bare';
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        aria-hidden="true"
        // w-auto, not a hard-coded width: the box is the mark's own aspect (or
        // a square tile), so the intrinsic ratio drives the width and the mark
        // stays centred at any height.
        className="brand-mark h-6 w-auto shrink-0 overflow-visible"
        data-backing={tile}
        data-shading={lighting}
        data-colour={metal.id}
        data-interactive={interactive || undefined}
        viewBox={backed ? `0 0 ${TILE} ${TILE}` : `0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`}
        fill="none"
      >
        <defs>
          <linearGradient
            id={`${uid}-ramp`}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2={RAMP_END.x}
            y2={RAMP_END.y}
          >
            {stops.map((stop, index) => (
              <stop key={index} offset={RAMP_OFFSETS[index]} style={{ stopColor: stop }} />
            ))}
          </linearGradient>
          {lighting !== 'flat' && (
            <>
              <clipPath id={`${uid}-under`}>
                <path d={MARK_UNDER_PATH} />
              </clipPath>
              <clipPath id={`${uid}-body`}>
                <path d={MARK_BODY_PATH} />
              </clipPath>
            </>
          )}
          {lighting === 'sculpted' && (
            <>
              <radialGradient id={`${uid}-dive`} gradientUnits="userSpaceOnUse" cx={CROSSING.x} cy={CROSSING.y} r={9}>
                <stop offset="0" style={{ stopColor: shade, stopOpacity: 0.5 }} />
                <stop offset="1" style={{ stopColor: shade, stopOpacity: 0 }} />
              </radialGradient>
              <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </>
          )}
          {lighting === 'chiseled' && (
            <>
              {/* Two facets meeting on a diagonal: lit above it, shaded below. */}
              <linearGradient id={`${uid}-facet`} x1="0" y1="0" x2="0.62" y2="1">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.3" />
                <stop offset="0.46" stopColor="#ffffff" stopOpacity="0.08" />
                <stop offset="0.46" style={{ stopColor: shade, stopOpacity: 0 }} />
                <stop offset="1" style={{ stopColor: shade, stopOpacity: 0.34 }} />
              </linearGradient>
              <linearGradient id={`${uid}-edge`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={MARK_HEIGHT}>
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
                <stop offset="0.6" style={{ stopColor: metal.rimTint, stopOpacity: 0.5 }} />
                <stop offset="1" style={{ stopColor: metal.rimTint, stopOpacity: 0.15 }} />
              </linearGradient>
            </>
          )}
          {lighting === 'celestial' && (
            <>
              <radialGradient id={`${uid}-bloom`}>
                <stop offset="0" style={{ stopColor: metal.rimTint, stopOpacity: onLight ? 0.22 : 0.42 }} />
                <stop offset="1" style={{ stopColor: metal.rimTint, stopOpacity: 0 }} />
              </radialGradient>
              <radialGradient id={`${uid}-core`}>
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.6" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
            </>
          )}
          {tile === 'gilded' && (
            <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e8b45a" stopOpacity="0.62" />
              <stop offset="1" stopColor="#e8b45a" stopOpacity="0.2" />
            </linearGradient>
          )}
          {tile === 'tinted' && (
            <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--color-surface-2)' }} />
              <stop offset="1" style={{ stopColor: 'var(--color-surface-1)' }} />
            </linearGradient>
          )}
        </defs>
        {backed && (
          <path
            className="brand-mark-tile"
            d={SQUIRCLE}
            fill={tile === 'tinted' ? `url(#${uid}-glass)` : '#000000'}
            style={{
              stroke: tile === 'gilded' ? `url(#${uid}-rim)` : tile === 'tinted' ? 'var(--color-line-edge)' : '#26262c',
            }}
            strokeWidth={tile === 'gilded' ? 0.9 : 1}
          />
        )}
        <g transform={backed ? `translate(${TILE_INSET.x} ${TILE_INSET.y})` : undefined}>
          {body}
          {shards}
        </g>
      </svg>
      {wordmark ? (
        // Solid, not a gradient. The mark carries the ramp because it is a
        // shape; running it through the letterforms only softened them.
        <span className="text-gold">{wordmark}</span>
      ) : (
        <span className="sr-only">Memoria</span>
      )}
    </span>
  );
}
