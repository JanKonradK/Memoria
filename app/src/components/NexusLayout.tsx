import { useEffect, useRef, useState } from 'react';
import type { AppState, EnergyProjection, GameEvent, GameUrgency, Resource } from '@memoria/shared';
import { effectiveResourceKind, projectEnergy } from '@memoria/shared';
import { DateTime } from 'luxon';
import { titleFont } from '../fonts';
import { gameAccent, gameRim, gameTitleInk, resolveGameIdentityColors, type GameColors } from '../game-color';
import { useMediaQuery, useReducedMotion } from '../hooks';
import { useDerived } from '../selectors';
import { gameShellVars, useGround, useTheme } from '../theme';
import { tint } from '../util';
import { GameControlsView, type GameControlActions } from './GameCard';
import { ReactorTube } from './primitives';
import { NexusHub } from './nexus/NexusHub';

/** Mirrors --nexus-dur in app/src/index.css. */
const NEXUS_DUR_MS = 340;
const HOUR = 3_600_000;

type UrgencyTier = 'low' | 'med' | 'high';

const URGENCY_TONE: Record<UrgencyTier, string> = {
  low: 'var(--color-ok)',
  med: 'var(--color-warn)',
  high: 'var(--color-danger)',
};

/** The same time bands used by resource controls: red <2h, amber <8h, green beyond. */
function urgencyTier(entry: GameUrgency, now: number): UrgencyTier {
  if (entry.game.paused || !entry.next) return 'low';
  const remaining = entry.next.at - now;
  if (remaining < 2 * HOUR) return 'high';
  if (remaining < 8 * HOUR) return 'med';
  return 'low';
}

const SERVER_REGIONS: Record<string, string> = {
  'Etc/GMT+5': 'NA',
  'Etc/GMT-1': 'EU',
  'Etc/GMT-8': 'ASIA',
};

function offsetLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'UTC';

  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const offset = minutes > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : String(hours);
  return `UTC${offsetMinutes > 0 ? '+' : '−'}${offset}`;
}

export function serverRegionLabel(tz: string, now: number): string {
  if (SERVER_REGIONS[tz]) return SERVER_REGIONS[tz];
  if (/^(?:Etc\/)?(?:UTC|GMT)$/i.test(tz)) return 'UTC';

  const serverNow = DateTime.fromMillis(now, { zone: tz });
  if (!serverNow.isValid) return 'Server';

  // Use the current offset so real IANA zones follow daylight-saving time.
  // The narrow ranges cover the supported server regions and their seasonal
  // offsets. Other offsets stay explicit instead of getting a regional guess.
  if (serverNow.offset >= -10 * 60 && serverNow.offset <= -4 * 60) return 'NA';
  if (serverNow.offset >= 0 && serverNow.offset <= 3 * 60) return 'EU';
  if (serverNow.offset >= 7 * 60 && serverNow.offset <= 9 * 60) return 'ASIA';
  return offsetLabel(serverNow.offset);
}

/** Card countdowns stay in hours until the value reaches three digits. */
export function formatCardTimeLeft(ms: number): string {
  if (ms <= 0) return 'now';
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) return totalMinutes > 0 ? `${totalMinutes}m` : '<1m';

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 100) return `${totalHours}h`;
  return `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`;
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
  onOpenTimeline: () => void;
};

function NexusNode({
  entry,
  state,
  now,
  expanded,
  columns,
  reducedMotion,
  primary,
  projection,
  identityColors,
  actions,
  onToggle,
  onEditGame,
  onOpenGameEvent,
  relocated,
  railIndex,
}: {
  entry: GameUrgency;
  state: AppState;
  now: number;
  expanded: boolean;
  columns: 1 | 2;
  reducedMotion: boolean;
  primary: Resource | undefined;
  projection: EnergyProjection | null;
  identityColors: GameColors;
  actions: GameControlActions;
  onToggle: () => void;
  onEditGame: (gameId: string) => void;
  onOpenGameEvent: (eventId: string, gameId: string) => void;
  /** This card was pushed aside by another card opening — see nexusRelocate. */
  relocated: boolean;
  /** Position in its rail, so the displaced cards arrive in sequence. */
  railIndex: number;
}) {
  const { game, next } = entry;
  const theme = useTheme();
  const ground = useGround();
  const tier = urgencyTier(entry, now);
  const nodeRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(expanded);
  const [settled, setSettled] = useState(expanded);
  const collapsedTriggerRef = useRef<HTMLButtonElement | null>(null);
  const wasExpanded = useRef(expanded);
  // The control that opened the card is gone once it is open, so hand focus to
  // the card itself — keyboard users land inside it, and Escape has a target.
  //
  // Collapsing has the mirror problem: the focused card becomes a trigger in
  // the same commit, so focus would drop to <body> and the keyboard user loses
  // their place in the rail. Hand it to the trigger that replaces the card.
  // Guarded on the previous value so a card that mounts collapsed does not
  // steal focus.
  useEffect(() => {
    if (expanded) {
      nodeRef.current?.focus({ preventScroll: true });
    } else if (wasExpanded.current) {
      // Only reclaim focus the collapse itself dropped. Opening another card
      // collapses this one in the SAME commit, and focus then rightly belongs to
      // that card — grabbing it back leaves the newly opened card unfocused, so
      // its Escape handler never fires. Same guard as Disclosure.
      const active = document.activeElement;
      if (!active || active === document.body || nodeRef.current?.contains(active)) {
        collapsedTriggerRef.current?.focus({ preventScroll: true });
      }
    }
    wasExpanded.current = expanded;
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
  // Paused or unmeasured: colour remains, motion does not. A tube that has
  // stopped charging goes visually still, which is the signal that it is wasting.
  const charging = !game.paused && primary != null && projection?.hasSnapshot === true && fraction < 1;
  const controlsId = `nexus-controls-${game.id}`;
  // The game's most saturated usable colour, and the source of the card's cast.
  // Tinting with the PRIMARY is what left Genshin and Star Rail grey: both of
  // those are near-white creams, so over charcoal they lighten without carrying
  // any hue at all. gameRim already walks the trio for the member that is
  // actually chromatic, which is the one worth washing the card with.
  const identity = gameRim(identityColors, ground);
  const accent = gameAccent(identityColors, ground);
  const titleInk = gameTitleInk(identityColors, ground);
  const tintAmount = theme === 'dark' ? 0.09 : 0.12;
  const accountLabel = game.accountLabel?.trim();
  const serverLabel = serverRegionLabel(game.tz, now);

  return (
    <article
      ref={nodeRef}
      className="card-shell nexus-node relative overflow-hidden rounded-ui-card outline-none"
      // Only a card that is genuinely out of time pulses, and only while it is
      // closed: a breathing card you are typing into is a distraction, and if
      // everything pulses, nothing does.
      data-urgent={!expanded && tier === 'high' ? 'true' : undefined}
      data-expanded={expanded || undefined}
      data-settled={(expanded && settled) || undefined}
      data-relocated={relocated && !reducedMotion ? 'true' : undefined}
      style={{
        ...gameShellVars(game, theme, identityColors),
        ...(relocated && !reducedMotion ? { animationDelay: `${Math.min(railIndex, 4) * 45}ms` } : {}),
      }}
      // Nothing INSIDE an open card closes it. It used to collapse on any click
      // that missed a control, which meant misjudging the edge of an energy field
      // threw away the card you were working in. It closes from Escape or by
      // clicking off the card entirely.
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
    >
      {/* A faint raking tint sits above the shared charcoal shell. Small identity
          parts keep the full game colour; the card body only whispers it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-ui-card"
        style={{
          background: [
            `linear-gradient(155deg, ${tint(identity, tintAmount)}, transparent 62%)`,
            `linear-gradient(335deg, ${tint(accent, tintAmount)}, transparent 56%)`,
          ].join(', '),
        }}
      />
      {/* The glint along the top edge: the game's two colours running out to
          nothing at both ends. Small, and most of what made the old card feel lit
          from somewhere rather than filled in. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-4 top-0 z-20 h-0.5 rounded-ui-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${identity}, ${accent}, transparent)`,
        }}
      />
      {!expanded && (
        <button
          type="button"
          ref={collapsedTriggerRef}
          onClick={onToggle}
          aria-expanded={false}
          aria-controls={controlsId}
          aria-label={`Expand ${game.name}${accountLabel ? `, ${accountLabel}` : ''} controls`}
          className="relative z-10 grid h-full w-full grid-rows-3 rounded-ui-card px-3 py-2 text-left transition-colors hover:bg-fill-1"
        >
          <span className="relative z-10 flex min-w-0 items-center gap-2">
            <span
              className={`max-w-20 shrink-0 truncate rounded-ui-sm border border-line-edge bg-inset px-1.5 py-0.5 text-caption font-semibold text-fg-soft ${serverLabel.startsWith('UTC') && serverLabel !== 'UTC' ? 'numeral' : ''}`}
            >
              {serverLabel}
            </span>
            {/* Display faces set the same character count at different widths.
                One title step plus truncation keeps every card consistent. */}
            <span
              className="min-w-0 flex-1 truncate text-title font-semibold"
              style={{ fontFamily: titleFont(game.titleFont), color: titleInk }}
            >
              {game.name}
            </span>
            {accountLabel && (
              <>
                <span aria-hidden className="h-3 w-px shrink-0 bg-line-edge" />
                <span className="min-w-0 max-w-[45%] shrink-0 truncate text-right text-body font-semibold text-fg-soft">
                  {accountLabel}
                </span>
              </>
            )}
          </span>

          <span className="relative z-10 flex min-w-0 items-center">
            <span className="block w-full min-w-0">
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-body font-medium text-fg-soft">
                  {primary?.name ?? (game.paused ? 'Tracking paused' : 'No regen resource')}
                </span>
                <span className="numeral shrink-0 text-lead text-fg">
                  {primary && projection && projection.hasSnapshot ? projection.value : '—'}
                  <span className="text-muted">/{primary?.cap ?? '—'}</span>
                </span>
              </span>

              <ReactorTube
                value={fraction}
                // The tube reports a level that can be at fault. Urgency owns that
                // colour once the vessel is full or nearly so; below that it is the
                // game's own tone.
                tone={fraction >= 1 ? 'var(--color-danger)' : fraction >= 0.9 ? 'var(--color-warn)' : titleInk}
                charging={charging}
                height={6}
                className="!mt-1"
              />
            </span>
          </span>

          <span className="relative z-10 flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-caption text-muted">
              {next?.label ?? (game.paused ? 'Tracking paused' : 'All clear')}
            </span>
            <span className="numeral shrink-0 text-caption" style={{ color: URGENCY_TONE[tier] }}>
              {next ? (next.at <= now ? 'NOW' : formatCardTimeLeft(next.at - now)) : '—'}
            </span>
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
          <div className="max-h-(--stage-h) overflow-y-auto px-4 pb-4 pt-4">
            <GameControlsView
              entry={entry}
              state={state}
              actions={actions}
              now={now}
              layout="focus"
              columns={columns}
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
  onOpenTimeline,
}: SharedNexusProps) {
  const [expandedCard, setExpandedCard] = useState<{ gameId: string; side: 'left' | 'right' } | null>(null);
  const reducedMotion = useReducedMotion();
  const wideEnough = useMediaQuery('(min-width: 1500px)');
  const columns = wideEnough ? 2 : 1;
  const derived = useDerived(now);
  const stageRef = useRef<HTMLDivElement>(null);
  const entryById = new Map(entries.map((entry) => [entry.game.id, entry]));
  const identityColors = resolveGameIdentityColors(entries.map((entry) => entry.game));
  const visibleIds = displayIds.filter((id) => entryById.has(id));
  const activeExpandedGameId = expandedCard && visibleIds.includes(expandedCard.gameId) ? expandedCard.gameId : null;
  const leftCount = Math.ceil(visibleIds.length / 2);
  const restingLeftIds = visibleIds.slice(0, leftCount);
  const restingRightIds = visibleIds.slice(leftCount);
  const expandedSide = activeExpandedGameId ? expandedCard?.side : undefined;
  const otherIds = activeExpandedGameId ? visibleIds.filter((id) => id !== activeExpandedGameId) : [];
  const leftIds = activeExpandedGameId ? (expandedSide === 'left' ? [activeExpandedGameId] : otherIds) : restingLeftIds;
  const rightIds = activeExpandedGameId
    ? expandedSide === 'right'
      ? [activeExpandedGameId]
      : otherIds
    : restingRightIds;
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
      setExpandedCard(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [activeExpandedGameId]);

  const renderRail = (ids: string[], side: 'left' | 'right') => (
    <aside
      className="nexus-rail scrollbar-thin relative z-10 flex min-w-0 flex-col overflow-y-auto"
      aria-label={`${side} game rail`}
    >
      {ids.map((id, index) => {
        const entry = entryById.get(id)!;
        const energy = energyById.get(id)!;
        return (
          <NexusNode
            key={id}
            entry={entry}
            state={state}
            now={now}
            relocated={activeExpandedGameId != null && id !== activeExpandedGameId}
            railIndex={index}
            expanded={activeExpandedGameId === id}
            columns={columns}
            reducedMotion={reducedMotion}
            primary={energy.resource}
            projection={energy.projection}
            identityColors={identityColors[id] ?? entry.game}
            actions={gameControlActions}
            onToggle={() => setExpandedCard((current) => (current?.gameId === id ? null : { gameId: id, side }))}
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
      className="nexus-stage relative grid items-stretch gap-[clamp(0.75rem,1.4vw,1.5rem)]"
      data-focus={expandedSide}
      onClick={(event) => {
        if (activeExpandedGameId == null) return;
        const target = event.target as HTMLElement;
        if (!target.closest('.nexus-node') && !target.closest(INTERACTIVE_SELECTOR)) setExpandedCard(null);
      }}
    >
      {renderRail(leftIds, 'left')}
      <NexusHub state={state} entries={entries} now={now} onOpenEvent={onOpenEvent} onOpenTimeline={onOpenTimeline} />
      {renderRail(rightIds, 'right')}
    </div>
  );
}
