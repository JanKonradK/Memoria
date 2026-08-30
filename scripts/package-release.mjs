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
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
const NODE_VERSION = process.env['MEMORIA_NODE_VERSION'] ?? 'v24.14.0';
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
  ['desktop/update.mjs', 'desktop/update.mjs'],
  ['desktop/shared-core.mjs', 'desktop/shared-core.mjs'],
  ['desktop/dist/shared-core.mjs', 'desktop/dist/shared-core.mjs'],
  ['desktop/Memoria.vbs', 'desktop/Memoria.vbs'],
  ['desktop/memoria.ico', 'desktop/memoria.ico'],
  ['desktop/Install-Shortcut.ps1', 'desktop/Install-Shortcut.ps1'],
];

for (const [source] of required) {
  if (!existsSync(join(root, source))) {
    fail(`missing ${source} — run "npm run build" before packaging`);
  }
}

// --- bundled Node -----------------------------------------------------------

/**
 * Fetches the official node.exe and checks it against the SHASUMS256.txt that
 * nodejs.org publishes beside it. A runtime pulled over the network and handed
 * to users unverified would be the single worst link in this chain.
 */
async function fetchNodeExe() {
  const cached = join(nodeCacheDir, NODE_VERSION, 'node.exe');
  if (existsSync(cached)) return cached;

  const sumsResponse = await fetch(`${NODE_DIST}/SHASUMS256.txt`);
  if (!sumsResponse.ok) fail(`nodejs.org returned ${sumsResponse.status} for SHASUMS256.txt`);
  const sums = await sumsResponse.text();
  const line = sums.split(/\r?\n/).find((entry) => entry.trim().endsWith('win-x64/node.exe'));
  if (!line) fail(`SHASUMS256.txt for ${NODE_VERSION} does not list win-x64/node.exe`);
  const expected = line.trim().split(/\s+/)[0].toLowerCase();

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

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

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
      builtAt: new Date().toISOString(),
      platform: 'win-x64',
    },
    null,
    2,
  )}\n`,
  'utf8',
);

writeFileSync(
  join(stageDir, 'Start Memoria.cmd'),
  [
    '@echo off',
    'rem Visible-console fallback. The Desktop shortcut installed by',
    'rem "Add Memoria to Start Menu.cmd" runs the same launcher with no window.',
    'cd /d "%~dp0"',
    'node\\node.exe desktop\\memoria.mjs %*',
    '',
  ].join('\r\n'),
  'utf8',
);

writeFileSync(
  join(stageDir, 'Add Memoria to Start Menu.cmd'),
  [
    '@echo off',
    'rem Puts Memoria on the Desktop and Start Menu with its icon.',
    'cd /d "%~dp0"',
    'powershell -NoProfile -ExecutionPolicy Bypass -File desktop\\Install-Shortcut.ps1',
    'pause',
    '',
  ].join('\r\n'),
  'utf8',
);

writeFileSync(
  join(stageDir, 'README.txt'),
  [
    `Memoria ${version}`,
    '',
    'A gacha daily / energy / event tracker that runs entirely on this machine.',
    'No account, no server, nothing leaves the computer.',
    '',
    'START IT',
    '  Double-click "Start Memoria.cmd".',
    '  Then run "Add Memoria to Start Menu.cmd" once to get a Desktop icon.',
    '',
    'UPDATES',
    '  Memoria checks GitHub for a new version in the background, at most once',
    '  every six hours. A new build downloads quietly and is put in place the',
    '  next time you start the app. Nothing is installed without a restart.',
    '',
    '  To check immediately:  node\\node.exe desktop\\memoria.mjs --check-update',
    '  To turn it off:        set MEMORIA_NO_UPDATE=1 before starting.',
    '',
    'YOUR DATA',
    `  Lives in %APPDATA%\\memoria, not in this folder. Deleting or replacing`,
    '  this folder never touches it. Back it up from Settings -> Data.',
    '',
    'Everything, including the source: https://github.com/JanKonradK/Memoria',
    '',
  ].join('\r\n'),
  'utf8',
);

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
      `Compress-Archive -Path '${stageDir}' -DestinationPath '${zipPath}' -CompressionLevel Optimal -Force`,
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
writeFileSync(join(releaseDir, SUMS_NAME), `${digest}  ${ZIP_NAME}\n`, 'utf8');

const megabytes = (statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`\n${basename(zipPath)}  ${megabytes} MB`);
console.log(`sha256  ${digest}`);
console.log(`\nStaged tree: ${stageDir}`);
