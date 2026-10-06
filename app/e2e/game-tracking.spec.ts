import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('game tracking controls keep energy, task, reset and reminder edits', async ({ page }, info) => {
  test.skip(!['android-s23', 'mobile-320', 'desktop'].includes(info.project.name), 'Tracking editor sizes');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add your first game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const openEditor = async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Game settings for Genshin Impact', exact: true }).click();
  };
  await openEditor();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('tab', { name: 'Energy', exact: true })).toHaveAttribute('aria-selected', 'true');
  await dialog.getByLabel('Cap', { exact: true }).first().fill('220');
  await dialog.getByLabel('Minutes per point', { exact: true }).first().fill('7');
  await expect
    .poll(async () => {
      const box = (await dialog.boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  await page.screenshot({ path: info.outputPath('energy-editor.png') });
  await dialog.getByRole('tab', { name: 'Tasks', exact: true }).click();
  await dialog.getByRole('button', { name: /^Daily Commissions/ }).click();
  await dialog.getByRole('combobox', { name: 'Mode for Daily Commissions ×4' }).click();
  await page.getByRole('option', { name: 'Counter', exact: true }).click();
  await dialog.getByLabel('Count target for Daily Commissions ×4').fill('4');
  await page.screenshot({ path: info.outputPath('task-editor.png') });
  await dialog.getByRole('tab', { name: 'Resets', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Server timezone' }).click();
  await page.getByRole('option', { name: 'NIKKE, all regions (UTC+9)', exact: true }).click();
  await dialog.getByLabel('Daily reset hour', { exact: true }).fill('5');
  await dialog.getByRole('tab', { name: 'Reminders', exact: true }).click();
  await dialog.getByLabel('Reminder message').fill('Claim weekly rewards');
  await dialog.getByRole('tab', { name: 'Energy', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Reminders', exact: true }).click();
  await expect(dialog.getByLabel('Reminder message')).toHaveValue('Claim weekly rewards');
  await dialog.getByRole('button', { name: 'Add reminder', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit reminder Claim weekly rewards', exact: true }).click();
  await dialog.getByLabel('Reminder message').fill('Claim rewards before reset');
  await dialog.getByRole('button', { name: 'Save reminder', exact: true }).click();
  await expect(dialog.getByText('Claim rewards before reset', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('reminder-editor.png') });
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await openEditor();
  await expect(dialog.getByLabel('Cap', { exact: true }).first()).toHaveValue('220');
  await expect(dialog.getByLabel('Minutes per point', { exact: true }).first()).toHaveValue('7');
  await dialog.getByRole('tab', { name: 'Tasks', exact: true }).click();
  await dialog.getByRole('button', { name: /^Daily Commissions/ }).click();
  await expect(dialog.getByLabel('Count target for Daily Commissions ×4')).toHaveValue('4');
  await dialog.getByRole('tab', { name: 'Resets', exact: true }).click();
  await expect(dialog.getByLabel('Daily reset hour', { exact: true })).toHaveValue('5');
  await expect(dialog.getByRole('combobox', { name: 'Server timezone' })).toContainText('NIKKE');
  await dialog.getByRole('tab', { name: 'Reminders', exact: true }).click();
  await expect(dialog.getByText('Claim rewards before reset', { exact: true })).toBeVisible();
});
