import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { emptyState, latestSnapshots, type AppState } from '@memoria/shared';
import { makeGame, makeResource, makeSnapshot } from '../../shared/test/helpers';

const NOW = Date.UTC(2026, 9, 6, 12, 10);

async function stored(page: Page): Promise<AppState> {
  return page.evaluate(
    () =>
      new Promise<AppState>((resolve, reject) => {
        const request = indexedDB.open('keyval-store');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction('keyval').objectStore('keyval').get('memoria-state');
          read.onsuccess = () => {
            resolve(read.result);
            db.close();
          };
          read.onerror = () => {
            reject(read.error);
            db.close();
          };
        };
      }),
  );
}

async function openImport(page: Page) {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Import readings', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Import game readings', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function review(page: Page, value: number, at = NOW) {
  const dialog = page.getByRole('dialog', { name: 'Import game readings', exact: true });
  await dialog.getByRole('button', { name: 'Screenshot', exact: true }).click();
  await dialog.getByLabel('Text from the screenshot', { exact: true }).fill(`Original Resin ${value} / 200`);
  const local = await page.evaluate((time) => {
    const date = new Date(time);
    return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }, at);
  await dialog.getByLabel('Screenshot capture time', { exact: false }).fill(local);
  await dialog.getByRole('button', { name: 'Review readings', exact: true }).click();
  return dialog;
}

test.beforeEach(async ({ page }, info) => {
  test.skip(!['android-s23', 'mobile-320', 'desktop'].includes(info.project.name), 'Import phone and desktop flows');
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const state = emptyState();
  state.games = [
    makeGame({ id: 'primary', name: 'Import primary', updatedAt: NOW - 600_000 }),
    makeGame({ id: 'secondary', name: 'Import secondary', sort: 1, updatedAt: NOW - 600_000 }),
  ];
  state.resources = state.games.map((game) =>
    makeResource({ id: `resin-${game.id}`, gameId: game.id, name: 'Original Resin', updatedAt: NOW - 600_000 }),
  );
  state.snapshots = state.resources.map((resource) =>
    makeSnapshot({ id: `seed-${resource.id}`, resourceId: resource.id, value: 20, takenAt: NOW - 600_000 }),
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: 'import-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await openImport(page);
});

test('reviewed screenshots record their source and undo restores the prior reading', async ({ page }, info) => {
  const dialog = await review(page, 123);
  await expect(
    dialog.getByRole('region', { name: 'Review imported values' }).getByLabel('Original Resin', { exact: true }),
  ).toHaveValue('123');
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('import-review.png') });
  await dialog.getByRole('button', { name: 'Apply reviewed readings', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Import history' })).toContainText('Screenshot · 1 saved');
  await expect
    .poll(async () => latestSnapshots((await stored(page)).snapshots).get('resin-primary')?.provenance?.kind)
    .toBe('screenshot');
  await dialog.getByRole('button', { name: 'Undo import', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('1 readings restored.');
  await expect(dialog.getByRole('button', { name: 'Undo import', exact: true })).toBeDisabled();
  await expect.poll(async () => latestSnapshots((await stored(page)).snapshots).get('resin-primary')?.value).toBe(21);
});

test('an older screenshot cannot replace a newer reading', async ({ page }) => {
  const dialog = await review(page, 90, NOW - 1_200_000);
  await expect(dialog.getByText('A newer reading or resource edit is already saved.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Apply reviewed readings', exact: true })).toBeDisabled();
  expect(latestSnapshots((await stored(page)).snapshots).get('resin-primary')?.value).toBe(20);
});

test('an unnamed ratio requires an explicit resource and preserves capture seconds', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(NOW + 30_456));
  const dialog = page.getByRole('dialog', { name: 'Import game readings', exact: true });
  await dialog.getByRole('textbox', { name: 'Text from the screenshot', exact: true }).fill('88 / 200');
  await dialog.getByRole('button', { name: 'Taken just now', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review readings', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Apply reviewed readings', exact: true })).toHaveCount(0);
  await dialog.getByText('Assign values without a label', { exact: true }).click();
  await dialog.getByRole('combobox', { name: '88 / 200', exact: true }).click();
  await page.getByRole('option', { name: 'Original Resin', exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('import-assignment.png') });
  await dialog.getByRole('button', { name: 'Review readings', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply reviewed readings', exact: true }).click();
  await expect
    .poll(async () => latestSnapshots((await stored(page)).snapshots).get('resin-primary')?.takenAt)
    .toBe(NOW + 30_456);
  expect(latestSnapshots((await stored(page)).snapshots).get('resin-primary')?.value).toBe(88);
});

test('the selected game owns the imported reading', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Import game readings', exact: true });
  await dialog.getByRole('combobox', { name: 'Game account', exact: true }).click();
  await page.getByRole('option', { name: 'Import secondary', exact: true }).click();
  await review(page, 88);
  await dialog.getByRole('button', { name: 'Apply reviewed readings', exact: true }).click();
  await expect.poll(async () => latestSnapshots((await stored(page)).snapshots).get('resin-secondary')?.value).toBe(88);
  expect(latestSnapshots((await stored(page)).snapshots).get('resin-primary')?.value).toBe(20);
});

test('undo preserves a later manual correction', async ({ page }) => {
  const dialog = await review(page, 123);
  await dialog.getByRole('button', { name: 'Apply reviewed readings', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Import history' })).toContainText('Screenshot · 1 saved');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.clock.setFixedTime(new Date(NOW + 120_000));
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games' }).click();
  await page.getByRole('button', { name: 'Open Import primary controls', exact: true }).click();
  const energy = page.getByLabel('Original Resin current value', { exact: true });
  await energy.fill('66');
  await energy.press('Enter');
  await openImport(page);
  await dialog.getByRole('button', { name: 'History', exact: true }).click();
  await dialog.getByRole('button', { name: 'Undo import', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('0 readings restored. 1 kept unchanged.');
  await expect.poll(async () => latestSnapshots((await stored(page)).snapshots).get('resin-primary')?.value).toBe(66);
});

test('dismissal preserves a rejected screenshot draft', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Import game readings', exact: true });
  await dialog.getByLabel('Text from the screenshot', { exact: true }).fill('Original Resin 74 / 200');
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('textbox', { name: 'Text from the screenshot', exact: true })).toHaveValue(
    'Original Resin 74 / 200',
  );
  page.once('dialog', (confirmation) => confirmation.accept());
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
