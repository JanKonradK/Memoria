import { expect, test } from '@playwright/test';

test('backup export and merge preview stay within the viewport', async ({ page }) => {
  // Start past first-run onboarding: this flow is about the dashboard and Settings.
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add your first game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add GI' }).click();
  const expand = page.getByRole('button', { name: 'Expand Genshin Impact controls' });
  if (await expand.isVisible()) await expand.click();
  await expect(page.getByRole('heading', { name: 'Genshin Impact', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  // Settings is an accordion now — export/import live inside the collapsed Data section.
  await page.getByRole('button', { name: 'Expand Data settings' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^memoria-backup-/);

  const backup = await download.createReadStream();
  expect(backup).toBeTruthy();

  await page.getByText('Import backup').click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'memoria-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        exportedAt: new Date().toISOString(),
        schemaVersion: 2,
        state: {
          games: [],
          resources: [],
          snapshots: [],
          tasks: [],
          completions: [],
          events: [],
          chips: [],
          alertRules: [],
          reminders: [],
          settings: {
            quietStart: null,
            quietEnd: null,
            localTz: 'UTC',
            sleepHours: 8,
            updatedAt: Date.now(),
          },
        },
      }),
    ),
  });
  await expect(page.getByText(/Merge backup with/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Merge backup' })).toBeVisible();
});
