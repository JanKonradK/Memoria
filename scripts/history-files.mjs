// Version history lives in two places so no single file outgrows the bundle
// budget: app/src/data/feed/history.json holds the games and versions, and each
// game's archived events sit in app/src/data/feed/archive/<game>.json. These
// helpers read them as one document and write them back split.
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function historyPaths(root) {
  const feed = path.join(root, 'app/src/data/feed');
  return { history: path.join(feed, 'history.json'), archive: path.join(feed, 'archive') };
}

/** The whole version history, archive included. */
export async function readHistory(root) {
  const paths = historyPaths(root);
  const history = JSON.parse(await readFile(paths.history, 'utf8'));
  const files = await readdir(paths.archive).catch(() => []);
  const archive = [...(history.archive ?? [])];
  for (const file of files.filter((name) => name.endsWith('.json')).sort())
    archive.push(...JSON.parse(await readFile(path.join(paths.archive, file), 'utf8')));
  return { ...history, archive };
}

// Write beside the file, then rename over it, so an interrupted run never
// leaves a half-written file behind.
async function replace(file, value) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

/** Writes the archive per game first, then history.json without it. */
export async function writeHistory(root, history) {
  const paths = historyPaths(root);
  await mkdir(paths.archive, { recursive: true });
  const byGame = new Map();
  for (const event of history.archive) byGame.set(event.game, [...(byGame.get(event.game) ?? []), event]);
  for (const [game, events] of byGame) await replace(path.join(paths.archive, `${game}.json`), events);
  for (const file of await readdir(paths.archive))
    if (file.endsWith('.json') && !byGame.has(file.slice(0, -5))) await rm(path.join(paths.archive, file));
  await replace(paths.history, { ...history, archive: [] });
}
