// Void desktop launcher.
// Serves the built PWA (app/dist) on a FIXED local port and opens it as a
// chromeless "app" window inside the user's default Chromium browser (shared
// profile — costs about one tab). The server exits on its own once no app
// window has been connected for a few minutes.
// Zero dependencies — plain Node. Invoked hidden by Void.vbs.
//
// The port must stay identical between launches: IndexedDB (all app data) is
// scoped to the origin `http://127.0.0.1:<port>`, so a changing port silently
// wipes the app's state on every launch. PORTS is an ordered list tried in the
// same order every time; the first entry is used unless a foreign app squats it.
//
// Optional: create desktop/config.json with {"url": "https://void.<you>.workers.dev"}
// after deploying to Cloudflare — the launcher then skips the local server and
// opens the hosted (always-synced) app in the same kind of window.
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, watch, writeFileSync } from 'node:fs';
import { dirname, join, normalize, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const dist = join(repo, 'app', 'dist');

// The one local state document — served over /api/sync to app windows.
const APP_DATA_ROOT = process.env['APPDATA'] ?? join(os.homedir(), '.config');
const LEGACY_DATA_DIR = join(APP_DATA_ROOT, 'technogg');
const DATA_DIR = join(APP_DATA_ROOT, 'void');

function migrateLegacyDataDirectory() {
  if (!existsSync(LEGACY_DATA_DIR)) return;
  if (!existsSync(DATA_DIR)) {
    renameSync(LEGACY_DATA_DIR, DATA_DIR);
    return;
  }

  const legacyStateFile = join(LEGACY_DATA_DIR, 'state.json');
  const stateFile = join(DATA_DIR, 'state.json');
  if (!existsSync(legacyStateFile) || existsSync(stateFile)) return;
  mkdirSync(DATA_DIR, { recursive: true });
  const legacyState = readFileSync(legacyStateFile);
  writeFileSync(stateFile, legacyState);
  if (!readFileSync(stateFile).equals(legacyState)) {
    throw new Error('Void could not verify the migrated desktop state file.');
  }
}

migrateLegacyDataDirectory();
const STATE_FILE = join(DATA_DIR, 'state.json');

const PORTS = [17817, 17818, 17819];
const MARKER = 'x-void';

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

function hostedUrl() {
  try {
    const cfg = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'));
    const url = typeof cfg.url === 'string' ? cfg.url.trim().replace(/\/+$/, '') : '';
    return /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

function ensureBuilt() {
  if (existsSync(join(dist, 'index.html'))) return;
  // First run (or after cleaning): build the app. npm.cmd on Windows.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  spawnSync(npm, ['run', 'build'], { cwd: repo, stdio: 'ignore' });
}

function serveFile(res, filePath) {
  try {
    const body = readFileSync(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      [MARKER]: '1',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

/** Is a Void instance already serving on this port? */
async function isVoid(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return res.headers.get(MARKER) === '1';
  } catch {
    return false;
  }
}

// Merge logic bundled from shared/src/merge.ts by `npm run build:desktop` —
// the launcher stays zero-dependency, but merging must be the exact same code
// the app and worker use.
let mergeCore = null;
async function loadMergeCore() {
  if (mergeCore) return mergeCore;
  const file = join(here, 'dist', 'merge.mjs');
  if (!existsSync(file)) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    spawnSync(npm, ['run', 'build:desktop'], { cwd: repo, stdio: 'ignore' });
  }
  mergeCore = await import(pathToFileURL(file).href);
  return mergeCore;
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
  res.writeHead(status, { 'content-type': 'application/json', [MARKER]: '1' });
  res.end(JSON.stringify(payload));
}

async function handleGetState(res) {
  try {
    const { normalizeState } = await loadMergeCore();
    respondJson(res, 200, { state: normalizeState(readStateRaw()) });
  } catch (e) {
    respondJson(res, 500, { error: String(e?.message ?? e) });
  }
}

/** Same contract as the worker's POST /api/sync, backed by the shared state file. */
function handleSync(req, res) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    try {
      const { mergeState, normalizeState } = await loadMergeCore();
      const client = normalizeState(JSON.parse(body || '{}').state);
      const current = normalizeState(readStateRaw());
      const merged = mergeState(current, client);
      // Only write when the merge changed something — otherwise every synced
      // client's pull would bump the file's mtime and re-ping every client
      // through /api/events, ad infinitum.
      if (JSON.stringify(merged) !== JSON.stringify(current)) writeState(merged);
      respondJson(res, 200, { state: merged });
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

function tryListen(port) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      lastActivity = Date.now();
      const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
      if (req.method === 'GET' && urlPath === '/api/events') return handleEvents(req, res);
      if (req.method === 'GET' && urlPath === '/api/state') return void handleGetState(res);
      if (req.method === 'POST' && urlPath === '/api/sync') return handleSync(req, res);
      if (req.method === 'POST' && urlPath === '/api/test-alert') {
        return respondJson(res, 400, {
          error: 'Alerts while closed need the deployed Cloudflare worker (see README).',
        });
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
    server.once('error', () => resolve(null));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/**
 * Bind the first free port from PORTS, or detect a Void instance already
 * running on one (second launch) and reuse its URL instead of starting anew.
 */
async function startOrReuse() {
  for (const port of PORTS) {
    const server = await tryListen(port);
    if (server) return { server, port };
    if (await isVoid(port)) return { server: null, port };
  }
  return null;
}

/** Chromium-family exe names — safe to hand a `--app=` flag. Helium ships as chrome.exe. */
const CHROMIUM_EXES = new Set(['chrome.exe', 'msedge.exe', 'brave.exe', 'vivaldi.exe', 'helium.exe', 'opera.exe']);

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
    return CHROMIUM_EXES.has(exe.split('\\').pop().toLowerCase()) ? exe : null;
  } catch {
    return null;
  }
}

function findBrowser() {
  const fromRegistry = defaultChromiumBrowser();
  if (fromRegistry) return fromRegistry;
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] ?? '';
  const candidates = [
    local && join(local, 'imput', 'Helium', 'Application', 'chrome.exe'),
    join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local && join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

/**
 * Open a chromeless app window INSIDE the user's running browser (default
 * profile — no --user-data-dir). Costs roughly one tab; the old dedicated
 * profile booted an entire second browser instance (~300-600 MB). The spawn
 * delegates to the existing browser process and exits immediately, so window
 * lifetime is untrackable — the server shuts itself down when idle instead.
 */
function openAppWindow(url) {
  const browser = findBrowser();
  if (!browser) {
    // No Chromium browser found: open the default browser as a plain tab.
    spawnSync('cmd', ['/c', 'start', '', url], { shell: false });
    return;
  }
  const child = spawn(browser, [`--app=${url}`, '--window-size=1200,860'], { detached: true, stdio: 'ignore' });
  child.on('error', () => {
    spawnSync('cmd', ['/c', 'start', '', url], { shell: false });
  });
  child.unref();
}

async function main() {
  // Hosted mode: the app lives on Cloudflare, no local server needed.
  const hosted = hostedUrl();
  if (hosted) {
    if (process.env['VOID_NO_BROWSER']) {
      console.log(hosted);
      return;
    }
    openAppWindow(hosted);
    return;
  }

  ensureBuilt();
  const got = await startOrReuse();
  if (!got) {
    // All candidate ports are squatted by foreign apps — bail loudly rather
    // than fall back to a random port (that would strand the user's data).
    console.error(`Void: ports ${PORTS.join(', ')} are all in use by other programs.`);
    process.exit(1);
  }
  const { server, port } = got;
  const url = `http://127.0.0.1:${port}/`;
  const shutdown = () => {
    server?.close();
    process.exit(0);
  };

  // Headless mode for testing: serve (or point at the running instance),
  // print the URL, don't open a window.
  if (process.env['VOID_NO_BROWSER']) {
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

  // The app window lives inside the user's own browser, so there is no child
  // process to watch. Open windows hold an SSE connection (/api/events);
  // once none are connected and nothing has talked to us for a while, exit.
  const IDLE_MS = 5 * 60_000;
  setInterval(() => {
    if (sseClients.size === 0 && Date.now() - lastActivity > IDLE_MS) shutdown();
  }, 60_000);
}

main();
