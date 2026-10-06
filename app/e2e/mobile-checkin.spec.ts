import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }, info) => {
  test.skip(!['android-s23', 'mobile-320', 'mobile-390'].includes(info.project.name), 'Phone check-in flow');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Add your first game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('phone roster opens full controls and keeps edits across navigation', async ({ page }, info) => {
  await expect(page.getByRole('button', { name: 'Open Genshin Impact controls' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const box = await nav.boundingBox();
  // The glass dock floats above the safe area instead of touching the edge.
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 8);
  expect(box!.y + box!.height).toBeGreaterThan(page.viewportSize()!.height - 60);
  expect(box!.x).toBeGreaterThanOrEqual(8);
  for (const button of await nav.getByRole('button').all()) {
    const bounds = await button.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: info.outputPath('phone-roster.png') });
  await page.getByRole('button', { name: 'Open Genshin Impact controls' }).click();
  const value = page.getByLabel('Original Resin current value');
  await value.fill('100');
  await value.press('Enter');
  await page.getByRole('button', { name: 'Decrease Original Resin' }).click();
  await expect(value).toHaveValue('99');
  const task = page.getByRole('button', { name: /Daily Commissions/ });
  await task.click();
  await expect(task).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Back to dashboard', exact: true }).click();
  await expect(page.getByText('1/6 dailies', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Genshin Impact controls' })).toContainText(/99\s*\/\s*200/);
  await page.getByRole('button', { name: 'Open Genshin Impact controls' }).click();
  await expect(value).toHaveValue('99');
  await expect(task).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Edit Genshin Impact', exact: true }).last().click();
  await expect(page.getByRole('region', { name: 'Layout editor for Genshin Impact' })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to dashboard', exact: true }).click();
  await page.getByRole('radio', { name: 'Tonight & reminders' }).click();
  await expect(page.getByRole('region', { name: 'Across every game' })).toBeVisible();
  await expect(page.getByText(/Sleep safe|caps overnight/)).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Reminder', exact: true }).click();
  const message = 'Remember to collect every expedition reward before the next server reset tonight.';
  await page.getByRole('textbox', { name: 'Message' }).fill(message);
  await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const reminder = page.getByText(message, { exact: true });
  await expect(reminder).toBeVisible();
  expect(await reminder.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  // Scan the settled theme rather than an intermediate color transition.
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveCSS('color', 'rgb(53, 55, 64)');
  await expect(page.getByRole('radio', { name: 'Games', exact: true })).toHaveCSS('color', 'rgb(91, 94, 105)');
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('touch scroll on an energy button does not change the value', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Genshin Impact controls' }).click();
  const value = page.getByLabel('Original Resin current value');
  await value.fill('100');
  await value.press('Enter');
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
  await expect(page.getByRole('radio', { name: 'List', exact: true })).toHaveAttribute('data-state', 'on');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Event', exact: true }).click();
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
  await expect(
    page.getByRole('button', { name: 'Edit Genshin Impact event: Phone test event', exact: true }),
  ).toBeVisible();
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
