import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Game } from '@memoria/shared';
import { useMediaQuery, useReducedMotion } from '../hooks';
import { useDerived } from '../selectors';
import { useApp } from '../store';
import { GAME_TABS, useUI, type GameTab } from '../ui-store';
import { GameControlsView } from './GameCard';
import { gameShellVars, useGround, useSurfaces } from '../theme';
import { useIdentityColors } from './roster';
import { Btn, Page, ServerChip, Tooltip, useSlidingIndicator } from './ui';
import { Pill } from './primitives';
import { GameNotes } from './Notes';
import { GameLogo } from './GameLogo';
import { LaunchButton } from './GameLaunch';
import { GameEvents } from './GameEvents';
import { AttentionIndicator } from './AttentionIndicator';
import { PageBar, PageBarEnd } from './shell/PageBar';
import { closeWorkspace, openGame, recordWorkspaceHistory } from '../workspace-navigation';
import { titleStyle } from '../fonts';
import { gameTitleInk } from '../game-color';
import { localResetLabel } from '../util';
import { gameServerLabel, sameGameKey } from '../server-choice';
import { useCatchUpUnread } from '../catch-up-status';
import { useActiveCodeCount } from '../codes';
import { gameTabAvailable } from './game-tabs/availability';
import './game-tabs/game-tabs.css';

const GamePulls = lazy(() => import('./game-tabs/GamePulls').then((module) => ({ default: module.GamePulls })));
const GameQuests = lazy(() => import('./game-tabs/GameQuests').then((module) => ({ default: module.GameQuests })));
const GameNews = lazy(() => import('./game-tabs/GameNews').then((module) => ({ default: module.GameNews })));
const GameCodes = lazy(() => import('./GameCodes').then((module) => ({ default: module.GameCodes })));

const TAB_LABEL: Record<GameTab, string> = {
  track: 'Track',
  events: 'Events',
  codes: 'Codes',
  pulls: 'Pulls',
  quests: 'Quests',
  news: 'News',
  notes: 'Notes',
};

/** The game's name, where it plays, and its reset, beside its coin. */
function GameIdentity({ game, now, urgent }: { game: Game; now: number; urgent: boolean }) {
  const ground = useGround();
  const zone = useApp((s) => s.state.settings.localTz);
  const account = game.accountLabel?.trim();
  return (
    <div className="game-bar-id">
      <GameLogo game={game} size={52} flippable className="game-bar-logo" />
      <div className="min-w-0">
        <h1
          tabIndex={-1}
          className="game-bar-title"
          style={{ ...titleStyle(game.titleFont), color: `var(--game-ink, ${gameTitleInk(game, ground, 4.5)})` }}
        >
          {game.name}
        </h1>
        <div className="game-bar-meta">
          <ServerChip label={gameServerLabel(game, now)} className="max-w-20 truncate" />
          {account && <span className="truncate">{account}</span>}
          <span>resets {localResetLabel(game, zone, now)}</span>
          {game.paused && (
            <Pill variant="paused" size="md">
              paused
            </Pill>
          )}
          {urgent && <AttentionIndicator />}
        </div>
        <GameAccounts game={game} now={now} />
      </div>
    </div>
  );
}

/**
 * The same game on other servers or under other nicknames, as a sideways strip
 * of its accounts. One account has no strip.
 */
function GameAccounts({ game, now }: { game: Game; now: number }) {
  const games = useApp((s) => s.state.games);
  const key = sameGameKey(game);
  const accounts = games
    .filter((other) => !other.deleted && sameGameKey(other) === key)
    .sort((a, b) => a.sort - b.sort);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [game.id]);
  if (accounts.length < 2) return null;
  return (
    <div ref={strip} className="game-accounts" role="group" aria-label={`${game.name} accounts`}>
      {accounts.map((account) => {
        const server = gameServerLabel(account, now);
        const name = account.accountLabel?.trim();
        return (
          <button
            key={account.id}
            type="button"
            className="game-account"
            aria-pressed={account.id === game.id}
            onClick={() => account.id !== game.id && openGame(account.id)}
          >
            <span className="game-account-server">{server}</span>
            {name && <span className="game-account-name">{name}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Below 1100px the tabs wrap onto their own row under the game's name, and the
 * bar sticks with only that row in view: it publishes how far down the bar the
 * tabs start as --game-id-h, which shell.css lifts the sticky bar by. Measured
 * again whenever the bar's size changes (the name wraps, an accounts strip).
 */
const pinTabs = (tabs: HTMLDivElement | null) => {
  const bar = tabs?.parentElement;
  if (!tabs || !bar) return;
  const measure = () => bar.style.setProperty('--game-id-h', `${tabs.offsetTop}px`);
  measure();
  if (typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(measure);
  observer.observe(bar);
  return () => observer.disconnect();
};

/** Track, Events, Codes, Pulls, Quests, News and Notes: everything about one game, one tab at a time. */
function GameTabs({
  game,
  tabs,
  current,
  eventCount,
  codeCount,
}: {
  game: Game;
  tabs: readonly GameTab[];
  current: GameTab;
  eventCount: number;
  codeCount: number;
}) {
  const setGameTab = useUI((s) => s.setGameTab);
  const { unread } = useCatchUpUnread(game);
  const refs = useRef(new Map<GameTab, HTMLButtonElement>());
  const strip = useRef<HTMLDivElement | null>(null);
  // One underline in the game's colour, slid from tab to tab rather than
  // switched off under one and on under the next.
  const underline = useSlidingIndicator(
    strip,
    '[aria-selected="true"]',
    `${current}|${tabs.join()}`,
    useReducedMotion(),
  );
  // On a narrow screen the strip scrolls sideways; the open tab is kept in view.
  useEffect(() => {
    refs.current.get(current)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const index = tabs.indexOf(current);
    const next =
      event.key === 'Home'
        ? tabs[0]!
        : event.key === 'End'
          ? tabs[tabs.length - 1]!
          : tabs[(index + step + tabs.length) % tabs.length]!;
    setGameTab(next);
    refs.current.get(next)?.focus();
  };
  const setStrip = useCallback((node: HTMLDivElement | null) => {
    strip.current = node;
    return pinTabs(node);
  }, []);
  return (
    <div ref={setStrip} role="tablist" aria-label={`${game.name} sections`} className="game-tabs" onKeyDown={move}>
      {tabs.map((tab) => (
        <button
          key={tab}
          ref={(node) => {
            if (node) refs.current.set(tab, node);
            else refs.current.delete(tab);
          }}
          type="button"
          role="tab"
          id={`game-tab-${tab}`}
          aria-selected={tab === current}
          aria-controls="game-tab-panel"
          tabIndex={tab === current ? 0 : -1}
          className="game-tab"
          onClick={() => setGameTab(tab)}
        >
          {TAB_LABEL[tab]}
          {tab === 'events' && eventCount > 0 && <span className="game-tab-count numeral">{eventCount}</span>}
          {tab === 'codes' && codeCount > 0 && <span className="game-tab-count numeral">{codeCount}</span>}
          {tab === 'news' && unread > 0 && (
            <>
              <span aria-hidden className="game-tab-new" />
              <span className="sr-only">, {unread} new</span>
            </>
          )}
        </button>
      ))}
      {/* After the tabs, so it draws over the chosen tab's fill. */}
      <span aria-hidden className="game-tab-underline" style={underline} />
    </div>
  );
}

/** Windows app only: shrinks the window to this game's quick card, to keep beside the game. */
function QuickCardButton({ game }: { game: Game }) {
  const enterCompact = window.memoriaDesktop?.window?.enterCompact;
  if (!enterCompact) return null;
  return (
    <Tooltip content="Quick card">
      <Btn
        kind="quiet"
        className="inline-flex shrink-0 items-center"
        aria-label={`Open ${game.name} quick card`}
        onClick={() => void enterCompact(game.id).catch(() => undefined)}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className="icon h-4 w-4" aria-hidden>
          <rect x="3" y="3" width="14" height="14" rx="2.5" />
          <path d="M10.5 9.5H14V13M14 9.5 9.5 14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Btn>
    </Tooltip>
  );
}

/** One game's full page. Its bar holds who it is, its tabs, Play and Edit. */
export function GamePage({ now }: { now: number }) {
  const derived = useDerived(now);
  const { state, entryById } = derived;
  const upsertEvent = useApp((s) => s.upsertEvent);
  const setTaskDone = useApp((s) => s.setTaskDone);
  const restartTaskTimer = useApp((s) => s.restartTaskTimer);
  const advanceTaskTimer = useApp((s) => s.advanceTaskTimer);
  const setTaskCount = useApp((s) => s.setTaskCount);
  const setEnergy = useApp((s) => s.setEnergy);
  const adjustEnergy = useApp((s) => s.adjustEnergy);
  const actions = useMemo(
    () => ({
      state,
      upsertEvent,
      setTaskDone,
      restartTaskTimer,
      advanceTaskTimer,
      setTaskCount,
      setEnergy,
      adjustEnergy,
    }),
    [adjustEnergy, advanceTaskTimer, restartTaskTimer, setEnergy, setTaskCount, setTaskDone, state, upsertEvent],
  );
  const openSheet = useUI((s) => s.openSheet);
  const openGameEvent = useCallback((eventId: string) => openSheet({ kind: 'eventPeek', eventId }), [openSheet]);
  const twoColumns = useMediaQuery('(min-width: 900px)');
  // An ultrawide window gives energy, tasks and events a column each.
  const threeColumns = useMediaQuery('(min-width: 1800px)');
  const focusedGameId = useUI((s) => s.focusedGameId);
  const gameTab = useUI((s) => s.gameTab);
  const focusedEntry = focusedGameId ? entryById.get(focusedGameId) : undefined;
  const workspaceId = focusedEntry?.game.id;
  const surfaces = useSurfaces();
  const identityColors = useIdentityColors(state.games);

  useEffect(() => {
    if (workspaceId) recordWorkspaceHistory(workspaceId);
  }, [workspaceId]);

  // The swipe steps through the tabs this game shows, so it is told which they are.
  const tabs = focusedEntry
    ? GAME_TABS.filter((tab) => gameTabAvailable(focusedEntry.game, tab, { state, now }))
    : GAME_TABS;
  const tabKey = tabs.join(' ');
  const setGameTabs = useUI((s) => s.setGameTabs);
  useEffect(() => {
    setGameTabs(tabKey.split(' ') as GameTab[]);
  }, [setGameTabs, tabKey]);
  const direction = useUI((s) => s.gameTabDirection);
  const codeCount = useActiveCodeCount(focusedEntry?.game, now);
  const tab = tabs.includes(gameTab) ? gameTab : 'track';
  // A tab slides in only when it takes over from another of this game's tabs.
  // Arriving on the page, or on another game, is the page's own arrival.
  const panelKey = `${workspaceId ?? ''}:${tab}`;
  const [panel, setPanel] = useState({ key: panelKey, slides: false });
  if (panel.key !== panelKey) setPanel({ key: panelKey, slides: panel.key.startsWith(`${workspaceId ?? ''}:`) });

  // Without a game there is no page. The shell sends this route back to Today.
  if (!focusedEntry) return null;
  const game = { ...focusedEntry.game, ...(identityColors[focusedEntry.game.id] ?? {}) };
  const eventCount = state.events.filter(
    (event) => event.gameId === game.id && !event.deleted && !event.done && event.end > now,
  ).length;
  const urgent = !game.paused && focusedEntry.next != null && focusedEntry.next.at - now < 2 * 60 * 60_000;

  return (
    <Page>
      <section
        key={game.id}
        className="focus-workspace"
        style={gameShellVars(focusedEntry.game, surfaces, identityColors[game.id])}
        aria-label={`${game.name} focus workspace`}
      >
        <PageBar className="game-bar">
          <GameIdentity game={game} now={now} urgent={urgent} />
          <GameTabs game={game} tabs={tabs} current={tab} eventCount={eventCount} codeCount={codeCount} />
          <PageBarEnd>
            <LaunchButton game={game} />
            <QuickCardButton game={game} />
            <Tooltip content={`Edit ${game.name}`}>
              <Btn
                className="inline-flex shrink-0 items-center"
                aria-label={`Edit ${game.name}`}
                onClick={() => openSheet({ kind: 'game', gameId: game.id })}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className="icon h-4 w-4" aria-hidden>
                  <path
                    d="M13.3 3.7a1.7 1.7 0 0 1 2.4 2.4L7.4 14.4 4 15l.6-3.4z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Btn>
            </Tooltip>
          </PageBarEnd>
        </PageBar>
        <div
          key={`${game.id}:${tab}`}
          role="tabpanel"
          id="game-tab-panel"
          aria-labelledby={`game-tab-${tab}`}
          className="game-tab-panel tab-enter"
          data-direction={panel.slides ? direction : undefined}
        >
          {tab === 'track' && (
            <GameControlsView
              entry={focusedEntry}
              state={state}
              actions={actions}
              now={now}
              onBack={closeWorkspace}
              layout="focus"
              heading={false}
              split
              columns={threeColumns ? 3 : twoColumns ? 2 : 1}
              onOpenEvent={openGameEvent}
            />
          )}
          {tab === 'events' && <GameEvents game={focusedEntry.game} now={now} />}
          {tab === 'notes' && <GameNotes game={game} />}
          <Suspense fallback={<p className="py-8 text-center text-meta text-muted">Loading…</p>}>
            {tab === 'pulls' && <GamePulls game={focusedEntry.game} />}
            {tab === 'quests' && <GameQuests game={focusedEntry.game} />}
            {tab === 'news' && <GameNews game={focusedEntry.game} now={now} />}
            {tab === 'codes' && <GameCodes game={focusedEntry.game} now={now} />}
          </Suspense>
        </div>
      </section>
    </Page>
  );
}
