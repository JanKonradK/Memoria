import { useState, type CSSProperties, type ReactNode } from 'react';
import type { Game } from '@memoria/shared';
import { useAppUpdate } from '../../app-update';
import { cloudSyncNow } from '../../cloud-sync';
import { useNow, useReducedMotion } from '../../hooks';
import { syncLanNow, useLanSync } from '../../lan-sync';
import { useDerived } from '../../selectors';
import { useApp } from '../../store';
import { syncNow } from '../../sync';
import { useUI } from '../../ui-store';
import { closeWorkspace, openGame } from '../../workspace-navigation';
import { gameInk } from '../../game-color';
import { useGround } from '../../theme';
import { GameLogo } from '../GameLogo';
import { useIdentityColors } from '../roster';
import { Logo } from '../Logo';
import { Tooltip } from '../ui';
import { railCountdown } from './rail-countdown';
import './shell.css';

const ICON = {
  today: 'M5 3.5h10M5 3.5v13l5-3 5 3v-13M7.5 8l1.8 1.8 3.4-3.3',
  calendar:
    'M3 6.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 8.5h14M7 2.5V6M13 2.5V6M6.5 12h4M6.5 14.5h7',
  add: 'M10 4v12M4 10h12',
  settings:
    'M10 7.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6',
  refresh: 'M16.25 6.25V2.5m0 3.75H12.5M15.2 5.15A7 7 0 1 0 17 11',
} as const;

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="rail-icon"
    >
      <path d={d} />
    </svg>
  );
}

function RailView({
  label,
  icon,
  current,
  badge,
  describedBy,
  className = '',
  onClick,
}: {
  className?: string;
  label: string;
  icon: string;
  current: boolean;
  badge?: ReactNode;
  describedBy?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rail-view ${className}`}
      aria-current={current ? 'page' : undefined}
      aria-describedby={describedBy}
      onClick={onClick}
    >
      <Icon d={icon} />
      <span className="rail-label">{label}</span>
      {badge}
    </button>
  );
}

/** One game in the rail: its face and how long until it next needs the player. */
function RailGame({
  game,
  ink,
  at,
  label,
  now,
  current,
}: {
  game: Game;
  ink: string;
  at?: number;
  label?: string;
  now: number;
  current: boolean;
}) {
  const countdown = at == null ? null : railCountdown(at - now);
  const account = game.accountLabel?.trim();
  const name = account ? `${game.name}, ${account}` : game.name;
  const summary = [name, label && countdown ? `${label} in ${countdown.long}` : null].filter(Boolean).join(' · ');
  return (
    <Tooltip content={summary} side="right">
      <button
        type="button"
        className="rail-game"
        data-rail-game={game.id}
        data-paused={game.paused || undefined}
        aria-current={current ? 'page' : undefined}
        aria-label={name}
        onClick={() => openGame(game.id)}
        style={{ '--rail-ink': ink } as CSSProperties}
      >
        <span aria-hidden className="rail-pin" />
        <GameLogo game={game} size={40} className="rail-game-logo" />
        <span aria-hidden className="rail-countdown numeral" data-tone={game.paused ? 'paused' : countdown?.tone}>
          {game.paused ? '—' : (countdown?.short ?? '·')}
        </span>
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
  const syncing = [desktop, cloud, lan].includes('syncing') || lan === 'pairing';
  const synced = [desktop, cloud, lan].includes('ok');
  return (
    <span role="status" aria-live="polite" className="rail-status">
      {issue ? (
        <Tooltip content={issue} side="right">
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
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={`rail-icon ${refreshing && !reducedMotion ? 'loader-spin' : ''}`}
      >
        <path d={ICON.refresh} />
      </svg>
      <span className="rail-label">{refreshing ? 'Refreshing' : 'Refresh'}</span>
    </button>
  );
}

/**
 * The app's one navigation. On a PC it is a rail down the left edge: Today and
 * Calendar, then every game in the player's own order with its next deadline,
 * then Add and Settings. On a phone the same rail lies along the bottom as the
 * dock, its games scrolling sideways. The rail never re-sorts, so a game is
 * always where the player left it.
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
  const identity = useIdentityColors(derived.state.games);
  const games = derived.state.games
    .filter((game) => !game.deleted)
    .sort((a, b) => a.sort - b.sort)
    .map((game) => ({ ...game, ...(identity[game.id] ?? {}) }));
  // What Today still asks for: the dailies not yet done on active games.
  let open = 0;
  for (const game of games) {
    if (game.paused) continue;
    for (const item of derived.checklistByGame.get(game.id) ?? [])
      if (item.cadence === 'daily' && !item.done) open += 1;
  }

  return (
    <nav aria-label="Primary" className="app-rail">
      <span className="rail-mark" aria-hidden>
        <Logo className="[&>svg]:h-9 [&>svg]:w-9" />
      </span>
      <div className="rail-views">
        <RailView
          label="Today"
          icon={ICON.today}
          current={tab === 'today'}
          onClick={() => (tab === 'home' ? closeWorkspace() : setTab('today'))}
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
        <RailView
          label="Calendar"
          icon={ICON.calendar}
          current={tab === 'timeline'}
          onClick={() => setTab('timeline')}
        />
      </div>
      <span aria-hidden className="rail-sep" />
      <div className="rail-games" role="group" aria-label="Games">
        {games.map((game) => {
          const next = derived.entryById.get(game.id)?.next ?? null;
          return (
            <RailGame
              key={game.id}
              game={game}
              ink={gameInk(game, ground)}
              at={next?.at}
              label={next?.label}
              now={now}
              current={tab === 'home' && focusedGameId === game.id}
            />
          );
        })}
        <button
          type="button"
          className="rail-view rail-add"
          aria-label="Add game"
          onClick={() => openSheet({ kind: 'addGame' })}
        >
          <Icon d={ICON.add} />
        </button>
      </div>
      <div className="rail-end">
        <SyncAttention />
        {(needsRefresh || lanTrouble) && <RefreshButton />}
        <RailView
          className="rail-settings"
          label="Settings"
          icon={ICON.settings}
          current={tab === 'settings'}
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
      </div>
    </nav>
  );
}
