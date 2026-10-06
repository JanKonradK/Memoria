import { expect, test } from '@playwright/test';
import { createLanSync, createStateAccess } from '../../desktop/lan-sync.mjs';
import * as core from '../../desktop/dist/shared-core.mjs';
import AxeBuilder from '@axe-core/playwright';

for (const method of ['scan', 'manual']) {
  test(`Android ${method} pairing merges PC and phone edits and recovers after an outage`, async ({ page }, info) => {
    test.skip(info.project.name !== 'android-s23', 'Native bridge integration at phone size');
    let document = core.normalizeState(undefined);
    const access = createStateAccess({
      loadCore: async () => core,
      read: () => document,
      write: (next: typeof document) => {
        document = next;
      },
    });
    const server = createLanSync({ state: access, port: 0 });
    const status = await server.control({ action: 'start' });
    const address = `http://192.168.1.2:${status.port}`;
    let offline = false;
    let scanMode = 'cancel';
    const pairingText = JSON.stringify({ kind: 'memoria-pair', version: 1, addresses: [address], code: status.code });
    await page.exposeFunction('nativeScan', () =>
      scanMode === 'cancel'
        ? { error: 'CANCELLED' }
        : scanMode === 'invalid'
          ? { text: 'https://untrusted.example' }
          : { text: pairingText },
    );
    // Only the transport is simulated. Requests reach the real paired LAN server.
    await page.exposeFunction(
      'nativeHttp',
      async (options: { url: string; headers: Record<string, string>; data: unknown }) => {
        if (offline) throw new Error('Simulated network outage');
        const target = new URL(options.url);
        target.hostname = '127.0.0.1';
        const response = await fetch(target, {
          method: 'POST',
          headers: options.headers,
          body: JSON.stringify(options.data),
        });
        return { status: response.status, data: await response.json(), headers: {}, url: options.url };
      },
    );
    await page.addInitScript(() => {
      Object.assign(window, {
        androidBridge: {},
        Capacitor: {
          PluginHeaders: [
            { name: 'CapacitorHttp', methods: [{ name: 'post', rtype: 'promise' }] },
            { name: 'PairingScanner', methods: [{ name: 'scan', rtype: 'promise' }] },
            {
              name: 'App',
              methods: [
                { name: 'addListener', rtype: 'callback' },
                { name: 'removeListener', rtype: 'promise' },
              ],
            },
          ],
          nativePromise: async (plugin: string, _method: string, options: unknown) => {
            if (plugin === 'CapacitorHttp')
              return (window as unknown as { nativeHttp(options: unknown): Promise<unknown> }).nativeHttp(options);
            if (plugin === 'PairingScanner') {
              const result = await (
                window as unknown as { nativeScan(): Promise<{ text?: string; error?: string }> }
              ).nativeScan();
              if (result.error) throw Object.assign(new Error('Scan cancelled'), { code: result.error });
              return result;
            }
          },
          nativeCallback: () => Promise.resolve('test-listener'),
        },
      });
    });
    try {
      await page.goto('/');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: 'Connect my PC', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Phone & computer', exact: true })).toBeVisible();
      await expect(page.getByLabel('PC address', { exact: true })).not.toBeVisible();
      if (method === 'manual') {
        await page.getByText('Enter a code instead', { exact: true }).click();
        await page.getByLabel('Pairing code', { exact: true }).fill(status.code);
        // A missing address must focus its required field, not leave an inert button.
        await page.getByRole('button', { name: 'Connect to PC', exact: true }).click();
        await expect(page.getByLabel('PC address', { exact: true })).toBeFocused();
        await expect(page.getByRole('button', { name: 'Connect to PC', exact: true })).toBeEnabled();
        await page.getByLabel('PC address', { exact: true }).fill(address);
        await page.getByRole('button', { name: 'Connect to PC', exact: true }).click();
      } else {
        await page.screenshot({ path: info.outputPath('phone-connect.png') });
        const scan = page.getByRole('button', { name: 'Scan PC code', exact: true });
        await scan.click();
        await expect(scan).toBeEnabled();
        await expect(page.getByRole('alert')).toHaveCount(0);
        scanMode = 'invalid';
        await scan.click();
        await expect(page.getByRole('alert')).toContainText('not a Memoria connection code');
        scanMode = 'valid';
        await scan.click();
      }
      await expect(page.getByText('Connected to your PC', { exact: true })).toBeVisible();
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
          ['serious', 'critical'].includes(item.impact ?? ''),
        ),
      ).toEqual([]);
      await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
      await page.getByRole('button', { name: 'Add your first game' }).click();
      await page.getByRole('button', { name: /Genshin Impact/ }).click();
      await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect.poll(() => document.games.length).toBe(1);
      // A PC edit arrives through the same server state access as the launcher.
      const remote = structuredClone(document);
      remote.games[0] = { ...remote.games[0], name: 'PC edited game', updatedAt: Date.now() + 10 };
      await access.merge(remote);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(page.getByRole('button', { name: 'Open PC edited game controls', exact: true })).toBeVisible();
      offline = true;
      await page.getByRole('button', { name: 'Open PC edited game controls', exact: true }).click();
      const energy = page.getByLabel('Original Resin current value');
      await energy.fill('77');
      await energy.press('Enter');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByText('Connection options', { exact: true }).click();
      await page.getByRole('button', { name: 'Check connection', exact: true }).click();
      await expect(page.getByText(/Cannot reach your PC/).first()).toBeVisible();
      offline = false;
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect
        .poll(() => document.snapshots.some((snapshot: { value: number }) => snapshot.value === 77))
        .toBe(true);
      await page.getByText('Connection options', { exact: true }).click();
      await page.screenshot({ path: info.outputPath('wifi-connected.png') });
      await page.getByText('Connection options', { exact: true }).click();
      await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Scan PC code', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
      await expect(energy).toHaveValue('77');
    } finally {
      await server.control({ action: 'stop' });
    }
  });
}
