import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { emptyState } from '@memoria/shared';
import { makeGame, makeResource } from '../../shared/test/helpers';

test('normal browser setup discovers an account and saves its readings to the card', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Native PC bridge flow');
  const now = Date.UTC(2026, 9, 8, 12, 0);
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(() => {
    localStorage.setItem('memoria-onboarding', 'complete');
    localStorage.setItem('memoria-preset-gap-dismissed', '999');
    localStorage.setItem('memoria-legacy-home-timezone-dismissed', '1');
    let connected = false;
    window.memoriaDesktop = {
      version: 1,
      onCloseRequested: () => () => undefined,
      completeClose: () => undefined,
      browser: {
        setup: async () => ({ folder: 'C:/Memoria/browser-connector' }),
        status: async () => ({ receivedAt: Date.UTC(2026, 9, 8, 11, 59), accounts: 1 }),
        listAccounts: async () => ({
          accounts: [{ provider: 'genshin', uid: '700000002', server: 'os_euro', nickname: 'Traveler' }],
        }),
        request: async (body) => {
          if (body?.action === 'connect') connected = true;
          return {
            connections: connected
              ? [
                  {
                    gameId: 'g1',
                    provider: 'genshin',
                    uid: '700000002',
                    server: 'os_euro',
                    autoRefresh: false,
                    lastCheckedAt: Date.UTC(2026, 9, 8, 11, 59),
                    transport: 'browser',
                  },
                ]
              : [],
            ...(body?.action === 'connect'
              ? {
                  reading: {
                    gameId: 'g1',
                    provider: 'genshin',
                    uid: '700000002',
                    observedAt: Date.UTC(2026, 9, 8, 11, 59),
                    data: { current_resin: 123, max_resin: 200 },
                  },
                }
              : {}),
          };
        },
      },
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const state = emptyState();
  state.games = [makeGame({ id: 'g1', name: 'Genshin browser', presetKey: 'genshin', updatedAt: now - 600_000 })];
  state.resources = [makeResource({ gameId: 'g1', name: 'Original Resin', updatedAt: now - 600_000 })];
  await page.locator('input[type="file"]').setInputFiles({
    name: 'browser-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('memoria:open-accounts', { detail: { gameId: 'g1' } })),
  );
  // Accounts open inside the game's card, not in a separate dialog.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const panel = page.getByRole('region', { name: 'Account for Genshin browser', exact: true });
  const setup = panel.getByRole('region', { name: 'Chrome or Edge connection' });
  await expect(setup).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Sign in with HoYoLAB' })).toHaveCount(0);
  await expect(panel.getByRole('textbox', { name: 'HoYoLAB session cookie' })).toHaveCount(0);
  await expect(setup.getByRole('link', { name: 'Open HoYoLAB in your browser' })).toHaveAttribute(
    'href',
    'https://www.hoyolab.com/',
  );
  await setup.getByRole('button', { name: 'Set up browser connector' }).click();
  await expect(panel.getByRole('status')).toContainText('Connector folder opened');
  await page.setViewportSize({ width: 512, height: 600 });
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('browser-account-setup.png') });
  await panel.getByRole('button', { name: 'Find my accounts', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: 'In-game UID', exact: true })).toHaveValue('700000002');
  await panel.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved 1 reading to Genshin browser.' })).toBeVisible();
  await expect(page.getByLabel('Original Resin current value', { exact: true })).toHaveValue('123');
  await expect(page.locator('[data-reading-status]')).toContainText('Account ·');
});
