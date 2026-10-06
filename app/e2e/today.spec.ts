import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { emptyState } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';

test.beforeEach(async ({ page }, info) => {
  test.skip(!['android-s23', 'mobile-320', 'desktop'].includes(info.project.name), 'Today phone and desktop surfaces');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
});

test('Today starts a new roster and keeps all navigation reachable', async ({ page }, info) => {
  const primary = page.getByRole('navigation', { name: 'Primary', exact: true });
  await expect(primary.getByRole('button')).toHaveText(['Today', 'Games', 'Calendar']);
  await expect(primary.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Add your first game', exact: true }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs attention', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('today-dark.png') });
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(primary.getByRole('button', { name: 'Games' })).toHaveCSS('color', 'rgb(53, 55, 64)');
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('today-light.png') });
  await primary.getByRole('button', { name: 'Calendar' }).click();
  await page.getByRole('button', { name: 'Livestreams', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Livestreams', exact: true })).toBeVisible();
  await expect(primary.getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('a Today game opens complete controls and browser Back returns to Today', async ({ page }) => {
  await page.getByRole('button', { name: 'Add your first game', exact: true }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (page.viewportSize()!.width >= 1100) {
    await page.getByRole('button', { name: 'Review Genshin Impact', exact: true }).click();
    await page.getByRole('button', { name: 'Open game', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Open Genshin Impact', exact: true }).click();
  }
  const energy = page.getByLabel('Original Resin current value', { exact: true });
  await energy.fill('91');
  await energy.press('Enter');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByText(/Estimated 91\/200/)).toBeVisible();
});

test('browser Back restores a scrolled Today roster', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'Phone priority opens the game directly');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const state = emptyState();
  state.games = Array.from({ length: 12 }, (_, index) =>
    makeGame({ id: `today-${index}`, name: `Today game ${index}`, sort: index }),
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: 'today-roster.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today' }).click();
  const priority = page.getByRole('button', { name: 'Open Today game 7', exact: true });
  await priority.scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => scrollY);
  expect(position).toBeGreaterThan(0);
  await priority.click();
  await expect(page.getByRole('heading', { name: 'Today game 7', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(position, 0);
  await expect(priority).toBeFocused();
});
