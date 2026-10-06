import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';

test('long game choices fit the viewport and backup import has visible keyboard focus', async ({ page }) => {
  const name = 'A very long game name with several words and an account that needs room';
  const accountLabel = 'UnbrokenAccountName'.repeat(5);
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'long-game.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...emptyState(), games: [makeGame({ name, accountLabel })] })),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  const scope = page.getByRole('combobox', { name: 'Focus game' });
  await scope.click();
  const choices = page.getByRole('listbox');
  await expect(choices).toBeVisible();
  const bounds = (await choices.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(7);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width - 7);
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(scope).toContainText(accountLabel);
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    elements: Array.from(document.querySelectorAll('body *'))
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && (bounds.right > innerWidth + 1 || bounds.left < -1);
      })
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          class: element.getAttribute('class'),
          left: bounds.left,
          right: bounds.right,
          width: bounds.width,
          overflowX: style.overflowX,
          minWidth: style.minWidth,
          whiteSpace: style.whiteSpace,
        };
      }),
  }));
  expect(overflow.scrollWidth, JSON.stringify(overflow, null, 2)).toBeLessThanOrEqual(overflow.width);

  await page.getByRole('button', { name: 'Export backup', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('input[type="file"]')).toBeFocused();
  await expect(page.locator('label').filter({ has: page.locator('input[type="file"]') })).toHaveCSS(
    'outline-style',
    'solid',
  );
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? ''))).toEqual([]);
});
