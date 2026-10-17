import { expect, test } from '@playwright/test';
import { openGame } from './support';

test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23'].includes(info.project.name), 'Game page on desktop and phone');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a game', exact: true }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test("a game's page keeps its actions in its heading", async ({ page }) => {
  await openGame(page, 'Genshin Impact');
  // The actions are a plain labelled div rather than a landmark, so they are found by their label.
  const bar = page.getByLabel('Genshin Impact tracking controls', { exact: true });
  await expect(bar).toBeVisible();
  await expect(bar).toBeInViewport();
  await expect(bar.getByRole('button', { name: 'Manage events', exact: true })).toBeVisible();
  for (const name of ['Add event', 'Readings', 'Pause tracking', 'Set up launch']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  const resources = page.locator('[data-tour="resources"]').first();
  const barBox = await bar.boundingBox();
  const resourcesBox = await resources.boundingBox();
  expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(resourcesBox!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const desktop = (page.viewportSize()?.width ?? 0) >= 900;
  if (desktop) {
    // Tasks sit in the same column as the resources, below them.
    const tasksBox = await page.locator('[data-tour="tasks"]').first().boundingBox();
    expect(Math.abs(tasksBox!.x - resourcesBox!.x)).toBeLessThanOrEqual(2);
    expect(tasksBox!.y).toBeGreaterThan(resourcesBox!.y);
  }
});

test('an event can be ticked off and taken back on its page', async ({ page }) => {
  await openGame(page, 'Genshin Impact');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Event', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New event' });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Tick me');
  // The sheet opens a window at the moment it opens, but the page clock only ticks every 30 seconds.
  // Until the page catches up the window reads as upcoming, and an upcoming event that is ticked
  // leaves the list. Start it ten minutes back so it is already running, as the page sees it.
  const starts = dialog.getByLabel('Starts', { exact: true });
  const [day, time] = (await starts.inputValue()).split('T');
  const [year, month, date] = day!.split('-').map(Number);
  const [hour, minute] = time!.split(':').map(Number);
  const earlier = new Date(Date.UTC(year!, month! - 1, date!, hour!, minute! - 10));
  await starts.fill(earlier.toISOString().slice(0, 16));
  await dialog.getByRole('button', { name: 'Add event', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const tick = page.getByRole('checkbox', { name: 'Tick me: done', exact: true });
  await tick.click();
  await expect(tick).toHaveAttribute('aria-checked', 'true');
  await tick.click();
  await expect(tick).toHaveAttribute('aria-checked', 'false');
});
