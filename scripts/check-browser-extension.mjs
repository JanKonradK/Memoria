/* global chrome, document */
import { chromium, expect } from '@playwright/test';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Use a fresh browser profile and synthetic publisher responses. This check
// never reads the owner's Chrome/Edge profile or signs in to a real account.
const root = resolve(import.meta.dirname, '..');
const extension = join(root, 'dist/release/Memoria/browser-extension');
const scratch = join(root, 'dist/browser-check', String(Date.now()));
mkdirSync(scratch, { recursive: true });
const fixtureExtension = join(scratch, 'extension');
cpSync(extension, fixtureExtension, { recursive: true });
const workerFile = join(fixtureExtension, 'background.mjs');
const workerSource = readFileSync(workerFile, 'utf8');
const construction = 'const worker = createWorker(chrome);';
if (!workerSource.includes(construction)) throw new Error('The browser worker fixture entry point changed.');
// Use the worker's existing dependency-injection option. Its default fetch is
// captured on startup, before a browser test can attach to the service worker.
writeFileSync(
  workerFile,
  workerSource.replace(
    construction,
    'const worker = createWorker(chrome, { fetcher: (...args) => globalThis.connectorFixtureFetch(...args) });',
  ),
);
const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
const context = await chromium.launchPersistentContext(scratch, {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${fixtureExtension}`, `--load-extension=${fixtureExtension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  expect(id).toBe('fonifgaeglmfmakjocdjembgclppgcfe');
  const configuration = await worker.evaluate(async () => ({
    permissions: await chrome.permissions.getAll(),
    rulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
    alarms: await chrome.alarms.getAll(),
  }));
  expect(configuration.permissions.permissions.sort()).toEqual(manifest.permissions.slice().sort());
  expect(configuration.permissions.origins.sort()).toEqual(manifest.host_permissions.slice().sort());
  expect(configuration.rulesets).toEqual(['hoyolab_referer']);
  expect(configuration.alarms).toEqual([]);

  // Supply a fixed native signing response and delayed publisher fixtures inside
  // this isolated extension worker. The real packaged native host has its own
  // framed-stdio and app-IPC checks in check:native.
  await worker.evaluate(() => {
    const routes = {
      genshin: {
        business: 'hk4e_global',
        server: 'os_euro',
        url: 'https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote',
        data: { current_resin: 123 },
      },
      hsr: {
        business: 'hkrpg_global',
        server: 'prod_official_eur',
        url: 'https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note',
        data: { current_stamina: 125 },
      },
      zzz: {
        business: 'nap_global',
        server: 'prod_gf_eu',
        url: 'https://sg-act-public-api.hoyolab.com/event/game_record_zzz/api/zzz/note',
        data: { energy: { progress: { current: 140 } } },
      },
    };
    globalThis.connectorFixture = { requests: [], published: [], release: undefined };
    const wait = new Promise((resolveRead) => {
      globalThis.connectorFixture.release = resolveRead;
    });
    chrome.runtime.sendNativeMessage = (_host, message, callback) => {
      if (message.action === 'publish') {
        globalThis.connectorFixture.published.push(message.snapshot);
        callback({ ok: true, accounts: message.snapshot.accounts.length, receivedAt: Date.now() });
        return;
      }
      const route = routes[message.provider];
      const url = new URL(
        message.kind === 'accounts'
          ? 'https://api-account-os.hoyolab.com/binding/api/getUserGameRolesByCookie'
          : route.url,
      );
      if (message.kind === 'accounts') url.searchParams.set('game_biz', route.business);
      else {
        url.searchParams.set('role_id', message.uid);
        url.searchParams.set('server', message.server);
      }
      callback({
        ok: true,
        url: url.href,
        headers: {
          'x-rpc-app_version': '1.5.0',
          'x-rpc-client_type': '5',
          'x-rpc-language': 'en-us',
          'x-rpc-lang': 'en-us',
          DS: '1791500000,abcdef,0123456789abcdef0123456789abcdef',
        },
      });
    };
    globalThis.connectorFixtureFetch = async (url, init) => {
      const parsed = new URL(url);
      const provider = Object.keys(routes).find(
        (name) =>
          parsed.searchParams.get('game_biz') === routes[name].business || String(url).startsWith(routes[name].url),
      );
      if (!provider) throw new Error('Unexpected publisher request.');
      globalThis.connectorFixture.requests.push({
        credentials: init.credentials,
        redirect: init.redirect,
        provider,
        headers: Object.keys(init.headers).sort(),
      });
      if (provider === 'genshin' && !parsed.searchParams.has('game_biz')) await wait;
      const data = parsed.searchParams.has('game_biz')
        ? { list: [{ game_uid: '712345678', region: routes[provider].server, nickname: 'Synthetic player' }] }
        : routes[provider].data;
      return new Response(JSON.stringify({ retcode: 0, data }));
    };
  });

  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/popup.html`);
  const automatic = page.getByRole('checkbox', { name: 'Read every five minutes' });
  await expect(automatic).not.toBeChecked();
  await page.getByRole('button', { name: 'Read accounts', exact: true }).click();
  await expect.poll(() => worker.evaluate(() => globalThis.connectorFixture.requests.length)).toBe(2);
  const reopened = await context.newPage();
  await reopened.setViewportSize({ width: 360, height: 600 });
  reopened.on('pageerror', (error) => errors.push(error.message));
  await reopened.goto(`chrome-extension://${id}/popup.html`);
  await expect(reopened.getByRole('button', { name: 'Reading…', exact: true })).toBeDisabled();
  await worker.evaluate(() => globalThis.connectorFixture.release());
  await expect(reopened.getByRole('button', { name: 'Read accounts', exact: true })).toBeEnabled();
  await expect(reopened.getByRole('status')).toContainText('3 accounts sent');
  await expect(reopened.getByRole('list', { name: 'Linked game accounts' }).locator('li')).toHaveCount(3);
  const sent = await worker.evaluate(() => ({
    requests: globalThis.connectorFixture.requests,
    published: globalThis.connectorFixture.published,
  }));
  expect(sent.requests).toHaveLength(6);
  expect(
    sent.requests.every(
      (request) =>
        request.credentials === 'include' && request.redirect === 'error' && !request.headers.includes('cookie'),
    ),
  ).toBe(true);
  expect(sent.published).toHaveLength(1);
  expect(sent.published[0].accounts.every((account) => account.reading.observedAt <= sent.published[0].fetchedAt)).toBe(
    true,
  );
  const toggle = reopened.getByRole('checkbox', { name: 'Read every five minutes' });
  await toggle.check();
  await expect
    .poll(() => worker.evaluate(async () => (await chrome.alarms.get('memoria-hoyolab-readings'))?.periodInMinutes))
    .toBe(5);
  await toggle.uncheck();
  await expect
    .poll(() => worker.evaluate(async () => Boolean(await chrome.alarms.get('memoria-hoyolab-readings'))))
    .toBe(false);
  expect(
    await reopened.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);
  await reopened.locator('body').screenshot({ path: join(root, 'dist/browser-connector-popup.png') });
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      browserConnector:
        'PASS: packaged MV3 extension, stable identity, narrow permissions, scoped rules, default opt-out, signed request validation, three provider fixtures, one publication, live popup completion and opt-in alarms',
      screenshot: 'dist/browser-connector-popup.png',
    }),
  );
} finally {
  await context.close();
}
