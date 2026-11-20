import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { addGameFromRail, openSettings } from './support';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await addGameFromRail(page);
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('combobox', { name: 'Server' }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a look applies at once, survives a reload before first paint, and passes axe', async ({ page }) => {
  await openSettings(page, 'Appearance');
  const looks = page.getByRole('radiogroup', { name: 'Look' });
  await expect(looks.getByRole('radio')).toHaveCount(8);
  await expect(looks.getByRole('radio', { name: /^Classic/ })).toBeChecked();

  for (const name of ['Soft HUD', 'Paper', 'Arcade']) {
    await looks.getByRole('radio', { name: new RegExp(`^${name}`) }).click();
    await expect(looks.getByRole('radio', { name: new RegExp(`^${name}`) })).toBeChecked();
    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations;
    expect(violations.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
  }
  await expect(page.locator('html')).toHaveAttribute('data-look', 'arcade');

  // The pre-paint script sets the look on its own: with the app's code withheld, the page still wears it.
  await page.route('**/src/main.tsx*', (route) => route.abort());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-look', 'arcade');
  await page.unroute('**/src/main.tsx*');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-look', 'arcade');
});

test('Minimal hides explanations and dock names from the screen, never from assistive technology', async ({ page }) => {
  await openSettings(page, 'Appearance');
  const hint = page.getByText('Minimal hides explanations and labels', { exact: false });
  await expect(hint).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Detail' }).getByRole('radio', { name: 'Minimal', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-detail', 'minimal');
  // Clipped to a pixel: off the screen, still in the accessibility tree.
  expect(await hint.evaluate((node) => node.getBoundingClientRect().width <= 1)).toBe(true);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  for (const place of ['Calendar', 'Games', 'Today', 'Notes', 'Settings']) {
    await expect(nav.getByRole('button', { name: place, exact: true })).toBeAttached();
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-detail', 'minimal');
});
