import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { chooseFromEdit, openGame, addFromShell, showTodayGames } from './support';

/** Game settings, on its Tasks tab. */
async function openTaskSettings(page: Page, game: string) {
  await chooseFromEdit(page, game, 'Game settings');
  const dialog = page.getByRole('dialog', { name: game });
  await dialog.getByRole('tab', { name: 'Tasks', exact: true }).click();
  return dialog;
}

test('daily task rules can change on the card, including count targets and new tasks', async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23', 'mobile-320'].includes(info.project.name), 'Card editing sizes');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Add a game' }).click();
  await page.getByRole('button', { name: /Wuthering Waves/ }).click();
  // No server is chosen for you: pick the game's first one.
  await page.getByRole('combobox', { name: 'Server' }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('button', { name: 'Add WuWa', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await showTodayGames(page);
  await page.screenshot({ path: info.outputPath('game-cards.png') });
  // Only a wide window has the card beside Today's list.
  if (page.viewportSize()!.width >= 900) {
    const card = page.locator('.today-card');
    await expect(card).toBeVisible();
    await card.screenshot({ path: info.outputPath('card-edge.png') });
  }
  await openGame(page, 'Wuthering Waves');
  await page
    .getByRole('button', { name: 'Weekly Challenge ×3: 0 of 3 done, click to mark one more', exact: true })
    .click();
  // Task rules live in Game settings; the card shows the result.
  const settings = await openTaskSettings(page, 'Wuthering Waves');
  await settings.getByRole('button', { name: /^Weekly Challenge ×3/ }).click();
  await settings.getByLabel('Count target for Weekly Challenge ×3', { exact: true }).fill('6');
  await settings.getByLabel('Task name: Weekly Challenge ×3', { exact: true }).fill('My weekly bosses');
  await settings.getByLabel('New task name').fill('Tacet Discord Nests');
  await settings.getByRole('button', { name: 'Add task', exact: true }).click();
  await settings.getByRole('button', { name: /^Tacet Discord Nests/ }).click();
  await settings.getByRole('combobox', { name: 'Mode for Tacet Discord Nests', exact: true }).click();
  await page.getByRole('option', { name: 'Counter', exact: true }).click();
  await settings.getByLabel('Count target for Tacet Discord Nests', { exact: true }).fill('5');
  await expect(settings.getByLabel('Count target for Tacet Discord Nests', { exact: true })).toHaveValue('5');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('daily-task-editor.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'My weekly bosses: 1 of 6 done, click to mark one more', exact: true }),
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
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await openGame(page, 'Wuthering Waves');
  await expect(nests).toHaveAccessibleName('Tacet Discord Nests: 5 of 5 done, complete — click to reset');
  await expect(
    page.getByRole('button', { name: 'My weekly bosses: 1 of 6 done, click to mark one more', exact: true }),
  ).toBeVisible();
  await addFromShell(page, 'Event');
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
  await page.emulateMedia({ colorScheme: 'light' });
  const again = await openTaskSettings(page, 'Wuthering Waves');
  await again.getByRole('button', { name: /^Tacet Discord Nests/ }).click();
  await expect(again.getByLabel('Count target for Tacet Discord Nests', { exact: true })).toHaveValue('5');
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('light-daily-task-editor.png') });
});
