import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function frameTaskEditor(page: Page) {
  await page.getByLabel('Item title', { exact: true }).evaluate((node) => {
    node.blur();
    const editor = node.closest('[aria-label^="Edit item"]')!;
    const headerHeight = document.querySelector('header')?.getBoundingClientRect().height ?? 0;
    window.scrollTo({ top: scrollY + editor.getBoundingClientRect().top - headerHeight - 12, behavior: 'instant' });
  });
  const title = await page.getByLabel('Item title', { exact: true }).boundingBox();
  const close = await page.getByRole('button', { name: 'Close item', exact: true }).boundingBox();
  const dock = await page.getByRole('navigation', { name: 'Primary', exact: true }).boundingBox();
  expect(title!.y).toBeGreaterThan(0);
  expect(close!.y + close!.height).toBeLessThanOrEqual(
    page.viewportSize()!.width < 640 ? dock!.y : page.viewportSize()!.height,
  );
}

test('daily task rules can change on the card, including Tacet counts and new tasks', async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23', 'mobile-320'].includes(info.project.name), 'Card editing sizes');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Add your first game' }).click();
  await page.getByRole('button', { name: /Wuthering Waves/ }).click();
  await page.getByRole('button', { name: 'Add WuWa', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const card = page.locator('.game-card-surface').first();
  await expect(card).toBeVisible();
  expect(
    await card.evaluate(
      (node) => getComputedStyle(node).cornerShape === getComputedStyle(node, '::before').cornerShape,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath('game-cards.png') });
  await card.screenshot({ path: info.outputPath('card-edge.png') });
  await page.getByRole('button', { name: 'Open Wuthering Waves controls', exact: true }).click();
  await page.getByRole('button', { name: 'Tacet Fields ×5: 0 of 5 done, click to mark one more', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Wuthering Waves', exact: true }).last().click();
  await page.getByRole('button', { name: 'Edit item Tacet Fields ×5', exact: true }).click();
  await page.getByLabel('Count target for Tacet Fields ×5', { exact: true }).fill('6');
  await page.getByLabel('Item title', { exact: true }).fill('My Tacet fields');
  await expect(page.getByRole('button', { name: /Half width|Full width|Resize/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close item', exact: true }).click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByLabel('New item name').fill('Tacet Discord Nests');
  await page.locator('form').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('combobox', { name: 'Mode for Tacet Discord Nests', exact: true }).click();
  await page.getByRole('option', { name: 'Counter', exact: true }).click();
  await page.getByLabel('Count target for Tacet Discord Nests', { exact: true }).fill('5');
  await expect(page.getByLabel('Count target for Tacet Discord Nests', { exact: true })).toHaveValue('5');
  await page.getByLabel('Count target for Tacet Discord Nests', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.locator('[data-aria-hidden="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  await frameTaskEditor(page);
  await page.screenshot({ path: info.outputPath('daily-task-editor.png') });
  await page.getByRole('button', { name: 'Close item', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'My Tacet fields: 1 of 6 done, click to mark one more', exact: true }),
  ).toBeVisible();
  const nests = page.getByRole('button', { name: /^Tacet Discord Nests: \d of 5 done/ });
  for (let count = 0; count < 5; count++) await nests.click();
  await expect(nests).toHaveAccessibleName('Tacet Discord Nests: 5 of 5 done, complete — click to reset');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number | undefined>((resolve, reject) => {
            const open = indexedDB.open('keyval-store');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              const request = db.transaction('keyval').objectStore('keyval').get('memoria-state');
              request.onerror = () => {
                db.close();
                reject(request.error);
              };
              request.onsuccess = () => {
                const state = request.result as import('@memoria/shared').AppState;
                const task = state.tasks.find((item) => item.name === 'Tacet Discord Nests');
                resolve(state.completions.find((item) => item.taskId === task?.id)?.countDone);
                db.close();
              };
            };
          }),
      ),
    )
    .toBe(5);
  await page.reload();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Open Wuthering Waves controls', exact: true }).click();
  await expect(nests).toHaveAccessibleName('Tacet Discord Nests: 5 of 5 done, complete — click to reset');
  await expect(
    page.getByRole('button', { name: 'My Tacet fields: 1 of 6 done, click to mark one more', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  const event = page.getByRole('dialog', { name: 'New event', exact: true });
  await expect(event).toBeVisible();
  await expect
    .poll(() =>
      event.evaluate((node) => {
        for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
          if (Number(getComputedStyle(parent).opacity) < 0.99) return false;
        }
        const bounds = node.getBoundingClientRect();
        return bounds.top >= 0 && bounds.bottom <= innerHeight + 1;
      }),
    )
    .toBe(true);
  const starts = await event.getByLabel('Starts', { exact: true }).boundingBox();
  const ends = await event.getByLabel('Ends', { exact: true }).boundingBox();
  if (page.viewportSize()!.width >= 640) expect(Math.abs(starts!.y - ends!.y)).toBeLessThan(1);
  expect(
    await event.evaluate(
      (node) => getComputedStyle(node).cornerShape === getComputedStyle(node, '::after').cornerShape,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath('event-editor.png') });
  await event.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Wuthering Waves', exact: true }).last().click();
  await page.getByRole('button', { name: 'Edit item Tacet Discord Nests', exact: true }).click();
  await expect(page.getByLabel('Count target for Tacet Discord Nests', { exact: true })).toHaveValue('5');
  await expect(page.locator('[data-aria-hidden="true"]')).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  await frameTaskEditor(page);
  await page.screenshot({ path: info.outputPath('light-daily-task-editor.png') });
});
