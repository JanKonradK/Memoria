import { create } from 'zustand';
import { showNotice } from './readings';

/**
 * Starting a game from its card, in the Windows app.
 *
 * What starts each game is chosen once in a native file dialog and kept on this
 * PC by the desktop shell. The app only ever knows the file's name, so nothing
 * about it reaches a backup, a synced folder, or a phone.
 */
export const useGameLaunch = create<{
  available: boolean;
  /** Game id to the file name of what starts it. */
  targets: Record<string, string>;
  /** The game whose target is being picked or started. */
  busy: string | null;
}>(() => ({ available: false, targets: {}, busy: null }));

/** Electron prefixes a rejected invoke with its channel; the player needs only the reason. */
const reason = (error: unknown) =>
  (error instanceof Error ? error.message : 'Windows could not start the game.').replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  );

export function initGameLaunch(): void {
  const host = window.memoriaDesktop?.launch;
  if (!host) return;
  useGameLaunch.setState({ available: true });
  void host
    .list()
    .then(({ targets }) => useGameLaunch.setState({ targets }))
    .catch(() => undefined);
}

async function run(
  gameId: string,
  action: (host: NonNullable<NonNullable<Window['memoriaDesktop']>['launch']>) => Promise<void>,
) {
  const host = window.memoriaDesktop?.launch;
  if (!host || useGameLaunch.getState().busy) return;
  useGameLaunch.setState({ busy: gameId });
  try {
    await action(host);
  } catch (error) {
    showNotice('error', reason(error));
  } finally {
    useGameLaunch.setState({ busy: null });
  }
}

/** Open the file dialog. Cancelling it keeps whatever was chosen before. */
export function chooseLaunchTarget(gameId: string): Promise<void> {
  return run(gameId, async (host) => useGameLaunch.setState({ targets: (await host.choose(gameId)).targets }));
}

export function clearLaunchTarget(gameId: string): Promise<void> {
  return run(gameId, async (host) => useGameLaunch.setState({ targets: (await host.clear(gameId)).targets }));
}

export function launchGame(gameId: string): Promise<void> {
  return run(gameId, async (host) => {
    const { started } = await host.start(gameId);
    showNotice('ok', `Starting ${started}.`);
  });
}
