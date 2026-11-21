import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { EnergyBank, Game } from '@memoria/shared';
import { useAppUpdate } from '../../app-update';
import { cloudSyncNow } from '../../cloud-sync';
import { useMediaQuery, useNow, useReducedMotion } from '../../hooks';
import { syncLanNow, useLanSync } from '../../lan-sync';
import { todayStepsLeft, useDerived } from '../../selectors';
import { useApp } from '../../store';
import { syncNow } from '../../sync';
import { useUI } from '../../ui-store';
import { closeWorkspace, openGame } from '../../workspace-navigation';
import { gameInk, gameSupport } from '../../game-color';
import { useGround } from '../../theme';
import { GameLogo } from '../GameLogo';
import { useIdentityColors } from '../roster';
import { Logo } from '../Logo';
import { NavIcon, type NavGlyph } from '../../nav-icons';
import { Tooltip } from '../ui';
import { railCountdown } from './rail-countdown';
import './shell.css';

/** A route in the rail. Extra props come from a Tooltip wrapped around it. */
function RailView({
  label,
  icon,
  current,
  badge,
  describedBy,
  keyShortcuts,
  className = '',
  onClick,
  ...trigger
}: {
  className?: string;
  label: string;
  icon: NavGlyph;
  current: boolean;
  badge?: ReactNode;
  describedBy?: string;
  keyShortcuts?: string;
  onClick: () => void;
} & Omit<ComponentPropsWithRef<'button'>, 'onClick' | 'className'>) {
  return (
    <button
      {...trigger}
      type="button"
      className={`rail-view ${className}`}
      aria-current={current ? 'page' : undefined}
      aria-describedby={describedBy ?? trigger['aria-describedby']}
      aria-keyshortcuts={keyShortcuts}
      onClick={onClick}
    >
      <NavIcon glyph={icon} className="rail-icon" />
      <span className="rail-label">{label}</span>
      {badge}
    </button>
  );
}

type Place = 'calendar' | 'games' | 'today' | 'notes' | 'settings';
/** Upright, Today sits in the middle of the dock, under the thumb. */
const DOCK_ORDER: readonly Place[] = ['calendar', 'games', 'today', 'notes', 'settings'];
/** Down a wide screen's side Today leads; Games comes last so its list opens beneath it. */
const RAIL_ORDER: readonly Place[] = ['today', 'calendar', 'notes', 'games', 'settings'];

/** Upright, the rail is a dock along the bottom, so its tips rise above it. */
const useTipSide = () => (useMediaQuery('(orientation: portrait)') ? 'top' : 'right');

/** A text field keeps Ctrl+digit for itself. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable]'));

/** A game's bar and its bank, as the rail draws them. */
export interface RailEnergy {
  name: string;
  value: number;
  cap: number;
  bank: EnergyBank | null;
}

const fraction = (value: number | null, cap: number) => (value == null || cap <= 0 ? 0 : Math.min(1, value / cap));

/** "Original Resin 137 of 200, Condensed Resin 3 of 5": the meters, said. */
export function railEnergyText(energy: RailEnergy): string {
  const bar = `${energy.name} ${energy.value} of ${energy.cap}`;
  const { bank } = energy;
  if (!bank) return bar;
  return `${bar}, ${bank.label} ${bank.value == null ? 'not read yet' : `${bank.value} of ${bank.cap}`}`;
}

/**
 * One game in the rail: its face and how long until it next needs the player.
 * Its name is the button's text (read, not shown) so nothing visible is left
 * out of it; the countdown is shown, and said in full as the description.
 */
function RailGame({
  game,
  ink,
  at,
  label,
  now,
  current,
  shortcut,
  energy,
  support,
}: {
  game: Game;
  ink: string;
  /** The bar and its bank, drawn as two hairlines under the face. */
  energy?: RailEnergy;
  support: string;
  at?: number;
  label?: string;
  now: number;
  current: boolean;
  shortcut?: number;
}) {
  const descriptionId = useId();
  const tipSide = useTipSide();
  const countdown = at == null ? null : railCountdown(at - now);
  const account = game.accountLabel?.trim();
  const name = account ? `${game.name}, ${account}` : game.name;
  const next = game.paused ? 'Paused' : label && countdown ? `${label} in ${countdown.long}` : '';
  const reading = energy && !game.paused ? railEnergyText(energy) : '';
  const described = [next, reading].filter(Boolean).join('. ');
  return (
    <Tooltip
      side={tipSide}
      content={
        <>
          <span className="block font-semibold text-fg">{name}</span>
          {next && <span className="block">{next}</span>}
          {energy && !game.paused && (
            <span className="block numeral">
              {energy.name} {energy.value}/{energy.cap}
              {energy.bank && (
                <>
                  {' · '}
                  {energy.bank.label} {energy.bank.value ?? '—'}/{energy.bank.cap}
                </>
              )}
            </span>
          )}
          {shortcut && <span className="block text-muted">Ctrl+{shortcut}</span>}
        </>
      }
    >
      <button
        type="button"
        className="rail-game"
        data-rail-game={game.id}
        data-paused={game.paused || undefined}
        aria-current={current ? 'page' : undefined}
        aria-describedby={described ? descriptionId : undefined}
        aria-keyshortcuts={shortcut ? `Control+${shortcut}` : undefined}
        onClick={() => openGame(game.id)}
        style={{ '--rail-ink': ink, '--rail-ink-2': support } as CSSProperties}
      >
        <span aria-hidden className="rail-pin" />
        {/* Under 44px a text coin is a monogram, which is what a rail can read. */}
        <GameLogo game={game} size={42} className="rail-game-logo" />
        {energy && (
          <span aria-hidden className="rail-meters" data-banked={energy.bank ? true : undefined}>
            <span className="rail-meter" data-full={energy.value >= energy.cap || undefined}>
              <i style={{ transform: `scaleX(${fraction(energy.value, energy.cap)})` }} />
            </span>
            {energy.bank && (
              <span className="rail-meter rail-meter-bank" data-full={energy.bank.full || undefined}>
                <i style={{ transform: `scaleX(${fraction(energy.bank.value, energy.bank.cap)})` }} />
              </span>
            )}
          </span>
        )}
        <span aria-hidden className="rail-countdown numeral" data-tone={game.paused ? 'paused' : countdown?.tone}>
          {game.paused ? '—' : (countdown?.short ?? '·')}
        </span>
        <span className="sr-only">{name}</span>
        {described && (
          <span id={descriptionId} hidden>
            {described}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

/** Trouble says so and leads to the fix; healthy sync says nothing. */
function SyncAttention() {
  const desktop = useApp((s) => s.syncStatus);
  const desktopError = useApp((s) => s.syncError);
  const cloud = useApp((s) => s.cloudStatus);
  const cloudError = useApp((s) => s.cloudError);
  const lan = useLanSync((s) => s.status);
  const lanError = useLanSync((s) => s.error);
  const issue =
    desktop === 'error'
      ? desktopError || 'PC sync failed'
      : cloud === 'error' || cloud === 'needs-permission'
        ? cloudError || 'Sync file needs attention'
        : lan === 'error' || lan === 'offline'
          ? lanError || 'Device sync needs attention'
          : '';
  const tipSide = useTipSide();
  const syncing = [desktop, cloud, lan].includes('syncing') || lan === 'pairing';
  const synced = [desktop, cloud, lan].includes('ok');
  return (
    <span role="status" aria-live="polite" className="rail-status">
      {issue ? (
        <Tooltip content={issue} side={tipSide}>
          <button
            type="button"
            className="rail-view rail-trouble"
            onClick={() => useUI.getState().openSettings('sync')}
            aria-label={`Sync needs attention: ${issue}`}
          >
            <span aria-hidden className="rail-trouble-dot" />
            <span className="rail-label">Sync</span>
          </button>
        </Tooltip>
      ) : (
        <span className="sr-only">{syncing ? 'Syncing' : synced ? 'Synced' : 'Local mode'}</span>
      )}
    </span>
  );
}

/** Retry loading and syncing, shown only after something failed. */
function RefreshButton() {
  const load = useApp((s) => s.load);
  const reducedMotion = useReducedMotion();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
      const { loaded, loadError, saveError } = useApp.getState();
      if (!loaded || loadError || saveError) return;
      await Promise.all([syncNow(), cloudSyncNow(), syncLanNow()]);
    } catch (error) {
      useApp.setState({ loadError: error instanceof Error ? error.message : 'Local data operation failed.' });
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <button
      type="button"
      className="rail-view"
      onClick={() => void refresh()}
      disabled={refreshing}
      aria-label="Refresh data"
      aria-busy={refreshing}
    >
      <NavIcon glyph="refresh" className={`rail-icon ${refreshing && !reducedMotion ? 'loader-spin' : ''}`} />
      <span className="rail-label">{refreshing ? 'Refreshing' : 'Refresh'}</span>
    </button>
  );
}

/**
 * The app's one navigation. On a wide screen it is a rail down the left edge:
 * Today, Calendar, Notes, then Games with every game listed under it (Games
 * folds the list away), and Settings at the foot. On a tall screen
 * (a phone, an upright tablet) it is a dock floating over the bottom edge,
 * under the thumb, in the order Calendar, Games, Today, Notes, Settings, and
 * Games raises the shelf of game logos over it. The games
 * never re-sort, so a game is always where the player left it. Ctrl+1 to
 * Ctrl+9 open the first nine games; Alt+1 to Alt+5 the five places, in the
 * order shown.
 */
export function AppRail() {
  const now = useNow(30_000);
  const derived = useDerived(now);
  const tab = useUI((s) => s.tab);
  const setTab = useUI((s) => s.setTab);
  const focusedGameId = useUI((s) => s.focusedGameId);
  const openSheet = useUI((s) => s.openSheet);
  const needsRefresh = useApp(
    (s) => Boolean(s.loadError || s.saveError) || s.syncStatus === 'error' || s.cloudStatus === 'error',
  );
  const lanTrouble = useLanSync((s) => s.status === 'error');
  const updateWaiting = useAppUpdate((s) => s.status === 'available' || s.status === 'ready');
  const ground = useGround();
  const reducedMotion = useReducedMotion();
  const tipSide = useTipSide();
  const upright = useMediaQuery('(orientation: portrait)');
  const placeOrder = upright ? DOCK_ORDER : RAIL_ORDER;
  const altKey = (place: Place) => `Alt+${placeOrder.indexOf(place) + 1}`;
  const shelfOpen = useUI((s) => s.shelfOpen);
  const setShelfOpen = useUI((s) => s.setShelfOpen);
  const railGamesOpen = useUI((s) => s.railGamesOpen);
  const setRailGamesOpen = useUI((s) => s.setRailGamesOpen);
  const identity = useIdentityColors(derived.state.games);
  const games = derived.state.games
    .filter((game) => !game.deleted)
    .sort((a, b) => a.sort - b.sort)
    .map((game) => ({ ...game, ...(identity[game.id] ?? {}) }));
  // What Today still asks for: the same steps its own bar counts.
  const open = todayStepsLeft(derived);
  const currentGame = tab === 'home' ? focusedGameId : null;
  const order = games.map((game) => game.id).join(' ');

  // Ctrl+1..9 opens the Nth game, unless a field takes the keystroke or a sheet is open.
  useEffect(() => {
    const jump = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat) return;
      if (!/^[1-9]$/.test(event.key) || event.defaultPrevented || typing(event.target)) return;
      if (useUI.getState().sheet || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const id = order.split(' ')[Number(event.key) - 1];
      if (!id) return;
      event.preventDefault();
      if (useUI.getState().tab !== 'home' || useUI.getState().focusedGameId !== id) openGame(id);
    };
    document.addEventListener('keydown', jump);
    return () => document.removeEventListener('keydown', jump);
  }, [order]);

  // Glass glows with the first two games' colours, behind everything.
  const aurora = games
    .slice(0, 2)
    .map((game) => gameInk(game, ground))
    .join(' ');
  useEffect(() => {
    const root = document.documentElement;
    const [a, b] = aurora.split(' ');
    for (const [name, value] of [
      ['--aurora-a', a],
      ['--aurora-b', b],
    ] as const) {
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
  }, [aurora]);

  // Alt+1..5 open the five places, in the order they are shown.
  useEffect(() => {
    const go = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
      if (!/^[1-5]$/.test(event.key) || event.defaultPrevented || typing(event.target)) return;
      if (useUI.getState().sheet || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      const ui = useUI.getState();
      const place = placeOrder[Number(event.key) - 1];
      if (place === 'calendar') ui.setTab('timeline');
      else if (place === 'games') {
        const id = ui.lastGameId ?? order.split(' ')[0];
        if (id) openGame(id);
      } else if (place === 'today') {
        if (ui.tab === 'home') closeWorkspace();
        else ui.setTab('today');
      } else if (place === 'notes') ui.setTab('notes');
      else ui.setTab('settings');
    };
    document.addEventListener('keydown', go);
    return () => document.removeEventListener('keydown', go);
  }, [order, placeOrder]);

  // Across the top the games scroll sideways; the open game is kept in view.
  const gamesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = gamesRef.current;
    if (!strip || !currentGame || strip.scrollWidth <= strip.clientWidth) return;
    const button = strip.querySelector<HTMLElement>(`[data-rail-game="${CSS.escape(currentGame)}"]`);
    if (!button) return;
    const start = button.offsetLeft - strip.offsetLeft;
    // The strip fades out at its end, so leave room past the button for the fade.
    const end = start + button.offsetWidth + 28;
    const target =
      start < strip.scrollLeft
        ? start
        : end > strip.scrollLeft + strip.clientWidth
          ? end - strip.clientWidth
          : strip.scrollLeft;
    if (target !== strip.scrollLeft) strip.scrollTo({ left: target, behavior: reducedMotion ? 'instant' : 'smooth' });
  }, [currentGame, order, reducedMotion]);

  // On a tall screen Games raises the shelf over the dock; on a wide one it
  // folds the rail's list. A game's own page opens the shelf with it.
  const shelfShown = upright ? shelfOpen : railGamesOpen;
  const toggleGames = () => {
    if (games.length === 0) return openSheet({ kind: 'addGame' });
    if (upright) setShelfOpen(!shelfOpen);
    else setRailGamesOpen(!railGamesOpen);
  };
  const urgent = games.filter((game) => {
    const next = derived.entryById.get(game.id)?.next;
    return !game.paused && next != null && railCountdown(next.at - now).tone === 'now';
  }).length;

  // Upright, the dock puts Today under the thumb in the middle; down a PC's
  // side Today leads and Games sits last, with its list opening under it.
  const placeButtons: Record<Exclude<Place, 'settings'>, ReactNode> = {
    calendar: (
      <RailView
        key="calendar"
        className="rail-place rail-place-calendar"
        label="Calendar"
        icon="calendar"
        current={tab === 'timeline'}
        onClick={() => setTab('timeline')}
        keyShortcuts={altKey('calendar')}
      />
    ),
    games: (
      <RailView
        key="games"
        className="rail-place rail-place-games"
        label="Games"
        icon="games"
        current={tab === 'home'}
        aria-expanded={games.length > 0 ? shelfShown : undefined}
        aria-controls={games.length > 0 ? 'rail-shelf' : undefined}
        keyShortcuts={altKey('games')}
        describedBy={urgent > 0 ? 'rail-games-urgent' : undefined}
        onClick={toggleGames}
        badge={
          urgent > 0 ? (
            <>
              <span aria-hidden className="rail-dot rail-dot-urgent" />
              <span id="rail-games-urgent" hidden>
                {urgent === 1 ? '1 game needs you within two hours' : `${urgent} games need you within two hours`}
              </span>
            </>
          ) : undefined
        }
      />
    ),
    today: (
      <RailView
        key="today"
        className="rail-place rail-place-today"
        label="Today"
        icon="today"
        current={tab === 'today'}
        onClick={() => (tab === 'home' ? closeWorkspace() : setTab('today'))}
        keyShortcuts={tab === 'home' ? `${altKey('today')} Alt+ArrowLeft` : altKey('today')}
        describedBy={open > 0 ? 'rail-today-left' : undefined}
        badge={
          open > 0 ? (
            <>
              <span aria-hidden className="rail-badge numeral">
                {open}
              </span>
              <span id="rail-today-left" hidden>
                {open} left today
              </span>
            </>
          ) : undefined
        }
      />
    ),
    notes: (
      <RailView
        key="notes"
        className="rail-place rail-place-notes"
        label="Notes"
        icon="notes"
        current={tab === 'notes'}
        onClick={() => setTab('notes')}
        keyShortcuts={altKey('notes')}
      />
    ),
  };

  return (
    <nav aria-label="Primary" className="app-rail" data-shelf={shelfShown || undefined}>
      <span className="rail-mark" aria-hidden>
        <Logo className="[&>svg]:h-[30px] [&>svg]:w-[30px]" />
      </span>
      <div className="rail-places">
        {placeOrder.filter((place) => place !== 'settings').map((place) => placeButtons[place])}
      </div>
      <div id="rail-shelf" className="rail-shelf" inert={!shelfShown}>
        <div ref={gamesRef} className="rail-games" role="group" aria-label="Games">
          {games.map((game, index) => {
            const next = derived.entryById.get(game.id)?.next ?? null;
            const { resource, projection, bank } = derived.primaryEnergy(game.id);
            const energy =
              resource && projection?.hasSnapshot
                ? { name: resource.name, value: projection.value, cap: resource.cap, bank }
                : undefined;
            return (
              <RailGame
                key={game.id}
                game={game}
                ink={gameInk(game, ground)}
                support={gameSupport(game, ground)}
                energy={energy}
                at={next?.at}
                label={next?.label}
                now={now}
                current={currentGame === game.id}
                shortcut={index < 9 ? index + 1 : undefined}
              />
            );
          })}
          <Tooltip content="Add game" side={tipSide}>
            <RailView
              className="rail-icon-only rail-add"
              label="Add game"
              icon="add"
              current={false}
              onClick={() => openSheet({ kind: 'addGame' })}
            />
          </Tooltip>
        </div>
      </div>
      <div className="rail-foot">
        <SyncAttention />
        {(needsRefresh || lanTrouble) && <RefreshButton />}
        <Tooltip content={updateWaiting ? 'Settings · Update available' : 'Settings'} side={tipSide}>
          <RailView
            className="rail-place rail-place-settings rail-settings"
            label="Settings"
            icon="settings"
            current={tab === 'settings'}
            keyShortcuts={altKey('settings')}
            describedBy={updateWaiting ? 'rail-update' : undefined}
            onClick={() => setTab('settings')}
            badge={
              updateWaiting ? (
                <>
                  <span aria-hidden className="rail-dot" />
                  <span id="rail-update" hidden>
                    Update available
                  </span>
                </>
              ) : undefined
            }
          />
        </Tooltip>
      </div>
    </nav>
  );
}
