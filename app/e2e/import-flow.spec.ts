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

/** The game's card: beside Today's list on a wide window, its own page on a phone. */
async function openCard(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today' }).click();
  const desktop = page.viewportSize()!.width >= 900;
  await page.getByRole('button', { name: `${desktop ? 'Review' : 'Open'} ${name}`, exact: true }).click();
}

/** Type a reading into the card. The browser version cannot read images, so this is its path. */
async function enterText(page: Page, name: string, text: string) {
  await openCard(page, name);
  await page.getByRole('button', { name: 'Readings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Enter screenshot text', exact: true }).click();
  const review = page.getByRole('region', { name: `Check this reading for ${name}`, exact: true });
  await review.getByRole('textbox', { name: 'Screenshot text', exact: true }).fill(text);
  return review;
}

const latest = async (page: Page, resourceId: string) =>
  latestSnapshots((await stored(page)).snapshots).get(resourceId);

test.beforeEach(async ({ page }, info) => {
  test.skip(!['android-s23', 'mobile-320', 'desktop'].includes(info.project.name), 'Readings on phone and desktop');
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
});

test('a reading saved from the card records its source and undo restores the prior one', async ({ page }, info) => {
  const review = await enterText(page, 'Import primary', 'Original Resin 123 / 200');
  await expect(review.getByRole('spinbutton', { name: 'Original Resin / 200', exact: true })).toHaveValue('123');
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('reading-review.png') });
  await review.getByRole('button', { name: 'Save 1 reading', exact: true }).click();
  await expect(review).toHaveCount(0);
  const notice = page.getByRole('status').filter({ hasText: 'Saved 1 reading to Import primary.' });
  await expect(notice).toBeVisible();
  await expect.poll(async () => (await latest(page, 'resin-primary'))?.provenance?.kind).toBe('screenshot');
  await expect(page.locator('[data-reading-status]')).toContainText('Screenshot · just now');
  await page.screenshot({ path: info.outputPath('reading-saved.png') });
  await notice.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restored 1 reading.' })).toBeVisible();
  await expect.poll(async () => (await latest(page, 'resin-primary'))?.value).toBe(21);
  await page.getByRole('button', { name: 'Readings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Recent imports', exact: true }).click();
  const history = page.getByRole('region', { name: 'Recent imports for Import primary', exact: true });
  await expect(history).toContainText('Screenshot · 1 saved');
  await expect(history.getByRole('button', { name: /^Undo import/ })).toBeDisabled();
});

test('an older reading cannot replace a newer one', async ({ page }) => {
  const review = await enterText(page, 'Import primary', 'Original Resin 90 / 200');
  const local = await page.evaluate((time) => {
    const date = new Date(time);
    return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }, NOW - 1_200_000);
  await review.getByLabel('Taken', { exact: true }).fill(local);
  await expect(review.getByText('A newer reading or resource edit is already saved.', { exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: /^Save/ })).toBeDisabled();
  expect((await latest(page, 'resin-primary'))?.value).toBe(20);
});

test('an unnamed ratio requires an explicit resource and preserves capture seconds', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(NOW + 30_456));
  const review = await enterText(page, 'Import primary', '88 / 200');
  await review.getByRole('button', { name: 'Just now', exact: true }).click();
  await expect(review.getByRole('button', { name: /^Save/ })).toBeDisabled();
  await review.getByRole('combobox', { name: '88 / 200', exact: true }).click();
  await page.getByRole('option', { name: 'Original Resin', exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('reading-assignment.png') });
  await review.getByRole('button', { name: 'Save 1 reading', exact: true }).click();
  await expect.poll(async () => (await latest(page, 'resin-primary'))?.takenAt).toBe(NOW + 30_456);
  expect((await latest(page, 'resin-primary'))?.value).toBe(88);
});

test('the card a reading is entered in owns it', async ({ page }) => {
  const review = await enterText(page, 'Import secondary', 'Original Resin 88 / 200');
  await review.getByRole('button', { name: 'Save 1 reading', exact: true }).click();
  await expect.poll(async () => (await latest(page, 'resin-secondary'))?.value).toBe(88);
  expect((await latest(page, 'resin-primary'))?.value).toBe(20);
});

test('undo preserves a later manual correction', async ({ page }) => {
  const review = await enterText(page, 'Import primary', 'Original Resin 123 / 200');
  await review.getByRole('button', { name: 'Save 1 reading', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved 1 reading' })).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW + 120_000));
  const energy = page.getByLabel('Original Resin current value', { exact: true });
  await energy.fill('66');
  await energy.press('Enter');
  await page.getByRole('button', { name: 'Readings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Recent imports', exact: true }).click();
  await page.getByRole('button', { name: /^Undo import/ }).click();
  await expect(page.getByRole('alert')).toContainText('This resource changed after the import.');
  await expect.poll(async () => (await latest(page, 'resin-primary'))?.value).toBe(66);
});

test('a reading being checked survives leaving the card and goes only when discarded', async ({ page }) => {
  const review = await enterText(page, 'Import primary', 'Original Resin 74');
  const primary = page.getByRole('navigation', { name: 'Primary' });
  await primary.getByRole('button', { name: 'Calendar' }).click();
  await expect(review).toHaveCount(0);
  await openCard(page, 'Import primary');
  // The typed text is kept with the draft; its detected value is what the card shows first.
  await expect(review.getByRole('spinbutton', { name: 'Original Resin / 200', exact: true })).toHaveValue('74');
  await review.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect((await latest(page, 'resin-primary'))?.value).toBe(20);
});
