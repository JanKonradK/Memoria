// Memoria self-update.
//
// Only ever runs in a PACKAGED install — the release zip carries a release.json
// at the install root, and a git checkout does not. A developer running
// `node desktop/memoria.mjs` from a clone must never have their working tree
// overwritten by a download, so every entry point here returns early without
// release.json.
//
// The update is downloaded in the background and applied at the START of the
// next launch, before the server binds. Applying mid-session would swap the
// files out from under a running window; applying at startup means the only
// code holding those paths open is this process, which has already read what it
// needs into memory.
//
// Zero dependencies — plain Node, like the launcher it serves.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import os from 'node:os';

/**
 * The repository the updater reads releases from. A rename on GitHub keeps
 * redirecting the API, but this is the one line to change if the project ever
 * moves for real.
 */
export const REPO = 'JanKonradK/Memoria';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;

/** The zip built by scripts/package-release.mjs and attached to every release. */
const ASSET_NAME = 'Memoria-win-x64.zip';
const CHECKSUM_ASSET = 'SHA256SUMS.txt';

/** GitHub is asked for the latest release at most this often. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** A download that has not finished by now is not worth blocking a release on. */
const NETWORK_TIMEOUT_MS = 60_000;
/** Nothing here is worth a crash; the app runs fine on the version already on disk. */
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

const APP_DATA_ROOT = process.env['APPDATA'] ?? join(os.homedir(), '.config');
const DATA_DIR = join(APP_DATA_ROOT, 'memoria');
const UPDATE_DIR = join(DATA_DIR, 'updates');
const PENDING_DIR = join(UPDATE_DIR, 'pending');
const PENDING_MANIFEST = join(UPDATE_DIR, 'pending.json');
const LAST_CHECK_FILE = join(UPDATE_DIR, 'last-check.json');
/** Suffix for a file staged next to its destination but not yet swapped in. */
const STAGED_SUFFIX = '.mem-new';
/** Suffix for a running executable moved aside so its replacement can land. */
const RETIRED_SUFFIX = '.mem-old';

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * The release record dropped at the install root by the packaging script.
 * Its presence is the single signal that this is a packaged install rather
 * than a checkout.
 */
export function readReleaseRecord(installRoot) {
  return readJson(join(installRoot, 'release.json'));
}

export function isPackagedInstall(installRoot) {
  return readReleaseRecord(installRoot) !== null;
}

export function installedVersion(installRoot) {
  return readReleaseRecord(installRoot)?.version ?? null;
}

/**
 * Compares `1.2.3`-shaped versions. A build carrying a prerelease tag
 * (`1.2.3-beta.1`) sorts below the same release without one, which is enough
 * ordering for a channel that only ever ships finished tags.
 */
export function compareVersions(left, right) {
  const parse = (value) => {
    const [core = '', prerelease = ''] = String(value).replace(/^v/, '').split('-', 2);
    const parts = core.split('.').map((part) => Number.parseInt(part, 10) || 0);
    return { parts, prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Every file under a directory, as paths relative to it. */
function walk(root, base = root, found = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) walk(path, base, found);
    else found.push(relative(base, path));
  }
  return found;
}

// ---------------------------------------------------------------------------
// Applying a staged update
// ---------------------------------------------------------------------------

/**
 * Moves a file that Windows will not let us overwrite. A running .exe cannot be
 * deleted or written through, but it CAN be renamed — so the live binary is
 * pushed aside and the replacement takes its path. The stale copy is swept up
 * by a later launch, once nothing is executing it.
 */
function retireLockedFile(destination) {
  const retired = `${destination}${RETIRED_SUFFIX}`;
  rmSync(retired, { force: true });
  renameSync(destination, retired);
}

function sweepRetiredFiles(installRoot) {
  if (!existsSync(installRoot)) return;
  for (const relativePath of walk(installRoot)) {
    if (!relativePath.endsWith(RETIRED_SUFFIX)) continue;
    // Still locked if the old binary is somehow live; force:false would throw,
    // so this stays best-effort and simply retries on the next launch.
    try {
      rmSync(join(installRoot, relativePath), { force: true });
    } catch {
      /* swept next time */
    }
  }
}

/**
 * Copies a verified pending tree over the install root in two phases: stage
 * every file beside its destination, then swap them all in. Phase one is where
 * disk-full and permission failures land, and it breaks nothing when it fails —
 * by the time phase two starts, every byte is already on the target volume.
 */
function applyTree(pendingRoot, installRoot) {
  const files = walk(pendingRoot);
  const staged = [];

  for (const relativePath of files) {
    const source = join(pendingRoot, relativePath);
    const destination = join(installRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    const stagedPath = `${destination}${STAGED_SUFFIX}`;
    copyFileSync(source, stagedPath);
    staged.push({ destination, stagedPath });
  }

  for (const { destination, stagedPath } of staged) {
    if (existsSync(destination)) {
      try {
        rmSync(destination, { force: true });
      } catch {
        retireLockedFile(destination);
      }
    }
    renameSync(stagedPath, destination);
  }

  return files.length;
}

/**
 * Applies a previously downloaded update, if one is staged and newer than what
 * is installed. Call this FIRST at startup, before the server binds.
 *
 * Never throws: an install that cannot be updated is still an install that
 * runs, and a user who is offline, out of disk or inside Program Files without
 * write access should get their app, not a stack trace.
 *
 * @returns {{applied: boolean, version?: string, files?: number, reason?: string}}
 */
export function applyPendingUpdate(installRoot) {
  const record = readReleaseRecord(installRoot);
  if (!record) return { applied: false, reason: 'not a packaged install' };

  sweepRetiredFiles(installRoot);

  const manifest = readJson(PENDING_MANIFEST);
  if (!manifest || !existsSync(PENDING_DIR)) return { applied: false, reason: 'nothing staged' };

  // A pending tree at or below the running version is left over from an update
  // that already landed, or from a downgrade that should not happen on its own.
  if (compareVersions(manifest.version, record.version) <= 0) {
    rmSync(PENDING_DIR, { recursive: true, force: true });
    rmSync(PENDING_MANIFEST, { force: true });
    return { applied: false, reason: 'staged build is not newer' };
  }

  try {
    const files = applyTree(PENDING_DIR, installRoot);
    rmSync(PENDING_DIR, { recursive: true, force: true });
    rmSync(PENDING_MANIFEST, { force: true });
    return { applied: true, version: manifest.version, files };
  } catch (error) {
    // Leave the pending tree in place: the next launch retries, and a partially
    // staged tree is harmless because phase two only runs after phase one.
    return { applied: false, reason: String(error?.message ?? error) };
  }
}

// ---------------------------------------------------------------------------
// Checking for and downloading an update
// ---------------------------------------------------------------------------

function dueForCheck(force) {
  if (force) return true;
  const last = readJson(LAST_CHECK_FILE);
  if (!last?.checkedAt) return true;
  return Date.now() - Date.parse(last.checkedAt) > CHECK_INTERVAL_MS;
}

async function fetchWithTimeout(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': `Memoria-updater (+https://github.com/${REPO})`, ...headers },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function downloadTo(url, destination) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_DOWNLOAD_BYTES) throw new Error(`refusing a ${length}-byte download`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > MAX_DOWNLOAD_BYTES) throw new Error('download exceeded the size ceiling');
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, body);
  return destination;
}

/**
 * Unpacks a zip using whatever the machine already has. Windows 10 build 17063
 * and later ship bsdtar as `tar`, which reads zip and is markedly faster than
 * Expand-Archive; PowerShell is the fallback for everything older.
 */
function extractZip(zipFile, destination) {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });

  const tar = spawnSync('tar', ['-xf', zipFile, '-C', destination], { stdio: 'ignore' });
  if (tar.status === 0) return;

  if (process.platform !== 'win32') throw new Error('no usable unzip tool found');
  const powershell = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipFile}' -DestinationPath '${destination}' -Force`,
    ],
    { stdio: 'ignore' },
  );
  if (powershell.status !== 0) throw new Error('could not unpack the downloaded update');
}

/**
 * The release zip contains a single top-level `Memoria/` folder so that
 * unpacking it by hand does not litter the user's Downloads. Staging needs the
 * contents, not the wrapper.
 */
function unwrapSingleRoot(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) return directory;
  return join(directory, entries[0].name);
}

function parseChecksums(text) {
  const table = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (match) table.set(match[2].replace(/^\.\//, ''), match[1].toLowerCase());
  }
  return table;
}

/**
 * Asks GitHub for the latest release and, if it is newer than the running
 * build, downloads and stages it for the next launch.
 *
 * Never throws, for the same reason applyPendingUpdate does not: this runs in
 * the background of a launch the user asked for, and a failed check is not
 * their problem to see.
 *
 * @returns {Promise<{status: string, version?: string, reason?: string}>}
 */
export async function checkForUpdate(installRoot, { force = false } = {}) {
  const record = readReleaseRecord(installRoot);
  if (!record) return { status: 'skipped', reason: 'not a packaged install' };
  if (process.env['MEMORIA_NO_UPDATE']) return { status: 'skipped', reason: 'MEMORIA_NO_UPDATE is set' };
  if (!dueForCheck(force)) return { status: 'skipped', reason: 'checked recently' };

  const staged = readJson(PENDING_MANIFEST);
  if (staged && compareVersions(staged.version, record.version) > 0) {
    return { status: 'staged', version: staged.version, reason: 'already waiting for a restart' };
  }

  try {
    const response = await fetchWithTimeout(RELEASES_API, { accept: 'application/vnd.github+json' });
    // Record the attempt even when it fails, so a broken network or a rate
    // limit cannot turn every launch into another request.
    writeJson(LAST_CHECK_FILE, { checkedAt: new Date().toISOString() });
    if (!response.ok) return { status: 'error', reason: `GitHub responded ${response.status}` };

    const release = await response.json();
    if (release.draft || release.prerelease) return { status: 'current', reason: 'latest is not a final release' };

    const version = String(release.tag_name ?? '').replace(/^v/, '');
    if (!version) return { status: 'error', reason: 'release carries no tag' };
    if (compareVersions(version, record.version) <= 0) return { status: 'current', version: record.version };

    const assets = Array.isArray(release.assets) ? release.assets : [];
    const zipAsset = assets.find((asset) => asset.name === ASSET_NAME);
    const sumsAsset = assets.find((asset) => asset.name === CHECKSUM_ASSET);
    if (!zipAsset) return { status: 'error', reason: `release ${version} has no ${ASSET_NAME}` };
    if (!sumsAsset) return { status: 'error', reason: `release ${version} has no ${CHECKSUM_ASSET}` };

    const workDir = join(UPDATE_DIR, 'download');
    rmSync(workDir, { recursive: true, force: true });
    mkdirSync(workDir, { recursive: true });

    const zipFile = join(workDir, ASSET_NAME);
    await downloadTo(zipAsset.browser_download_url, zipFile);
    const sumsFile = await downloadTo(sumsAsset.browser_download_url, join(workDir, CHECKSUM_ASSET));

    // An unsigned zip off the internet gets checked against the digest the
    // release publishes before a single byte of it is unpacked.
    const expected = parseChecksums(readFileSync(sumsFile, 'utf8')).get(ASSET_NAME);
    if (!expected) return { status: 'error', reason: `${CHECKSUM_ASSET} does not list ${ASSET_NAME}` };
    const actual = sha256(zipFile);
    if (actual !== expected) {
      rmSync(workDir, { recursive: true, force: true });
      return { status: 'error', reason: `checksum mismatch (expected ${expected}, got ${actual})` };
    }

    const unpacked = join(workDir, 'unpacked');
    extractZip(zipFile, unpacked);
    const tree = unwrapSingleRoot(unpacked);
    if (!existsSync(join(tree, 'release.json'))) {
      return { status: 'error', reason: 'downloaded build has no release.json' };
    }

    rmSync(PENDING_DIR, { recursive: true, force: true });
    mkdirSync(dirname(PENDING_DIR), { recursive: true });
    renameSync(tree, PENDING_DIR);
    writeJson(PENDING_MANIFEST, { version, tag: release.tag_name, stagedAt: new Date().toISOString() });
    rmSync(workDir, { recursive: true, force: true });

    return { status: 'staged', version };
  } catch (error) {
    return { status: 'error', reason: String(error?.message ?? error) };
  }
}

/** What the launcher reports over /api/update, and what `--check-update` prints. */
export function updateStatus(installRoot) {
  const record = readReleaseRecord(installRoot);
  const staged = readJson(PENDING_MANIFEST);
  return {
    packaged: record !== null,
    version: record?.version ?? null,
    channel: record?.channel ?? 'stable',
    pending: staged && record && compareVersions(staged.version, record.version) > 0 ? staged.version : null,
    lastChecked: readJson(LAST_CHECK_FILE)?.checkedAt ?? null,
    releasePage: RELEASE_PAGE,
  };
}

/** Where a staged download lives, so the launcher can report and tests can clear it. */
export const paths = { DATA_DIR, UPDATE_DIR, PENDING_DIR, PENDING_MANIFEST, LAST_CHECK_FILE };
