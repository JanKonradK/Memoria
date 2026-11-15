import { useState, type CSSProperties } from 'react';
import { DateTime } from 'luxon';
import { actBy, eventReward, isTickableDaily, nextQuietWindow, type Game, type GameUrgency } from '@memoria/shared';
import { useDerived, type Derived } from '../selectors';
import { selectAllClear, type AllClear } from '../all-clear';
import { useApp } from '../store';
import { useUI } from '../ui-store';
import { haptic, useMediaQuery } from '../hooks';
import { useFlip } from '../flip';
import { fmtClock, fmtDur } from '../util';
import { calendarSchedule } from '../event-schedule';
import { selectTodayAgenda, TODAY_AGENDA_HOURS, type TodayAgendaItem } from '../today-agenda';
import { gameInk } from '../game-color';
import { gameShellVars, useGround, useSurfaces } from '../theme';
import { openGame } from '../workspace-navigation';
import { isDesktopApp } from '../desktop-host';
import { readingSource } from '../reading-source';
import { useIdentityColors } from './roster';
import { GameControls } from './GameCard';
import { GameLogo } from './GameLogo';
import { TickNumber } from './TickNumber';
import { behindGames, behindText, useFeedDate } from './CalendarBehind';
import { GamePage } from './GamePage';
import { TodayNotices } from './TodayNotices';
import { TodayCodes } from './TodayCodes';
import { ProgressBar } from './primitives';
import { Btn, Page, Tooltip } from './ui';
import '../today.css';

const URGENT_MS = 2 * 60 * 60_000;

function PriorityRow({
  entry,
  derived,
  selected,
  desktop,
  onSelect,
  onTicked,
}: {
  entry: GameUrgency;
  derived: Derived;
  selected: boolean;
  desktop: boolean;
  onSelect: () => void;
  /** Ticking can make the day all clear, which folds the list away with its Undo. */
  onTicked: () => void;
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
  // The ring ticks every check-type daily from Today, with Undo, without opening the game.
  const completeDailies = useApp((store) => store.completeDailies);
  const undoActivity = useApp((store) => store.undoActivity);
  const journal = useApp((store) => store.history.journal);
  const [ticked, setTicked] = useState<string>();
  const canTick = !game.paused && dailies.some(isTickableDaily);
  const canUndo = Boolean(ticked && journal.some((entry) => entry.id === ticked && !entry.undone));
  const left = next ? next.at - now : null;
  // With quiet hours set, a reset at 03:00 is due when they begin, not at 03:00.
  const actLeft = next ? actBy(derived.state.settings, next.at, now) - now : null;
  const tone = left == null ? 'idle' : left <= 0 ? 'danger' : actLeft! < URGENT_MS ? 'warn' : 'calm';
  const compact = useMediaQuery('(max-width: 479px)');
  // The dailies ring matches the logo, so both ends of the row carry the same weight.
  const badge = compact ? 48 : 60;
  const descriptionId = `today-priority-${encodeURIComponent(game.id)}`;
  const summary = [
    next ? `${next.label}${left! > 0 ? ` in ${fmtDur(left!)}` : ' now'}` : 'No upcoming deadlines',
    resource &&
      (known && source
        ? `Estimated ${projection!.value} of ${resource.cap} ${resource.name}, ${source.kind === 'estimate' ? 'from a starting estimate' : `entered ${source.age}`}`
        : `No ${resource.name} reading yet`),
    dailies.length > 0 && `${done} of ${dailies.length} dailies done`,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <li className="today-priority-item">
      <button
        type="button"
        className="today-priority-row"
        data-roster-game={game.id}
        data-paused={game.paused || undefined}
        aria-label={`${desktop ? 'Review' : 'Open'} ${game.name}${game.accountLabel ? ` ${game.accountLabel}` : ''}${game.paused ? ', paused' : ''}`}
        aria-describedby={descriptionId}
        aria-pressed={desktop ? selected : undefined}
        onClick={onSelect}
      >
        <span id={descriptionId} className="sr-only">
          {summary}
        </span>
        <span className="today-row-badge">
          <GameLogo game={game} size={badge} />
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
                <Tooltip
                  content={
                    source.kind === 'estimate'
                      ? 'Starting guess. Enter the real value on the card.'
                      : `Entered ${source.age}`
                  }
                >
                  <span className="today-row-source numeral text-caption">{source.shortAge}</span>
                </Tooltip>
              )}
            </>
          )}
          <span className="today-row-what truncate text-caption">
            {next?.label ?? (resource && !known ? `Enter ${resource.name}` : 'No deadlines')}
          </span>
        </span>
        <span className="today-row-ring">
          {dailies.length > 0 && (
            <ProgressBar
              variant="ring"
              size={badge}
              stroke={compact ? 4 : 4.5}
              value={done / dailies.length}
              color={gameInk(colors, ground)}
            >
              {done === dailies.length ? (
                <svg viewBox="0 0 20 20" aria-hidden className="icon h-5 w-5" fill="none" stroke="currentColor">
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
      {(canTick || canUndo) && (
        <button
          type="button"
          className="today-ring-action"
          data-undo={canUndo || undefined}
          aria-label={canUndo ? `Undo ticking ${game.name} dailies` : `Tick all ${game.name} dailies`}
          title={canUndo ? 'Undo' : 'Tick all dailies'}
          onClick={() => {
            haptic();
            if (canUndo) {
              undoActivity(ticked!);
              setTicked(undefined);
            } else {
              onTicked();
              setTicked(completeDailies(game.id));
            }
          }}
        >
          {canUndo && <span className="today-ring-undo text-caption font-semibold">Undo</span>}
        </button>
      )}
    </li>
  );
}

const CADENCE_NOUN: Record<string, [string, string]> = {
  daily: ['daily', 'dailies'],
  weekly: ['weekly', 'weeklies'],
  monthly: ['monthly', 'monthlies'],
  custom: ['routine', 'routines'],
};
const AGENDA_PREVIEW = 10;

function agendaText(item: TodayAgendaItem, gameName: (id: string) => string, game?: Game) {
  const games = item.gameIds.map(gameName).join(', ');
  if (item.kind === 'energy') return { title: item.label, detail: games };
  if (item.kind === 'reset') {
    const [one, many] = CADENCE_NOUN[item.cadence] ?? CADENCE_NOUN.custom!;
    return { title: `${item.left} ${item.left === 1 ? one : many} reset`, detail: games };
  }
  const reward = item.edge === 'ends' && !item.event.done ? eventReward(item.event, game) : null;
  return {
    title: item.event.name,
    detail: `${item.edge === 'ends' ? 'Ends' : 'Starts'} · ${games}${reward ? ` · ${reward.label} unclaimed` : ''}`,
  };
}

/** Everything due across every game in the next day, under the list. */
function TodayAgenda({ derived, onSelectGame }: { derived: Derived; onSelectGame: (gameId: string) => void }) {
  const { state, now, order } = derived;
  const openSheet = useUI((ui) => ui.openSheet);
  const colors = useIdentityColors(state.games);
  const [expanded, setExpanded] = useState(false);
  const items = selectTodayAgenda(order, state.events, now);
  const byId = new Map(state.games.map((game) => [game.id, game]));
  const gameName = (id: string) => {
    const game = byId.get(id);
    return game ? (game.accountLabel ? `${game.name} (${game.accountLabel})` : game.name) : '';
  };
  const shown = expanded ? items : items.slice(0, AGENDA_PREVIEW);
  const behind = behindGames(state, now);
  const feedDate = useFeedDate();
  // Everything above this line has to happen before quiet hours begin.
  const quiet = nextQuietWindow(state.settings, now);
  const quietIndex = quiet ? shown.findIndex((item) => item.at >= quiet.start) : -1;

  return (
    <section className="today-agenda" aria-labelledby="today-agenda-heading">
      <div className="today-group-rule">
        <h2 id="today-agenda-heading" className="text-meta font-semibold text-fg-soft">
          Next {TODAY_AGENDA_HOURS}h
        </h2>
        <span aria-hidden />
        <span className="numeral text-caption text-muted">{items.length}</span>
      </div>
      {behind.length > 0 && (
        <ul className="today-agenda-behind">
          {behind.map(({ game, behind: status }) => (
            <li key={game.id} className="text-meta text-warn-fg" data-calendar-behind={game.id}>
              <span className="font-semibold">{gameName(game.id)}:</span> {behindText(status, feedDate)}
            </li>
          ))}
        </ul>
      )}
      {items.length === 0 ? (
        <p className="aside today-clear text-meta text-muted">Nothing ends, caps or resets.</p>
      ) : (
        <ul className="today-agenda-list">
          {shown.map((item, index) => {
            const { title, detail } = agendaText(item, gameName, byId.get(item.gameIds[0]!));
            const left = item.at - now;
            const actLeft = actBy(state.settings, item.at, now) - now;
            const calendar = item.kind === 'event' ? calendarSchedule(item.event) : undefined;
            // Something starting soon is news, not a deadline.
            const deadline = item.kind !== 'event' || item.edge === 'ends';
            const tone =
              item.kind === 'energy' && item.full ? 'danger' : deadline && actLeft < URGENT_MS ? 'warn' : 'calm';
            const divider = index === quietIndex && quiet && (
              <li key="quiet" className="today-agenda-quiet text-caption text-muted">
                <span aria-hidden />
                Quiet hours {fmtClock(quiet.start, state.settings.localTz)}–
                {fmtClock(quiet.end, state.settings.localTz)}
                <span aria-hidden />
              </li>
            );
            return [
              divider,
              <li key={item.key}>
                <button
                  type="button"
                  className="today-agenda-row"
                  data-kind={item.kind}
                  onClick={() =>
                    item.kind === 'event'
                      ? openSheet({ kind: 'eventPeek', eventId: item.event.id })
                      : onSelectGame(item.gameIds[0]!)
                  }
                >
                  <span className="today-agenda-logos" data-count={Math.min(item.gameIds.length, 3)}>
                    {item.gameIds.slice(0, 3).map((id) => {
                      const game = byId.get(id);
                      return game ? <GameLogo key={id} game={{ ...game, ...colors[id] }} size={30} /> : null;
                    })}
                  </span>
                  <span className="today-agenda-text">
                    <span
                      className={`truncate text-meta font-semibold ${item.kind === 'event' && item.edge === 'starts' ? 'text-fg-soft' : 'text-fg'}`}
                    >
                      {title}
                    </span>
                    <span className="aside truncate text-caption text-muted">{detail}</span>
                  </span>
                  <span className="today-agenda-when numeral" data-tone={tone}>
                    {calendar ? (
                      <span className="text-caption text-muted">{calendar.label}</span>
                    ) : (
                      <>
                        <span className="text-meta font-semibold">{left <= 0 ? 'Now' : fmtDur(left)}</span>
                        {left > 0 && (
                          <span className="text-caption text-muted">{fmtClock(item.at, state.settings.localTz)}</span>
                        )}
                      </>
                    )}
                  </span>
                </button>
              </li>,
            ];
          })}
        </ul>
      )}
      {items.length > AGENDA_PREVIEW && (
        <button
          type="button"
          className="today-agenda-more text-meta font-semibold"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show fewer' : `Show ${items.length - AGENDA_PREVIEW} more`}
        </button>
      )}
    </section>
  );
}

/**
 * The best moment the product has: every daily done and nothing capping before
 * the next reset. Quiet, and it says when it ends and what comes next.
 */
function AllClearNote({
  clear,
  zone,
  folded,
  gameCount,
  onShowGames,
}: {
  clear: AllClear;
  zone: string;
  folded: boolean;
  gameCount: number;
  onShowGames: () => void;
}) {
  return (
    <section className="today-all-clear" aria-labelledby="today-all-clear-heading" data-all-clear>
      <h2 id="today-all-clear-heading" className="text-heading font-semibold text-fg">
        All clear until <span className="numeral">{fmtClock(clear.until, zone)}</span>
      </h2>
      <p className="mt-1 text-meta text-muted">
        {clear.next ? (
          <>
            Next: {clear.next.gameName} · {clear.next.label} at{' '}
            <span className="numeral">{fmtClock(clear.next.at, zone)}</span>
          </>
        ) : (
          'Every daily is done and nothing caps before then.'
        )}
      </p>
      {folded && (
        <button
          type="button"
          className="mt-2 min-h-11 rounded-ui-md px-2 -ml-2 text-meta font-semibold text-fg-soft hover:bg-fill-2"
          onClick={onShowGames}
        >
          Show games <span className="numeral text-muted">{gameCount}</span>
        </button>
      )}
    </section>
  );
}

export function TodayPage({ now }: { now: number }) {
  const derived = useDerived(now);
  const { state, order } = derived;
  const colors = useIdentityColors(state.games);
  const surfaces = useSurfaces();
  const desktop = useMediaQuery('(min-width: 900px)');
  const selectedId = useUI((ui) => ui.todayGameId);
  const setSelectedId = useUI((ui) => ui.setTodayGameId);
  const openSheet = useUI((ui) => ui.openSheet);
  // One list, soonest first. Paused games follow, dimmed.
  const games = [...order.filter((entry) => !entry.game.paused), ...order.filter((entry) => entry.game.paused)];
  const selected = order.find((entry) => entry.game.id === selectedId) ?? games[0];
  const date = DateTime.fromMillis(now, { zone: state.settings.localTz }).toFormat('cccc, d LLLL');
  const listRef = useFlip<HTMLDivElement>('[data-roster-game]', (node) => node.dataset.rosterGame ?? null);
  const allClear = selectAllClear(derived);
  const [showGames, setShowGames] = useState(false);
  const listFolded = Boolean(allClear) && !showGames && !desktop;

  return (
    <Page className="today-page">
      <div className="today-heading">
        <h1 className="text-title font-semibold tracking-[-0.02em] text-fg">Today</h1>
        <p className="text-meta text-muted">{date}</p>
      </div>
      <TodayNotices now={now} />
      {order.length === 0 ? (
        <section className="today-empty">
          <h2 className="text-heading font-semibold text-fg">No games yet</h2>
          <div className="mt-5 flex flex-wrap gap-2">
            <Btn kind="primary" onClick={() => openSheet({ kind: 'addGame' })}>
              Add a game
            </Btn>
            {!isDesktopApp() && <Btn onClick={() => useUI.getState().openSettings('sync')}>Connect to PC</Btn>}
          </div>
        </section>
      ) : (
        <div className="today-layout">
          <div className="today-list" ref={listRef}>
            {allClear && (
              <AllClearNote
                clear={allClear}
                zone={state.settings.localTz}
                folded={listFolded}
                gameCount={games.length}
                onShowGames={() => setShowGames(true)}
              />
            )}
            <ul className="today-priority-list" aria-label="Games" hidden={listFolded}>
              {games.map((entry) => (
                <PriorityRow
                  key={entry.game.id}
                  entry={entry}
                  derived={derived}
                  desktop={desktop}
                  selected={selected?.game.id === entry.game.id}
                  onSelect={() => (desktop ? setSelectedId(entry.game.id) : openGame(entry.game.id))}
                  onTicked={() => setShowGames(true)}
                />
              ))}
            </ul>
            {/* Extras come after what is lost first: the games' own deadlines. */}
            <TodayCodes games={derived.state.games} now={now} />
            <TodayAgenda
              derived={derived}
              onSelectGame={(gameId) => (desktop ? setSelectedId(gameId) : openGame(gameId))}
            />
          </div>
          {desktop && selected && (
            <div className="today-detail">
              <section
                key={selected.game.id}
                className="today-card"
                style={gameShellVars(selected.game, surfaces, colors[selected.game.id])}
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
