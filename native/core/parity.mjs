// Prints state cases with Node's answers, for the Rust parity test
// (native/src/core.rs). Node runs the same rules (entry.mjs) on V8 with full
// Intl, so any difference comes from QuickJS or the Rust side around it.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const scratch = mkdtempSync(join(tmpdir(), 'memoria-parity-'));
const bundle = join(scratch, 'entry.mjs');
await build({
  entryPoints: [join(import.meta.dirname, 'entry.mjs')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  logLevel: 'warning',
});
const core = await import(pathToFileURL(bundle).href);
rmSync(scratch, { recursive: true, force: true });

const now = Date.now();
const DAY = 86_400_000;
const game = (id, over = {}) => ({
  id,
  name: `Game ${id}`,
  short: id.toUpperCase().slice(0, 3),
  color: '#38bdf8',
  icon: '⚔️',
  platform: 'both',
  tz: 'Asia/Shanghai',
  dailyResetHour: 4,
  weeklyResetDay: 1,
  monthlyResetDay: 1,
  paused: false,
  sort: 0,
  updatedAt: now - DAY,
  ...over,
});
const resource = (id, gameId, over = {}) => ({
  id,
  gameId,
  name: 'Stamina',
  cap: 240,
  regenMinutes: 6,
  reserveCap: 0,
  sort: 0,
  updatedAt: now - DAY,
  ...over,
});
const snapshot = (id, resourceId, value, takenAt) => ({ id, resourceId, value, takenAt });
const task = (id, gameId, over = {}) => ({
  id,
  gameId,
  name: 'Dailies',
  cadence: 'daily',
  intervalDays: 1,
  anchorAt: 0,
  sort: 0,
  updatedAt: now - DAY,
  ...over,
});

const base = core.read(
  JSON.stringify({
    games: [game('g1'), game('g2', { name: 'Zweite Welt — 日本', sort: 1 })],
    resources: [resource('r1', 'g1'), resource('r2', 'g2', { cap: 180 })],
    snapshots: [snapshot('s1', 'r1', 120, now - 3_600_000)],
    tasks: [task('t1', 'g1'), task('t2', 'g2', { cadence: 'weekly', intervalDays: 7 })],
  }),
).state;
const edited = structuredClone(base);
edited.games[0] = { ...edited.games[0], name: 'Renamed', updatedAt: now - 1000 };
edited.snapshots.push(snapshot('s2', 'r2', 50, now - 60_000));
const stale = structuredClone(base);
stale.games[0] = { ...stale.games[0], name: 'Older name', updatedAt: now - 10 * DAY };
const future = structuredClone(base);
future.snapshots.push(snapshot('s3', 'r1', 200, now + 365 * DAY));
future.games[1] = { ...future.games[1], name: 'From the future', updatedAt: now + 365 * DAY };
const crowded = structuredClone(base);
crowded.snapshots = Array.from({ length: 19_000 }, (_, i) => snapshot(`x${i}`, 'r1', i % 240, now - i * 1000));

const cases = [
  { name: 'first merge into no file', raw: null, incoming: base },
  { name: 'newer edit wins', raw: base, incoming: edited },
  { name: 'older edit loses', raw: edited, incoming: stale },
  { name: 'same state writes nothing', raw: base, incoming: base },
  { name: 'future clocks are discarded', raw: base, incoming: future },
  { name: 'invalid state is refused', raw: base, incoming: { games: 'nope' } },
  { name: 'missing state is refused', raw: base, body: '{}' },
  {
    name: 'legacy document migrates',
    raw: { games: [game('g9')], resources: [], snapshots: [], tasks: [] },
    incoming: base,
  },
  { name: 'capacity overflow', raw: base, incoming: crowded },
];

const results = [];
for (const item of cases) {
  const raw = item.raw === null ? null : JSON.stringify(item.raw);
  const body = item.body ?? JSON.stringify({ state: item.incoming });
  let expected;
  try {
    const result = core.merge(raw, body);
    expected =
      'status' in result
        ? { status: result.status, error: result.error }
        : { ok: JSON.parse(result.json), wrote: result.changed };
  } catch (error) {
    expected = { status: 500, error: String(error.message) };
  }
  results.push({ name: item.name, raw, body, expected, read: core.read(raw).state });
}
process.stdout.write(JSON.stringify(results));
