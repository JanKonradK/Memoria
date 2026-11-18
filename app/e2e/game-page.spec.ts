import { expect, test } from '@playwright/test';
import { openGame, addFromShell } from './support';

test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23'].includes(info.project.name), 'Game page on desktop and phone');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a game', exact: true }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  // No server is chosen for you: pick the game's first one.
  await page.getByRole('combobox', { name: 'Server' }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test("a game's page keeps its actions in its bar and its tracking in columns", async ({ page }) => {
  await openGame(page, 'Genshin Impact');
  const bar = page.locator('.game-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toBeInViewport();
  await expect(bar.getByRole('button', { name: 'Edit Genshin Impact', exact: true })).toBeVisible();
  for (const name of ['Add event', 'Readings', 'Pause tracking', 'Set up launch']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  const resources = page.locator('[data-section="resources"]').first();
  const barBox = await bar.boundingBox();
  const resourcesBox = await resources.boundingBox();
  expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(resourcesBox!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const width = page.viewportSize()?.width ?? 0;
  const tasksBox = await page.locator('[data-section="tasks"]').first().boundingBox();
  const sideBox = await page.locator('.game-track-side').boundingBox();
  if (width >= 1280) {
    // Energy, tasks, then events and notes: three columns from the same top.
    expect(tasksBox!.x).toBeGreaterThan(resourcesBox!.x + resourcesBox!.width - 1);
    expect(sideBox!.x).toBeGreaterThan(tasksBox!.x + tasksBox!.width - 1);
    expect(Math.abs(tasksBox!.y - resourcesBox!.y)).toBeLessThanOrEqual(24);
  } else {
    // A phone reads energy, then tasks, then events.
    expect(tasksBox!.y).toBeGreaterThan(resourcesBox!.y);
    expect(sideBox!.y).toBeGreaterThan(tasksBox!.y);
  }
});

test('an event can be ticked off and taken back on its page', async ({ page }) => {
  await openGame(page, 'Genshin Impact');
  await addFromShell(page, 'Event');
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
  // Events are added from their tab and ticked on Track.
  await page.getByRole('tab', { name: 'Track', exact: true }).click();

  // One tick steps through partly done and done, then back to not started.
  const tick = page.getByRole('checkbox', { name: 'Tick me: done', exact: true });
  await tick.click();
  await expect(tick).toHaveAttribute('aria-checked', 'mixed');
  await tick.click();
  await expect(tick).toHaveAttribute('aria-checked', 'true');
  await tick.click();
  await expect(tick).toHaveAttribute('aria-checked', 'false');
});
