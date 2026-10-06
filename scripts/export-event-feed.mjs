import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundled = await build({
  stdin: {
    contents:
      "export { SEED_EVENTS, SEED_UPDATED, SEED_WITHDRAWN_KEYS } from './app/src/data/seed-feed.ts'; export { RemoteEventFeedSchema, MAX_EVENT_FEED_BYTES } from './shared/src/event-feed.ts';",
    resolveDir: root,
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const module = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const { SEED_EVENTS, SEED_UPDATED, SEED_WITHDRAWN_KEYS, RemoteEventFeedSchema, MAX_EVENT_FEED_BYTES } = module;
const check = process.argv.includes('--check');
const outputPath = path.join(root, 'app/public/events.json');
let published;
try {
  const existing = await readFile(outputPath, 'utf8');
  if (Buffer.byteLength(existing) > MAX_EVENT_FEED_BYTES) throw new Error('The public calendar exceeds 512 KB.');
  published = RemoteEventFeedSchema.parse(JSON.parse(existing));
} catch (error) {
  if (check || error.code !== 'ENOENT') throw error;
}
const timestampArgument = process.argv.indexOf('--generated-at');
const content = { seedUpdated: SEED_UPDATED, events: SEED_EVENTS, withdrawn: SEED_WITHDRAWN_KEYS };
const revision = createHash('sha256').update(JSON.stringify(content)).digest('hex');
const changed = published?.revision !== revision;
const at = Date.now();
const generatedAt = check
  ? published.generatedAt
  : timestampArgument >= 0
    ? process.argv[timestampArgument + 1]
    : !changed
      ? published.generatedAt
      : new Date(Math.max(at, published ? Date.parse(published.generatedAt) + 1 : at)).toISOString();
if (!check) {
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp) || timestamp > at + 300_000)
    throw new Error('The public calendar publication timestamp is invalid or too far in the future.');
  if (changed && published && timestamp <= Date.parse(published.generatedAt))
    throw new Error('Changed calendar content needs a later publication timestamp.');
}
const feed = RemoteEventFeedSchema.parse({ version: 2, generatedAt, revision, ...content });
const json = `${JSON.stringify(feed)}\n`;
if (Buffer.byteLength(json) > MAX_EVENT_FEED_BYTES) throw new Error('The public calendar exceeds 512 KB.');
if (check) {
  if (!isDeepStrictEqual(published, JSON.parse(json)))
    throw new Error('app/public/events.json is stale. Run npm run export:events and include the updated feed.');
  console.log(`Public calendar matches ${feed.events.length} reviewed events, revision ${revision.slice(0, 12)}.`);
} else {
  await writeFile(outputPath, json, 'utf8');
  console.log(
    `Exported ${feed.events.length} reviewed events (${Buffer.byteLength(json)} bytes), revision ${revision.slice(0, 12)}.`,
  );
}
