import { create } from 'zustand';
import { gameGlance, glanceLine, presetForGame, type AppState } from '@memoria/shared';
import type { DesktopPreferences, DesktopPresence } from './desktop-host';
import { useGameLaunch } from './game-launch';
import { useApp } from './store';
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
      const game = state.games.find((item) => item.id === gameId && !item.deleted);
      if (!game) return;
      const now = Date.now();
      const glance = gameGlance(state, game, now);
      void host
        .notify({ gameId, title: `${glance.name} started`, body: glanceLine(glance, now) })
        .catch(() => undefined);
    }),
    host.onOpenGame((gameId) => {
      if (useApp.getState().state.games.some((game) => game.id === gameId && !game.deleted)) openGame(gameId);
    }),
  ];
  sendWatch();
  return () => {
    for (const stop of stops) stop();
  };
}
