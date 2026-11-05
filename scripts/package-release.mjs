// Builds the downloadable Memoria release: a zip a person unpacks anywhere and
// double-clicks. One small Rust program plus the built app; the window is the
// WebView2 runtime that ships with Windows.
//
//   npm run build            # must run first — this script only assembles
//   npm run package
//
// Output lands in dist/release/:
//   Memoria-win-x64.zip   the download
//   SHA256SUMS.txt        digests, which the in-app updater verifies before it
//                         unpacks anything it fetched
//
// The zip contains one top-level `Memoria/` folder, so unpacking it in
// Downloads produces a folder rather than a mess.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const releaseDir = join(root, 'dist', 'release');
const stageDir = join(releaseDir, 'Memoria');

const ZIP_NAME = 'Memoria-win-x64.zip';
const SUMS_NAME = 'SHA256SUMS.txt';

function fail(message) {
  console.error(`package-release: ${message}`);
  process.exit(1);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Everything written into the zip is read on Windows, in Notepad as often as not. */
function writeStagedText(name, lines) {
  writeFileSync(join(stageDir, name), `${lines.join('\r\n')}\r\n`, 'utf8');
}

/** Single-quoted PowerShell literal — the only escape that matters is the quote itself. */
function powershellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

// --- inputs -----------------------------------------------------------------

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+/.test(version)) fail(`package.json version "${version}" is not a release version`);
if (process.platform !== 'win32' || process.arch !== 'x64') fail('build the Windows release on Windows x64');

// Everything the app needs at runtime, and nothing else. Listed explicitly
// rather than copied wholesale so a stray local file cannot end up in a public
// download.
const required = [
  ['app/dist', 'app/dist'],
  ['desktop/memoria.ico', 'desktop/memoria.ico'],
  ['desktop/Install-Shortcut.ps1', 'desktop/Install-Shortcut.ps1'],
  ['desktop/Install-Lock.ps1', 'desktop/Install-Lock.ps1'],
];
for (const [source] of [...required, ['desktop/dist/core.js']]) {
  if (!existsSync(join(root, source))) fail(`missing ${source} — run "npm run build" before packaging`);
}

// --- the Windows program ------------------------------------------------------

// The program reports the same version as the release it ships in.
const tauriDir = join(root, 'desktop', 'tauri');
const cargoToml = join(tauriDir, 'Cargo.toml');
writeFileSync(cargoToml, readFileSync(cargoToml, 'utf8').replace(/^version = "[^"]+"/m, `version = "${version}"`));
const tauriConf = join(tauriDir, 'tauri.conf.json');
const conf = JSON.parse(readFileSync(tauriConf, 'utf8'));
if (conf.version !== version) writeFileSync(tauriConf, `${JSON.stringify({ ...conf, version }, null, 2)}\n`);

console.log('Building Memoria.exe...');
const built = spawnSync('cargo', ['build', '--release', '--manifest-path', cargoToml], {
  stdio: 'inherit',
});
if (built.status !== 0) fail('cargo could not build Memoria.exe');
const program = join(tauriDir, 'target', 'release', 'Memoria.exe');
if (!existsSync(program)) fail('cargo did not produce Memoria.exe');

// --- assemble ---------------------------------------------------------------

if (existsSync(stageDir)) {
  const idle = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$ErrorActionPreference = 'Stop'; . ${powershellLiteral(join(root, 'desktop', 'Install-Lock.ps1'))}; $locks = Lock-MemoriaProgramTree ${powershellLiteral(stageDir)}; try { Remove-Item -LiteralPath ${powershellLiteral(stageDir)} -Recurse -Force } finally { Unlock-MemoriaProgramTree $locks }`,
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  if (idle.status !== 0) fail(`close Memoria from ${stageDir} before replacing the staged release`);
}
mkdirSync(stageDir, { recursive: true });

cpSync(program, join(stageDir, 'Memoria.exe'));
for (const [source, destination] of required) {
  cpSync(join(root, source), join(stageDir, destination), { recursive: true });
}

// The marker that tells the program it is installed, and the version the
// updater compares against GitHub.
writeFileSync(
  join(stageDir, 'release.json'),
  `${JSON.stringify(
    {
      name: 'Memoria',
      version,
      tag: `v${version}`,
      channel: 'stable',
      runtime: 'tauri',
      updateMode: 'manual',
      builtAt: new Date().toISOString(),
      platform: 'win-x64',
    },
    null,
    2,
  )}\n`,
  'utf8',
);

writeStagedText('Start Memoria.cmd', [
  '@echo off',
  'rem Open the standalone app with its bundled runtime.',
  'cd /d "%~dp0"',
  'start "" "%~dp0Memoria.exe" %*',
]);

writeStagedText('Add Memoria to Start Menu.cmd', [
  '@echo off',
  'rem Installs Memoria for this Windows user and creates shortcuts.',
  'cd /d "%~dp0"',
  'powershell -NoProfile -ExecutionPolicy Bypass -File desktop\\Install-Shortcut.ps1',
  'pause',
]);

writeStagedText('README.txt', [
  `Memoria ${version}`,
  '',
  'A gacha daily / energy / event tracker that runs entirely on this machine.',
  'No cloud account. Optional Wi-Fi sync connects your Android phone to this PC.',
  'Uses the WebView2 runtime built into Windows. No browser or developer tools required.',
  '',
  'START IT',
  '  Double-click Memoria.exe.',
  '  To install it, close Memoria and run "Add Memoria to Start Menu.cmd".',
  '  The installer copies the app to %LOCALAPPDATA%\\Programs\\Memoria.',
  '  It creates Desktop and Start Menu shortcuts. No administrator rights needed.',
  '  For phone sync, right-click the Memoria tray icon and select Allow phone sync through Windows.',
  '  Approve the Windows permission request to allow local phone connections.',
  '',
  'UPDATES',
  '  Memoria checks GitHub for new versions and shows what changed.',
  '  Select Update, then Restart and update. Your data is kept.',
  '  Right-click the Memoria tray icon and select Check for updates to check now.',
  '',
  'YOUR DATA',
  '  Lives in %APPDATA%\\memoria, not in this folder. Deleting or replacing',
  '  this folder never touches it. Back it up from Settings -> Data.',
  '',
  'Everything, including the source: https://github.com/JanKonradK/Memoria',
]);

// --- zip --------------------------------------------------------------------

const zipPath = join(releaseDir, ZIP_NAME);
// Compress-Archive is on every supported Windows and, unlike bsdtar's zip
// writer, needs no feature probing. Non-Windows hosts get bsdtar, which is
// enough for a maintainer inspecting the layout locally.
if (process.platform === 'win32') {
  const zipped = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -LiteralPath ${powershellLiteral(stageDir)} -DestinationPath ${powershellLiteral(zipPath)} -CompressionLevel Optimal -Force`,
    ],
    { stdio: 'inherit' },
  );
  if (zipped.status !== 0) fail('Compress-Archive failed');
} else {
  const zipped = spawnSync('tar', ['-c', '-f', zipPath, '--format', 'zip', '-C', releaseDir, 'Memoria'], {
    stdio: 'inherit',
  });
  if (zipped.status !== 0) fail('tar could not write the zip');
}

const digest = sha256(zipPath);
const sumsPath = join(releaseDir, SUMS_NAME);
const otherSums = existsSync(sumsPath)
  ? readFileSync(sumsPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.endsWith(`  ${ZIP_NAME}`))
  : [];
writeFileSync(sumsPath, [...otherSums, `${digest}  ${ZIP_NAME}`, ''].join('\n'), 'utf8');

const megabytes = (statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`\n${basename(zipPath)}  ${megabytes} MB`);
console.log(`sha256  ${digest}`);
console.log(`\nStaged tree: ${stageDir}`);
