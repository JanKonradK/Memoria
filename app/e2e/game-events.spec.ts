import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<import('@memoria/shared').AppState>((resolve, reject) => {
        const request = indexedDB.open('keyval-store');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const document = db.transaction('keyval').objectStore('keyval').get('memoria-state');
          document.onsuccess = () => {
            resolve(document.result);
            db.close();
          };
          document.onerror = () => {
            reject(document.error);
            db.close();
          };
        };
      }),
  );
}

async function openWorkspace(page: Page) {
  await page.getByRole('button', { name: 'Open Genshin Impact controls', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Manage events', exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }, info) => {
  test.skip(!['android-s23', 'mobile-320', 'desktop'].includes(info.project.name), 'Game management sizes');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add your first game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWorkspace(page);
});

test('cards add, rename, change behavior, and delete finished events from Edit layout', async ({ page }, info) => {
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'New event' });
  await expect(dialog.getByRole('combobox', { name: 'Game', exact: true })).toContainText('Genshin Impact');
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('My personal window');
  await dialog.getByRole('combobox', { name: 'Type', exact: true }).click();
  await page.getByRole('option', { name: 'banner', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Banner tag', exact: true }).click();
  await page.getByRole('option', { name: 'Character banner', exact: true }).click();
  await dialog.getByRole('switch', { name: 'Needs a daily check-in' }).click();
  await dialog.getByRole('switch', { name: 'Include in next actions' }).click();
  await dialog.getByRole('button', { name: 'Add event', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit Genshin Impact', exact: true }).last().click();
  await page.getByRole('button', { name: 'Edit item Events', exact: true }).click();
  await page.getByRole('button', { name: 'Edit event details', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Events for Genshin Impact' });
  await expect(panel.getByRole('heading', { name: 'Events', exact: true })).toBeFocused();
  await panel.getByRole('searchbox', { name: 'Find event' }).fill('My personal window');
  const row = panel.getByRole('button', { name: 'Edit Genshin Impact event: My personal window', exact: true });
  await expect(row).toContainText('Daily check-in');
  await expect(row).toContainText('Next actions off');
  await row.click();
  dialog = page.getByRole('dialog', { name: 'Edit event' });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('My renamed cycle');
  await dialog.getByRole('combobox', { name: 'Type', exact: true }).click();
  await page.getByRole('option', { name: 'cycle', exact: true }).click();
  await dialog.getByRole('switch', { name: 'Mark done', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await panel.getByRole('searchbox', { name: 'Find event' }).fill('My renamed cycle');
  await panel.getByRole('radio', { name: /^Finished/ }).click();
  const done = panel.getByRole('button', { name: 'Edit Genshin Impact event: My renamed cycle', exact: true });
  await expect(done).toContainText('cycle');
  await expect(done).toContainText('Done');
  await expect
    .poll(async () => (await stored(page)).events.find((event) => event.name === 'My renamed cycle'))
    .toMatchObject({ type: 'cycle', done: true, dailyTouch: true, notify: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('game-event-management.png') });
  await done.click();
  dialog = page.getByRole('dialog', { name: 'Edit event' });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Keep event', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(done).toHaveCount(0);
  await expect
    .poll(async () => (await stored(page)).events.find((event) => event.name === 'My renamed cycle')?.deleted)
    .toBe(true);
});

test('pause survives reload and resumes saved daily progress from the dashboard', async ({ page }, info) => {
  const value = page.getByLabel('Original Resin current value');
  await value.fill('99');
  await value.press('Enter');
  await page.getByRole('button', { name: /Daily Commissions/ }).click();
  await expect.poll(async () => (await stored(page)).completions.length).toBeGreaterThan(0);
  const before = await stored(page);
  await page.getByRole('button', { name: 'Pause tracking', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume tracking', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).games[0]?.paused).toBe(true);
  await page.getByRole('button', { name: 'Manage events', exact: true }).click();
  const events = page.getByRole('region', { name: 'Events for Genshin Impact' });
  await events.getByRole('radio', { name: /^All/ }).click();
  await events
    .getByRole('button', { name: /^Edit Genshin Impact event:/ })
    .first()
    .click();
  const edit = page.getByRole('dialog', { name: 'Edit event' });
  await expect(edit.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resume tracking', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to dashboard', exact: true }).click();
  await page.reload();
  if (info.project.name === 'desktop') {
    await openWorkspace(page);
    await page.getByRole('button', { name: 'Resume tracking', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Resume Genshin Impact tracking', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Pause tracking', exact: true })).toBeVisible();
  await expect(value).toHaveValue('99');
  await expect(page.getByRole('button', { name: /Daily Commissions/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await stored(page)).games[0]?.paused).toBe(false);
  const after = await stored(page);
  const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  expect(byId(after.snapshots)).toEqual(byId(before.snapshots));
  expect(byId(after.completions)).toEqual(byId(before.completions));
  expect(byId(after.events)).toEqual(byId(before.events));
  expect(byId(after.tasks)).toEqual(byId(before.tasks));
});
