import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { drawPng } from '../app/scripts/draw-icon.mjs';

const root = resolve(import.meta.dirname, '..');
const androidDir = join(root, 'android');
const windows = process.platform === 'win32';
const env = { ...process.env };
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || (env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Android', 'Sdk'));
if (sdk && existsSync(sdk)) env.ANDROID_HOME = sdk;
const studioJava = join(env.ProgramFiles || 'C:/Program Files', 'Android', 'Android Studio', 'jbr');
if (!env.JAVA_HOME && windows && existsSync(studioJava)) env.JAVA_HOME = studioJava;

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Native and browser builds share the same tested, fully local web assets.
if (windows) run('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'npm -w app run build']);
else run('npm', ['-w', 'app', 'run', 'build']);
run(
  process.execPath,
  [join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'],
  join(root, 'app'),
);

// Reuse the existing Memoria mark rather than shipping Capacitor's starter icon.
for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  const directory = join(androidDir, 'app', 'src', 'main', 'res', `mipmap-${density}`);
  mkdirSync(directory, { recursive: true });
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    writeFileSync(join(directory, `${name}.png`), drawPng(size, { maskable: true }));
  }
  writeFileSync(join(directory, 'ic_launcher_foreground.png'), drawPng(Math.round(size * 2.25), { maskable: true }));
}

if (windows)
  run(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', '& ./gradlew.bat assembleDebug --no-daemon'],
    androidDir,
  );
else run('sh', ['./gradlew', 'assembleDebug', '--no-daemon'], androidDir);

const releaseDir = join(root, 'dist', 'release');
const name = 'Memoria-android-debug.apk';
mkdirSync(releaseDir, { recursive: true });
const artifact = join(releaseDir, name);
copyFileSync(join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'), artifact);
const digest = createHash('sha256').update(readFileSync(artifact)).digest('hex');
const sums = join(releaseDir, 'SHA256SUMS.txt');
const other = existsSync(sums)
  ? readFileSync(sums, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.endsWith(`  ${name}`))
  : [];
writeFileSync(sums, [...other, `${digest}  ${name}`, ''].join('\n'));
console.log(`\nAndroid debug APK: ${artifact}\nsha256 ${digest}`);
