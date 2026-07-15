import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'app', 'dist');
const required = ['index.html', 'manifest.webmanifest', 'sw.js'];

for (const file of required) {
  await stat(resolve(dist, file)).catch(() => {
    throw new Error(`Missing required PWA build artifact: app/dist/${file}`);
  });
}

const assets = await readdir(resolve(dist, 'assets'));
const jsFiles = assets.filter((file) => file.endsWith('.js'));
if (jsFiles.length === 0) throw new Error('No JavaScript bundle found in app/dist/assets');

const sizes = await Promise.all(
  jsFiles.map(async (file) => ({ file, bytes: (await stat(resolve(dist, 'assets', file))).size })),
);
const largest = sizes.sort((a, b) => b.bytes - a.bytes)[0];
const budget = 350 * 1024;

if (largest.bytes > budget) {
  throw new Error(
    `Largest JavaScript bundle ${largest.file} is ${largest.bytes} bytes; budget is ${budget} bytes. Split the bundle before merging.`,
  );
}

console.log(`PWA artifacts present; largest JavaScript bundle is ${largest.bytes} bytes.`);
