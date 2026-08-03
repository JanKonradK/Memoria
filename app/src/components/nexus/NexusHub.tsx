import { useState } from 'react';
import { DateTime } from 'luxon';
import type { AppState, GameEvent, GameUrgency } from '@void/shared';
import { useDerived } from '../../selectors';
import { fmtDur } from '../../util';
import { Disclosure } from '../Disclosure';
import { ProgressRing } from '../ProgressRing';
import { AgendaList } from '../TimelineAgenda';
import { GameBadge } from '../ui';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export function NexusHub({
  state,
  entries,
  now,
  onOpenEvent,
  onToggleEvent,
  onOpenReminder,
  onOpenTimeline,
}: {
  state: AppState;
  entries: GameUrgency[];
  now: number;
  onOpenEvent: (event: GameEvent) => void;
  onToggleEvent: (event: GameEvent) => void;
  onOpenReminder: () => void;
  onOpenTimeline: () => void;
}) {
  const derived = useDerived(now);
  // A week, not a day: events run for days, so a 24h cut left "Upcoming" empty.
  // The selector already windows and budgets the rails — the hub just consumes it.
  const horizon = now + WEEK;
  const agenda = derived.agenda('dashboard');
  const reminders = state.reminders
    .filter((reminder) => !reminder.deleted && reminder.at > now - DAY && reminder.at <= horizon)
    .sort((a, b) => a.at - b.at)
    .slice(0, 4);
  const checklistEntries = entries.map((entry) => ({
    entry,
    items: derived.checklistByGame.get(entry.game.id) ?? [],
  }));
  const dailyItems = checklistEntries.flatMap(({ items }) => items.filter((item) => item.cadence === 'daily'));
  const resetGames = checklistEntries.flatMap(({ entry, items }) => {
    if (entry.game.paused) return [];
    const resetItems = items.filter(
      (item) => (item.cadence === 'weekly' || item.cadence === 'monthly') && item.resetAt <= horizon,
    );
    if (resetItems.length === 0) return [];
    return [
      {
        game: entry.game,
        done: resetItems.filter((item) => item.done).length,
        total: resetItems.length,
        resetAt: Math.min(...resetItems.map((item) => item.resetAt)),
      },
    ];
  });
  const dailiesDone = dailyItems.filter((item) => item.done).length;
  const capsDuringSleep = entries.filter((entry) => !entry.game.paused && derived.sleepFor(entry.game.id).caps);
  const timelineCount = agenda.live.length + agenda.upcoming.length + agenda.endingSoon.length + reminders.length;
  const [openSection, setOpenSection] = useState<'timeline' | 'resets' | 'reminders' | null>('timeline');

  // Hub height subtracts 17rem, not 13rem: Page now reserves the floating nav rail's
  // height (lg:pb-24), so the hub has to give that back or Games overflows the viewport.
  return (
    <section
      className="gold-hairline relative z-10 grid h-[calc(100dvh-17rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden rounded-ui-card p-4"
      aria-label="Across every game"
      style={{
        background:
          'linear-gradient(180deg, rgba(124,92,255,0.1), rgba(255,111,165,0.04) 40%, rgba(0,0,0,0.5)), var(--color-surface-1)',
        boxShadow: 'inset 0 0 0 1px var(--color-line-strong), inset 0 1px 0 var(--color-line-hairline)',
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
          <p className="mt-1 text-caption text-dim">A card glows when its next deadline is close.</p>
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
                ? 'bg-danger/10 text-danger-fg ring-danger/30'
                : 'bg-ok/10 text-ok-fg ring-ok/25'
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

      <div className="relative flex min-h-0 flex-col gap-1">
        <Disclosure
          open={openSection === 'timeline'}
          onOpenChange={(open) => setOpenSection(open ? 'timeline' : null)}
          title={<span className="text-caption font-bold uppercase tracking-[0.2em] text-dim">Event pulse</span>}
          summary={
            <span className="text-caption font-bold tabular-nums text-muted">
              {timelineCount} {timelineCount === 1 ? 'item' : 'items'}
            </span>
          }
          triggerLabel={`${openSection === 'timeline' ? 'Collapse' : 'Expand'} event pulse`}
          className="border-b border-line-hairline"
          triggerClassName="pb-1"
          contentClassName="h-full overflow-hidden pb-2"
          fill
        >
          <AgendaList
            data={agenda}
            now={now}
            mode="dashboard"
            onOpenEvent={onOpenEvent}
            onToggleEvent={onToggleEvent}
          />
        </Disclosure>

        <Disclosure
          open={openSection === 'resets'}
          onOpenChange={(open) => setOpenSection(open ? 'resets' : null)}
          title={<span className="text-caption font-bold uppercase tracking-widest text-dim">Resets this week</span>}
          summary={
            <span className="text-caption font-bold tabular-nums text-muted">
              {resetGames.length} {resetGames.length === 1 ? 'game' : 'games'}
            </span>
          }
          triggerLabel={`${openSection === 'resets' ? 'Collapse' : 'Expand'} Resets this week`}
          className="border-b border-line-hairline"
          triggerClassName="pb-1"
          contentClassName="scrollbar-thin h-full overflow-y-auto pb-2"
          fill
        >
          {resetGames.length > 0 ? (
            <div className="space-y-1">
              {resetGames.map(({ game, done, total, resetAt }) => (
                <div key={game.id} className="flex items-center gap-2 rounded-ui-lg bg-fill-1 px-2.5 py-2">
                  <GameBadge short={game.short} color={game.color} color2={game.color2} size="sm" />
                  <span className="min-w-0 flex-1 text-meta text-muted">
                    {done}/{total} weeklies
                  </span>
                  <span className="shrink-0 text-caption font-bold tabular-nums text-dim">
                    resets in {fmtDur(resetAt - now)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-ui-lg bg-fill-1 px-3 py-2 text-label text-muted">
              Nothing resets in the next 7 days.
            </p>
          )}
        </Disclosure>

        <Disclosure
          open={openSection === 'reminders'}
          onOpenChange={(open) => setOpenSection(open ? 'reminders' : null)}
          title={<span className="text-caption font-bold uppercase tracking-widest text-dim">Reminders</span>}
          summary={
            <span className="text-caption font-bold tabular-nums text-muted">
              {reminders.length} {reminders.length === 1 ? 'reminder' : 'reminders'}
            </span>
          }
          triggerLabel={`${openSection === 'reminders' ? 'Collapse' : 'Expand'} Reminders`}
          triggerClassName="pb-1"
          contentClassName="scrollbar-thin h-full overflow-y-auto pb-2"
          fill
        >
          <div className="mb-1.5 flex justify-end">
            <button
              type="button"
              onClick={onOpenReminder}
              className="rounded-ui-md px-2 py-1 text-caption font-semibold text-muted transition hover:bg-fill-2 hover:text-white"
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
                  <div key={reminder.id} className="flex items-start gap-2 rounded-ui-lg bg-fill-1 px-2.5 py-2">
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
                      <p className="truncate text-meta font-medium text-fg-soft">{reminder.message}</p>
                      <p className={`mt-0.5 text-caption tabular-nums ${due ? 'text-danger-fg' : 'text-dim'}`}>
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
            <p className="rounded-ui-lg bg-fill-1 px-3 py-2 text-label text-muted">
              No reminders due in the next 7 days.
            </p>
          )}
        </Disclosure>
      </div>

      <button
        type="button"
        onClick={onOpenTimeline}
        className="relative min-h-10 w-full rounded-ui-lg bg-gradient-to-r from-accent/20 to-accent-2/15 px-3 py-2 text-meta font-bold text-accent-fg ring-1 ring-accent/30 transition hover:brightness-125"
      >
        Open full timeline →
      </button>
    </section>
  );
}
