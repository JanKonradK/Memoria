import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('livestream recaps have readable artwork, working navigation and accessible content', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-17T12:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Livestreams', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Livestreams', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(4);
  for (const artwork of await page.locator('article img').all()) {
    await artwork.scrollIntoViewIfNeeded();
    await expect(artwork).toBeVisible();
    await expect.poll(() => artwork.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByRole('link', { name: 'Watch official replay ↗', exact: true })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.waitForTimeout(350);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('codes copy, show official destinations and expire while the page stays open', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-09-20T15:58:00Z') });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Livestreams', exact: true }).click();
  const nte = page.getByRole('article', { name: 'For Whom the Verses Mourn' });
  const genshin = page.getByRole('article', { name: 'A Rekviem for the Underworld' });
  await nte.getByRole('button', { name: 'Copy WITCHHOUSE', exact: true }).click();
  await expect(nte.getByRole('status')).toHaveText('WITCHHOUSE copied. Paste it to redeem.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('WITCHHOUSE');
  await expect(genshin.getByRole('button', { name: 'Copy Rekviem', exact: true })).toBeDisabled();
  await expect(genshin.getByRole('link', { name: 'Redemption page for Rekviem' })).toHaveAttribute(
    'href',
    'https://genshin.hoyoverse.com/en/gift?code=Rekviem',
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Denied')) },
    }),
  );
  await nte.getByRole('button', { name: 'Copy THEWHOOTS', exact: true }).click();
  await expect(nte.getByRole('status')).toContainText('Select the code and copy it manually.');
  await page.clock.fastForward(90_000);
  await expect(nte.getByRole('button', { name: 'Copy WITCHHOUSE', exact: true })).toBeDisabled();
  await expect(nte.getByText('Expired', { exact: true })).toBeVisible();
});
