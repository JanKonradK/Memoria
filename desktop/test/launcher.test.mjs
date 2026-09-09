import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyState } from '@memoria/shared';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import os from 'node:os';
import { isolateLauncherPort } from '../../scripts/launcher-test-support.mjs';

const root = resolve(import.meta.dirname, '../..');
const scratch = mkdtempSync(join(os.tmpdir(), 'memoria-launcher-test-'));
const install = join(scratch, 'install');
const appdata = join(scratch, 'data');
const stateFile = join(appdata, 'memoria', 'state.json');
let child;
let origin;
let token;
let launchResponse;
let launchHtml;

const auth = () => ({ authorization: `Bearer ${token}` });
function post(state = emptyState(), extra = {}) {
  return fetch(`${origin}/api/sync`, {
    method: 'POST',
    headers: { ...auth(), origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...extra },
    body: JSON.stringify({ state }),
  });
}

beforeAll(async () => {
  mkdirSync(join(install, 'desktop', 'dist'), { recursive: true });
  mkdirSync(join(install, 'app', 'dist'), { recursive: true });
  mkdirSync(join(install, 'app', 'dist-private'), { recursive: true });
  writeFileSync(join(install, 'release.json'), JSON.stringify({ name: 'Memoria', version: '0.1.0' }));
  writeFileSync(
    join(install, 'app', 'dist', 'index.html'),
    '<!doctype html><html><head></head><body>Memoria</body></html>',
  );
  writeFileSync(join(install, 'app', 'dist-private', 'private.txt'), 'outside the public app');
  for (const file of ['memoria.mjs', 'update.mjs', 'dist/shared-core.mjs']) {
    cpSync(join(root, 'desktop', file), join(install, 'desktop', file));
  }
  // Isolate the test server from all real Memoria ports and app data. The
  // production launcher remains fixed to its existing browser storage origins.
  const launcher = join(install, 'desktop', 'memoria.mjs');
  await isolateLauncherPort(launcher);
  child = spawn(process.execPath, [launcher], {
    cwd: install,
    windowsHide: true,
    env: { ...process.env, APPDATA: appdata, MEMORIA_NO_BROWSER: '1', MEMORIA_NO_UPDATE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const launchUrl = await new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`Test launcher exited: ${errors}`)));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/api\/launch\/[A-Za-z0-9_-]{43}/);
      if (match) resolve(match[0]);
    });
  });
  origin = new URL(launchUrl).origin;
  launchResponse = await fetch(launchUrl);
  launchHtml = await launchResponse.text();
  token = JSON.parse(launchHtml.match(/const token = ("[A-Za-z0-9_-]{43}");/)[1]);
  expect((await fetch(launchUrl)).status).toBe(401);
}, 15_000);

beforeEach(() => {
  writeFileSync(stateFile, JSON.stringify(emptyState()));
});

afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  const target = resolve(scratch);
  if (!target.startsWith(`${resolve(os.tmpdir())}${sep}memoria-launcher-test-`))
    throw new Error('Unsafe test cleanup path');
  rmSync(target, { recursive: true, force: true });
});

describe('launcher security boundary', () => {
  it('accepts a fresh signed ticket request once and rejects expired proofs', async () => {
    const master = readFileSync(join(appdata, 'memoria', 'launcher-token'), 'utf8');
    const ticketRequest = async (nonce, timestamp) => {
      const port = new URL(origin).port;
      const proof = createHmac('sha256', master)
        .update(`memoria-launcher-v1:ticket:${port}:${nonce}:${timestamp}`)
        .digest('base64url');
      return fetch(`${origin}/.memoria/ticket`, {
        method: 'POST',
        headers: { 'x-memoria-nonce': nonce, 'x-memoria-time': timestamp, 'x-memoria-proof': proof },
      });
    };
    const nonce = randomBytes(32).toString('base64url');
    const timestamp = String(Date.now());
    const first = await ticketRequest(nonce, timestamp);
    expect(first.status).toBe(200);
    expect((await ticketRequest(nonce, timestamp)).status).toBe(401);
    expect((await ticketRequest(randomBytes(32).toString('base64url'), String(Date.now() - 60_000))).status).toBe(401);
    const { ticket } = await first.json();
    expect((await fetch(`${origin}/api/launch/${ticket}`)).status).toBe(200);
    expect((await fetch(`${origin}/api/launch/${ticket}`)).status).toBe(401);
  });

  it('still answers the pre-rename identity challenge, in its own HMAC domain', async () => {
    // A launcher of the older vintage probes this endpoint to decide whether the
    // port is held by Memoria. Drop it and that launcher takes a second port,
    // which moves the origin and hides every byte of IndexedDB the user has.
    const master = readFileSync(join(appdata, 'memoria', 'launcher-token'), 'utf8');
    const port = new URL(origin).port;
    const nonce = randomBytes(32).toString('base64url');
    const response = await fetch(`${origin}/.void/hello?nonce=${nonce}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-void')).toBe('1');
    expect((await response.json()).proof).toBe(
      createHmac('sha256', master).update(`void-launcher-v1:hello:${port}:${nonce}`).digest('base64url'),
    );
    // The current dialect must not answer in the legacy domain, or the two
    // protocols would be interchangeable and the version marker would mean nothing.
    const current = await fetch(`${origin}/.memoria/hello?nonce=${nonce}`);
    expect((await current.json()).proof).toBe(
      createHmac('sha256', master).update(`memoria-launcher-v1:hello:${port}:${nonce}`).digest('base64url'),
    );
  });

  it('answers an unknown /api route with 404, never with the app shell', async () => {
    // The static handler sits directly below this branch. An /api path that fell
    // through to it would serve index.html to an unauthenticated caller.
    expect((await fetch(`${origin}/api/not-a-route`)).status).toBe(401);
    const authorized = await fetch(`${origin}/api/not-a-route`, { headers: auth() });
    expect(authorized.status).toBe(404);
    expect(authorized.headers.get('content-type')).toContain('application/json');
    expect((await fetch(`${origin}/api`, { headers: auth() })).status).toBe(404);
    // Wrong method on a real route is still an API miss, not a page.
    expect((await fetch(`${origin}/api/sync`, { headers: auth() })).status).toBe(404);
  });

  it('bootstraps a separate origin token, clears old cookies and applies a nonce CSP', () => {
    const master = readFileSync(join(appdata, 'memoria', 'launcher-token'), 'utf8');
    expect(token).not.toBe(master);
    expect(launchHtml).not.toContain(master);
    expect(launchHtml).toContain("sessionStorage.setItem('memoria-launcher-token'");
    const cookie = launchResponse.headers.get('set-cookie');
    expect(cookie).not.toContain(token);
    expect(cookie).not.toContain(master);
    expect(cookie).toContain('Max-Age=0');
    const nonce = launchHtml.match(/<script nonce="([^"]+)"/)[1];
    expect(launchResponse.headers.get('content-security-policy')).toContain(`'nonce-${nonce}'`);
    expect(launchResponse.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rejects cookies and master tokens, and accepts the app authorization header', async () => {
    expect((await fetch(`${origin}/api/state`)).status).toBe(401);
    expect((await fetch(`${origin}/api/state`, { headers: { cookie: `memoria_token=${token}` } })).status).toBe(401);
    const master = readFileSync(join(appdata, 'memoria', 'launcher-token'), 'utf8');
    expect((await fetch(`${origin}/api/state`, { headers: { authorization: `Bearer ${master}` } })).status).toBe(401);
    expect((await fetch(`${origin}/api/state`, { headers: auth() })).status).toBe(200);
  });

  it('refuses foreign Host and Origin headers', async () => {
    // Fetch rewrites Host. Use HTTP directly to test the actual wire header.
    const status = await new Promise((resolve, reject) => {
      const req = request(`${origin}/api/state`, { headers: { ...auth(), host: 'attacker.invalid' } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(421);
    expect((await post(emptyState(), { origin: 'https://attacker.invalid' })).status).toBe(403);
    expect((await post(emptyState(), { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  it('blocks encoded traversal into sibling dist directories and malformed paths', async () => {
    for (const path of [
      '/..%2fdist-private/private.txt',
      '/..%5cdist-private/private.txt',
      '/..%2f..%2frelease.json',
    ]) {
      expect((await fetch(`${origin}${path}`)).status).toBe(403);
    }
    expect((await fetch(`${origin}/%ZZ`)).status).toBe(400);
    const index = await fetch(`${origin}/`);
    expect(index.headers.get('x-content-type-options')).toBe('nosniff');
    expect(index.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('rejects invalid content types, oversized bodies and newer schemas', async () => {
    expect((await post(emptyState(), { 'content-type': 'text/plain' })).status).toBe(415);
    const response = await fetch(`${origin}/api/sync`, {
      method: 'POST',
      headers: { ...auth(), origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      body: 'x'.repeat(1_000_001),
    });
    expect(response.status).toBe(413);
    expect((await post({ ...emptyState(), schemaVersion: 999 })).status).toBe(400);
  });

  it.each(['{ corrupt', JSON.stringify({ ...emptyState(), schemaVersion: 999 })])(
    'preserves unreadable or newer state on disk',
    async (contents) => {
      writeFileSync(stateFile, contents);
      expect((await fetch(`${origin}/api/state`, { headers: auth() })).status).toBe(500);
      expect((await post()).status).toBe(500);
      expect(readFileSync(stateFile, 'utf8')).toBe(contents);
    },
  );

  it('delivers state-change events over an authenticated stream', async () => {
    const response = await fetch(`${origin}/api/events`, { headers: auth(), signal: AbortSignal.timeout(5000) });
    const reader = response.body.getReader();
    try {
      expect(response.status).toBe(200);
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('retry:');
      const state = emptyState();
      state.settings.sleepHours = 9;
      state.settings.updatedAt = Date.now();
      expect((await post(state)).status).toBe(200);
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('data: changed');
    } finally {
      await reader.cancel();
    }
  });
});
