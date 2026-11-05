// Moves events of versions that have ended from app/src/data/feed/current.json
// into app/src/data/feed/history.json, so the timeline only loads live patches.
//
//   npm run feed:archive              archive as of today
//   npm run feed:archive -- --today 2026-11-05
//
// Afterwards run `npm run export:events` so the public calendar matches.
import { build } from 'esbuild';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundled = await build({
  stdin: {
    contents:
      "export { archiveEndedVersions, VersionHistorySchema, PublicFeedEventSchema } from './shared/src/index.ts'; export { SEED_RETENTION_MS } from './app/src/data/seed-feed.ts';",
    resolveDir: root,
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { archiveEndedVersions, VersionHistorySchema, PublicFeedEventSchema, SEED_RETENTION_MS } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const todayArgument = process.argv.indexOf('--today');
const today = todayArgument >= 0 ? process.argv[todayArgument + 1] : new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? '')) throw new Error('--today must be YYYY-MM-DD.');

const currentPath = path.join(root, 'app/src/data/feed/current.json');
const historyPath = path.join(root, 'app/src/data/feed/history.json');
const current = JSON.parse(await readFile(currentPath, 'utf8'));
const history = VersionHistorySchema.parse(JSON.parse(await readFile(historyPath, 'utf8')));
const events = current.events.map((event) => PublicFeedEventSchema.parse(event));

const result = archiveEndedVersions(events, history, today, SEED_RETENTION_MS);
// Write beside each file, then rename over it, and save the archive first.
// An interrupted run can leave an event in both files, never in neither.
async function replace(file, value) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}
await replace(historyPath, { ...history, archive: result.archive });
await replace(currentPath, { ...current, events: result.current });
console.log(
  `Archived ${result.moved} new events as of ${today}. Current feed: ${result.current.length} events (was ${events.length}). Archive: ${result.archive.length}.`,
);
