import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppState, Game } from '@technogg/shared';
import { PRESETS } from '@technogg/shared';

const pexec = promisify(execFile);

/** Lower-cased running process names, without the .exe suffix. */
export async function runningProcessNames(): Promise<Set<string>> {
  if (process.platform !== 'win32') return new Set();
  try {
    // tasklist starts in ~100ms; PowerShell would cost ~1s just to boot.
    const { stdout } = await pexec('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true });
    const names = new Set<string>();
    for (const line of stdout.split('\n')) {
      const m = /^"([^"]+)"/.exec(line.trim());
      if (m) names.add(m[1].toLowerCase().replace(/\.exe$/, ''));
    }
    return names;
  } catch {
    return new Set();
  }
}

/** Process names for a game: its own data, else its preset's (pre-processNames imports). */
export function namesFor(game: Game): string[] {
  if (game.processNames?.length) return game.processNames;
  const preset = PRESETS.find((p) => p.name === game.name || p.short === game.short);
  return preset?.processNames ?? [];
}

/** The non-paused game whose executable is running right now, if any. */
export async function detectGame(state: AppState): Promise<Game | null> {
  const running = await runningProcessNames();
  if (running.size === 0) return null;
  for (const game of state.games.filter((g) => !g.deleted && !g.paused)) {
    if (namesFor(game).some((n) => running.has(n.toLowerCase()))) return game;
  }
  return null;
}

/** Match a CLI arg like "gi", "hsr", "gen" against short/name (case-insensitive prefix). */
export function gameByArg(state: AppState, arg: string): Game | null {
  const q = arg.toLowerCase();
  const live = state.games.filter((g) => !g.deleted);
  return (
    live.find((g) => g.short.toLowerCase() === q) ??
    live.find((g) => g.short.toLowerCase().startsWith(q) || g.name.toLowerCase().startsWith(q)) ??
    null
  );
}
