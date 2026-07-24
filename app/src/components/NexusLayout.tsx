import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { DateTime } from 'luxon';
import type { AppState, GameEvent, GameUrgency } from '@technogg/shared';
import { checklistFor, effectiveResourceKind, latestSnapshots, projectEnergy, sleepCheck } from '@technogg/shared';
import { useMediaQuery, useReducedMotion } from '../hooks';
import { useUI } from '../ui-store';
import { endTone, fmtDur, tint } from '../util';
import { GameControlsView, type GameControlActions } from './GameCard';
import { ProgressRing } from './ProgressRing';
import { ProgressBar } from './primitives';
import { AgendaList, selectAgendaData } from './TimelineAgenda';
import { GameBadge } from './ui';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

type UrgencyTier = 'low' | 'med' | 'high';

const URGENCY_STROKE: Record<UrgencyTier, number> = { low: 1.6, med: 2.6, high: 3.8 };
const URGENCY_SPEED: Record<UrgencyTier, string> = { low: '2.4s', med: '2s', high: '1.3s' };
const URGENCY_DOT: Record<UrgencyTier, string> = {
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

/**
 * A conduit is drawn as a real cable: a dark jacket, ribbed rim highlights on
 * that jacket, the game-tinted fibre core, and the light pulse travelling inside.
 */
type ConduitPaths = {
  jacket?: SVGPathElement;
  rim?: SVGPathElement;
  core?: SVGPathElement;
  pulse?: SVGPathElement;
};

/** How far the jacket extends past the fibre core on each side. */
const CONDUIT_JACKET_PAD = 6;

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
  actions,
  setElement,
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
  actions: GameControlActions;
  setElement: (element: HTMLElement | null) => void;
  onToggle: () => void;
  onEditGame: (gameId: string) => void;
  onOpenGameEvent: (eventId: string, gameId: string) => void;
}) {
  const { game, next } = entry;
  const tier = urgencyTier(entry, now);
  const nodeRef = useRef<HTMLElement | null>(null);
  // The control that opened the card is gone once it is open, so hand focus to
  // the card itself — keyboard users land inside it, and Escape has a target.
  useEffect(() => {
    if (expanded) nodeRef.current?.focus({ preventScroll: true });
  }, [expanded]);
  const primary = state.resources
    .filter(
      (resource) => resource.gameId === game.id && !resource.deleted && effectiveResourceKind(resource) === 'regen',
    )
    .sort((a, b) => a.sort - b.sort)[0];
  const projection = primary
    ? projectEnergy(primary, latestSnapshots(state.snapshots).get(primary.id), now, game)
    : null;
  const fraction = primary && projection ? projection.precise / Math.max(1, primary.cap) : 0;
  const controlsId = `nexus-controls-${game.id}`;

  return (
    <article
      ref={(element) => {
        nodeRef.current = element;
        setElement(element);
      }}
      className="nexus-node relative overflow-hidden rounded-ui-card bg-surface-1 outline-none transition-[box-shadow,opacity] duration-300"
      data-expanded={expanded || undefined}
      data-collapsed={collapsed || undefined}
      // Expanded, the card has no collapse control: any click that lands on the
      // card itself rather than on a control closes it, as does Escape.
      tabIndex={expanded ? -1 : undefined}
      onClick={
        expanded
          ? (event) => {
              if (!(event.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) onToggle();
            }
          : undefined
      }
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
            ? `inset 0 0 0 1.5px ${game.color}, 0 0 60px -18px ${tint(game.color, 0.7)}, 0 26px 50px -26px #000`
            : `inset 0 0 0 1px ${tint(game.color, 0.28)}, inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 40px -28px #000`,
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
      {expanded ? (
        <>
          {/* The card's own background is the collapse target — it sits behind the
              controls, so only empty space (and Escape) closes the card. */}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded
            aria-controls={controlsId}
            aria-label={`Collapse ${game.name} controls`}
            className="absolute inset-0 z-0 cursor-zoom-out rounded-ui-card"
          />
          <span
            aria-hidden
            className={`pointer-events-none absolute right-3 top-3 z-20 h-2.5 w-2.5 rounded-ui-full ${
              tier === 'high' ? 'warn-pulse' : ''
            }`}
            style={{
              background: URGENCY_DOT[tier],
              boxShadow: `0 0 ${tier === 'high' ? 10 : 8}px ${URGENCY_DOT[tier]}`,
            }}
          />
        </>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-controls={controlsId}
          aria-label={`Expand ${game.name} controls`}
          className="relative z-10 block w-full rounded-ui-card p-3 text-left transition hover:bg-white/[0.025]"
        >
          <span className="flex items-center gap-2.5">
            <GameBadge short={game.short} color={game.color} color2={game.color2} size="lg" />
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

          <span className="nexus-node-meter mt-2.5 grid grid-cols-[auto_minmax(2rem,1fr)] items-center gap-2.5">
            <span className="text-xs font-black tabular-nums text-fg-soft">
              {primary && projection && projection.hasSnapshot ? projection.value : '—'}
              <span className="font-medium text-dim">/{primary?.cap ?? '—'}</span>
            </span>
            <ProgressBar value={fraction} color={game.color} color2={game.color2} className="!mt-0 !h-1.5 min-w-8" />
          </span>

          <span className="nexus-node-deadline mt-2 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2 text-caption">
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
        className="nexus-node-body scrollbar-thin focus-bay"
        role="region"
        aria-label={`${game.name} controls`}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        <div className="max-h-[calc(100dvh-18rem)] overflow-y-auto px-4 pb-4 pt-4">
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
      </div>
    </article>
  );
}

function NexusHub({
  state,
  entries,
  now,
  hubRef,
  onOpenEvent,
  onToggleEvent,
  onOpenReminder,
  onOpenTimeline,
}: {
  state: AppState;
  entries: GameUrgency[];
  now: number;
  hubRef: React.RefObject<HTMLElement | null>;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
  onOpenReminder: () => void;
  onOpenTimeline: () => void;
}) {
  // A week, not a day: events run for days, so a 24h cut left "Upcoming" empty.
  // The selector already windows and budgets the rails — the hub just consumes it.
  const horizon = now + WEEK;
  const agenda = selectAgendaData(state, now, 'dashboard');
  const reminders = state.reminders
    .filter((reminder) => !reminder.deleted && reminder.at > now - DAY && reminder.at <= horizon)
    .sort((a, b) => a.at - b.at)
    .slice(0, 4);
  const dailyItems = entries.flatMap((entry) =>
    checklistFor(state, entry.game, now).filter((item) => item.cadence === 'daily'),
  );
  const resetGames = entries.flatMap((entry) => {
    if (entry.game.paused) return [];
    const items = checklistFor(state, entry.game, now).filter(
      (item) => (item.cadence === 'weekly' || item.cadence === 'monthly') && item.resetAt <= horizon,
    );
    if (items.length === 0) return [];
    return [
      {
        game: entry.game,
        done: items.filter((item) => item.done).length,
        total: items.length,
        resetAt: Math.min(...items.map((item) => item.resetAt)),
      },
    ];
  });
  const dailiesDone = dailyItems.filter((item) => item.done).length;
  const capsDuringSleep = entries.filter(
    (entry) => !entry.game.paused && sleepCheck(state, entry.game, state.settings.sleepHours, now).caps,
  );
  const timelineCount = agenda.live.length + agenda.upcoming.length + reminders.length;

  return (
    <section
      ref={hubRef}
      className="gold-hairline relative z-10 grid h-[calc(100dvh-13rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden rounded-ui-card p-4"
      aria-label="Across every game"
      style={{
        background:
          'linear-gradient(180deg, rgba(124,92,255,0.1), rgba(255,111,165,0.04) 40%, rgba(0,0,0,0.5)), var(--color-surface-1)',
        boxShadow:
          'inset 0 0 0 1px rgba(200,180,255,0.22), inset 0 1px 0 rgba(255,255,255,0.05), 0 30px 60px -30px #000',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            'linear-gradient(rgba(160,140,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(160,140,255,0.05) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          maskImage: 'radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 75%)',
        }}
      />
      <div className="grid gap-3">
        <header className="relative">
          <p className="text-caption font-bold uppercase tracking-[0.22em] text-dim">Across every game</p>
          <h2 className="mt-0.5 text-title font-black text-fg">Tonight at a glance</h2>
        </header>

        <div className="relative grid gap-2 min-[1500px]:grid-cols-[auto_minmax(0,1fr)]">
          <div className="flex items-center gap-3 rounded-ui-lg bg-surface-2/90 px-3 py-2.5 ring-1 ring-line">
            <ProgressRing
              fraction={dailyItems.length > 0 ? dailiesDone / dailyItems.length : 0}
              color="var(--color-accent)"
              size={54}
              stroke={4}
            >
              {dailiesDone}/{dailyItems.length}
            </ProgressRing>
            <div>
              <p className="text-title font-black tabular-nums text-fg">
                {dailiesDone}
                <span className="text-body text-dim">/{dailyItems.length}</span>
              </p>
              <p className="text-label text-muted">global dailies done</p>
            </div>
          </div>
          <div
            className={`flex items-center gap-2 rounded-ui-lg px-3 py-2.5 ring-1 ${
              capsDuringSleep.length > 0
                ? 'bg-danger/10 text-rose-100 ring-rose-300/30'
                : 'bg-ok/10 text-emerald-100 ring-emerald-300/25'
            }`}
          >
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-ui-full ${capsDuringSleep.length > 0 ? 'warn-pulse bg-danger' : 'bg-ok'}`}
            />
            <div className="min-w-0">
              <p className="text-body font-bold">
                {capsDuringSleep.length} {capsDuringSleep.length === 1 ? 'game caps' : 'games cap'} during your{' '}
                {state.settings.sleepHours}h sleep
              </p>
              <p className="truncate text-caption opacity-70">
                {capsDuringSleep.length > 0
                  ? capsDuringSleep.map((entry) => entry.game.short).join(' · ')
                  : 'Every tracked regen resource is sleep safe.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="scrollbar-thin relative grid min-h-0 gap-3 overflow-y-auto">
        <div className="relative flex items-baseline justify-between gap-2 border-b border-white/[0.07] pb-2">
          <h3 className="text-caption font-bold uppercase tracking-[0.2em] text-dim">Next 7 days</h3>
          <span className="text-caption font-bold tabular-nums text-muted">
            {timelineCount} {timelineCount === 1 ? 'item' : 'items'}
          </span>
        </div>
        <div className="relative">
          <AgendaList
            data={agenda}
            now={now}
            mode="dashboard"
            onOpenEvent={onOpenEvent}
            onToggleEvent={onToggleEvent}
          />
        </div>

        <section className="relative">
          <h3 className="mb-1.5 text-caption font-bold uppercase tracking-widest text-dim">Resets this week</h3>
          {resetGames.length > 0 ? (
            <div className="space-y-1">
              {resetGames.map(({ game, done, total, resetAt }) => (
                <div key={game.id} className="flex items-center gap-2 rounded-ui-lg bg-white/[0.025] px-2.5 py-2">
                  <GameBadge short={game.short} color={game.color} color2={game.color2} size="sm" />
                  <span className="min-w-0 flex-1 text-xs text-muted">
                    {done}/{total} weeklies
                  </span>
                  <span className="shrink-0 text-caption font-bold tabular-nums text-dim">
                    resets in {fmtDur(resetAt - now)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-ui-lg bg-white/[0.02] px-3 py-2 text-label text-faint">
              Nothing resets in the next 7 days.
            </p>
          )}
        </section>

        <section className="relative">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="text-caption font-bold uppercase tracking-widest text-dim">Reminders</h3>
            <button
              type="button"
              onClick={onOpenReminder}
              className="rounded-ui-md px-2 py-1 text-caption font-semibold text-muted transition hover:bg-white/[0.06] hover:text-white"
            >
              + Add
            </button>
          </div>
          {reminders.length > 0 ? (
            <div className="space-y-1">
              {reminders.map((reminder) => {
                const game = reminder.gameId ? agenda.games.get(reminder.gameId) : undefined;
                const due = reminder.at <= now;
                return (
                  <div key={reminder.id} className="flex items-start gap-2 rounded-ui-lg bg-white/[0.025] px-2.5 py-2">
                    {game ? (
                      <GameBadge
                        short={game.short}
                        color={game.color}
                        color2={game.color2}
                        size="sm"
                        className="mt-0.5"
                      />
                    ) : (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-ui-full bg-gold" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-fg-soft">{reminder.message}</p>
                      <p className={`mt-0.5 text-caption tabular-nums ${due ? 'text-rose-300' : 'text-dim'}`}>
                        {due
                          ? 'due now'
                          : `${DateTime.fromMillis(reminder.at).toFormat('dd LLL · HH:mm')} · in ${fmtDur(reminder.at - now)}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="rounded-ui-lg bg-white/[0.02] px-3 py-2 text-label text-faint">
              No reminders due in the next 7 days.
            </p>
          )}
        </section>
      </div>

      <button
        type="button"
        onClick={onOpenTimeline}
        className="relative min-h-10 w-full rounded-ui-lg bg-gradient-to-r from-accent/20 to-accent-2/15 px-3 py-2 text-xs font-bold text-violet-100 ring-1 ring-accent/30 transition hover:brightness-125"
      >
        Open full timeline →
      </button>
    </section>
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
  const idPrefix = useId().replace(/:/g, '');
  const stageRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const conduitRefs = useRef(new Map<string, ConduitPaths>());
  const conduitRef = (id: string, part: keyof ConduitPaths) => (element: SVGPathElement | null) => {
    const paths = conduitRefs.current.get(id) ?? {};
    if (element) paths[part] = element;
    else delete paths[part];
    if (Object.keys(paths).length > 0) conduitRefs.current.set(id, paths);
    else conduitRefs.current.delete(id);
  };
  const entryById = new Map(entries.map((entry) => [entry.game.id, entry]));
  const visibleIds = displayIds.filter((id) => entryById.has(id));
  const leftCount = Math.ceil(visibleIds.length / 2);
  const leftIds = visibleIds.slice(0, leftCount);
  const rightIds = visibleIds.slice(leftCount);
  const activeExpandedGameId = expandedGameId && visibleIds.includes(expandedGameId) ? expandedGameId : null;
  const expandedSide = activeExpandedGameId ? (leftIds.includes(activeExpandedGameId) ? 'left' : 'right') : undefined;
  const visualKey = visibleIds
    .map((id) => {
      const entry = entryById.get(id)!;
      return `${id}:${entry.game.color}:${entry.game.color2 ?? ''}:${urgencyTier(entry, now)}`;
    })
    .join('|');
  const idsKey = visibleIds.join('|');

  useEffect(() => {
    const stage = stageRef.current;
    const hub = hubRef.current;
    if (!stage || !hub) return;
    let frame: number | undefined;

    const draw = () => {
      const stageBox = stage.getBoundingClientRect();
      const hubBox = hub.getBoundingClientRect();
      for (const id of visibleIds) {
        const node = nodeRefs.current.get(id);
        const { jacket, rim, core, pulse } = conduitRefs.current.get(id) ?? {};
        const entry = entryById.get(id);
        if (!node || !jacket || !rim || !core || !pulse || !entry) continue;

        const nodeBox = node.getBoundingClientRect();
        const left = (nodeBox.left + nodeBox.right) / 2 < (hubBox.left + hubBox.right) / 2;
        const startX = (left ? nodeBox.right : nodeBox.left) - stageBox.left;
        const startY = (nodeBox.top + nodeBox.bottom) / 2 - stageBox.top;
        const endX = (left ? hubBox.left : hubBox.right) - stageBox.left;
        const endY =
          Math.max(hubBox.top + 16, Math.min(hubBox.bottom - 16, (nodeBox.top + nodeBox.bottom) / 2)) - stageBox.top;
        const middleX = (startX + endX) / 2;
        const path = `M ${startX} ${startY} C ${middleX} ${startY} ${middleX} ${endY} ${endX} ${endY}`;
        const selected = id === activeExpandedGameId;
        const dimmed = activeExpandedGameId != null && !selected;
        const width = URGENCY_STROKE[urgencyTier(entry, now)];

        const coreWidth = selected ? width + 1.6 : width;
        const jacketWidth = coreWidth + CONDUIT_JACKET_PAD;

        jacket.setAttribute('d', path);
        jacket.setAttribute('opacity', dimmed ? '0.4' : '0.92');
        jacket.setAttribute('stroke-width', String(jacketWidth));
        rim.setAttribute('d', path);
        rim.setAttribute('opacity', dimmed ? '0.06' : selected ? '0.4' : '0.22');
        rim.setAttribute('stroke-width', String(jacketWidth));
        core.setAttribute('d', path);
        core.setAttribute('opacity', dimmed ? '0.14' : selected ? '0.95' : '0.55');
        core.setAttribute('stroke-width', String(coreWidth));
        core.style.filter = `drop-shadow(0 0 ${selected ? 9 : 5}px ${entry.game.color})`;
        pulse.setAttribute('d', path);
        pulse.setAttribute('opacity', dimmed ? '0.05' : selected ? '0.85' : '0.5');
        pulse.setAttribute('stroke-width', String(width * 0.55 + (selected ? 0.8 : 0)));
      }
    };

    const loop = () => {
      draw();
      frame = requestAnimationFrame(loop);
    };
    const onTransitionEnd = (event: TransitionEvent) => {
      if (['grid-template-columns', 'grid-template-rows'].includes(event.propertyName)) draw();
    };

    if (reducedMotion) frame = requestAnimationFrame(draw);
    else loop();
    window.addEventListener('resize', draw);
    stage.addEventListener('transitionend', onTransitionEnd);
    const observer = new ResizeObserver(draw);
    observer.observe(stage);
    observer.observe(hub);
    for (const node of nodeRefs.current.values()) observer.observe(node);

    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', draw);
      stage.removeEventListener('transitionend', onTransitionEnd);
    };
    // Entries are represented by the stable id/tier keys; rect reads use live DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExpandedGameId, idsKey, reducedMotion, visualKey]);

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
        return (
          <NexusNode
            key={id}
            entry={entry}
            state={state}
            now={now}
            expanded={activeExpandedGameId === id}
            collapsed={activeExpandedGameId != null && activeExpandedGameId !== id}
            columns={columns}
            actions={gameControlActions}
            setElement={(element) => {
              if (element) nodeRefs.current.set(id, element);
              else nodeRefs.current.delete(id);
            }}
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
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible">
        <defs>
          {visibleIds.map((id, index) => {
            const game = entryById.get(id)!.game;
            return (
              <linearGradient key={id} id={`${idPrefix}-conduit-${index}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={game.color} />
                <stop offset="1" stopColor={game.color2 ?? game.color} />
              </linearGradient>
            );
          })}
        </defs>
        {visibleIds.map((id, index) => {
          const entry = entryById.get(id)!;
          const tier = urgencyTier(entry, now);
          return (
            <g key={id}>
              {/* Cable jacket: the fibre core reads as light running inside a sheath. */}
              <path
                ref={conduitRef(id, 'jacket')}
                fill="none"
                stroke="#0b0912"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {/* Ribbing on the jacket — short dashes across its full width. */}
              <path
                ref={conduitRef(id, 'rim')}
                fill="none"
                stroke="rgba(214,205,255,0.55)"
                strokeDasharray="1.5 7"
                vectorEffect="non-scaling-stroke"
              />
              <path
                ref={conduitRef(id, 'core')}
                fill="none"
                stroke={`url(#${idPrefix}-conduit-${index})`}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                ref={conduitRef(id, 'pulse')}
                fill="none"
                stroke="white"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className="nexus-conduit-pulse"
                style={{ animationDuration: URGENCY_SPEED[tier] }}
              />
            </g>
          );
        })}
      </svg>

      {renderRail(leftIds, 'left')}
      <NexusHub
        state={state}
        entries={entries}
        now={now}
        hubRef={hubRef}
        onOpenEvent={onOpenEvent}
        onToggleEvent={onToggleEvent}
        onOpenReminder={onOpenReminder}
        onOpenTimeline={onOpenTimeline}
      />
      {renderRail(rightIds, 'right')}
    </div>
  );
}
