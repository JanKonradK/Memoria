import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import type { GameEvent, GameUrgency } from '@memoria/shared';
import { useDerived, type Derived } from '../selectors';
import { useUI } from '../ui-store';
import { useMediaQuery } from '../hooks';
import { useFlip } from '../flip';
import { fmtDur } from '../util';
import { gameInk } from '../game-color';
import { gameShellVars, useGround, useTheme } from '../theme';
import { navigateWorkspace } from '../workspace-navigation';
import { readingSource } from '../reading-source';
import { useReadings } from '../readings';
import { useIdentityColors } from './roster';
import { GameControls } from './GameCard';
import { GameLogo } from './GameLogo';
import { TickNumber } from './TickNumber';
import { GamePage } from './GamePage';
import { SourceIcon } from './GameReadings';
import { NexusHub } from './nexus/NexusHub';
import { TodayNotices } from './TodayNotices';
import { ProgressBar } from './primitives';
import { Btn, GameBadge, Page, Tooltip } from './ui';
import '../today.css';

function openGame(gameId: string) {
  const ui = useUI.getState();
  navigateWorkspace(gameId, null, () => {
    ui.setFocusedGameId(gameId);
    ui.setTab('home');
  });
}

const URGENT_MS = 2 * 60 * 60_000;

function PriorityRow({
  entry,
  derived,
  selected,
  desktop,
  onSelect,
}: {
  entry: GameUrgency;
  derived: Derived;
  selected: boolean;
  desktop: boolean;
  onSelect: () => void;
}) {
  const { game, next } = entry;
  const { now } = derived;
  const ground = useGround();
  const colors = useIdentityColors(derived.state.games)[game.id] ?? game;
  const { resource, projection } = derived.primaryEnergy(game.id);
  const source = readingSource(resource ? derived.snaps.get(resource.id) : undefined, now);
  const known = Boolean(resource && projection?.hasSnapshot);
  const dailies = (derived.checklistByGame.get(game.id) ?? []).filter((item) => item.cadence === 'daily');
  const done = dailies.filter((item) => item.done).length;
  const left = next ? next.at - now : null;
  const tone = left == null ? 'idle' : left <= 0 ? 'danger' : left < URGENT_MS ? 'warn' : 'calm';
  const compact = useMediaQuery('(max-width: 479px)');
  const descriptionId = `today-priority-${encodeURIComponent(game.id)}`;
  const summary = [
    next ? `${next.label}${left! > 0 ? ` in ${fmtDur(left!)}` : ' now'}` : 'No upcoming deadlines',
    resource &&
      (known && source
        ? `Estimated ${projection!.value} of ${resource.cap} ${resource.name} from ${source.label.toLowerCase()} reading ${source.age}`
        : `No ${resource.name} reading yet`),
    dailies.length > 0 && `${done} of ${dailies.length} dailies done`,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <li>
      <button
        type="button"
        className="today-priority-row"
        data-roster-game={game.id}
        aria-label={`${desktop ? 'Review' : 'Open'} ${game.name}${game.accountLabel ? ` ${game.accountLabel}` : ''}`}
        aria-describedby={descriptionId}
        aria-pressed={desktop ? selected : undefined}
        onClick={onSelect}
      >
        <span id={descriptionId} className="sr-only">
          {summary}
        </span>
        <span className="today-row-badge">
          <GameLogo game={game} size={compact ? 56 : 64} label="short" />
        </span>
        <span className="today-row-name">
          <span className="today-row-title text-body font-semibold text-fg">{game.name}</span>
          {game.accountLabel && <span className="today-row-account aside truncate text-meta">{game.accountLabel}</span>}
        </span>
        <span className="today-row-time numeral" data-tone={tone}>
          {left == null ? '—' : left <= 0 ? 'Now' : fmtDur(left)}
        </span>
        <span className="today-row-reading">
          {resource && (
            <>
              <span
                className="today-meter"
                data-known={known || undefined}
                style={
                  {
                    '--level': known ? Math.min(1, projection!.precise / resource.cap) : 0,
                    '--meter-ink': gameInk(colors, ground),
                  } as CSSProperties
                }
              >
                <span />
              </span>
              <span className="today-row-value numeral text-caption text-fg-soft">
                {known ? <TickNumber value={projection!.value} /> : '—'}
                <span className="text-muted">/{resource.cap}</span>
              </span>
              {known && source && (
                <Tooltip content={`Estimated from your ${source.label.toLowerCase()} reading, ${source.age}`}>
                  <span className="today-row-source numeral text-caption">
                    <SourceIcon kind={source.kind} />
                    {source.shortAge}
                  </span>
                </Tooltip>
              )}
            </>
          )}
          <span className="today-row-what aside truncate text-caption">{next?.label ?? 'No deadlines'}</span>
        </span>
        <span className="today-row-ring">
          {dailies.length > 0 && (
            <ProgressBar
              variant="ring"
              size={34}
              stroke={3.5}
              value={done / dailies.length}
              color={gameInk(colors, ground)}
            >
              {done === dailies.length ? (
                <svg viewBox="0 0 20 20" aria-hidden className="icon h-3.5 w-3.5" fill="none" stroke="currentColor">
                  <path d="m5 10.5 3.5 3.5L15 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className="numeral">
                  <TickNumber value={done} />/{dailies.length}
                </span>
              )}
            </ProgressBar>
          )}
        </span>
      </button>
    </li>
  );
}

function Group({ id, label, note, children }: { id: string; label: string; note?: string; children: ReactNode }) {
  return (
    <section className="today-group" aria-labelledby={id}>
      <div className="today-group-rule">
        <h2 id={id} className="text-meta font-semibold text-fg-soft">
          {label}
        </h2>
        <span aria-hidden />
        {note && <span className="numeral aside text-caption text-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export function TodayPage({ now }: { now: number }) {
  const derived = useDerived(now);
  const { state, order } = derived;
  const colors = useIdentityColors(state.games);
  const theme = useTheme();
  const desktop = useMediaQuery('(min-width: 900px)');
  const selectedId = useUI((ui) => ui.todayGameId);
  const setSelectedId = useUI((ui) => ui.setTodayGameId);
  // A window snapped narrower loses the pane. Anything open in that card follows
  // the player to the game's own page instead of disappearing with it.
  const wasDesktop = useRef(desktop);
  useEffect(() => {
    const open = useReadings.getState().panel?.gameId;
    if (wasDesktop.current && !desktop && open) openGame(open);
    wasDesktop.current = desktop;
  }, [desktop]);
  const openSheet = useUI((ui) => ui.openSheet);
  const setTab = useUI((ui) => ui.setTab);
  const openEvent = useCallback(
    (event: GameEvent) => openSheet({ kind: 'event', gameId: event.gameId, eventId: event.id }),
    [openSheet],
  );
  const openTimeline = useCallback(() => setTab('timeline'), [setTab]);
  const active = order.filter((entry) => !entry.game.paused);
  const paused = order.filter((entry) => entry.game.paused);
  const attentionUntil = now + state.settings.sleepHours * 3_600_000;
  const attention = active.filter((entry) => entry.next && entry.next.at <= attentionUntil);
  const canWait = active.filter((entry) => !entry.next || entry.next.at > attentionUntil);
  const selected = order.find((entry) => entry.game.id === selectedId) ?? attention[0] ?? active[0] ?? order[0];
  const date = DateTime.fromMillis(now, { zone: state.settings.localTz }).toFormat('cccc, d LLLL');
  const listRef = useFlip<HTMLDivElement>('[data-roster-game]', (node) => node.dataset.rosterGame ?? null);

  const rows = (entries: GameUrgency[]) => (
    <ul className="today-priority-list">
      {entries.map((entry) => (
        <PriorityRow
          key={entry.game.id}
          entry={entry}
          derived={derived}
          desktop={desktop}
          selected={selected?.game.id === entry.game.id}
          onSelect={() => (desktop ? setSelectedId(entry.game.id) : openGame(entry.game.id))}
        />
      ))}
    </ul>
  );

  return (
    <Page className="today-page">
      <div className="today-heading">
        <h1 className="text-title font-semibold tracking-[-0.02em] text-fg">Today</h1>
        <p className="aside text-meta text-muted">{date}</p>
      </div>
      <TodayNotices now={now} />
      {order.length === 0 ? (
        <section className="today-empty">
          <h2 className="text-heading font-semibold text-fg">Nothing tracked yet</h2>
          <p className="mt-2 text-body text-muted">Add a game to see what caps or resets next.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Btn kind="primary" onClick={() => openSheet({ kind: 'addGame' })}>
              Add your first game
            </Btn>
            <Btn onClick={() => setTab('settings')}>Connect my PC</Btn>
          </div>
        </section>
      ) : (
        <div className="today-layout">
          <div className="today-list" ref={listRef}>
            <Group id="today-attention" label="Needs attention" note={`next ${state.settings.sleepHours}h`}>
              {attention.length ? rows(attention) : <p className="today-clear text-meta text-muted">Nothing due.</p>}
            </Group>
            {canWait.length > 0 && (
              <Group id="today-can-wait" label="Can wait">
                {rows(canWait)}
              </Group>
            )}
            {paused.length > 0 && (
              <Group id="today-paused" label="Paused">
                <ul className="today-paused">
                  {paused.map(({ game }) => (
                    <li key={game.id}>
                      <button
                        type="button"
                        className="today-paused-game"
                        aria-label={`${desktop ? 'Review' : 'Open'} ${game.name}, paused`}
                        aria-pressed={desktop ? selected?.game.id === game.id : undefined}
                        onClick={() => (desktop ? setSelectedId(game.id) : openGame(game.id))}
                      >
                        <GameBadge short={game.short} {...(colors[game.id] ?? game)} size="sm" />
                        <span className="truncate text-meta">{game.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Group>
            )}
            {/* What closes and arrives across every game, after what each game needs. */}
            <NexusHub state={state} entries={order} now={now} onOpenEvent={openEvent} onOpenTimeline={openTimeline} />
          </div>
          {desktop && selected && (
            <div className="today-detail">
              <section
                key={selected.game.id}
                className="today-card"
                style={gameShellVars(selected.game, theme, colors[selected.game.id])}
                aria-label={`${selected.game.name} card`}
              >
                <GameControls
                  entry={selected}
                  now={now}
                  layout="focus"
                  actionsEnd={<Btn onClick={() => openGame(selected.game.id)}>Open full page</Btn>}
                />
              </section>
            </div>
          )}
        </div>
      )}
    </Page>
  );
}

/**
 * Today and the game page it opens load as one chunk. Opening a game then
 * renders in the same pass as the click, so focus and the arrival motion land
 * on a page that is already there.
 */
export function TodayRoute({ tab, now }: { tab: 'today' | 'home'; now: number }) {
  return tab === 'home' ? <GamePage now={now} /> : <TodayPage now={now} />;
}
