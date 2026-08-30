import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameEvent } from '@memoria/shared';
import { detectLocalTz, missingPresetTasks } from '@memoria/shared';
import { useMediaQuery } from '../hooks';
import { useDerived } from '../selectors';
import { useApp } from '../store';
import { utcOffsetLabel } from '../timezone';
import { useUI } from '../ui-store';
import { GameCard } from './GameCard';
import { NexusLayout } from './NexusLayout';
import { Btn, Page } from './ui';

const PRESET_GAP_KEY = 'memoria-preset-gap-dismissed';
/** The key this counter shipped under before the rename. */
const LEGACY_PRESET_GAP_KEY = 'void-preset-gap-dismissed';
const LEGACY_HOME_TZ_KEY = 'memoria-legacy-home-timezone-dismissed';

function readDismissedGap(): number {
  return Number(localStorage.getItem(PRESET_GAP_KEY) ?? localStorage.getItem(LEGACY_PRESET_GAP_KEY) ?? '0');
}

function readLegacyHomeTzDismissed(): boolean {
  return localStorage.getItem(LEGACY_HOME_TZ_KEY) === '1';
}

export function DashboardPage({ now }: { now: number }) {
  const derived = useDerived(now);
  const { state, order, entryById } = derived;
  // Individual selectors (zustand action refs are stable). Grouped into one
  // object for passing down to the stage's game-control views.
  const upsertEvent = useApp((s) => s.upsertEvent);
  const setTaskDone = useApp((s) => s.setTaskDone);
  const startTaskTimer = useApp((s) => s.startTaskTimer);
  const restartTaskTimer = useApp((s) => s.restartTaskTimer);
  const advanceTaskTimer = useApp((s) => s.advanceTaskTimer);
  const setTaskCount = useApp((s) => s.setTaskCount);
  const setEnergy = useApp((s) => s.setEnergy);
  const adjustEnergy = useApp((s) => s.adjustEnergy);
  const addMissingPresetTasksEverywhere = useApp((s) => s.addMissingPresetTasksEverywhere);
  const updateSettings = useApp((s) => s.updateSettings);
  const dashboardStore = useMemo(
    () => ({
      state,
      upsertEvent,
      setTaskDone,
      startTaskTimer,
      restartTaskTimer,
      advanceTaskTimer,
      setTaskCount,
      setEnergy,
      adjustEnergy,
    }),
    [
      adjustEnergy,
      advanceTaskTimer,
      restartTaskTimer,
      setEnergy,
      setTaskCount,
      setTaskDone,
      startTaskTimer,
      state,
      upsertEvent,
    ],
  );
  const openSheet = useUI((s) => s.openSheet);
  const setTab = useUI((s) => s.setTab);
  const editGame = useCallback((gameId: string) => openSheet({ kind: 'game', gameId }), [openSheet]);
  const openGameEvent = useCallback(
    (eventId: string, gameId: string) => openSheet({ kind: 'event', eventId, gameId }),
    [openSheet],
  );
  const openEvent = useCallback(
    (event: GameEvent) => openSheet({ kind: 'event', gameId: event.gameId, eventId: event.id }),
    [openSheet],
  );
  const toggleEvent = useCallback(
    (event: GameEvent) => upsertEvent({ id: event.id, gameId: event.gameId, done: !event.done }),
    [upsertEvent],
  );
  const openTimeline = useCallback(() => setTab('timeline'), [setTab]);
  const wide = useMediaQuery('(min-width: 1280px)');

  // Card ORDER is frozen while you're on this page — live re-sorting made cards
  // jump away mid-entry. Values and timers stay live; position changes only when
  // re-sorting is asked for, or when the page is re-entered.
  const liveIds = order.map((o) => o.game.id);
  const [sortedIds, setSortedIds] = useState<string[]>(liveIds);
  const displayIds = [
    ...sortedIds.filter((id) => liveIds.includes(id)),
    ...liveIds.filter((id) => !sortedIds.includes(id)),
  ];

  // Asking for it is Refresh. The dashboard used to grow its own "Sort by
  // urgency" button whenever the order went stale, which meant two buttons for
  // one idea: bring what I am looking at up to date. Refresh bumps this counter
  // from the app bar and the order reseals here.
  const orderEpoch = useUI((s) => s.orderEpoch);
  useEffect(() => {
    setSortedIds(order.map((o) => o.game.id));
    // Deliberately keyed on the epoch alone: this fires when a reseal is
    // requested, not whenever the live order happens to change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderEpoch]);

  // Presets only apply when a game is ADDED, so a preset that grows later is
  // invisible to everyone already tracking that game — which is exactly the case
  // where the new routines matter. The banner is dismissed against the COUNT, so
  // it comes back when a later update adds more.
  const presetShortfalls = state.games
    .filter((game) => !game.deleted)
    .map(
      (game) =>
        missingPresetTasks(
          game,
          state.tasks.filter((task) => task.gameId === game.id),
        ).length,
    );
  const presetGap = presetShortfalls.reduce((sum, count) => sum + count, 0);
  const presetGamesBehind = presetShortfalls.filter((count) => count > 0).length;
  const [dismissedGap, setDismissedGap] = useState(readDismissedGap);
  const presetGapDismissed = dismissedGap >= presetGap;
  const detectedTz = detectLocalTz();
  const [legacyHomeTzDismissed, setLegacyHomeTzDismissed] = useState(readLegacyHomeTzDismissed);
  const showLegacyHomeTz =
    !legacyHomeTzDismissed && state.settings.localTz === 'Europe/Warsaw' && detectedTz !== 'Europe/Warsaw';

  return (
    <Page>
      {/* The games themselves are the content, so this page has no visible title
          — but every route still needs an h1 for the heading outline to start at
          the top. Matches the nav label. */}
      <h1 className="sr-only">Dashboard</h1>

      {/* Adding a game is one of three things you can add, so it lives in the app
          bar's single "+" alongside the other two rather than in a per-route
          toolbar of its own. The empty state below still offers it directly —
          a dashboard with nothing on it should say what to do next. */}

      {showLegacyHomeTz && (
        <section className="panel grain mb-3 rounded-ui-card p-3" aria-label="Home timezone correction">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-fg">Check your home timezone</p>
              <p className="mt-0.5 text-meta text-muted">
                Memoria is set to Europe/Warsaw ({utcOffsetLabel('Europe/Warsaw', now)}). This system reports{' '}
                {detectedTz} ({utcOffsetLabel(detectedTz, now)}).
              </p>
            </div>
            <button
              type="button"
              onClick={() => updateSettings({ localTz: detectedTz })}
              className="min-h-8 shrink-0 rounded-ui-md border border-line-strong bg-inset px-3 py-1 text-meta font-medium text-fg transition-colors hover:border-line-strong hover:bg-surface-2"
            >
              Switch to {detectedTz}
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem(LEGACY_HOME_TZ_KEY, '1');
                setLegacyHomeTzDismissed(true);
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ui-md text-muted transition-colors hover:text-fg"
              aria-label="Dismiss home timezone correction"
            >
              ✕
            </button>
          </div>
        </section>
      )}

      {presetGap > 0 && !presetGapDismissed && (
        <section className="panel grain mb-3 rounded-ui-card p-3" aria-label="New preset routines">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-fg">
                {presetGap} new {presetGap === 1 ? 'routine' : 'routines'} for {presetGamesBehind}{' '}
                {presetGamesBehind === 1 ? 'game' : 'games'}
              </p>
              <p className="mt-0.5 text-meta text-muted">
                Presets gained dailies and weeklies since these games were added. Nothing you deleted comes back.
              </p>
            </div>
            <button
              type="button"
              onClick={() => addMissingPresetTasksEverywhere()}
              className="min-h-8 shrink-0 rounded-ui-md border border-line-strong bg-inset px-3 py-1 text-meta font-medium text-fg transition-colors hover:border-line-strong hover:bg-surface-2"
            >
              Add them
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem(PRESET_GAP_KEY, String(presetGap));
                setDismissedGap(presetGap);
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ui-md text-muted transition-colors hover:text-fg"
              aria-label="Dismiss new routines"
            >
              ✕
            </button>
          </div>
        </section>
      )}

      {order.length === 0 ? (
        <div className="fade-in mx-auto mt-20 flex max-w-md flex-col items-start gap-3">
          <h2 className="text-heading font-semibold text-fg">Nothing is being tracked yet</h2>
          <p className="text-body text-muted">
            Add the games you actually play, then type in whatever energy each one is sitting on. Memoria projects it
            forward and tells you when it caps.
          </p>
          <Btn kind="ghost" onClick={() => openSheet({ kind: 'addGame' })} className="mt-1">
            Add your first game
          </Btn>
        </div>
      ) : (
        <>
          {wide ? (
            <NexusLayout
              state={state}
              entries={order}
              displayIds={displayIds}
              now={now}
              gameControlActions={dashboardStore}
              onEditGame={editGame}
              onOpenGameEvent={openGameEvent}
              onOpenEvent={openEvent}
              onToggleEvent={toggleEvent}
              onOpenTimeline={openTimeline}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {displayIds.map((id) => (
                <GameCard key={id} entry={entryById.get(id)!} now={now} />
              ))}
            </div>
          )}
        </>
      )}
    </Page>
  );
}
