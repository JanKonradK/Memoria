import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('upcoming broadcasts show announced dates and keep expired codes collapsed', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date('2026-11-03T12:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.getByRole('radio', { name: 'Livestreams', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Upcoming broadcasts', exact: true })).toBeVisible();
  // Kuro announced this one; the rest of the list are predicted windows.
  await expect(page.getByText('WuWa 3.8 Special Broadcast', { exact: true })).toBeVisible();
  const genshin = page.getByRole('article', { name: 'Hour of Ruin' });
  await expect(genshin.getByRole('button', { name: 'Copy HourofRuin', exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('upcoming-broadcasts.png') });
  await page.getByRole('button', { name: 'Track game', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Add a game', exact: true })).toBeVisible();
});

test('livestream recaps have readable artwork, working navigation and accessible content', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-03T12:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.getByRole('radio', { name: 'Livestreams', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Livestreams', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(4);
  for (const artwork of await page.locator('article img').all()) {
    await artwork.scrollIntoViewIfNeeded();
    await expect(artwork).toBeVisible();
    await expect.poll(() => artwork.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByRole('link', { name: 'Watch replay ↗', exact: true })).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.waitForTimeout(350);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('codes copy, show official destinations and expire while the page stays open', async ({ page, context }) => {
  // Genshin 7.2 codes expire October 26 at 00:00 (UTC-4), two minutes from here.
  await page.clock.install({ time: new Date('2026-10-26T03:58:00Z') });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.getByRole('radio', { name: 'Livestreams', exact: true }).click();
  const genshin = page.getByRole('article', { name: 'Hour of Ruin' });
  await genshin.getByRole('button', { name: 'Copy HourofRuin', exact: true }).click();
  await expect(genshin.getByRole('status')).toHaveText('Copied HourofRuin');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('HourofRuin');
  await expect(genshin.getByRole('link', { name: 'Redeem HourofRuin' })).toHaveAttribute(
    'href',
    'https://genshin.hoyoverse.com/en/gift?code=HourofRuin',
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Denied')) },
    }),
  );
  await genshin.getByRole('button', { name: 'Copy ExpertMitya', exact: true }).click();
  await expect(genshin.getByRole('status')).toContainText('Could not copy ExpertMitya');
  await page.clock.fastForward(150_000);
  await genshin.getByText('Expired codes (3)', { exact: true }).click();
  await expect(genshin.getByRole('button', { name: 'Copy HourofRuin', exact: true })).toBeDisabled();
  await expect(genshin.getByRole('link', { name: 'Redemption page for HourofRuin' })).toBeVisible();
});
