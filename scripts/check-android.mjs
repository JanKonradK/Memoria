import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gradle, androidDir, syncWebAssets } from './android-project.mjs';
import { nativeLibraryAlignment, PAGE_ALIGN } from './android-alignment.mjs';

// The Android readiness gate: the same web assets and content policy a release
// ships, then a debug build of both flavours, which compiles the Java code,
// manifests and resources of each. Then two Play checks on what was built:
//   1. the Play build's merged manifest holds none of the permissions and
//      components it must not ship (docs/play-store-compliance.md), and
//   2. every 64-bit native library is aligned for 16 KB memory pages.
// Nothing is signed with the release key or copied to dist/.
const app = join(androidDir, 'app');
const failures = [];

syncWebAssets();
gradle('assembleDirectDebug', 'assemblePlayDebug');

/** The merged manifest Gradle wrote for one variant, wherever this Android Gradle Plugin keeps it. */
function mergedManifest(variant) {
  const root = join(app, 'build', 'intermediates');
  const found = [];
  const walk = (directory, depth) => {
    if (depth > 6 || !existsSync(directory)) return;
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path, depth + 1);
      else if (name === 'AndroidManifest.xml') found.push(path);
    }
  };
  if (existsSync(root))
    for (const name of readdirSync(root)) if (name.startsWith('merged_manifest')) walk(join(root, name), 1);
  const wanted = found.filter((path) => relative(root, path).split(/[\\/]/).includes(variant));
  if (!wanted.length) throw new Error(`No merged manifest for ${variant} under ${relative(androidDir, root)}.`);
  return wanted.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

// What the Play build must not declare. The direct build keeps every one.
const FORBIDDEN = [
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.USE_EXACT_ALARM',
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'app.memoria.tracker.AlarmService',
  'app.memoria.tracker.AlarmActivity',
  'app.memoria.tracker.AlarmReceiver',
];
const declares = (manifest, name) => new RegExp(`android:name="${name.replace(/\./g, '\\.')}"`).test(manifest);

const play = readFileSync(mergedManifest('playDebug'), 'utf8');
const direct = readFileSync(mergedManifest('directDebug'), 'utf8');
const leaked = FORBIDDEN.filter((name) => declares(play, name));
for (const name of leaked) failures.push(`The Play manifest declares ${name}.`);
// The overlay must only touch the Play build: the GitHub build still installs updates and rings alarms.
for (const name of ['android.permission.REQUEST_INSTALL_PACKAGES', 'app.memoria.tracker.AlarmService'])
  if (!declares(direct, name)) failures.push(`The direct manifest lost ${name}.`);
console.log(
  leaked.length
    ? `\nPlay manifest: ${leaked.length} forbidden declaration(s).`
    : `\nPlay manifest: none of the ${FORBIDDEN.length} forbidden permissions or components.`,
);

for (const flavour of ['direct', 'play']) {
  const apk = join(app, 'build', 'outputs', 'apk', flavour, 'debug', `app-${flavour}-debug.apk`);
  if (!existsSync(apk)) {
    failures.push(`The ${flavour} debug APK was not built.`);
    continue;
  }
  const libraries = nativeLibraryAlignment(apk);
  const checked = libraries.filter((library) => library.checked);
  console.log(`\n${flavour}: ${libraries.length} native libraries, ${checked.length} on 64-bit ABIs`);
  for (const library of checked) {
    const align = library.align === null ? 'no PT_LOAD' : `${library.align} B`;
    const zip = library.zipAligned ? 'zip 16 KB ok' : `zip offset ${library.zipOffset} unaligned`;
    console.log(`  ${library.ok ? 'ok  ' : 'FAIL'} ${library.name} (PT_LOAD align ${align}, ${zip})`);
    if (!library.ok) {
      if (library.align === null || library.align < PAGE_ALIGN)
        failures.push(`${flavour}: ${library.name} is aligned to ${align}, under ${PAGE_ALIGN} B (16 KB pages).`);
      if (!library.zipAligned)
        failures.push(
          `${flavour}: ${library.name} is stored uncompressed at offset ${library.zipOffset}, not aligned to ${PAGE_ALIGN} B (16 KB pages).`,
        );
    }
  }
}

if (failures.length) {
  console.error(`\nAndroid check failed:\n${failures.map((failure) => `  - ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log(
  '\nAndroid debug builds compiled (direct and play), the Play manifest is clean, and native code is 16 KB aligned.',
);
