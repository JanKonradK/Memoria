import { expect, test } from '@playwright/test';

test('the dailies ring on Today ticks a game, and Undo takes it back', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Add a game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('combobox', { name: 'Server' }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const tick = page.getByRole('button', { name: 'Tick all Genshin Impact dailies' });
  await tick.click();
  const undo = page.getByRole('button', { name: 'Undo ticking Genshin Impact dailies' });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(tick).toBeVisible();
});
