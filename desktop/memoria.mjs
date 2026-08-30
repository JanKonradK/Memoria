// Memoria desktop launcher.
// Serves the built PWA (app/dist) on a FIXED local port and opens it as a
// chromeless "app" window inside the user's default Chromium browser (shared
// profile — costs about one tab). The server exits on its own once no app
// window has been connected for a few minutes.
// Zero dependencies — plain Node. Invoked hidden by Memoria.vbs.
//
// The port must stay identical between launches: IndexedDB (all app data) is
// scoped to the origin `http://127.0.0.1:<port>`, so a changing port silently
// wipes the app's state on every launch. PORTS is an ordered list tried in the
// same order every time; the first entry is used unless a foreign app squats it.
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { dirname, join, normalize, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { applyPendingUpdate, checkForUpdate, isPackagedInstall, updateStatus } from './update.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const dist = join(repo, 'app', 'dist');

/**
 * A packaged install ships prebuilt `app/dist` and `desktop/dist` and carries
 * no source tree, so the two build-on-demand paths below must not fire: there
 * is no npm, no `shared/src` to stat, and nothing to compile. A checkout keeps
 * the old behaviour of rebuilding whatever has gone stale.
 */
const packaged = isPackagedInstall(repo);

// The one local state document — served over /api/sync to app windows.
const APP_DATA_ROOT = process.env['APPDATA'] ?? join(os.homedir(), '.config');
// Every directory this launcher has stored state in, newest first. The app has
// been renamed twice, and this directory holds the ONLY copy of the desktop
// state document — a rename that ignored it would look exactly like a first run
// while the real data sat one folder away.
const LEGACY_DATA_DIRS = [join(APP_DATA_ROOT, 'void'), join(APP_DATA_ROOT, 'technogg')];
const DATA_DIR = join(APP_DATA_ROOT, 'memoria');

function migrateLegacyDataDirectory() {
  for (const legacyDir of LEGACY_DATA_DIRS) {
    if (!existsSync(legacyDir)) continue;
    if (!existsSync(DATA_DIR)) {
      renameSync(legacyDir, DATA_DIR);
      return;
    }

    const legacyStateFile = join(legacyDir, 'state.json');
    const stateFile = join(DATA_DIR, 'state.json');
    if (!existsSync(legacyStateFile) || existsSync(stateFile)) continue;
    mkdirSync(DATA_DIR, { recursive: true });
    const legacyState = readFileSync(legacyStateFile);
    writeFileSync(stateFile, legacyState);
    if (!readFileSync(stateFile).equals(legacyState)) {
      throw new Error('Memoria could not verify the migrated desktop state file.');
    }
    return;
  }
}

migrateLegacyDataDirectory();
const STATE_FILE = join(DATA_DIR, 'state.json');
const TOKEN_FILE = join(DATA_DIR, 'launcher-token');
const LOCK_FILE = join(DATA_DIR, 'launcher.lock');

const PORTS = [17817, 17818, 17819];
/**
 * How long a lock may claim a port before an unanswered identity challenge is
 * taken as proof that its owner is gone. Long enough to cover a slow start, far
 * short of leaving a dead lock in place across reboots.
 */
const STALE_LOCK_GRACE_MS = 30_000;
const MARKER = 'x-void';
const MAX_SYNC_BYTES = 1_000_000;
const LAUNCH_TICKET_TTL_MS = 30_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/** Optional desktop/config.json: { "browser": "helium" }. */
let configCache = null;
function readConfig() {
  if (configCache) return configCache;
  try {
    const parsed = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'));
    configCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    configCache = {};
  }
  return configCache;
}

function ensureBuilt() {
  if (existsSync(join(dist, 'index.html'))) return;
  if (packaged) {
    // Nothing to fall back on: a release with no app/dist is a broken download,
    // and silently starting a server that can only 404 would look like the app
    // hanging. Say what is wrong and where to get an intact copy.
    throw new Error(
      'this install is missing app/dist. Re-download Memoria from ' +
        'https://github.com/JanKonradK/Memoria/releases/latest and unpack it again.',
    );
  }
  // First run (or after cleaning): build the app. npm.cmd on Windows.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  spawnSync(npm, ['run', 'build'], { cwd: repo, stdio: 'ignore' });
}

function protectPrivateFile(filePath) {
  // The HMAC is only meaningful if another unprivileged account cannot read
  // its key. APPDATA is already user-scoped on Windows; this also constrains
  // the file itself on platforms whose chmod bits carry the access decision.
  chmodSync(filePath, 0o600);
}

function installSecret() {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (!existsSync(TOKEN_FILE)) {
    try {
      writeFileSync(TOKEN_FILE, randomBytes(32).toString('base64url'), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  protectPrivateFile(TOKEN_FILE);
  const secret = readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!TOKEN_PATTERN.test(secret)) {
    throw new Error(`Memoria's launcher token is missing or invalid: ${TOKEN_FILE}`);
  }
  return secret;
}

function secretEquals(actual, expected) {
  if (typeof actual !== 'string') return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function hmacProof(secret, purpose, port, nonce) {
  return createHmac('sha256', secret).update(`void-launcher-v1:${purpose}:${port}:${nonce}`).digest('base64url');
}

function serveFile(res, filePath, extraHeaders = {}) {
  try {
    const body = readFileSync(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      [MARKER]: '1',
      ...extraHeaders,
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

/** Prove the listener knows our profile secret without disclosing that secret. */
async function probeVoid(port, secret) {
  const nonce = randomBytes(32).toString('base64url');
  try {
    const res = await fetch(`http://127.0.0.1:${port}/.void/hello?nonce=${nonce}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    const claimsVoid = res.headers.get(MARKER) === '1';
    if (!res.ok) return { authenticated: false, claimsVoid };
    let payload;
    try {
      payload = await res.json();
    } catch {
      return { authenticated: false, claimsVoid };
    }
    return {
      authenticated: secretEquals(payload?.proof, hmacProof(secret, 'hello', port, nonce)),
      claimsVoid,
    };
  } catch {
    return { authenticated: false, claimsVoid: false };
  }
}

async function isVoid(port, secret) {
  return (await probeVoid(port, secret)).authenticated;
}

// The browser cannot execute the shared package's TypeScript entry directly.
// Bundle this desktop shim from the public package boundary so both merging and
// validation remain the exact code the app runs.
let sharedCore = null;
function newestMtimeUnder(directory) {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtimeUnder(path) : statSync(path).mtimeMs);
  }
  return newest;
}

async function loadSharedCore() {
  if (sharedCore) return sharedCore;
  const entry = join(here, 'shared-core.mjs');
  const file = join(here, 'dist', 'shared-core.mjs');
  if (packaged) {
    // The bundle was built by the release pipeline against the exact sources
    // this build shipped. There is no shared/src here to compare it against,
    // and stat'ing the missing directory is what would throw.
    if (!existsSync(file)) throw new Error('this install is missing desktop/dist/shared-core.mjs.');
    sharedCore = await import(pathToFileURL(file).href);
    return sharedCore;
  }
  const newestSourceMtime = Math.max(statSync(entry).mtimeMs, newestMtimeUnder(join(repo, 'shared', 'src')));
  if (!existsSync(file) || statSync(file).mtimeMs < newestSourceMtime) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    mkdirSync(dirname(file), { recursive: true });
    const built = spawnSync(
      npm,
      ['exec', '--no', '--', 'esbuild', entry, '--bundle', '--platform=node', '--format=esm', `--outfile=${file}`],
      { cwd: repo, encoding: 'utf8' },
    );
    if (built.status !== 0 || !existsSync(file)) {
      throw new Error(
        `Memoria could not build its shared desktop core: ${built.error?.message || built.stderr?.trim() || 'unknown error'}`,
      );
    }
  }
  sharedCore = await import(pathToFileURL(file).href);
  return sharedCore;
}

function readStateRaw() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** Atomic write (temp + rename). */
function writeState(state) {
  mkdirSync(DATA_DIR, { recursive: true });
  const json = JSON.stringify(state);
  writeFileSync(`${STATE_FILE}.tmp`, json);
  // Windows: rename-over transiently EPERMs while AV/indexer holds the target.
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
      return;
    } catch {
      if (attempt >= 4) {
        writeFileSync(STATE_FILE, json);
        return;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

function respondJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    [MARKER]: '1',
  });
  res.end(JSON.stringify(payload));
}

async function handleGetState(res) {
  try {
    const { normalizeState } = await loadSharedCore();
    respondJson(res, 200, { state: normalizeState(readStateRaw()) });
  } catch (e) {
    respondJson(res, 500, { error: String(e?.message ?? e) });
  }
}

/** POST /api/sync — last-write-wins merge into the shared state file. */
function handleSync(req, res) {
  const contentTypeHeader = requestHeader(req, 'content-type');
  const contentType = contentTypeHeader?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    respondJson(res, 415, { error: 'Content-Type must be application/json.' });
    return;
  }

  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SYNC_BYTES) {
    // Closing after the response keeps a sender from making us drain a body we
    // have already decided can never become a valid state document.
    req.pause();
    res.writeHead(413, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'close',
      [MARKER]: '1',
    });
    res.end(JSON.stringify({ error: `Request body exceeds ${MAX_SYNC_BYTES} bytes.` }), () => req.destroy());
    return;
  }

  const chunks = [];
  let received = 0;
  let settled = false;
  req.on('data', (chunk) => {
    if (settled) return;
    received += chunk.length;
    if (received <= MAX_SYNC_BYTES) {
      chunks.push(chunk);
      return;
    }
    settled = true;
    chunks.length = 0;
    req.pause();
    res.writeHead(413, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'close',
      [MARKER]: '1',
    });
    res.end(JSON.stringify({ error: `Request body exceeds ${MAX_SYNC_BYTES} bytes.` }), () => req.destroy());
  });
  req.on('end', async () => {
    if (settled) return;
    settled = true;
    try {
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks, received).toString('utf8'));
      } catch {
        respondJson(res, 400, { error: 'Request body is not valid JSON.' });
        return;
      }

      const { mergeState, normalizeState, safeParseAppState } = await loadSharedCore();
      const parsedClient = safeParseAppState(payload?.state);
      if (!parsedClient.success) {
        respondJson(res, 400, { error: `Invalid app state: ${parsedClient.error}` });
        return;
      }

      const current = normalizeState(readStateRaw());
      const merged = mergeState(current, parsedClient.data);
      const parsedMerged = safeParseAppState(merged);
      if (!parsedMerged.success) {
        respondJson(res, 500, { error: 'The merged state failed validation; state.json was not changed.' });
        return;
      }
      // Only write when the merge changed something — otherwise every synced
      // client's pull would bump the file's mtime and re-ping every client
      // through /api/events, ad infinitum.
      if (JSON.stringify(parsedMerged.data) !== JSON.stringify(current)) writeState(parsedMerged.data);
      respondJson(res, 200, { state: parsedMerged.data });
    } catch (e) {
      respondJson(res, 500, { error: String(e?.message ?? e) });
    }
  });
}

// Server-sent events: ping connected app windows when the state file changes
// on disk, so they pull immediately instead of polling.
const sseClients = new Set();
let lastActivity = Date.now();
let stateWatcherStarted = false;
let pingTimer;

function startStateWatcher() {
  if (stateWatcherStarted) return;
  stateWatcherStarted = true;
  mkdirSync(DATA_DIR, { recursive: true });
  // Event-based (no polling). Watch the directory, not the file: writeState
  // replaces state.json via rename, which unbinds a direct file watcher.
  watch(DATA_DIR, (_event, filename) => {
    if (filename !== 'state.json') return;
    clearTimeout(pingTimer);
    pingTimer = setTimeout(() => {
      for (const client of sseClients) client.write('data: changed\n\n');
    }, 100);
  });
}

function handleEvents(req, res) {
  startStateWatcher();
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    [MARKER]: '1',
  });
  res.write('retry: 2000\n\n');
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
    lastActivity = Date.now(); // idle countdown starts when the last window closes
  });
}

const launchTickets = new Map();
const usedTicketNonces = new Map();

function pruneLaunchCredentials() {
  const now = Date.now();
  for (const [ticket, expiresAt] of launchTickets) {
    if (expiresAt <= now) launchTickets.delete(ticket);
  }
  for (const [nonce, expiresAt] of usedTicketNonces) {
    if (expiresAt <= now) usedTicketNonces.delete(nonce);
  }
}

function issueLaunchTicket() {
  pruneLaunchCredentials();
  const ticket = randomBytes(32).toString('base64url');
  launchTickets.set(ticket, Date.now() + LAUNCH_TICKET_TTL_MS);
  return ticket;
}

function consumeLaunchTicket(ticket) {
  pruneLaunchCredentials();
  const expiresAt = launchTickets.get(ticket);
  launchTickets.delete(ticket);
  return typeof expiresAt === 'number' && expiresAt > Date.now();
}

function requestHeader(req, name) {
  const value = req.headers[name];
  return typeof value === 'string' ? value : null;
}

function validHost(req, port) {
  const host = requestHeader(req, 'host');
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function cookieToken(req) {
  const cookie = requestHeader(req, 'cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === 'void_token') return value.join('=');
  }
  return null;
}

function bearerToken(req) {
  const authorization = requestHeader(req, 'authorization');
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? cookieToken(req);
}

function unsafeRequestIsSameOrigin(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '')) return true;
  const host = requestHeader(req, 'host');
  return requestHeader(req, 'origin') === `http://${host}` && requestHeader(req, 'sec-fetch-site') === 'same-origin';
}

function authorizeApi(req, res, secret) {
  if (!secretEquals(bearerToken(req), secret)) {
    res.setHeader('www-authenticate', 'Bearer realm="Memoria desktop"');
    respondJson(res, 401, { error: 'A valid Memoria desktop bearer token is required.' });
    return false;
  }
  if (!unsafeRequestIsSameOrigin(req)) {
    respondJson(res, 403, { error: 'Unsafe API requests must come from this exact loopback origin.' });
    return false;
  }
  return true;
}

function serveLaunchHtml(res, secret) {
  try {
    const tokenLiteral = JSON.stringify(secret).replaceAll('<', '\\u003c');
    const bootstrap = `<script>
      (() => {
        const token = ${tokenLiteral};
        try {
          localStorage.setItem('void-sync-config', JSON.stringify({ url: location.origin, token }));
        } catch {
          // The API will remain closed if the browser refuses token storage.
        }
        history.replaceState(history.state, '', '/');
      })();
    </script>`;
    const source = readFileSync(join(dist, 'index.html'), 'utf8');
    if (!source.includes('<head>')) throw new Error("Memoria's built index.html has no token injection point.");
    const body = source.replace('<head>', `<head>${bootstrap}`);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': `void_token=${secret}; HttpOnly; SameSite=Strict; Path=/`,
      [MARKER]: '1',
    });
    res.end(body);
  } catch (error) {
    respondJson(res, 500, { error: String(error?.message ?? error) });
  }
}

function handleIdentityChallenge(req, res, url, port, secret) {
  if (req.method !== 'GET') {
    respondJson(res, 405, { error: 'Method not allowed.' });
    return;
  }
  const nonce = url.searchParams.get('nonce');
  if (!nonce || !TOKEN_PATTERN.test(nonce)) {
    respondJson(res, 400, { error: 'A high-entropy challenge nonce is required.' });
    return;
  }
  respondJson(res, 200, { proof: hmacProof(secret, 'hello', port, nonce) });
}

function handleTicketRequest(req, res, port, secret) {
  if (req.method !== 'POST') {
    respondJson(res, 405, { error: 'Method not allowed.' });
    return;
  }
  pruneLaunchCredentials();
  const nonce = requestHeader(req, 'x-void-nonce');
  const proof = requestHeader(req, 'x-void-proof');
  const expected = nonce && TOKEN_PATTERN.test(nonce) ? hmacProof(secret, 'ticket', port, nonce) : null;
  if (!expected || !secretEquals(proof, expected) || usedTicketNonces.has(nonce)) {
    respondJson(res, 401, { error: 'The launch-ticket proof was rejected.' });
    return;
  }
  usedTicketNonces.set(nonce, Date.now() + LAUNCH_TICKET_TTL_MS);
  respondJson(res, 200, { ticket: issueLaunchTicket() });
}

function tryListen(port, secret) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      lastActivity = Date.now();
      if (!validHost(req, port)) {
        respondJson(res, 421, { error: `Host must be 127.0.0.1:${port} or localhost:${port}.` });
        return;
      }

      let url;
      let urlPath;
      try {
        url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        urlPath = decodeURIComponent(url.pathname);
      } catch {
        respondJson(res, 400, { error: 'Malformed request URL.' });
        return;
      }

      if (urlPath === '/.void/hello') return handleIdentityChallenge(req, res, url, port, secret);
      if (urlPath === '/.void/ticket') return handleTicketRequest(req, res, port, secret);

      const launchMatch = urlPath.match(/^\/api\/launch\/([A-Za-z0-9_-]{43})\/?$/);
      if (req.method === 'GET' && launchMatch) {
        if (!consumeLaunchTicket(launchMatch[1])) {
          respondJson(res, 401, { error: 'This launch ticket is invalid or has expired.' });
          return;
        }
        return serveLaunchHtml(res, secret);
      }

      if (urlPath === '/api' || urlPath.startsWith('/api/')) {
        if (!authorizeApi(req, res, secret)) return;
      }
      if (req.method === 'GET' && urlPath === '/api/events') return handleEvents(req, res);
      if (req.method === 'GET' && urlPath === '/api/state') return void handleGetState(res);
      if (req.method === 'POST' && urlPath === '/api/sync') return handleSync(req, res);
      // Lets an app window tell the user a newer build is already downloaded and
      // will be in place the next time they open Memoria.
      if (req.method === 'GET' && urlPath === '/api/update') return respondJson(res, 200, updateStatus(repo));
      if (urlPath === '/api' || urlPath.startsWith('/api/')) {
        respondJson(res, 404, { error: 'API route not found.' });
        return;
      }
      // Resolve within dist and block path traversal.
      let filePath = normalize(join(dist, urlPath));
      if (!filePath.startsWith(dist)) filePath = dist;
      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = join(filePath, 'index.html');
      }
      if (existsSync(filePath) && serveFile(res, filePath)) return;
      // SPA fallback.
      serveFile(res, join(dist, 'index.html'));
    });
    server.once('error', (error) => resolve({ server: null, error }));
    server.listen(port, '127.0.0.1', () => resolve({ server, error: null }));
  });
}

let ownedLockId = null;

function releaseOwnedLock() {
  if (!ownedLockId) return;
  try {
    const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
    if (lock?.instanceId === ownedLockId) unlinkSync(LOCK_FILE);
  } catch {
    // A missing or replaced lock is no longer ours to remove.
  }
  ownedLockId = null;
}

process.on('exit', releaseOwnedLock);

function createInstanceLock() {
  const instanceId = randomBytes(32).toString('base64url');
  const body = JSON.stringify({ version: 1, pid: process.pid, instanceId, createdAt: Date.now() });
  try {
    writeFileSync(LOCK_FILE, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    protectPrivateFile(LOCK_FILE);
    ownedLockId = instanceId;
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

function readInstanceLock() {
  const raw = readFileSync(LOCK_FILE, 'utf8');
  let lock;
  try {
    lock = JSON.parse(raw);
  } catch {
    throw new Error(`Memoria's single-instance lock is unreadable: ${LOCK_FILE}`);
  }
  if (
    lock?.version !== 1 ||
    !Number.isInteger(lock.pid) ||
    lock.pid <= 0 ||
    typeof lock.instanceId !== 'string' ||
    !TOKEN_PATTERN.test(lock.instanceId)
  ) {
    throw new Error(`Memoria's single-instance lock is invalid: ${LOCK_FILE}`);
  }
  return { raw, lock };
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findAuthenticatedInstance(secret, attempts = 1) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    for (const port of PORTS) {
      if (await isVoid(port, secret)) return port;
    }
    if (attempt + 1 < attempts) await delay(100);
  }
  return null;
}

async function claimInstance(secret) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (createInstanceLock()) return { owned: true, port: null };

    const { raw, lock } = readInstanceLock();
    // processIsAlive treats EPERM as "alive", which is right for a live process
    // owned by another account and WRONG on Windows when the pid has been
    // recycled by a system process — kill(pid, 0) then reports EPERM for a pid
    // this launcher has nothing to do with, and startup blocks for ever. A lock
    // exists to point at a running server, so once no server answers the
    // identity challenge and the lock is older than the grace period, the lock
    // is dead no matter what the pid claims.
    const lockAgeMs = Date.now() - (Number(lock.createdAt) || 0);
    const createdAt = Number(lock.createdAt);
    const withinStartupGrace =
      !Number.isFinite(createdAt) || createdAt <= 0 || (lockAgeMs >= 0 && lockAgeMs < STALE_LOCK_GRACE_MS);
    if (processIsAlive(lock.pid) && withinStartupGrace) {
      // The lock is primary, but startup has a small interval before listen().
      // Confirmation prevents both a PID reuse and a forged lock from sending
      // the browser to a process that does not know the profile secret.
      const port = await findAuthenticatedInstance(secret, 20);
      if (port) return { owned: false, port };
      throw new Error(
        `Memoria process ${lock.pid} holds ${LOCK_FILE}, but no server on ports ${PORTS.join(', ')} passed its identity challenge.`,
      );
    }

    // Delete only the bytes we inspected; another launcher may have replaced a
    // stale lock between the liveness check and this cleanup.
    if (readFileSync(LOCK_FILE, 'utf8') === raw) {
      unlinkSync(LOCK_FILE);
    }
  }
  throw new Error(`Memoria could not acquire its single-instance lock: ${LOCK_FILE}`);
}

/**
 * Bind the first free port from PORTS, or detect a Void instance already
 * running on one (second launch) and reuse its URL instead of starting anew.
 */
async function startOrReuse(secret) {
  const claim = await claimInstance(secret);
  if (!claim.owned) return { server: null, port: claim.port };

  const conflicts = [];
  for (const port of PORTS) {
    const { server, error } = await tryListen(port, secret);
    if (server) return { server, port };
    const identity = await probeVoid(port, secret);
    if (identity.authenticated) {
      releaseOwnedLock();
      return { server: null, port };
    }
    if (identity.claimsVoid) {
      releaseOwnedLock();
      throw new Error(
        `port ${port} is occupied by a listener claiming to be Void, but it failed the authenticated identity challenge; refusing to open a browser.`,
      );
    }
    conflicts.push(`${port}${error?.code ? ` (${error.code})` : ''}`);
    // Never navigate to an unconfirmed listener. Retaining the historical
    // fallback still gives users a deterministic origin when another local
    // program owns an earlier candidate.
    console.error(`Memoria: port ${port} is occupied and failed Memoria's authenticated identity challenge.`);
  }
  releaseOwnedLock();
  throw new Error(`ports ${conflicts.join(', ')} are all in use by other programs.`);
}

async function requestLaunchTicket(port, secret) {
  const nonce = randomBytes(32).toString('base64url');
  const response = await fetch(`http://127.0.0.1:${port}/.void/ticket`, {
    method: 'POST',
    headers: {
      'x-void-nonce': nonce,
      'x-void-proof': hmacProof(secret, 'ticket', port, nonce),
    },
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error(`the running Void instance refused a launch ticket (HTTP ${response.status}).`);
  const payload = await response.json();
  if (!TOKEN_PATTERN.test(payload?.ticket)) throw new Error('the running Void instance returned an invalid ticket.');
  return payload.ticket;
}

/** Chromium-family programs — safe to hand a `--app=` flag. Helium ships as chrome.exe. */
const CHROMIUM_APPS = new Set(['chrome', 'chromium', 'msedge', 'brave', 'vivaldi', 'helium', 'opera', 'thorium']);
/** Gecko-family programs — no app mode, but they do take `-new-window`. */
const FIREFOX_APPS = new Set(['firefox', 'librewolf', 'waterfox', 'zen']);

/** `C:\...\Application\chrome.exe` → `chrome`. */
function appName(exe) {
  return (exe.split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '').toLowerCase();
}

/**
 * Browsers Void knows how to find by name. `void.mjs --browser <key>`, the
 * VOID_BROWSER environment variable, or `"browser": "<key>"` in config.json all
 * accept these keys — as well as `system` (hand the URL to whatever the OS has
 * registered) or a full path to any executable you like.
 */
const KNOWN_BROWSERS = [
  {
    key: 'helium',
    label: 'Helium',
    win: [['LOCALAPPDATA', 'imput\\Helium\\Application\\chrome.exe']],
    unix: ['helium'],
  },
  {
    key: 'chrome',
    label: 'Google Chrome',
    win: [
      ['ProgramFiles', 'Google\\Chrome\\Application\\chrome.exe'],
      ['ProgramFiles(x86)', 'Google\\Chrome\\Application\\chrome.exe'],
      ['LOCALAPPDATA', 'Google\\Chrome\\Application\\chrome.exe'],
    ],
    unix: ['google-chrome', 'chromium'],
  },
  {
    key: 'edge',
    label: 'Microsoft Edge',
    win: [
      ['ProgramFiles', 'Microsoft\\Edge\\Application\\msedge.exe'],
      ['ProgramFiles(x86)', 'Microsoft\\Edge\\Application\\msedge.exe'],
    ],
    unix: ['microsoft-edge'],
  },
  {
    key: 'brave',
    label: 'Brave',
    win: [
      ['ProgramFiles', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
      ['ProgramFiles(x86)', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
      ['LOCALAPPDATA', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    ],
    unix: ['brave-browser', 'brave'],
  },
  {
    key: 'vivaldi',
    label: 'Vivaldi',
    win: [
      ['ProgramFiles', 'Vivaldi\\Application\\vivaldi.exe'],
      ['LOCALAPPDATA', 'Vivaldi\\Application\\vivaldi.exe'],
    ],
    unix: ['vivaldi'],
  },
  {
    key: 'opera',
    label: 'Opera',
    win: [
      ['ProgramFiles', 'Opera\\opera.exe'],
      ['LOCALAPPDATA', 'Programs\\Opera\\opera.exe'],
    ],
    unix: ['opera'],
  },
  {
    key: 'firefox',
    label: 'Firefox',
    win: [
      ['ProgramFiles', 'Mozilla Firefox\\firefox.exe'],
      ['ProgramFiles(x86)', 'Mozilla Firefox\\firefox.exe'],
    ],
    unix: ['firefox'],
  },
  {
    key: 'zen',
    label: 'Zen Browser',
    win: [
      ['ProgramFiles', 'Zen Browser\\zen.exe'],
      ['LOCALAPPDATA', 'Programs\\zen-browser\\zen.exe'],
    ],
    unix: ['zen-browser', 'zen'],
  },
  {
    key: 'librewolf',
    label: 'LibreWolf',
    win: [
      ['ProgramFiles', 'LibreWolf\\librewolf.exe'],
      ['LOCALAPPDATA', 'LibreWolf\\librewolf.exe'],
    ],
    unix: ['librewolf'],
  },
];

/** First existing install of a known browser, or null. */
function findKnownBrowser(key) {
  const entry = KNOWN_BROWSERS.find((b) => b.key === key);
  if (!entry) return null;
  if (process.platform === 'win32') {
    for (const [envVar, tail] of entry.win) {
      const base = process.env[envVar];
      if (!base) continue;
      const full = join(base, tail);
      if (existsSync(full)) return full;
    }
    return null;
  }
  for (const command of entry.unix) {
    const found = spawnSync('which', [command], { encoding: 'utf8' }).stdout?.trim();
    if (found) return found;
  }
  return null;
}

/** The user's default browser exe (Windows registry), if it's Chromium-based. */
function defaultChromiumBrowser() {
  if (process.platform !== 'win32') return null;
  try {
    const progId = spawnSync(
      'reg',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
        '/v',
        'ProgId',
      ],
      { encoding: 'utf8' },
    ).stdout?.match(/ProgId\s+REG_SZ\s+(\S+)/)?.[1];
    if (!progId) return null;
    const command = spawnSync('reg', ['query', `HKCR\\${progId}\\shell\\open\\command`, '/ve'], {
      encoding: 'utf8',
    }).stdout;
    const exe = command?.match(/"([^"]+\.exe)"/)?.[1];
    if (!exe || !existsSync(exe)) return null;
    return CHROMIUM_APPS.has(appName(exe)) ? exe : null;
  } catch {
    return null;
  }
}

/** No preference set: the default browser if it can do app windows, else the first one installed. */
function findBrowser() {
  return defaultChromiumBrowser() ?? KNOWN_BROWSERS.map((b) => findKnownBrowser(b.key)).find(Boolean) ?? null;
}

/**
 * Which browser to open, most specific source first:
 *   --browser <name|path>  →  VOID_BROWSER  →  config.json "browser"  →  auto
 * `system` (or `default`) hands the URL to whatever the OS has registered, which
 * is the escape hatch for anything not in KNOWN_BROWSERS.
 */
function browserPreference() {
  const args = process.argv.slice(2);
  const flag = args.find((arg) => arg.startsWith('--browser='));
  if (flag) return { value: flag.slice('--browser='.length).trim(), source: '--browser' };
  const bare = args.indexOf('--browser');
  if (bare >= 0 && args[bare + 1]) return { value: args[bare + 1].trim(), source: '--browser' };
  const fromEnv = process.env['VOID_BROWSER']?.trim();
  if (fromEnv) return { value: fromEnv, source: 'VOID_BROWSER' };
  const fromConfig = readConfig().browser;
  if (typeof fromConfig === 'string' && fromConfig.trim()) {
    return { value: fromConfig.trim(), source: 'desktop/config.json' };
  }
  return null;
}

function resolveBrowser() {
  const preference = browserPreference();
  if (!preference) return { kind: 'auto', exe: findBrowser() };

  const value = preference.value;
  const lower = value.toLowerCase();
  if (lower === 'system' || lower === 'default') return { kind: 'system' };
  if (lower === 'auto') return { kind: 'auto', exe: findBrowser() };

  const known = findKnownBrowser(lower);
  if (known) return { kind: 'exe', exe: known };
  // Anything else is taken as a path (or, off Windows, a command on PATH).
  if (existsSync(value)) return { kind: 'exe', exe: value };
  if (process.platform !== 'win32') {
    const onPath = spawnSync('which', [value], { encoding: 'utf8' }).stdout?.trim();
    if (onPath) return { kind: 'exe', exe: onPath };
  }
  // Silently opening a different browser than the one that was asked for is
  // worse than saying so — but not opening the app at all is worse still.
  console.error(`Void: browser "${value}" (from ${preference.source}) was not found; using the system default.`);
  return { kind: 'system' };
}

/** Hand the URL to the OS and let it pick — works with any browser, as a plain tab. */
function openWithSystem(url) {
  if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'start', '', url], { shell: false });
    return;
  }
  spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
}

/** Chromium gets a chromeless app window; Firefox at least gets its own window. */
function browserArgs(exe, url) {
  const name = appName(exe);
  if (CHROMIUM_APPS.has(name)) return [`--app=${url}`, '--window-size=1200,860'];
  if (FIREFOX_APPS.has(name)) return ['-new-window', url];
  return [url];
}

/**
 * Open the app INSIDE the chosen browser, in its default profile (no
 * --user-data-dir). Costs roughly one tab; a dedicated profile would boot an
 * entire second browser instance (~300-600 MB). The spawn delegates to the
 * existing browser process and exits immediately, so window lifetime is
 * untrackable — the server shuts itself down when idle instead.
 */
function openAppWindow(url) {
  const choice = resolveBrowser();
  if (choice.kind === 'system' || !choice.exe) {
    openWithSystem(url);
    return;
  }
  const child = spawn(choice.exe, browserArgs(choice.exe, url), { detached: true, stdio: 'ignore' });
  child.on('error', () => openWithSystem(url));
  child.unref();
}

/** `node desktop/void.mjs --list-browsers` — what is installed, and what would open. */
function listBrowsers() {
  const choice = resolveBrowser();
  const preference = browserPreference();
  for (const entry of KNOWN_BROWSERS) {
    const path = findKnownBrowser(entry.key);
    console.log(`${path ? '•' : ' '} ${entry.key.padEnd(10)} ${path ?? '(not installed)'}`);
  }
  console.log(`\n  ${'system'.padEnd(10)} (whatever this machine has registered for https)`);
  console.log(
    `\nVoid will open: ${choice.kind === 'system' ? 'the system default browser' : choice.exe}` +
      (preference ? ` — from ${preference.source}` : ' — no preference set'),
  );
  console.log('Set one with --browser <name|path>, VOID_BROWSER, or "browser" in desktop/config.json.');
}

async function main() {
  if (process.argv.includes('--list-browsers')) {
    listBrowsers();
    return;
  }

  // `--check-update` is the manual path: check, download and stage right now,
  // then report. Useful for support ("run this and tell me what it says") and
  // for anyone who does not want to wait out the six-hour interval.
  if (process.argv.includes('--check-update')) {
    const before = updateStatus(repo);
    if (!before.packaged) {
      console.log('This is a source checkout, not a packaged install — nothing to update.');
      return;
    }
    console.log(`Installed: ${before.version}`);
    const result = await checkForUpdate(repo, { force: true });
    if (result.status === 'staged')
      console.log(`Downloaded ${result.version}. It applies the next time Memoria starts.`);
    else if (result.status === 'current') console.log('Already up to date.');
    else console.log(`No update applied (${result.reason ?? result.status}).`);
    return;
  }

  // Before anything opens a handle on the install directory: swap in whatever a
  // previous run downloaded. This is the moment the update actually lands.
  const update = applyPendingUpdate(repo);
  if (update.applied) console.log(`Memoria updated to ${update.version}.`);

  ensureBuilt();
  const secret = installSecret();
  const got = await startOrReuse(secret);
  const { server, port } = got;
  const baseUrl = `http://127.0.0.1:${port}`;
  const ticket = server ? issueLaunchTicket() : await requestLaunchTicket(port, secret);
  const url = `${baseUrl}/api/launch/${ticket}`;
  const shutdown = () => {
    server?.close();
    process.exit(0);
  };

  // Headless mode for testing: serve (or point at the running instance),
  // print the URL, don't open a window.
  if (process.env['MEMORIA_NO_BROWSER']) {
    console.log(url);
    if (!server) return; // reusing another instance — nothing to keep alive
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  // Reuse case: another Void instance owns the server; just open a window on it.
  // Our process can exit immediately — the other instance manages lifetime.
  if (!server) {
    openAppWindow(url);
    return;
  }

  openAppWindow(url);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Only the instance that owns the server checks, so opening a second window
  // cannot start a second download. Deliberately not awaited: the window is
  // already up, and a slow or dead network must not hold the process open.
  void checkForUpdate(repo).then((result) => {
    if (result.status === 'staged') console.log(`Memoria ${result.version} downloaded; it applies on the next launch.`);
  });

  // The app window lives inside the user's own browser, so there is no child
  // process to watch. Open windows hold an SSE connection (/api/events);
  // once none are connected and nothing has talked to us for a while, exit.
  const IDLE_MS = 5 * 60_000;
  setInterval(() => {
    if (sseClients.size === 0 && Date.now() - lastActivity > IDLE_MS) shutdown();
  }, 60_000);
}

main().catch((error) => {
  console.error(`Void: ${String(error?.message ?? error)}`);
  process.exitCode = 1;
});
