import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import type { AppState, ChecklistItem, Game, GameUrgency } from '@memoria/shared';
import { bankCounterOf, effectiveResourceKind, endingSoon, isTickableDaily } from '@memoria/shared';
import { DESKTOP_CHROME_GLYPHS, keepFocus, type DesktopSurface, type DesktopWindow } from '../desktop-host';
import { useNow } from '../hooks';
import { useDerived } from '../selectors';
import { useApp } from '../store';
import { useUI, type Tab } from '../ui-store';
import { gameShellVars, useGround, useSurfaces } from '../theme';
import { gameInk } from '../game-color';
import { endTone, fmtDur } from '../util';
import { gameServerLabel, sameGameKey } from '../server-choice';
import { passSession } from '../session-focus';
import { useIdentityColors } from './roster';
import { EnergyControlRow, groupChecklist, hiddenRows, QuickSpendControls, type GameControlActions } from './GameCard';
import { GameLogo } from './GameLogo';
import { Tick } from './primitives';
import { ServerChip, Tooltip } from './ui';
import '../compact-card.css';

export { endingSoon };

/** The keyboard's home on the card: the reading's value. */
function focusReading(card: Element | null | undefined): void {
  card?.querySelector<HTMLInputElement>('[data-card-reading] .energy-value-input')?.focus();
}

/**
 * The card's game: the one asked for, else the game page open behind it, else
 * the most urgent one. Never a paused one; undefined when every game is paused.
 */
export function pickCardGame(
  order: readonly GameUrgency[],
  asked: string | null,
  behind: { tab: Tab; focusedGameId: string | null },
): Game | undefined {
  const live = order.map((entry) => entry.game).filter((game) => !game.deleted && !game.paused);
  const find = (id: string | null) => (id ? live.find((game) => game.id === id) : undefined);
  return find(asked) ?? (behind.tab === 'home' ? find(behind.focusedGameId) : undefined) ?? live[0];
}

/** The card's first bar: the game's main energy, else its first tracked stock. */
function primaryResource(state: AppState, game: Game, hidden: ReadonlySet<string>) {
  const resources = state.resources
    .filter((res) => res.gameId === game.id && !res.deleted && !hidden.has(`resource:${res.id}`))
    .sort((a, b) => a.sort - b.sort);
  const main =
    resources.find((res) => effectiveResourceKind(res) === 'regen') ??
    resources.find((res) => ['weekly', 'counter'].includes(effectiveResourceKind(res)));
  const counter = main ? bankCounterOf(main, resources) : undefined;
  return { main, counter: counter && !hidden.has(`resource:${counter.id}`) ? counter : undefined };
}

/**
 * The Windows app's quick card: the one window shrunk to a single game, to
 * update its energy and tick its dailies right after playing. Loaded only
 * while the card is up; the web, Android and the full window never load it.
 */
export function CompactGameCard({ host, surface }: { host: DesktopWindow; surface: DesktopSurface }) {
  const now = useNow(30_000);
  const derived = useDerived(now);
  const { state } = derived;
  const loaded = useApp((store) => store.loaded);
  const tab = useUI((store) => store.tab);
  const focusedGameId = useUI((store) => store.focusedGameId);
  // The switcher's pick, until the card is pointed at another game.
  const [choice, setChoice] = useState<{ asked: string | null; id: string | null }>({
    asked: surface.gameId,
    id: null,
  });
  if (choice.asked !== surface.gameId) setChoice({ asked: surface.gameId, id: null });
  const game = pickCardGame(derived.order, choice.id ?? surface.gameId, { tab, focusedGameId });
  const identityColors = useIdentityColors(state.games);
  const surfaces = useSurfaces();
  const [focused, setFocused] = useState(true);
  // The pin shows the press at once, and the host's word once it arrives.
  const [pinPressed, setPinPressed] = useState<boolean | null>(null);
  if (pinPressed !== null && pinPressed === surface.pinned) setPinPressed(null);
  const pinned = pinPressed ?? surface.pinned;
  const cardRef = useRef<HTMLDivElement>(null);
  // Inputs typed into since they were focused: Escape there throws the draft away, not the card.
  const drafting = useRef(new WeakSet<EventTarget>());

  // Sheets and full-screen layers clear the card's title bar as they clear the full one's.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.desktopChrome = '';
    return () => {
      delete root.dataset.desktopChrome;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const stop = host.onStateChanged((next) => {
      setFocused(next.focused);
      // Clicked into from elsewhere: the reading is where the keyboard goes.
      if (next.focused && (!document.activeElement || document.activeElement === document.body))
        focusReading(cardRef.current);
    });
    void host.getState().then(
      (next) => active && setFocused(next.focused),
      () => undefined,
    );
    return () => {
      active = false;
      stop();
    };
  }, [host]);

  // The player's own card opens on its reading; one Memoria opened waits to be clicked.
  const gameId = game?.id;
  useEffect(() => {
    if (!surface.autoOpened && gameId) focusReading(cardRef.current);
  }, [gameId, surface.autoOpened]);

  // Escape puts the card away, unless a dialog has the screen or a typed draft
  // is open: that Escape throws the draft away, as it does on the full card.
  // Captured, so it is seen before the field's own handler blurs the field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      const drafts = drafting.current;
      if (event.target && drafts.has(event.target)) {
        drafts.delete(event.target);
        return;
      }
      event.preventDefault();
      void host.exitCompact?.().catch(() => undefined);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [host]);

  const togglePin = () => {
    const next = !pinned;
    setPinPressed(next);
    void host.setCompactPin?.(next).catch(() => setPinPressed(null));
  };

  // Always the full app, never the tray: with no game to open it still comes forward.
  const openFull = () =>
    void host.exitCompact?.({ openGameId: game?.id ?? null, toTray: false }).catch(() => undefined);
  const close = () => void host.exitCompact?.().catch(() => undefined);
  const visualGame = game ? { ...game, ...(identityColors[game.id] ?? {}) } : undefined;

  return (
    <div
      ref={cardRef}
      className="compact-card"
      style={game ? gameShellVars(game, surfaces, identityColors[game.id]) : undefined}
      onInput={(event) => drafting.current.add(event.target)}
      onBlur={(event) => drafting.current.delete(event.target)}
    >
      <header data-window-chrome="" data-active={focused || undefined} className="compact-chrome">
        {visualGame && <GameLogo game={visualGame} size={20} className="compact-chrome-logo" />}
        <span className="compact-chrome-name">{visualGame?.name ?? 'Memoria'}</span>
        {visualGame && <AccountChip game={visualGame} games={state.games} now={now} />}
        {visualGame && (
          <GameSwitcher
            current={visualGame}
            games={derived.order.map((entry) => entry.game).filter((item) => !item.deleted && !item.paused)}
            onPick={(id) => {
              setChoice({ asked: surface.gameId, id });
              void host.enterCompact?.(id).catch(() => undefined);
            }}
          />
        )}
        <div className="compact-chrome-buttons">
          {host.setCompactPin && (
            <Tooltip content={pinned ? 'On top of other windows' : 'Keep on top of other windows'}>
              <button
                type="button"
                className="compact-chrome-glyph"
                aria-label="Keep on top"
                aria-pressed={pinned}
                onMouseDown={keepFocus}
                onClick={togglePin}
              >
                <span aria-hidden>{pinned ? DESKTOP_CHROME_GLYPHS.pinned : DESKTOP_CHROME_GLYPHS.pin}</span>
              </button>
            </Tooltip>
          )}
          <button type="button" className="compact-chrome-open" onMouseDown={keepFocus} onClick={openFull}>
            Open in Memoria <span aria-hidden>↗</span>
          </button>
          <button
            type="button"
            className="compact-chrome-glyph"
            aria-label="Close quick card"
            data-close=""
            onMouseDown={keepFocus}
            onClick={close}
          >
            <span aria-hidden>{DESKTOP_CHROME_GLYPHS.close}</span>
          </button>
        </div>
      </header>
      <main className="compact-card-body" aria-label={visualGame ? `${visualGame.name} quick card` : 'Quick card'}>
        {!loaded ? (
          <p role="status" className="compact-card-empty text-meta text-muted">
            Opening your games…
          </p>
        ) : !visualGame ? (
          <div className="compact-card-empty">
            <p className="text-body text-fg-soft">No game to update. Every game is paused, or none is tracked yet.</p>
            <button type="button" className="compact-card-action" onClick={openFull}>
              Open in Memoria <span aria-hidden>↗</span>
            </button>
          </div>
        ) : (
          <CardContent key={visualGame.id} game={visualGame} state={state} now={now} onOpen={openFull} />
        )}
      </main>
    </div>
  );
}

/** The game's server when the player tracks it on more than one account. */
function AccountChip({ game, games, now }: { game: Game; games: readonly Game[]; now: number }) {
  const key = sameGameKey(game);
  const accounts = games.filter((other) => !other.deleted && sameGameKey(other) === key).length;
  if (accounts < 2) return null;
  const account = game.accountLabel?.trim();
  return (
    <ServerChip
      label={account ? `${gameServerLabel(game, now)} · ${account}` : gameServerLabel(game, now)}
      className="compact-chrome-chip max-w-24 truncate"
    />
  );
}

/** A chevron over a native list of the other games: the keyboard and screen readers know it as is. */
function GameSwitcher({ current, games, onPick }: { current: Game; games: Game[]; onPick: (id: string) => void }) {
  if (games.length < 2) return null;
  return (
    <label className="compact-chrome-switch">
      <svg viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" className="icon h-3.5 w-3.5">
        <path d="m5.5 8 4.5 4.5L14.5 8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <select aria-label="Show another game" value={current.id} onChange={(event) => onPick(event.target.value)}>
        {games.map((game) => (
          <option key={game.id} value={game.id}>
            {game.accountLabel?.trim() ? `${game.name} · ${game.accountLabel.trim()}` : game.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CardContent({ game, state, now, onOpen }: { game: Game; state: AppState; now: number; onOpen: () => void }) {
  const derived = useDerived(now);
  // The same store actions the full card uses, so one reading or tick lands the same way.
  const setTaskDone = useApp((store) => store.setTaskDone);
  const restartTaskTimer = useApp((store) => store.restartTaskTimer);
  const advanceTaskTimer = useApp((store) => store.advanceTaskTimer);
  const setTaskCount = useApp((store) => store.setTaskCount);
  const setEnergy = useApp((store) => store.setEnergy);
  const adjustEnergy = useApp((store) => store.adjustEnergy);
  const actions = useMemo<GameControlActions>(
    () => ({ setTaskDone, restartTaskTimer, advanceTaskTimer, setTaskCount, setEnergy, adjustEnergy }),
    [adjustEnergy, advanceTaskTimer, restartTaskTimer, setEnergy, setTaskCount, setTaskDone],
  );
  const hidden = hiddenRows(game, state);
  const { main, counter } = primaryResource(state, game, hidden);
  const checklist = (derived.checklistByGame.get(game.id) ?? []).filter((item) => !hidden.has(`task:${item.taskId}`));
  const dailies = groupChecklist(checklist).find((group) => group.cadence === 'daily');
  const listRef = useRef<HTMLDivElement>(null);
  const ending = hidden.has('events') ? [] : endingSoon(state.events, game.id, now);

  // Enter in the reading moves on to the first daily still owed.
  const nextAfterReading = () => {
    const list = listRef.current;
    const target =
      list?.querySelector<HTMLElement>('[data-daily][aria-checked="false"]') ??
      list?.querySelector<HTMLElement>('[data-daily]');
    if (target) target.focus();
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  return (
    <>
      {main && (
        <section data-card-reading className="compact-card-reading" aria-label={`${main.name} for ${game.name}`}>
          <EnergyControlRow
            game={game}
            res={main}
            snap={derived.snaps.get(main.id)}
            counter={counter}
            counterSnap={counter ? derived.snaps.get(counter.id) : undefined}
            now={now}
            localTz={state.settings.localTz}
            setEnergy={actions.setEnergy}
            onCommitNext={nextAfterReading}
          />
          {!hidden.has('quick-spend') && <QuickSpendControls game={game} state={state} actions={actions} />}
        </section>
      )}
      {dailies && (
        <CardDailies
          game={game}
          items={dailies.items}
          now={now}
          actions={actions}
          listRef={listRef}
          onLeaveTop={() => focusReading(listRef.current?.closest('.compact-card'))}
        />
      )}
      {ending.length > 0 && (
        <section className="compact-card-section" aria-label={`Ending soon for ${game.name}`}>
          <h2 className="compact-card-rule">
            <span>Ends soon</span>
            <span aria-hidden className="compact-card-rule-line" />
          </h2>
          <ul className="compact-card-events">
            {ending.map((event) => (
              <li key={event.id}>
                <button type="button" className="compact-card-event" onClick={onOpen}>
                  <span className="min-w-0 flex-1 truncate text-fg-soft">{event.name}</span>
                  <span className="shrink-0 font-bold tabular-nums" style={{ color: endTone(event.end - now) }}>
                    {fmtDur(event.end - now)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!main && !dailies && ending.length === 0 && (
        <div className="compact-card-empty">
          <p className="text-body text-fg-soft">Nothing to update for {game.name} right now.</p>
          <button type="button" className="compact-card-action" onClick={onOpen}>
            Open in Memoria <span aria-hidden>↗</span>
          </button>
        </div>
      )}
    </>
  );
}

/** What pressing a daily does, as its row on the full card does. */
function pressDaily(item: ChecklistItem, actions: GameControlActions): void {
  if (item.mode === 'timer') {
    // A dispatch still out has nothing to collect yet.
    if (!item.timerRunning || item.timerReady) actions.restartTaskTimer(item.taskId, item.periodKey);
    return;
  }
  if (item.mode === 'count') {
    actions.setTaskCount(item.taskId, item.periodKey, item.done ? 0 : Math.min(item.countTarget, item.countDone + 1));
    return;
  }
  actions.setTaskDone(item.taskId, item.periodKey, !item.done);
}

function CardDailies({
  game,
  items,
  now,
  actions,
  listRef,
  onLeaveTop,
}: {
  game: Game;
  items: ChecklistItem[];
  now: number;
  actions: GameControlActions;
  listRef: RefObject<HTMLDivElement | null>;
  onLeaveTop: () => void;
}) {
  const ground = useGround();
  const color = gameInk(game, ground);
  const completeDailies = useApp((store) => store.completeDailies);
  const undoActivity = useApp((store) => store.undoActivity);
  const journal = useApp((store) => store.history.journal);
  const [ticked, setTicked] = useState<string>();
  const canUndo = ticked !== undefined && journal.some((entry) => entry.id === ticked && !entry.undone);
  const canTick = items.some(isTickableDaily);
  const done = items.filter((item) => item.done).length;

  // Up and down walk the dailies; up from the first goes back to the reading.
  const move = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-daily]') ?? [])];
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus();
    else if (event.key === 'ArrowUp') onLeaveTop();
  };

  return (
    <section className="compact-card-section" aria-label={`Daily tasks for ${game.name}`}>
      <h2 className="compact-card-rule">
        <span>Dailies</span>
        <span className="tabular-nums text-dim">
          {done}/{items.length}
        </span>
        <span aria-hidden className="compact-card-rule-line" />
        {canUndo ? (
          <button
            type="button"
            className="compact-card-tick"
            aria-label={`Undo completing dailies for ${game.name}`}
            onClick={() => {
              undoActivity(ticked);
              setTicked(undefined);
            }}
          >
            Undo
          </button>
        ) : (
          canTick && (
            <button
              type="button"
              className="compact-card-tick"
              aria-label={`Tick all dailies for ${game.name}`}
              onClick={() => {
                passSession(game.id, 'energy', 'reserve');
                setTicked(completeDailies(game.id));
              }}
            >
              <svg viewBox="0 0 20 20" aria-hidden className="icon h-4 w-4" fill="none" stroke="currentColor">
                <path d="m2.5 10.5 3 3 6.5-7M9.5 13l.5.5 6.5-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span aria-hidden>Tick all</span>
            </button>
          )
        )}
      </h2>
      <div ref={listRef} className="compact-card-dailies" onKeyDown={move}>
        {items.map((item) => {
          const waiting = item.mode === 'timer' && item.timerRunning && !item.timerReady;
          const partial = item.mode === 'count' && !item.done && item.countDone > 0;
          return (
            <button
              key={`${item.taskId}|${item.periodKey}`}
              type="button"
              role="checkbox"
              data-daily=""
              aria-checked={item.done ? true : partial ? 'mixed' : false}
              aria-disabled={waiting || undefined}
              className="compact-card-daily"
              onClick={() => {
                if (waiting) return;
                passSession(game.id, 'energy', 'reserve');
                pressDaily(item, actions);
              }}
            >
              <Tick
                color={color}
                checked={item.done}
                checkEnter="none"
                segments={item.mode === 'count' ? { current: item.countDone, total: item.countTarget } : undefined}
              />
              <span
                className={`min-w-0 flex-1 truncate ${item.done ? 'text-dim line-through' : item.core ? 'font-bold text-fg' : 'text-fg-soft'}`}
              >
                {item.name}
              </span>
              {item.mode === 'count' && (
                <span className="shrink-0 tabular-nums text-dim">
                  {item.countDone}/{item.countTarget}
                </span>
              )}
              {waiting && item.timerEndsAt != null && (
                <span className="shrink-0 tabular-nums text-dim">back in {fmtDur(item.timerEndsAt - now)}</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
