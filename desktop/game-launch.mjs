// Starting a tracked game from its card.
//
// The renderer is sandboxed and never supplies a path. It names a game; the
// only way a path enters this file is the native file dialog the player
// operates. Targets live beside the other per-PC files and stay out of
// state.json, so they never reach a backup, a synced folder, or a phone.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';

/** A program, or a shortcut to one. Scripts and documents are not launch targets. */
export const LAUNCH_EXTENSIONS = ['exe', 'lnk', 'url'];
const MAX_TARGETS = 200;

function fail(message) {
  return Object.assign(new Error(message), { expose: true });
}

function validId(gameId) {
  return typeof gameId === 'string' && gameId.length > 0 && gameId.length <= 160;
}

function validTarget(path) {
  return (
    typeof path === 'string' &&
    path.length <= 1024 &&
    isAbsolute(path) &&
    LAUNCH_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())
  );
}

export function createGameLaunch({ dataDir, pick, open, exists = existsSync, platform = process.platform }) {
  const file = join(dataDir, 'launch-targets.json');
  /** @type {Map<string, string>} */
  let targets;

  const load = () => {
    if (targets) return targets;
    targets = new Map();
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved && typeof saved === 'object' && !Array.isArray(saved))
        for (const [gameId, path] of Object.entries(saved).slice(0, MAX_TARGETS))
          if (validId(gameId) && validTarget(path)) targets.set(gameId, path);
    } catch {
      /* No file yet, or an unreadable one: start with no targets rather than fail the card. */
    }
    return targets;
  };

  const save = () => {
    mkdirSync(dataDir, { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(Object.fromEntries(load()), null, 2));
    renameSync(temporary, file);
  };

  /** File names only. The card needs a label, not the layout of the player's disk. */
  const list = () => ({
    targets: Object.fromEntries([...load()].map(([gameId, path]) => [gameId, basename(path)])),
  });

  const requireWindows = () => {
    if (platform !== 'win32') throw fail('Starting a game needs the Windows app.');
  };

  return {
    list,

    async choose(gameId) {
      requireWindows();
      if (!validId(gameId)) throw fail('Choose a game first.');
      const path = await pick();
      if (path == null) return list();
      if (!validTarget(path)) throw fail('Choose a program (.exe) or a shortcut (.lnk, .url).');
      if (!load().has(gameId) && load().size >= MAX_TARGETS)
        throw fail('Remove a launch target before adding another.');
      load().set(gameId, path);
      save();
      return list();
    },

    clear(gameId) {
      if (load().delete(gameId)) save();
      return list();
    },

    async start(gameId) {
      requireWindows();
      const path = validId(gameId) ? load().get(gameId) : undefined;
      if (!path) throw fail('Choose what starts this game first.');
      if (!exists(path)) throw fail(`${basename(path)} is no longer there. Choose it again.`);
      // The shell starts it the way a double-click would, so a launcher that
      // needs elevation can ask for it. A non-empty result is Windows' reason.
      const problem = await open(path);
      if (problem) throw fail(`Windows could not start ${basename(path)}.`);
      return { started: basename(path) };
    },
  };
}
