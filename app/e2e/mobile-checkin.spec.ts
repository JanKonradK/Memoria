import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gameRow, openGame, addFromShell, showTodayGames, editFromQuickView } from './support';

test.beforeEach(async ({ page }, info) => {
  test.skip(!['android-s23', 'mobile-320', 'mobile-390'].includes(info.project.name), 'Phone check-in flow');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Add a game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  // No server is chosen for you: pick the game's first one.
  await page.getByRole('combobox', { name: 'Server' }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('phone roster opens full controls and keeps edits across navigation', async ({ page }, info) => {
  await showTodayGames(page);
  await expect(gameRow(page, 'Genshin Impact')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const box = await nav.boundingBox();
  // Upright, the rail is a dock floating over the bottom edge, clear of the sides and the safe area.
  const viewport = page.viewportSize()!;
  expect(viewport.height - (box!.y + box!.height)).toBeGreaterThanOrEqual(6);
  expect(viewport.height - (box!.y + box!.height)).toBeLessThanOrEqual(40);
  expect(box!.x).toBeGreaterThanOrEqual(6);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 6);
  for (const button of await nav.getByRole('button').all()) {
    const bounds = await button.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.y).toBeGreaterThanOrEqual(box!.y);
  }
  await page.screenshot({ path: info.outputPath('phone-roster.png') });
  await openGame(page, 'Genshin Impact');
  const value = page.getByLabel('Original Resin current value');
  await value.fill('100');
  await value.press('Enter');
  // On touch the steppers appear once the reading is reached for.
  await value.focus();
  await page.getByRole('button', { name: 'Decrease Original Resin' }).click();
  await expect(value).toHaveValue('99');
  const task = page.getByRole('button', { name: /Daily Commissions/ });
  await task.click();
  await expect(task).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await showTodayGames(page);
  await expect(gameRow(page, 'Genshin Impact')).toHaveAccessibleDescription(/1 of 6 dailies done/);
  await expect(gameRow(page, 'Genshin Impact')).toContainText(/99\s*\/\s*200/);
  await openGame(page, 'Genshin Impact');
  await expect(value).toHaveValue('99');
  await expect(task).toHaveAttribute('aria-pressed', 'true');
  // A game page's Edit opens its settings; its events live on the Events tab.
  await page.locator('.focus-workspace').getByRole('button', { name: 'Edit Genshin Impact', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Genshin Impact' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await showTodayGames(page);
  await expect(page.getByRole('list', { name: 'Games', exact: true })).toBeVisible();
  await addFromShell(page, 'Reminder');
  const message = 'Remember to collect every expedition reward before the next server reset tonight.';
  await page.getByRole('textbox', { name: 'Message' }).fill(message);
  await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'light' });
  // Scan the settled theme rather than an intermediate color transition: a
  // route the dock is not on reads in the light theme's muted ink.
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveCSS('color', 'rgb(91, 94, 105)');
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('touch scroll on an energy button does not change the value', async ({ page }) => {
  await openGame(page, 'Genshin Impact');
  const value = page.getByLabel('Original Resin current value');
  await value.fill('100');
  await value.press('Enter');
  await value.focus();
  const step = page.getByRole('button', { name: 'Decrease Original Resin' });
  const touch = { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 200, clientY: 400 };
  await step.dispatchEvent('pointerdown', touch);
  await step.dispatchEvent('pointermove', { ...touch, clientY: 370 });
  await step.dispatchEvent('pointercancel', { ...touch, clientY: 370 });
  await page.waitForTimeout(500);
  await expect(value).toHaveValue('100');
  await step.click();
  await expect(value).toHaveValue('99');
});

test('event actions stay visible while the form scrolls and both event views remain available', async ({
  page,
}, info) => {
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  // A phone opens on the Agenda: a week of time bars leaves a bar no room for its name.
  await expect(page.getByRole('radio', { name: 'Agenda', exact: true })).toHaveAttribute('data-state', 'on');
  await addFromShell(page, 'Event');
  const dialog = page.getByRole('dialog', { name: 'New event' });
  const save = dialog.getByRole('button', { name: 'Add event', exact: true });
  // Measure the fixed footer after the sheet entrance and font swap settle.
  await expect(dialog.locator('..')).toHaveCSS('transform', 'none');
  await page.evaluate(() => document.fonts.ready);
  const before = await save.boundingBox();
  expect(before!.y + before!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Phone test event');
  await dialog.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep this note.');
  expect(Math.abs((await save.boundingBox())!.y - before!.y)).toBeLessThan(2);
  await save.click();
  await expect(dialog).toHaveCount(0);
  // The agenda row opens its quick view, and the editor keeps the note.
  const row = page.locator('.cal-agenda .cal-row-main').filter({ hasText: 'Phone test event' }).first();
  await expect(row).toBeVisible();
  await row.click();
  await editFromQuickView(page);
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep this note.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    ),
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('phone-event-list.png') });
  await page.getByRole('radio', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('[data-timeline-scale]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
