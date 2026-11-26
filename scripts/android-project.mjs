import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { withAndroidPolicy } from './android-csp.mjs';

/** The Android project, shared by the release build and the compile check. */
export const root = resolve(import.meta.dirname, '..');
export const androidDir = join(root, 'android');
const windows = process.platform === 'win32';
const env = { ...process.env };
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || (env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Android', 'Sdk'));
if (sdk && existsSync(sdk)) env.ANDROID_HOME = sdk;
const studioJava = join(env.ProgramFiles || 'C:/Program Files', 'Android', 'Android Studio', 'jbr');
if (!env.JAVA_HOME && windows && existsSync(studioJava)) env.JAVA_HOME = studioJava;

export function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Build the web app, copy it into the Android project, and put its content policy in the page. */
export function syncWebAssets() {
  // Native and browser builds share the same tested, fully local web assets.
  if (windows) run('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'npm -w app run build']);
  else run('npm', ['-w', 'app', 'run', 'build']);
  run(
    process.execPath,
    [join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'],
    join(root, 'app'),
  );

  // The WebView has no response headers, so the content policy rides in the page.
  const page = join(androidDir, 'app', 'src', 'main', 'assets', 'public', 'index.html');
  writeFileSync(page, withAndroidPolicy(readFileSync(page, 'utf8')));
}

/** Run Gradle tasks (one build, in order) in the Android project without leaving a daemon behind. */
export function gradle(...tasks) {
  if (windows)
    run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', `& ./gradlew.bat ${tasks.join(' ')} --no-daemon`],
      androidDir,
    );
  else run('sh', ['./gradlew', ...tasks, '--no-daemon'], androidDir);
}
