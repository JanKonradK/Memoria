import type { EnergyProjection, Game, Resource } from '@void/shared';
import { clamp, endTone, tint } from '../../util';

export type ConduitState = 'flowing' | 'capped' | 'paused' | 'unknown';

export interface ConduitVisual {
  fill: number;
  flowMs: number;
  state: ConduitState;
  core: string;
  tone: string;
}

const MIN_FLOW_MS = 1_200;
const MAX_FLOW_MS = 4_000;
const FLOW_MS_PER_REGEN_MINUTE = 250;
const WARN_START = 0.65;
const DANGER_START = 0.9;

function overflowTone(base: string, fill: number): string {
  if (fill <= WARN_START) return base;
  if (fill < DANGER_START) {
    const warnMix = Math.round(((fill - WARN_START) / (DANGER_START - WARN_START)) * 100);
    return `color-mix(in oklab, ${base}, var(--warn) ${warnMix}%)`;
  }
  const dangerMix = Math.round(((fill - DANGER_START) / (1 - DANGER_START)) * 100);
  return `color-mix(in oklab, var(--warn), var(--danger) ${dangerMix}%)`;
}

export function conduitVisual(
  resource: Resource | null | undefined,
  projection: EnergyProjection | null | undefined,
  game: Game,
  now: number,
): ConduitVisual {
  void now;
  const cap = Math.max(1, resource?.cap ?? 0);
  const fill = resource && projection ? clamp(projection.precise / cap, 0, 1) : 0;
  const flowMs = clamp((resource?.regenMinutes ?? MAX_FLOW_MS) * FLOW_MS_PER_REGEN_MINUTE, MIN_FLOW_MS, MAX_FLOW_MS);
  const baseCore = tint(game.color, 1);
  const baseTone = tint(game.color2 ?? game.color, 1);

  let state: ConduitState;
  if (!resource || !projection?.hasSnapshot) state = 'unknown';
  else if (game.paused) state = 'paused';
  else if (fill >= 1 || projection.precise >= resource.cap) state = 'capped';
  else state = 'flowing';

  if (state === 'capped') {
    return {
      fill: 1,
      flowMs,
      state,
      core: endTone(1),
      tone: 'var(--danger)',
    };
  }

  return {
    fill,
    flowMs,
    state,
    core: baseCore,
    tone: overflowTone(baseTone, fill),
  };
}
