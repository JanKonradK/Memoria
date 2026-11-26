import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { drawPng } from '../app/scripts/draw-icon.mjs';
import { androidDir, gradle, root, syncWebAssets } from './android-project.mjs';

// `--flavor direct` (the default) builds the APK on GitHub releases, which the
// in-app updater installs. `--flavor play` builds the Google Play bundle (.aab),
// with no updater and none of the permissions Play reserves for other apps.
const flagAt = process.argv.indexOf('--flavor');
const flavor = flagAt >= 0 ? process.argv[flagAt + 1] : 'direct';
if (flavor !== 'direct' && flavor !== 'play') {
  console.error(`Unknown flavor "${flavor}". Use --flavor direct or --flavor play.`);
  process.exit(1);
}

syncWebAssets();

// Reuse the existing Memoria mark rather than shipping Capacitor's starter icon.
for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  const directory = join(androidDir, 'app', 'src', 'main', 'res', `mipmap-${density}`);
  mkdirSync(directory, { recursive: true });
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    writeFileSync(join(directory, `${name}.png`), drawPng(size, { maskable: true }));
  }
  writeFileSync(join(directory, 'ic_launcher_foreground.png'), drawPng(Math.round(size * 2.25), { maskable: true }));
}

const outputs = join(androidDir, 'app', 'build', 'outputs');
const build =
  flavor === 'direct'
    ? {
        task: 'assembleDirectRelease',
        // The in-app updater looks for exactly this asset name on each release.
        name: 'Memoria-android.apk',
        from: join(outputs, 'apk', 'direct', 'release', 'app-direct-release.apk'),
      }
    : {
        task: 'bundlePlayRelease',
        name: 'Memoria-play.aab',
        from: join(outputs, 'bundle', 'playRelease', 'app-play-release.aab'),
      };
gradle(build.task);

const releaseDir = join(root, 'dist', 'release');
mkdirSync(releaseDir, { recursive: true });
const artifact = join(releaseDir, build.name);
copyFileSync(build.from, artifact);
const digest = createHash('sha256').update(readFileSync(artifact)).digest('hex');
const sums = join(releaseDir, 'SHA256SUMS.txt');
const other = existsSync(sums)
  ? readFileSync(sums, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.endsWith(`  ${build.name}`))
  : [];
writeFileSync(sums, [...other, `${digest}  ${build.name}`, ''].join('\n'));
console.log(`\nAndroid ${flavor === 'direct' ? 'APK' : 'Play bundle'}: ${artifact}\nsha256 ${digest}`);
