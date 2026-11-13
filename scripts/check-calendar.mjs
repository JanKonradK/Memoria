// Warns when a game's bundled calendar is behind its latest version, and fails
// when one of the five main games is still behind three days after its update.
// Set MEMORIA_ALLOW_STALE_CALENDAR=1 to release anyway, for example an urgent fix.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundled = await build({
  stdin: {
    contents:
      "export { SEED_EVENTS, SEED_UPDATED } from './app/src/data/seed-feed.ts'; export { calendarBehind } from './shared/src/calendar-status.ts';",
    resolveDir: root,
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { SEED_EVENTS, SEED_UPDATED, calendarBehind } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const MAIN = ['genshin', 'hsr', 'zzz', 'wuwa', 'nte'];
const DAY = 86_400_000;
const now = Date.now();
// Feed times are server-local; read as UTC they are within half a day, which is
// fine for a check measured in days.
const events = SEED_EVENTS.map((row, index) => ({
  ...row,
  id: String(index),
  gameId: row.game,
  start: Date.parse(`${row.start.replace(' ', 'T')}Z`),
  end: Date.parse(`${row.end.replace(' ', 'T')}Z`),
  updatedAt: 0,
}));
const games = [...new Set(events.map((row) => row.game))];
let failed = false;
for (const game of games) {
  const behind = calendarBehind(events, game, now);
  if (!behind) continue;
  const days = Math.floor((now - behind.since) / DAY);
  const what = behind.version
    ? `not updated for version ${behind.version} (${days} d)`
    : 'has nothing running or coming';
  const fatal = MAIN.includes(game) && (behind.version ? days > 3 : true);
  console[fatal ? 'error' : 'warn'](
    `${fatal ? 'Behind' : 'Note'}: ${game} calendar ${what}; feed from ${SEED_UPDATED}.`,
  );
  failed ||= fatal;
}
if (failed && process.env.MEMORIA_ALLOW_STALE_CALENDAR !== '1') {
  console.error('Update app/src/data/feed/current.json, or set MEMORIA_ALLOW_STALE_CALENDAR=1 to release anyway.');
  process.exit(1);
}
console.log('Calendar check done.');
