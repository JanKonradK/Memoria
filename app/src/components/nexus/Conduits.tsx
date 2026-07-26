import { useEffect, useId, useRef, type RefObject } from 'react';
import type { EnergyProjection, GameUrgency, Resource } from '@void/shared';
import { conduitPath } from './conduit-geometry';
import { conduitVisual, type ConduitVisual } from './conduit-visual';

type ConduitPathPart = 'jacket' | 'rim' | 'track' | 'core' | 'pulse' | 'pulseMask';
type ConduitStopPart = 'coreStop' | 'toneStop';

type ConduitElements = {
  jacket?: SVGPathElement;
  rim?: SVGPathElement;
  track?: SVGPathElement;
  core?: SVGPathElement;
  pulse?: SVGPathElement;
  pulseMask?: SVGPathElement;
  coreStop?: SVGStopElement;
  toneStop?: SVGStopElement;
};

type ConduitVisualState = ConduitVisual & {
  selected: boolean;
  dimmed: boolean;
  lastD: Partial<Record<ConduitPathPart, string>>;
  lastAttributes: Record<string, string>;
};

export interface NexusEnergy {
  resource: Resource | undefined;
  projection: EnergyProjection | null;
}

/** How far the jacket extends past the fibre core on each side. */
const CONDUIT_JACKET_PAD = 6;
const CONDUIT_CORE_WIDTH = 2.6;
/** Mirrors --nexus-dur in app/src/index.css. */
export const NEXUS_DUR_MS = 340;

export function Conduits({
  visibleIds,
  leftIds,
  entryById,
  energyById,
  now,
  activeExpandedGameId,
  reducedMotion,
  stageRef,
  hubRef,
  nodeRefs,
}: {
  visibleIds: string[];
  leftIds: string[];
  entryById: Map<string, GameUrgency>;
  energyById: Map<string, NexusEnergy>;
  now: number;
  activeExpandedGameId: string | null;
  reducedMotion: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  hubRef: RefObject<HTMLElement | null>;
  nodeRefs: RefObject<Map<string, HTMLElement>>;
}) {
  const idPrefix = useId().replace(/:/g, '');
  const conduitRefs = useRef(new Map<string, ConduitElements>());
  const conduitVisualsRef = useRef(new Map<string, ConduitVisualState>());
  const scheduleRef = useRef<(ms?: number) => void>(() => undefined);
  const lastExpandedGameIdRef = useRef<string | null>(null);

  const conduitPathRef = (id: string, part: ConduitPathPart) => (element: SVGPathElement | null) => {
    const elements = conduitRefs.current.get(id) ?? {};
    const visual = conduitVisualsRef.current.get(id);
    if (element) elements[part] = element;
    else delete elements[part];
    if (visual) {
      delete visual.lastD[part];
      visual.lastAttributes = {};
    }
    if (Object.keys(elements).length > 0) conduitRefs.current.set(id, elements);
    else conduitRefs.current.delete(id);
  };

  const conduitStopRef = (id: string, part: ConduitStopPart) => (element: SVGStopElement | null) => {
    const elements = conduitRefs.current.get(id) ?? {};
    const visual = conduitVisualsRef.current.get(id);
    if (element) elements[part] = element;
    else delete elements[part];
    if (visual) visual.lastAttributes = {};
    if (Object.keys(elements).length > 0) conduitRefs.current.set(id, elements);
    else conduitRefs.current.delete(id);
  };

  const idsKey = visibleIds.join('|');
  const visualKey = visibleIds
    .map((id) => {
      const entry = entryById.get(id)!;
      const energy = energyById.get(id);
      return [
        id,
        entry.game.color,
        entry.game.color2 ?? '',
        entry.game.paused,
        energy?.resource?.id ?? '',
        energy?.resource?.cap ?? '',
        energy?.resource?.regenMinutes ?? '',
        energy?.projection?.precise ?? '',
        energy?.projection?.hasSnapshot ?? '',
        energy?.projection?.overflow ?? '',
        now,
      ].join(':');
    })
    .join('|');

  useEffect(() => {
    const stage = stageRef.current;
    const hub = hubRef.current;
    if (!stage || !hub) return;
    let frame: number | undefined,
      settleUntil = 0;

    const draw = () => {
      const stageBox = stage.getBoundingClientRect();
      const hubBox = hub.getBoundingClientRect();
      const geometry = visibleIds.flatMap((id) => {
        const node = nodeRefs.current.get(id);
        const { jacket, rim, track, core, pulse, pulseMask, coreStop, toneStop } = conduitRefs.current.get(id) ?? {};
        const visual = conduitVisualsRef.current.get(id);
        if (!node || !jacket || !rim || !track || !core || !pulse || !pulseMask || !coreStop || !toneStop || !visual) {
          return [];
        }
        return [
          {
            nodeBox: node.getBoundingClientRect(),
            jacket,
            rim,
            track,
            core,
            pulse,
            pulseMask,
            coreStop,
            toneStop,
            visual,
          },
        ];
      });

      // All layout reads finish above; only DOM writes are allowed below this boundary.
      for (const { nodeBox, jacket, rim, track, core, pulse, pulseMask, coreStop, toneStop, visual } of geometry) {
        const path = conduitPath(stageBox, hubBox, nodeBox);
        const coreWidth = visual.selected ? CONDUIT_CORE_WIDTH + 1.6 : CONDUIT_CORE_WIDTH;
        const jacketWidth = coreWidth + CONDUIT_JACKET_PAD;
        const active = visual.state === 'flowing' || visual.state === 'capped';
        const hasFill = active && visual.fill > 0;
        const capped = visual.state === 'capped';

        const writePath = (part: ConduitPathPart, element: SVGPathElement) => {
          if (visual.lastD[part] === path) return;
          element.setAttribute('d', path);
          visual.lastD[part] = path;
        };
        writePath('jacket', jacket);
        writePath('rim', rim);
        writePath('track', track);
        writePath('core', core);
        writePath('pulse', pulse);
        writePath('pulseMask', pulseMask);

        const writeAttribute = (key: string, element: Element, name: string, value: string) => {
          if (visual.lastAttributes[key] === value) return;
          element.setAttribute(name, value);
          visual.lastAttributes[key] = value;
        };
        const writeStyle = (key: string, element: HTMLElement | SVGElement, name: string, value: string) => {
          if (visual.lastAttributes[key] === value) return;
          element.style.setProperty(name, value);
          visual.lastAttributes[key] = value;
        };

        writeAttribute('jacket:opacity', jacket, 'opacity', visual.dimmed ? '0.4' : '0.92');
        writeAttribute('jacket:width', jacket, 'stroke-width', String(jacketWidth));
        writeAttribute('rim:opacity', rim, 'opacity', visual.dimmed ? '0.06' : visual.selected ? '0.4' : '0.22');
        writeAttribute('rim:width', rim, 'stroke-width', String(jacketWidth));
        writeAttribute(
          'track:opacity',
          track,
          'opacity',
          active ? (visual.dimmed ? '0.04' : visual.selected ? '0.18' : '0.12') : visual.dimmed ? '0.04' : '0.08',
        );
        writeAttribute('track:width', track, 'stroke-width', String(coreWidth));
        writeAttribute(
          'core:opacity',
          core,
          'opacity',
          hasFill ? (visual.dimmed ? '0.14' : visual.selected ? '0.95' : '0.55') : '0',
        );
        writeAttribute('core:width', core, 'stroke-width', String(coreWidth));
        writeAttribute('core:fill', core, 'stroke-dasharray', `${visual.fill * 100} 100`);
        writeStyle(
          'core:filter',
          core,
          'filter',
          active ? `drop-shadow(0 0 ${visual.selected ? 9 : 5}px ${visual.core})` : 'none',
        );
        writeAttribute('mask:width', pulseMask, 'stroke-width', String(coreWidth));
        writeAttribute('mask:fill', pulseMask, 'stroke-dasharray', `${visual.fill * 100} 100`);
        writeAttribute('gradient:core', coreStop, 'stop-color', visual.core);
        writeAttribute('gradient:tone', toneStop, 'stop-color', visual.tone);
        writeAttribute(
          'pulse:opacity',
          pulse,
          'opacity',
          visual.state === 'flowing' && hasFill ? (visual.dimmed ? '0.05' : visual.selected ? '0.85' : '0.5') : '0',
        );
        writeAttribute(
          'pulse:width',
          pulse,
          'stroke-width',
          String(CONDUIT_CORE_WIDTH * 0.55 + (visual.selected ? 0.8 : 0)),
        );
        writeStyle('pulse:duration', pulse, 'animation-duration', `${visual.flowMs}ms`);
        writeStyle('pulse:state', pulse, 'animation-play-state', visual.state === 'flowing' ? 'running' : 'paused');

        const jacketState = capped ? 'capped' : 'normal';
        if (visual.lastAttributes['jacket:state'] !== jacketState) {
          jacket.classList.toggle('warn-pulse', capped);
          jacket.style.filter = capped ? 'drop-shadow(0 0 7px var(--danger))' : '';
          visual.lastAttributes['jacket:state'] = jacketState;
        }
      }
    };

    const schedule = (ms = 0) => {
      settleUntil = Math.max(settleUntil, performance.now() + (reducedMotion ? 0 : ms));
      if (frame == null) frame = requestAnimationFrame(tick);
    };
    const tick = (timestamp: number) => {
      frame = undefined;
      if (!document.hidden) draw();
      if (timestamp < settleUntil) frame = requestAnimationFrame(tick);
    };
    const onTransitionEnd = (event: TransitionEvent) => {
      if (['grid-template-columns', 'grid-template-rows'].includes(event.propertyName)) {
        draw();
        schedule();
      }
    };
    const onResize = () => schedule(120);
    const onVisibilityChange = () => {
      if (!document.hidden) schedule();
    };

    scheduleRef.current = schedule;
    schedule();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibilityChange);
    stage.addEventListener('transitionend', onTransitionEnd);
    const observer = new ResizeObserver(() => schedule(NEXUS_DUR_MS));
    observer.observe(stage);
    observer.observe(hub);
    for (const node of nodeRefs.current.values()) observer.observe(node);

    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      if (scheduleRef.current === schedule) scheduleRef.current = () => undefined;
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stage.removeEventListener('transitionend', onTransitionEnd);
    };
    // Installation follows node identity/motion only; the update effect below refreshes visuals without rebuilding listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, reducedMotion]);

  useEffect(() => {
    const previous = conduitVisualsRef.current;
    conduitVisualsRef.current = new Map(
      visibleIds.map((id) => {
        const entry = entryById.get(id)!;
        const energy = energyById.get(id);
        const prior = previous.get(id);
        const selected = id === activeExpandedGameId;
        return [
          id,
          {
            ...conduitVisual(energy?.resource, energy?.projection, entry.game, now),
            selected,
            dimmed: activeExpandedGameId != null && !selected,
            lastD: prior?.lastD ?? {},
            lastAttributes: prior?.lastAttributes ?? {},
          },
        ];
      }),
    );
    const expandedChanged = lastExpandedGameIdRef.current !== activeExpandedGameId;
    lastExpandedGameIdRef.current = activeExpandedGameId;
    scheduleRef.current(expandedChanged ? NEXUS_DUR_MS + 60 : 0);
    // visualKey represents energy/color inputs; expansion only changes desired visual state and settle time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualKey, activeExpandedGameId]);

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible">
      <defs>
        {visibleIds.map((id, index) => {
          const fromLeft = leftIds.includes(id);
          return (
            <linearGradient
              key={`${id}-gradient`}
              id={`${idPrefix}-conduit-${index}`}
              x1={fromLeft ? '0%' : '100%'}
              y1="0%"
              x2={fromLeft ? '100%' : '0%'}
              y2="0%"
            >
              <stop ref={conduitStopRef(id, 'coreStop')} offset="0" />
              <stop ref={conduitStopRef(id, 'toneStop')} offset="1" />
            </linearGradient>
          );
        })}
        {visibleIds.map((id, index) => (
          <mask key={`${id}-mask`} id={`${idPrefix}-conduit-mask-${index}`}>
            <path
              ref={conduitPathRef(id, 'pulseMask')}
              fill="none"
              stroke="white"
              strokeLinecap="round"
              pathLength="100"
              vectorEffect="non-scaling-stroke"
              className="nexus-conduit-fill"
            />
          </mask>
        ))}
      </defs>
      {visibleIds.map((id, index) => (
        <g key={id}>
          {/* Cable jacket: the fibre core reads as light running inside a sheath. */}
          <path
            ref={conduitPathRef(id, 'jacket')}
            fill="none"
            stroke="#0b0912"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="nexus-conduit-jacket"
          />
          {/* Ribbing on the jacket — short dashes across its full width. */}
          <path
            ref={conduitPathRef(id, 'rim')}
            fill="none"
            stroke="rgba(214,205,255,0.55)"
            strokeDasharray="1.5 7"
            vectorEffect="non-scaling-stroke"
          />
          {/* The full-length track keeps the unfilled share legible. */}
          <path
            ref={conduitPathRef(id, 'track')}
            fill="none"
            stroke={`url(#${idPrefix}-conduit-${index})`}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            ref={conduitPathRef(id, 'core')}
            fill="none"
            stroke={`url(#${idPrefix}-conduit-${index})`}
            strokeLinecap="round"
            pathLength="100"
            vectorEffect="non-scaling-stroke"
            className="nexus-conduit-fill"
          />
          <path
            ref={conduitPathRef(id, 'pulse')}
            fill="none"
            stroke="white"
            strokeLinecap="round"
            pathLength="100"
            vectorEffect="non-scaling-stroke"
            mask={`url(#${idPrefix}-conduit-mask-${index})`}
            className="nexus-conduit-pulse"
          />
        </g>
      ))}
    </svg>
  );
}
