import { useState } from 'react';
import { DateTime } from 'luxon';
import type { Game, GameUrgency, Snapshot } from '@memoria/shared';
import { useDerived, type Derived } from '../selectors';
import { useUI } from '../ui-store';
import { useMediaQuery } from '../hooks';
import { fmtDur } from '../util';
import { navigateWorkspace } from '../workspace-navigation';
import { useIdentityColors } from './roster';
import { Btn, GameBadge, Page } from './ui';
import '../today.css';

function openGame(gameId: string) {
  const ui = useUI.getState();
  navigateWorkspace(gameId, null, () => {
    ui.setFocusedGameId(gameId);
    ui.setTab('home');
  });
}

function openImport(gameId?: string) {
  document.dispatchEvent(new CustomEvent('memoria:open-import', { detail: { gameId } }));
}

function readingLabel(snapshot: Snapshot | undefined, now: number): string {
  if (!snapshot) return 'No reading yet';
  const provenance = snapshot.provenance;
  const source =
    provenance?.kind === 'account'
      ? 'Account'
      : provenance?.kind === 'screenshot'
        ? 'Screenshot'
        : provenance?.kind === 'estimate'
          ? 'Starting estimate'
          : 'Manual';
  const age = Math.max(0, now - (provenance?.observedAt ?? snapshot.takenAt));
  return `${source} · ${age < 60_000 ? 'just recorded' : `${fmtDur(age)} ago`}`;
}

function accountLabel(game: Game): string {
  return [game.accountLabel, game.tz].filter(Boolean).join(' · ');
}

function ActionSummary({ entry, now }: { entry: GameUrgency; now: number }) {
  const action = entry.next;
  return (
    <>
      {entry.game.paused
        ? 'Tracking paused'
        : action
          ? `${action.label}${action.at > now ? ` in ${fmtDur(action.at - now)}` : ''}`
          : 'No upcoming deadlines'}
    </>
  );
}

function ReadingDetail({ entry, derived }: { entry: GameUrgency; derived: Derived }) {
  const { resource, projection } = derived.primaryEnergy(entry.game.id);
  const snapshot = resource ? derived.snaps.get(resource.id) : undefined;
  return (
    <section className="today-detail panel rounded-ui-card p-5" aria-label={`${entry.game.name} next check-in`}>
      <h2 className="text-heading font-semibold text-fg">{entry.game.name}</h2>
      <p className="mt-1 break-words text-meta text-muted">{accountLabel(entry.game)}</p>
      {resource && (
        <div className="my-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-body font-medium text-fg-soft">{resource.name}</h3>
            <p className="numeral text-heading font-semibold text-fg">
              {projection?.hasSnapshot ? projection.value : '—'}{' '}
              <span className="text-meta font-normal text-muted">/ {resource.cap}</span>
            </p>
          </div>
          <p className="mt-2 text-meta text-muted">{readingLabel(snapshot, derived.now)}</p>
          {projection?.hasSnapshot && (
            <p className="mt-1 text-meta text-muted">Estimated now from your last reading.</p>
          )}
        </div>
      )}
      <div className="mb-5 border-t border-line pt-4">
        <h3 className="text-meta font-semibold text-fg-soft">Next up</h3>
        {entry.actions.length ? (
          <ul className="mt-2 space-y-3">
            {entry.actions.slice(0, 3).map((action, index) => (
              <li
                key={`${action.kind}-${index}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 text-meta"
              >
                <span className="text-fg-soft">{action.label}</span>
                <span className="numeral text-muted">
                  {action.at <= derived.now ? 'Now' : `in ${fmtDur(action.at - derived.now)}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-meta text-muted">
            {entry.game.paused
              ? 'Resume tracking in the game controls when you are ready.'
              : 'No tracked deadlines. Open the game to check your routines.'}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn kind="primary" onClick={() => openGame(entry.game.id)}>
          Open game
        </Btn>
        <Btn onClick={() => openImport(entry.game.id)}>Import readings</Btn>
      </div>
    </section>
  );
}

export function TodayPage({ now }: { now: number }) {
  const derived = useDerived(now);
  const { state, order } = derived;
  const colors = useIdentityColors(state.games);
  const desktop = useMediaQuery('(min-width: 1100px)');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openSheet = useUI((ui) => ui.openSheet);
  const setTab = useUI((ui) => ui.setTab);
  const active = order.filter((entry) => !entry.game.paused);
  const attentionUntil = now + state.settings.sleepHours * 3_600_000;
  const attention = active.filter((entry) => entry.next && entry.next.at <= attentionUntil);
  const canWait = active.filter((entry) => !entry.next || entry.next.at > attentionUntil);
  const selected = order.find((entry) => entry.game.id === selectedId) ?? attention[0] ?? active[0] ?? order[0];
  const date = DateTime.fromMillis(now, { zone: state.settings.localTz }).toFormat('cccc, d LLLL');

  const row = (entry: GameUrgency) => {
    const { resource, projection } = derived.primaryEnergy(entry.game.id);
    const snapshot = resource ? derived.snaps.get(resource.id) : undefined;
    const descriptionId = `today-priority-${encodeURIComponent(entry.game.id)}`;
    return (
      <li key={entry.game.id}>
        <button
          type="button"
          className="today-priority-row"
          data-roster-game={entry.game.id}
          aria-label={`${desktop ? 'Review' : 'Open'} ${entry.game.name}${entry.game.accountLabel ? ` ${entry.game.accountLabel}` : ''}`}
          aria-describedby={descriptionId}
          aria-pressed={desktop ? selected?.game.id === entry.game.id : undefined}
          onClick={() => (desktop ? setSelectedId(entry.game.id) : openGame(entry.game.id))}
        >
          <GameBadge short={entry.game.short} {...(colors[entry.game.id] ?? entry.game)} size="lg" />
          <span id={descriptionId} className="min-w-0 flex-1">
            <span className="block text-body font-semibold text-fg">{entry.game.name}</span>
            {entry.game.accountLabel && <span className="block text-meta text-muted">{entry.game.accountLabel}</span>}
            <span className="mt-1 block text-meta text-fg-soft">
              <ActionSummary entry={entry} now={now} />
            </span>
            {resource && (
              <span className="mt-1 block text-caption text-muted">
                {readingLabel(snapshot, now)}
                {projection?.hasSnapshot ? ` · Estimated ${projection.value}/${resource.cap}` : ''}
              </span>
            )}
          </span>
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="h-4 w-4 shrink-0 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="m7 4 6 6-6 6" />
          </svg>
        </button>
      </li>
    );
  };

  return (
    <Page className="today-page">
      <div className="today-heading">
        <div>
          <h1 className="text-title font-semibold tracking-[-0.02em] text-fg">Today</h1>
          <p className="mt-1 text-body text-muted">{date}</p>
        </div>
        {order.length > 0 && <Btn onClick={() => openImport()}>Import readings</Btn>}
      </div>
      {order.length === 0 ? (
        <section className="today-empty panel rounded-ui-card p-6">
          <h2 className="text-heading font-semibold text-fg">Your next check-in starts here</h2>
          <p className="mt-3 max-w-prose text-body text-muted">
            Add a game to see energy estimates, unfinished routines, and approaching deadlines together.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Btn kind="primary" onClick={() => openSheet({ kind: 'addGame' })}>
              Add your first game
            </Btn>
            <Btn onClick={() => setTab('settings')}>Connect my PC</Btn>
          </div>
        </section>
      ) : (
        <div className="today-layout">
          <aside className="today-roster" aria-label="Your games">
            <h2 className="mb-3 px-2 text-meta font-semibold text-muted">Your games</h2>
            <ul className="space-y-1">
              {order.map(({ game }) => (
                <li key={game.id}>
                  <button
                    type="button"
                    className="today-roster-button"
                    onClick={() => openGame(game.id)}
                    aria-label={`Open ${game.name} controls${game.accountLabel ? ` for ${game.accountLabel}` : ''}`}
                  >
                    <GameBadge short={game.short} {...(colors[game.id] ?? game)} />
                    <span className="min-w-0">
                      <span className="block truncate text-meta font-medium text-fg-soft">{game.name}</span>
                      <span className="block truncate text-caption text-muted">
                        {game.paused ? 'Paused' : game.accountLabel || 'Open controls'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-4 min-h-11 px-2 text-meta text-muted hover:text-fg"
              onClick={() => setTab('home')}
            >
              View all game controls
            </button>
          </aside>
          <div className="min-w-0">
            <section aria-labelledby="today-attention">
              <h2 id="today-attention" className="text-heading font-semibold text-fg">
                Needs attention
              </h2>
              <p className="mb-3 mt-1 text-meta text-muted">
                Caps and unfinished routines due in the next {state.settings.sleepHours} hours.
              </p>
              {attention.length ? (
                <ul className="today-priority-list">{attention.map(row)}</ul>
              ) : (
                <p className="py-5 text-body text-fg-soft">
                  No tracked deadlines in this window. You have room to choose.
                </p>
              )}
            </section>
            {canWait.length > 0 && (
              <section className="mt-8" aria-labelledby="today-can-wait">
                <h2 id="today-can-wait" className="mb-3 text-heading font-semibold text-fg">
                  Can wait
                </h2>
                <ul className="today-priority-list">{canWait.map(row)}</ul>
              </section>
            )}
            {active.length === 0 && (
              <p className="mt-3 text-body text-muted">All your games are paused. Open Games to resume tracking.</p>
            )}
            <p className="mt-6 text-meta text-muted">
              Readings describe your game progress. The header status shows device sync.
            </p>
          </div>
          {selected && <ReadingDetail entry={selected} derived={derived} />}
        </div>
      )}
    </Page>
  );
}
