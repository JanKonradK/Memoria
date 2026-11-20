import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openSettings } from './support';

const rootVar = (name: string) => (page: import('@playwright/test').Page) =>
  page.evaluate((property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(), name);

test('a colour palette and accent apply at once, survive a reload and pass axe', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await openSettings(page, 'Appearance');

  const palettes = page.getByRole('radiogroup', { name: 'Colour palette' });
  await palettes.getByRole('radio', { name: /Catppuccin/ }).click();
  await expect.poll(() => rootVar('--color-surface-0')(page)).toBe('#1e1e2e');

  await page.getByRole('radiogroup', { name: 'Catppuccin flavour' }).getByRole('radio', { name: 'Frappé' }).click();
  await expect.poll(() => rootVar('--color-surface-0')(page)).toBe('#303446');

  await page.getByRole('radiogroup', { name: 'Accent colour' }).getByRole('radio', { name: 'Peach' }).click();
  const accent = await rootVar('--color-accent-fg')(page);
  await expect(
    page.getByRole('radiogroup', { name: 'Accent colour' }).getByRole('radio', { name: 'Peach' }),
  ).toBeChecked();
  await page.screenshot({ path: info.outputPath('palette-frappe.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // The pre-paint script applies the palette before any module runs.
  await page.reload();
  await expect.poll(() => page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#303446');
  expect(await rootVar('--color-accent-fg')(page)).toBe(accent);

  // Light mode switches to Latte, the family's light variant.
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => rootVar('--color-surface-0')(page)).toBe('#eff1f5');
  await page.screenshot({ path: info.outputPath('palette-latte.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // Back to Memoria: its surfaces come from the stylesheet again.
  await openSettings(page, 'Appearance');
  await page
    .getByRole('radiogroup', { name: 'Colour palette' })
    .getByRole('radio', { name: /Memoria/ })
    .click();
  await expect.poll(() => rootVar('--color-surface-0')(page)).toBe('#f6f7f9');
  await page.emulateMedia({ colorScheme: 'dark' });
});
