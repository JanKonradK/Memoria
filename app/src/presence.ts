import { create } from 'zustand';
import { presetForGame, type AppState } from '@memoria/shared';
import type { DesktopPreferences, DesktopPresence } from './desktop-host';
import { useGameLaunch } from './game-launch';
import { endSession, nudgeLine, nudgeSession, startSession, useSession } from './session-focus';
import { useApp } from './store';
import { useUI } from './ui-store';
import { openGame } from './workspace-navigation';

/**
 * The Windows app stays in the tray, can start with Windows, and shows a notice
 * when a tracked game starts. The desktop shell owns the preferences; this
 * module mirrors them for Settings and supplies each game's program names.
 */
export const usePresence = create<{ presence: DesktopPresence | null; error: string }>(() => ({
  presence: null,
  error: '',
}));

export async function setPresence(changes: Partial<DesktopPreferences>): Promise<void> {
  const host = window.memoriaDesktop?.presence;
  if (!host) return;
  try {
    usePresence.setState({ presence: await host.set(changes), error: '' });
  } catch {
    usePresence.setState({ error: 'Windows did not accept the change. Try again.' });
  }
}

/** The quick card's global shortcut: on or off, new keys, or blank to clear it. Says why Windows refused. */
export async function setCompactShortcut(enabled: boolean, accelerator: string | null): Promise<void> {
  const host = window.memoriaDesktop?.presence;
  if (!host?.setCompactShortcut) return;
  try {
    usePresence.setState({ presence: await host.setCompactShortcut(enabled, accelerator), error: '' });
  } catch (error) {
    usePresence.setState({
      error: error instanceof Error && error.message ? error.message : 'Windows did not accept the change. Try again.',
    });
  }
}

/** A launcher starts every game it manages, so only a game's own program counts. */
const isLauncher = (file: string) => /launcher|^hyp\.exe$/i.test(file);

/** Program names to watch per game: the preset's, plus the program picked to start it. */
export function watchList(state: AppState, targets: Record<string, string>): Record<string, string[]> {
  const watch: Record<string, string[]> = {};
  for (const game of state.games) {
    if (game.deleted || game.paused) continue;
    const names = [...(game.processNames ?? presetForGame(game)?.processNames ?? [])];
    const target = targets[game.id];
    if (target && /\.exe$/i.test(target) && !isLauncher(target)) names.push(target);
    if (names.length) watch[game.id] = names;
  }
  return watch;
}

export function initPresence(): (() => void) | undefined {
  const host = window.memoriaDesktop?.presence;
  if (!host) return;
  let sent = '';
  const sendWatch = () => {
    const next = watchList(useApp.getState().state, useGameLaunch.getState().targets);
    const key = JSON.stringify(next);
    if (key === sent) return;
    sent = key;
    void host.watch(next).catch(() => {
      sent = '';
    });
  };
  void host.get().then(
    (presence) => usePresence.setState({ presence }),
    () => undefined,
  );
  const stops = [
    useApp.subscribe((next, prior) => {
      if (next.state.games !== prior.state.games) sendWatch();
    }),
    useGameLaunch.subscribe((next, prior) => {
      if (next.targets !== prior.targets) sendWatch();
    }),
    host.onChanged((presence) => usePresence.setState({ presence })),
    host.onGameStarted((gameId) => {
      const state = useApp.getState().state;
      const game = state.games.find((item) => item.id === gameId && !item.deleted && !item.paused);
      if (!game) return;
      // The game's page comes forward and shows what is next; nothing pops up.
      startSession(gameId);
      if (!useUI.getState().sheet) openGame(gameId);
      scheduleNudge(gameId);
    }),
    host.onGameStopped?.((gameId) => {
      cancelNudge(gameId);
      endSession(gameId);
    }) ?? (() => undefined),
    host.onOpenGame((gameId) => {
      if (useApp.getState().state.games.some((game) => game.id === gameId && !game.deleted)) openGame(gameId);
    }),
  ];
  sendWatch();
  return () => {
    for (const stop of stops) stop();
    for (const timer of nudges.values()) clearTimeout(timer);
    nudges.clear();
  };

  /**
   * A minute in, the player is through the login screens with the game's
   * numbers in front of them. If something is still owed, one notice says what,
   * and the step on the page starts to pulse.
   */
  function scheduleNudge(gameId: string) {
    cancelNudge(gameId);
    nudges.set(
      gameId,
      setTimeout(() => {
        nudges.delete(gameId);
        const session = useSession.getState().session;
        const state = useApp.getState().state;
        const game = state.games.find((item) => item.id === gameId && !item.deleted && !item.paused);
        if (!game || session?.gameId !== gameId) return;
        const line = nudgeLine(state, game, session, Date.now());
        if (!line) return;
        nudgeSession(gameId);
        void host!.notify({ gameId, title: game.name, body: line }).catch(() => undefined);
      }, nudgeTiming.delayMs),
    );
  }
}

/** How long after a game starts its notice comes, if one is needed. */
export const nudgeTiming = { delayMs: 60_000 };
const nudges = new Map<string, ReturnType<typeof setTimeout>>();

function cancelNudge(gameId: string) {
  const timer = nudges.get(gameId);
  if (timer) clearTimeout(timer);
  nudges.delete(gameId);
}
