// TechnoGG desktop launcher.
// Serves the built PWA (app/dist) on a FIXED local port, opens it in its own
// Edge/Chrome "app" window, and shuts the server down when that window closes.
// Zero dependencies — plain Node. Invoked hidden by TechnoGG.vbs.
//
// The port must stay identical between launches: IndexedDB (all app data) is
// scoped to the origin `http://127.0.0.1:<port>`, so a changing port silently
// wipes the app's state on every launch. PORTS is an ordered list tried in the
// same order every time; the first entry is used unless a foreign app squats it.
//
// Optional: create desktop/config.json with {"url": "https://technogg.<you>.workers.dev"}
// after deploying to Cloudflare — the launcher then skips the local server and
// opens the hosted (always-synced) app in the same kind of window.
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const dist = join(repo, 'app', 'dist');

const PORTS = [17817, 17818, 17819];
const MARKER = 'x-technogg';

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

/** Is a TechnoGG instance already serving on this port? */
async function isTechnoGG(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return res.headers.get(MARKER) === '1';
  } catch {
    return false;
  }
}

/** Same allowlist the worker enforces — the app relays HoYoLAB calls through us. */
function isAllowedHoyoUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ['.hoyolab.com', '.hoyoverse.com'].some((s) => u.hostname.endsWith(s));
  } catch {
    return false;
  }
}

function handleHoyoProxy(req, res) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const respond = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json', 'x-technogg': '1' });
      res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    };
    try {
      const { url, headers } = JSON.parse(body || '{}');
      if (!url || !isAllowedHoyoUrl(url)) return respond(400, { error: 'url not allowed' });
      const upstream = await fetch(url, { headers });
      respond(200, await upstream.text());
    } catch (e) {
      respond(502, { error: String(e?.message ?? e) });
    }
  });
}

function tryListen(port) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
      if (req.method === 'POST' && urlPath === '/hoyolab-proxy') return handleHoyoProxy(req, res);
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
 * Bind the first free port from PORTS, or detect a TechnoGG instance already
 * running on one (second launch) and reuse its URL instead of starting anew.
 */
async function startOrReuse() {
  for (const port of PORTS) {
    const server = await tryListen(port);
    if (server) return { server, port };
    if (await isTechnoGG(port)) return { server: null, port };
  }
  return null;
}

function findBrowser() {
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] ?? '';
  const candidates = [
    join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local && join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

function openAppWindow(url, onExit) {
  const browser = findBrowser();
  if (!browser) {
    // No Chromium browser found: open the default browser instead.
    spawnSync('cmd', ['/c', 'start', '', url], { shell: false });
    return;
  }
  const profile = join(process.env['LOCALAPPDATA'] ?? here, 'TechnoGG', 'browser');
  const child = spawn(
    browser,
    [
      `--app=${url}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1200,860',
    ],
    { detached: false },
  );
  // When the app window (its own profile → its own process) closes, quit.
  child.on('exit', onExit);
  child.on('error', () => {
    spawnSync('cmd', ['/c', 'start', '', url], { shell: false });
  });
}

async function main() {
  // Hosted mode: the app lives on Cloudflare, no local server needed.
  const hosted = hostedUrl();
  if (hosted) {
    if (process.env['TECHNOGG_NO_BROWSER']) {
      console.log(hosted);
      return;
    }
    openAppWindow(hosted, () => process.exit(0));
    return;
  }

  ensureBuilt();
  const got = await startOrReuse();
  if (!got) {
    // All candidate ports are squatted by foreign apps — bail loudly rather
    // than fall back to a random port (that would strand the user's data).
    console.error(`TechnoGG: ports ${PORTS.join(', ')} are all in use by other programs.`);
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
  if (process.env['TECHNOGG_NO_BROWSER']) {
    console.log(url);
    if (!server) return; // reusing another instance — nothing to keep alive
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  // Reuse case: another TechnoGG owns the server; just open a window on it.
  // Our process can exit immediately — the window belongs to the running
  // browser profile and the other instance manages the server lifetime.
  if (!server) {
    openAppWindow(url, () => process.exit(0));
    return;
  }

  openAppWindow(url, shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
