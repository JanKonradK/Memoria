export const CLUSTER_DOT_CAP = 6;

const CLUSTER_CENTRE = 36;
const CORE_MIN_RADIUS = 6;
const CORE_MAX_RADIUS = 12;
const CORE_MIN_OPACITY = 0.38;
const GOLDEN_ANGLE_RADIANS = (137.508 * Math.PI) / 180;

export interface ClusterCoreGeometry {
  radius: number;
  highlightRadius: number;
  opacity: number;
  glowRadius: number;
  glowOpacity: number;
}

export interface ClusterDot {
  x: number;
  y: number;
  radius: number;
  delayMs: number;
}

export interface ClusterDotLayout {
  dots: ClusterDot[];
  overflow: number;
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

/** Static core geometry: energy changes both the footprint and emitted light. */
export function clusterCoreGeometry(fraction: number, active = true): ClusterCoreGeometry {
  const energy = clampFraction(fraction);
  const radius = CORE_MIN_RADIUS + (CORE_MAX_RADIUS - CORE_MIN_RADIUS) * energy;
  const activeOpacity = CORE_MIN_OPACITY + (1 - CORE_MIN_OPACITY) * energy;
  const activityScale = active ? 1 : 0.38;

  return {
    radius: rounded(radius),
    highlightRadius: rounded(Math.max(1.5, radius * 0.3)),
    opacity: rounded(activeOpacity * activityScale),
    glowRadius: rounded(radius + 6 + energy * 3),
    glowOpacity: rounded((0.1 + energy * 0.22) * activityScale),
  };
}

/** FNV-1a gives each game a stable orbital phase without render-time randomness. */
function hashSeed(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/**
 * One point per open daily, capped for a bounded SVG cost. Coordinates stay in
 * a 72×72 viewBox and remain stable across renders for the same game id.
 */
export function clusterDotLayout(
  openDailyCount: number,
  seed: string,
  cap: number = CLUSTER_DOT_CAP,
): ClusterDotLayout {
  const count = nonNegativeInteger(openDailyCount);
  const limit = nonNegativeInteger(cap);
  const rendered = Math.min(count, limit);
  const seedText = String(seed);
  const phase = ((hashSeed(seedText) % 360) * Math.PI) / 180;
  const dots = Array.from({ length: rendered }, (_, index) => {
    const angle = phase + index * GOLDEN_ANGLE_RADIANS;
    const orbitRadius = 17 + index * 2.25;
    const pointHash = hashSeed(`${seedText}:${index}`);

    return {
      x: rounded(CLUSTER_CENTRE + Math.cos(angle) * orbitRadius),
      y: rounded(CLUSTER_CENTRE + Math.sin(angle) * orbitRadius * 0.72),
      radius: rounded(1.4 + (pointHash % 5) * 0.12),
      delayMs: -(pointHash % 2_400),
    };
  });

  return { dots, overflow: Math.max(0, count - rendered) };
}
