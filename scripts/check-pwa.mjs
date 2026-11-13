import { gzipSync } from 'node:zlib';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'app', 'dist');
const required = ['index.html', 'manifest.webmanifest', 'sw.js'];

const html = (await readFile(resolve(dist, 'index.html'), 'utf8')).replace(/\r\n?/g, '\n');
const headers = await readFile(resolve(dist, '_headers'), 'utf8');
for (const match of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
  const hash = `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`;
  if (!headers.includes(hash)) throw new Error(`Update the theme script hash in app/public/_headers: ${hash}`);
}

for (const file of required) {
  await stat(resolve(dist, file)).catch(() => {
    throw new Error(`Missing required PWA build artifact: app/dist/${file}`);
  });
}

const assets = await readdir(resolve(dist, 'assets'));
const jsFiles = assets.filter((file) => file.endsWith('.js'));
if (jsFiles.length === 0) throw new Error('No JavaScript bundle found in app/dist/assets');

// What a phone downloads and parses before the first screen: the entry page's
// scripts and styles, gzipped. Held at the measured size plus a little room; it
// only moves up with a decision in review, never to make a failing build pass.
const STARTUP_BUDGET = 380 * 1024;
const startup = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1]);
let startupBytes = 0;
for (const file of startup) startupBytes += gzipSync(await readFile(resolve(dist, file)), { level: 9 }).length;
if (startupBytes > STARTUP_BUDGET)
  throw new Error(
    `The startup path is ${startupBytes} bytes gzipped; the budget is ${STARTUP_BUDGET}. Load something later instead.`,
  );

const sizes = await Promise.all(
  jsFiles.map(async (file) => ({ file, bytes: (await stat(resolve(dist, 'assets', file))).size })),
);
const largest = sizes.sort((a, b) => b.bytes - a.bytes)[0];
// A backstop for any single chunk, lazy ones included.
const budget = 512 * 1024;

if (largest.bytes > budget) {
  throw new Error(
    `Largest JavaScript bundle ${largest.file} is ${largest.bytes} bytes; budget is ${budget} bytes. Split the bundle before merging.`,
  );
}

console.log(
  `PWA artifacts present; startup path ${startupBytes} bytes gzipped (budget ${STARTUP_BUDGET}); largest chunk ${largest.bytes} bytes (budget ${budget}).`,
);
