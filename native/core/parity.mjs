// Prints state cases with the Node launcher's answers, for the Rust parity test
// (native/src/core.rs). The reference is createStateAccess from
// desktop/lan-sync.mjs, run against an in-memory state file.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStateAccess } from '../../desktop/lan-sync.mjs';

const repo = join(import.meta.dirname, '..', '..');
const scratch = mkdtempSync(join(tmpdir(), 'memoria-parity-'));
const bundle = join(scratch, 'shared-core.mjs');
await build({
  entryPoints: [join(repo, 'desktop', 'shared-core.mjs')],
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

const base = core.normalizeState({
  games: [game('g1'), game('g2', { name: 'Zweite Welt — 日本', sort: 1 })],
  resources: [resource('r1', 'g1'), resource('r2', 'g2', { cap: 180 })],
  snapshots: [snapshot('s1', 'r1', 120, now - 3_600_000)],
  tasks: [task('t1', 'g1'), task('t2', 'g2', { cadence: 'weekly', intervalDays: 7 })],
});
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
  let file = item.raw === null ? null : structuredClone(item.raw);
  let wrote = false;
  const access = createStateAccess({
    loadCore: async () => core,
    read: () => structuredClone(file),
    write: (state) => {
      wrote = true;
      file = state;
    },
  });
  const body = item.body ?? JSON.stringify({ state: item.incoming });
  const raw = item.raw === null ? null : JSON.stringify(item.raw);
  let expected;
  try {
    expected = { ok: await access.merge(JSON.parse(body)?.state), wrote };
  } catch (error) {
    expected = { status: error.status ?? 500, error: String(error.message) };
  }
  const read = await createStateAccess({
    loadCore: async () => core,
    read: () => (raw === null ? null : JSON.parse(raw)),
  }).read();
  results.push({ name: item.name, raw, body, expected, read });
}
process.stdout.write(JSON.stringify(results));
