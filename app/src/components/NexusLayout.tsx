import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { AppState, EnergyProjection, GameEvent, GameUrgency, Resource } from '@void/shared';
import { effectiveResourceKind, projectEnergy } from '@void/shared';
import { useMediaQuery, useReducedMotion } from '../hooks';
import { useDerived } from '../selectors';
import { useUI } from '../ui-store';
import { endTone, fmtDur, tint } from '../util';
import { GameControlsView, type GameControlActions } from './GameCard';
import { ProgressBar } from './primitives';
import { clusterCoreGeometry, clusterDotLayout } from './nexus/cluster-geometry';
import { NexusHub } from './nexus/NexusHub';

/** Mirrors --nexus-dur in app/src/index.css. */
const NEXUS_DUR_MS = 340;
const HOUR = 3_600_000;

type UrgencyTier = 'low' | 'med' | 'high';

const URGENCY_DOT: Record<UrgencyTier, string> = {
  low: 'var(--color-ok)',
  med: 'var(--color-warn)',
  high: 'var(--color-danger)',
};

/**
 * How hard a card announces itself. This is the job the conduits were supposed
 * to do — they drew a cable per game whose fill tracked energy, which turned out
 * to say nothing you could act on, at the cost of a per-frame SVG repaint across
 * the whole stage. A card that needs you now simply glows like it.
 *
 * Concrete colour, not a game tint: at a glance across six cards the question is
 * "which one is on fire", and every game answering in its own hue made that
 * unreadable. The game's colour still owns the card's border and background.
 */
/**
 * Urgency reads from the inset ring, the pulsing overlay and the dot — three
 * signals that all survive on a black canvas. The outer halo this used to add
 * was a fourth, and it was the only one that cost a full-card raster every
 * frame the card animated. See the Shadows Float Only Rule in DESIGN.md.
 */
const URGENCY_RING: Record<UrgencyTier, string> = {
  low: '',
  med: 'inset 0 0 0 1.5px color-mix(in oklab, var(--warn) 50%, transparent)',
  high: 'inset 0 0 0 2px color-mix(in oklab, var(--danger) 75%, transparent)',
};

/** The same time bands used by resource controls: red <2h, amber <8h, green beyond. */
function urgencyTier(entry: GameUrgency, now: number): UrgencyTier {
  if (entry.game.paused || !entry.next) return 'low';
  const remaining = entry.next.at - now;
  if (remaining < 2 * HOUR) return 'high';
  if (remaining < 8 * HOUR) return 'med';
  return 'low';
}

/** Anything a click could plausibly be aimed at — everything else is "the background". */
const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, label, [role="button"], [contenteditable]';

/**
 * Sheets, selects and tooltips portal to <body>, so they sit outside the stage
 * in the DOM while being layered *over* it on screen. Clicks in there belong to
 * the layer, not to "the background" — collapsing the card behind them would
 * pull the rug out from under whatever the user just opened.
 */
const LAYER_SELECTOR =
  '[role="dialog"], [role="listbox"], [role="tooltip"], [role="menu"], [data-radix-popper-content-wrapper]';

function GalaxyCluster({
  gameId,
  short,
  color,
  color2,
  fraction,
  openDailyCount,
  active,
}: {
  gameId: string;
  short: string;
  color: string;
  color2?: string;
  fraction: number;
  openDailyCount: number;
  active: boolean;
}) {
  const idPrefix = useId().replaceAll(':', '');
  const armGradientId = `cluster-arms-${idPrefix}`;
  const coreGradientId = `cluster-core-${idPrefix}`;
  const core = clusterCoreGeometry(fraction, active);
  const dailyLayout = clusterDotLayout(openDailyCount, gameId);
  const secondaryColor = color2 ?? color;

  return (
    <svg
      aria-hidden="true"
      className="nexus-cluster pointer-events-none absolute inset-y-0 left-0 h-full w-24 overflow-visible"
      data-active={active || undefined}
      viewBox="0 0 96 112"
      preserveAspectRatio="xMinYMid meet"
    >
      <defs>
        <linearGradient id={armGradientId} x1="7" y1="12" x2="76" y2="71" gradientUnits="userSpaceOnUse">
          <stop stopColor={color} />
          <stop offset="1" stopColor={secondaryColor} />
        </linearGradient>
        <radialGradient id={coreGradientId}>
          <stop stopColor="#fff" />
          <stop offset="0.35" stopColor={color} />
          <stop offset="1" stopColor={secondaryColor} />
        </radialGradient>
      </defs>

      <g transform="translate(8 16)">
        <g className="nexus-cluster-rotation">
          <g
            className="nexus-cluster-arms"
            fill="none"
            stroke={`url(#${armGradientId})`}
            strokeLinecap="round"
            opacity={active ? 0.3 : 0.12}
          >
            <path d="M36 35c10-11 29-8 31 6 3 16-17 27-36 21C10 56 7 34 21 20" strokeWidth="2.2" />
            <path d="M36 37c-8 9-21 8-26-3C4 20 18 5 37 7c24 2 38 23 32 44" strokeWidth="1.4" />
            <ellipse
              cx="36"
              cy="36"
              rx="30"
              ry="20"
              strokeWidth="0.8"
              strokeDasharray="58 24"
              transform="rotate(24 36 36)"
            />
          </g>

          {dailyLayout.dots.map((dot, index) => (
            <circle
              key={index}
              className="nexus-cluster-dot"
              cx={dot.x}
              cy={dot.y}
              r={dot.radius}
              fill={index % 2 === 0 ? color : secondaryColor}
              style={{ animationDelay: `${dot.delayMs}ms` }}
            />
          ))}
        </g>

        <circle cx="36" cy="36" r={core.glowRadius} fill={`url(#${coreGradientId})`} opacity={core.glowOpacity} />
        <circle cx="36" cy="36" r={core.radius} fill={`url(#${coreGradientId})`} opacity={core.opacity} />
        <circle cx="34.5" cy="34.5" r={core.highlightRadius} fill="#fff" opacity={core.opacity} />
      </g>

      {/* This viewBox renders 1:1, so these are literal pixel sizes — 10 is the
          Caption floor from DESIGN.md, not a decorative choice. The short code
          is how the user picks the right card out of a rail at a glance; it was
          set to 7 here, which is below anything legible. */}
      <text x="44" y="96" fill={color} fontSize="10" fontWeight="900" letterSpacing="0.8" textAnchor="middle">
        {short}
      </text>
      {dailyLayout.overflow > 0 && (
        <text x="70" y="86" fill="var(--color-fg-soft)" fontSize="10" fontWeight="900" textAnchor="middle">
          +{dailyLayout.overflow}
        </text>
      )}
    </svg>
  );
}

type SharedNexusProps = {
  state: AppState;
  entries: GameUrgency[];
  displayIds: string[];
  now: number;
  gameControlActions: GameControlActions;
  onEditGame: (gameId: string) => void;
  onOpenGameEvent: (eventId: string, gameId: string) => void;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
  onOpenReminder: () => void;
  onOpenTimeline: () => void;
};

function NexusNode({
  entry,
  state,
  now,
  expanded,
  collapsed,
  columns,
  reducedMotion,
  primary,
  projection,
  openDailyCount,
  actions,
  onToggle,
  onEditGame,
  onOpenGameEvent,
}: {
  entry: GameUrgency;
  state: AppState;
  now: number;
  expanded: boolean;
  collapsed: boolean;
  columns: 1 | 2;
  reducedMotion: boolean;
  primary: Resource | undefined;
  projection: EnergyProjection | null;
  openDailyCount: number;
  actions: GameControlActions;
  onToggle: () => void;
  onEditGame: (gameId: string) => void;
  onOpenGameEvent: (eventId: string, gameId: string) => void;
}) {
  const { game, next } = entry;
  const tier = urgencyTier(entry, now);
  const nodeRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(expanded);
  const [settled, setSettled] = useState(expanded);
  // The control that opened the card is gone once it is open, so hand focus to
  // the card itself — keyboard users land inside it, and Escape has a target.
  useEffect(() => {
    if (expanded) nodeRef.current?.focus({ preventScroll: true });
  }, [expanded]);
  useEffect(() => {
    if (expanded) {
      setMounted(true);
      if (reducedMotion) {
        setSettled(true);
        return;
      }
      // Scrolling is switched on only after the card has finished growing. The
      // controls are taller than the card is for most of the animation, so an
      // always-scrollable body flashes a scrollbar in at the start and drops it
      // at the end — a width change on the content, right as the motion stops.
      const timer = setTimeout(() => setSettled(true), NEXUS_DUR_MS);
      return () => clearTimeout(timer);
    }
    setSettled(false);
    if (reducedMotion) {
      setMounted(false);
      return;
    }
    // Unmounting the controls is a layout and paint spike. It is invisible by
    // now (opacity 0, hidden, inert), so it waits until well clear of the motion.
    const timer = setTimeout(() => setMounted(false), NEXUS_DUR_MS + 220);
    return () => clearTimeout(timer);
  }, [expanded, reducedMotion]);
  const fraction = primary && projection ? projection.precise / Math.max(1, primary.cap) : 0;
  // Paused or unmeasured: colour remains, motion does not.
  const clusterActive = !game.paused && primary != null && projection?.hasSnapshot === true;
  const controlsId = `nexus-controls-${game.id}`;

  return (
    <article
      ref={nodeRef}
      // No shadow transition: these are two large-radius blurs, and animating
      // them re-rasterises the card's whole shadow on every frame of an
      // expansion that is already moving the grid. They snap; the eye is on the
      // card growing, not on the glow fading in.
      className="nexus-node relative overflow-hidden rounded-ui-card bg-surface-1 outline-none"
      // Only a card that is genuinely out of time pulses, and only while it is
      // closed: a breathing card you are typing into is a distraction, and if
      // everything pulses, nothing does.
      data-urgent={!expanded && tier === 'high' ? 'true' : undefined}
      data-expanded={expanded || undefined}
      data-settled={(expanded && settled) || undefined}
      data-collapsed={collapsed || undefined}
      // Nothing INSIDE an open card closes it. It used to collapse on any click
      // that missed a control, which meant misjudging the edge of an energy field
      // threw away the card you were working in. It closes from its own control,
      // from Escape, or by clicking off the card entirely.
      tabIndex={expanded ? -1 : undefined}
      onKeyDown={
        expanded
          ? (event) => {
              if (event.key !== 'Escape' || event.defaultPrevented) return;
              // Let a field's own Escape (cancel an energy edit) and any layered
              // dialog's Escape win — only a "bare" Escape on the card collapses it.
              if ((event.target as HTMLElement).closest('input, textarea, [contenteditable], [role="dialog"]')) return;
              onToggle();
            }
          : undefined
      }
      style={
        {
          '--nexus-accent': game.color,
          background: `linear-gradient(155deg, ${tint(game.color, expanded ? 0.2 : 0.1)}, transparent 48%), linear-gradient(335deg, ${tint(game.color2 ?? game.color, expanded ? 0.12 : 0.05)}, transparent 44%), var(--color-surface-1)`,
          boxShadow: expanded
            ? `inset 0 0 0 1.5px ${game.color}, inset 0 1px 0 var(--color-line-hairline)`
            : [
                // The urgency ring sits INSIDE the game's own ring rather than
                // replacing it, so a card never stops looking like its game.
                `inset 0 0 0 1px ${tint(game.color, 0.28)}`,
                URGENCY_RING[tier],
                'inset 0 1px 0 var(--color-line-hairline)',
              ]
                .filter(Boolean)
                .join(', '),
        } as CSSProperties
      }
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-3 top-0 z-20 h-0.5 rounded-ui-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${game.color}, ${game.color2 ?? game.color}, transparent)`,
        }}
      />
      {!expanded && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-controls={controlsId}
          aria-label={`Expand ${game.name} controls`}
          className="relative z-10 block w-full rounded-ui-card p-3 text-left transition hover:bg-fill-1"
        >
          <GalaxyCluster
            gameId={game.id}
            short={game.short}
            color={game.color}
            color2={game.color2}
            fraction={fraction}
            openDailyCount={openDailyCount}
            active={clusterActive}
          />

          <span className="relative z-10 flex items-center gap-2.5 pl-16">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-black text-fg" style={{ fontFamily: game.titleFont }}>
                {game.name}
              </span>
              <span className="block truncate text-caption uppercase tracking-[0.14em] text-dim">
                {primary?.name ?? (game.paused ? 'Tracking paused' : 'No regen resource')}
              </span>
            </span>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-dim"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
            <span
              aria-hidden
              className={`h-2.5 w-2.5 shrink-0 rounded-ui-full ${tier === 'high' ? 'warn-pulse' : ''}`}
              style={{
                background: URGENCY_DOT[tier],
                boxShadow: `0 0 ${tier === 'high' ? 10 : 8}px ${URGENCY_DOT[tier]}`,
              }}
            />
          </span>

          <span className="relative z-10 mt-2.5 grid grid-cols-[auto_minmax(2rem,1fr)] items-center gap-2.5 pl-16">
            <span className="text-meta font-black tabular-nums text-fg-soft">
              {primary && projection && projection.hasSnapshot ? projection.value : '—'}
              <span className="font-medium text-dim">/{primary?.cap ?? '—'}</span>
            </span>
            <ProgressBar value={fraction} color={game.color} color2={game.color2} className="!mt-0 !h-1.5 min-w-8" />
          </span>

          <span className="relative z-10 mt-2 flex items-center justify-between gap-2 border-t border-line-hairline pl-16 pt-2 text-caption">
            <span className="truncate text-dim">{next?.label ?? (game.paused ? 'Tracking paused' : 'All clear')}</span>
            {next && (
              <span className="shrink-0 font-black tabular-nums" style={{ color: endTone(next.at - now) }}>
                {next.at <= now ? 'NOW' : fmtDur(next.at - now)}
              </span>
            )}
          </span>
        </button>
      )}

      <div
        id={controlsId}
        className="nexus-node-body scrollbar-thin"
        role="region"
        aria-label={`${game.name} controls`}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        {(expanded || mounted) && (
          <div className="max-h-[calc(100dvh-18rem)] overflow-y-auto px-4 pb-4 pt-4">
            <GameControlsView
              entry={entry}
              state={state}
              actions={actions}
              now={now}
              layout="focus"
              columns={columns}
              // The close lives in the card's own header row rather than floating
              // over it — the header already owns that corner (dailies ring).
              headerTrailing={
                <span className="flex shrink-0 items-center gap-2.5">
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 rounded-ui-full ${tier === 'high' ? 'warn-pulse' : ''}`}
                    style={{
                      background: URGENCY_DOT[tier],
                      boxShadow: `0 0 ${tier === 'high' ? 10 : 8}px ${URGENCY_DOT[tier]}`,
                    }}
                  />
                  <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded
                    aria-controls={controlsId}
                    aria-label={`Collapse ${game.name} controls`}
                    className="flex h-10 w-10 items-center justify-center rounded-ui-full bg-fill-2 text-muted ring-1 ring-line-hairline transition hover:bg-fill-4 hover:text-white"
                  >
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6 15l6-6 6 6" />
                    </svg>
                  </button>
                </span>
              }
              onEditGame={onEditGame}
              onOpenEvent={onOpenGameEvent}
            />
          </div>
        )}
      </div>
    </article>
  );
}

export function NexusLayout({
  state,
  entries,
  displayIds,
  now,
  gameControlActions,
  onEditGame,
  onOpenGameEvent,
  onOpenEvent,
  onToggleEvent,
  onOpenReminder,
  onOpenTimeline,
}: SharedNexusProps) {
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const focusColumns = useUI((store) => store.focusColumns);
  const wideEnough = useMediaQuery('(min-width: 1500px)');
  const columns = focusColumns === 'auto' ? (wideEnough ? 2 : 1) : focusColumns === 'two' ? 2 : 1;
  const derived = useDerived(now);
  const stageRef = useRef<HTMLDivElement>(null);
  const entryById = new Map(entries.map((entry) => [entry.game.id, entry]));
  const visibleIds = displayIds.filter((id) => entryById.has(id));
  const leftCount = Math.ceil(visibleIds.length / 2);
  const leftIds = visibleIds.slice(0, leftCount);
  const rightIds = visibleIds.slice(leftCount);
  const activeExpandedGameId = expandedGameId && visibleIds.includes(expandedGameId) ? expandedGameId : null;
  const expandedSide = activeExpandedGameId ? (leftIds.includes(activeExpandedGameId) ? 'left' : 'right') : undefined;
  const energyById = new Map<string, { resource: Resource | undefined; projection: EnergyProjection | null }>(
    visibleIds.map((id) => {
      const entry = entryById.get(id)!;
      const resource = state.resources
        .filter(
          (candidate) => candidate.gameId === id && !candidate.deleted && effectiveResourceKind(candidate) === 'regen',
        )
        .sort((a, b) => a.sort - b.sort)[0];
      return [
        id,
        {
          resource,
          projection: resource ? projectEnergy(resource, derived.snaps.get(resource.id), now, entry.game) : null,
        },
      ];
    }),
  );

  useEffect(() => {
    if (activeExpandedGameId == null) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || stageRef.current?.contains(target)) return;
      if (target.closest(LAYER_SELECTOR)) return;
      setExpandedGameId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [activeExpandedGameId]);

  const renderRail = (ids: string[], side: 'left' | 'right') => (
    <aside className="relative z-10 flex min-w-0 flex-col justify-center gap-3" aria-label={`${side} game rail`}>
      {ids.map((id) => {
        const entry = entryById.get(id)!;
        const energy = energyById.get(id)!;
        const openDailyCount = (derived.checklistByGame.get(id) ?? []).filter(
          (item) => item.cadence === 'daily' && !item.done,
        ).length;
        return (
          <NexusNode
            key={id}
            entry={entry}
            state={state}
            now={now}
            expanded={activeExpandedGameId === id}
            collapsed={activeExpandedGameId != null && activeExpandedGameId !== id}
            columns={columns}
            reducedMotion={reducedMotion}
            primary={energy.resource}
            projection={energy.projection}
            openDailyCount={openDailyCount}
            actions={gameControlActions}
            onToggle={() => setExpandedGameId((current) => (current === id ? null : id))}
            onEditGame={onEditGame}
            onOpenGameEvent={onOpenGameEvent}
          />
        );
      })}
    </aside>
  );

  return (
    <div
      ref={stageRef}
      className="nexus-stage relative grid min-h-[35rem] items-stretch gap-[clamp(1.75rem,4vw,4rem)]"
      data-focus={expandedSide}
      onClick={(event) => {
        if (activeExpandedGameId == null) return;
        const target = event.target as HTMLElement;
        if (!target.closest('.nexus-node') && !target.closest(INTERACTIVE_SELECTOR)) setExpandedGameId(null);
      }}
    >
      {renderRail(leftIds, 'left')}
      <NexusHub
        state={state}
        entries={entries}
        now={now}
        onOpenEvent={onOpenEvent}
        onToggleEvent={onToggleEvent}
        onOpenReminder={onOpenReminder}
        onOpenTimeline={onOpenTimeline}
      />
      {renderRail(rightIds, 'right')}
    </div>
  );
}
