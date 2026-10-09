// Builds the downloadable Memoria release: a zip a person unpacks anywhere and
// double-clicks, with no Node install, no npm and no build step of their own.
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
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const releaseDir = join(root, 'dist', 'release');
const stageDir = join(releaseDir, 'Memoria');
const nodeCacheDir = join(root, 'dist', '.node-cache');

/**
 * The Node runtime shipped inside the zip. Pinned rather than tracking latest:
 * the release is tested against one runtime, and a user's install should not
 * change underneath them because nodejs.org moved a tag.
 */
const NODE_VERSION = process.env['MEMORIA_NODE_VERSION'] ?? 'v24.21.0';
if (!/^v\d+\.\d+\.\d+$/.test(NODE_VERSION)) throw new Error('MEMORIA_NODE_VERSION must be a version such as v24.14.0.');
const NODE_DIST = `https://nodejs.org/dist/${NODE_VERSION}`;

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

// Everything the launcher needs at runtime, and nothing else. Listed explicitly
// rather than copied wholesale so a stray local file cannot end up in a public
// download.
const required = [
  ['app/dist', 'app/dist'],
  ['desktop/memoria.mjs', 'desktop/memoria.mjs'],
  ['desktop/electron-main.mjs', 'desktop/electron-main.mjs'],
  ['desktop/electron-preload.cjs', 'desktop/electron-preload.cjs'],
  ['desktop/native-policy.mjs', 'desktop/native-policy.mjs'],
  ['desktop/game-capture.mjs', 'desktop/game-capture.mjs'],
  ['desktop/play-mode.mjs', 'desktop/play-mode.mjs'],
  ['desktop/hoyo-login.mjs', 'desktop/hoyo-login.mjs'],
  ['desktop/browser-bridge.mjs', 'desktop/browser-bridge.mjs'],
  ['desktop/browser-host.mjs', 'desktop/browser-host.mjs'],
  ['desktop/browser-host.cmd', 'desktop/browser-host.cmd'],
  ['desktop/Register-Browser-Connector.ps1', 'desktop/Register-Browser-Connector.ps1'],
  ['browser-extension/manifest.json', 'browser-extension/manifest.json'],
  ['browser-extension/identity.json', 'browser-extension/identity.json'],
  ['browser-extension/background.mjs', 'browser-extension/background.mjs'],
  ['browser-extension/hoyo-client.mjs', 'browser-extension/hoyo-client.mjs'],
  ['browser-extension/popup.html', 'browser-extension/popup.html'],
  ['browser-extension/popup.mjs', 'browser-extension/popup.mjs'],
  ['browser-extension/popup.css', 'browser-extension/popup.css'],
  ['browser-extension/icon.png', 'browser-extension/icon.png'],
  ['browser-extension/rules.json', 'browser-extension/rules.json'],
  ['browser-extension/dm-sans-latin-400-normal.woff2', 'browser-extension/dm-sans-latin-400-normal.woff2'],
  ['browser-extension/dm-sans-latin-600-normal.woff2', 'browser-extension/dm-sans-latin-600-normal.woff2'],
  ['browser-extension/FONT-LICENSE.txt', 'browser-extension/FONT-LICENSE.txt'],
  ['desktop/lan-sync.mjs', 'desktop/lan-sync.mjs'],
  ['desktop/http-response.mjs', 'desktop/http-response.mjs'],
  ['desktop/game-connections.mjs', 'desktop/game-connections.mjs'],
  ['desktop/screenshot-ocr.mjs', 'desktop/screenshot-ocr.mjs'],
  ['desktop/screenshot-ocr.ps1', 'desktop/screenshot-ocr.ps1'],
  ['desktop/update.mjs', 'desktop/update.mjs'],
  ['desktop/shared-core.mjs', 'desktop/shared-core.mjs'],
  ['desktop/dist/shared-core.mjs', 'desktop/dist/shared-core.mjs'],
  ['desktop/Memoria.vbs', 'desktop/Memoria.vbs'],
  ['desktop/memoria.ico', 'desktop/memoria.ico'],
  ['desktop/Install-Shortcut.ps1', 'desktop/Install-Shortcut.ps1'],
  ['desktop/Install-Lock.ps1', 'desktop/Install-Lock.ps1'],
  ['desktop/Enable-Phone-Sync.ps1', 'desktop/Enable-Phone-Sync.ps1'],
];

for (const [source] of required) {
  if (!existsSync(join(root, source))) {
    fail(`missing ${source} — run "npm run build" before packaging`);
  }
}

// The release includes its own window engine. Never package a host runtime for
// a different platform under the Windows download name.
const electronRoot = join(root, 'node_modules', 'electron');
const electronDist = join(electronRoot, 'dist');
const electronExe = join(electronDist, 'electron.exe');
if (process.platform !== 'win32' || process.arch !== 'x64' || !existsSync(electronExe)) {
  fail('the Windows x64 Electron runtime is missing — install dependencies on Windows x64 before packaging');
}
const electronVersion = JSON.parse(readFileSync(join(electronRoot, 'package.json'), 'utf8')).version;
if (readFileSync(join(electronDist, 'version'), 'utf8').trim() !== electronVersion) {
  fail('the Electron runtime version does not match the installed package');
}

// --- bundled Node -----------------------------------------------------------

/**
 * Fetches the official node.exe and checks it against the SHASUMS256.txt that
 * nodejs.org publishes beside it. A runtime pulled over the network and handed
 * to users unverified would be the single worst link in this chain.
 */
async function fetchNodeExe() {
  const cached = join(nodeCacheDir, NODE_VERSION, 'node.exe');

  const sumsResponse = await fetch(`${NODE_DIST}/SHASUMS256.txt`);
  if (!sumsResponse.ok) fail(`nodejs.org returned ${sumsResponse.status} for SHASUMS256.txt`);
  const sums = await sumsResponse.text();
  const line = sums.split(/\r?\n/).find((entry) => entry.trim().endsWith('win-x64/node.exe'));
  if (!line) fail(`SHASUMS256.txt for ${NODE_VERSION} does not list win-x64/node.exe`);
  const expected = line.trim().split(/\s+/)[0].toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) fail('nodejs.org returned an invalid node.exe checksum');
  if (existsSync(cached)) {
    if (sha256(cached) === expected) return cached;
    rmSync(cached, { force: true });
  }

  console.log(`Downloading Node ${NODE_VERSION} (win-x64)...`);
  const exeResponse = await fetch(`${NODE_DIST}/win-x64/node.exe`);
  if (!exeResponse.ok) fail(`nodejs.org returned ${exeResponse.status} for node.exe`);
  const bytes = Buffer.from(await exeResponse.arrayBuffer());

  mkdirSync(join(nodeCacheDir, NODE_VERSION), { recursive: true });
  writeFileSync(cached, bytes);
  const actual = sha256(cached);
  if (actual !== expected) {
    rmSync(cached, { force: true });
    fail(`node.exe checksum mismatch (expected ${expected}, got ${actual})`);
  }
  return cached;
}

// --- assemble ---------------------------------------------------------------

if (process.platform === 'win32' && existsSync(stageDir)) {
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

// Keep independently built Android artifacts in the shared release directory.
if (process.platform !== 'win32') rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

// Include Electron's license files, locale files, resources, and native DLLs.
// Only its default example app is replaced with our small bootstrap module.
cpSync(electronDist, stageDir, { recursive: true });
renameSync(join(stageDir, 'electron.exe'), join(stageDir, 'Memoria.exe'));
rmSync(join(stageDir, 'resources', 'default_app.asar'), { force: true });
const electronApp = join(stageDir, 'resources', 'app');
mkdirSync(electronApp, { recursive: true });
writeFileSync(
  join(electronApp, 'package.json'),
  `${JSON.stringify({ name: 'memoria', productName: 'Memoria', version, type: 'module', main: 'main.mjs' }, null, 2)}\n`,
);
writeFileSync(join(electronApp, 'main.mjs'), "import '../../desktop/electron-main.mjs';\n");

for (const [source, destination] of required) {
  cpSync(join(root, source), join(stageDir, destination), { recursive: true });
}

const nodeExe = await fetchNodeExe();
mkdirSync(join(stageDir, 'node'), { recursive: true });
cpSync(nodeExe, join(stageDir, 'node', 'node.exe'));

// The marker that tells the launcher it is packaged: no source tree to rebuild
// from, and a version the updater can compare against GitHub.
writeFileSync(
  join(stageDir, 'release.json'),
  `${JSON.stringify(
    {
      name: 'Memoria',
      version,
      tag: `v${version}`,
      channel: 'stable',
      node: NODE_VERSION,
      electron: electronVersion,
      runtime: 'electron',
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
  'Includes its own window and runtime. No browser or developer tools required.',
  '',
  'START IT',
  '  Double-click Memoria.exe.',
  '  To install it, close Memoria and run "Add Memoria to Start Menu.cmd".',
  '  The installer copies the app to %LOCALAPPDATA%\\Programs\\Memoria.',
  '  It creates Desktop and Start Menu shortcuts. No administrator rights needed.',
  '  For phone sync, press Alt and select Help > Allow phone sync through Windows.',
  '  Approve the Windows permission request to allow local phone connections.',
  '',
  'UPDATES',
  '  Press Alt to show the desktop menu.',
  '  Select Help > Download updates to open the release page.',
  '  Download and extract the new Windows ZIP. Close Memoria.',
  '  Run "Add Memoria to Start Menu.cmd" from the new folder.',
  '  This version does not replace its program files automatically.',
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
