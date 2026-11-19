import { expect, test, type Page } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';
import { openSettings } from './support';

const DAY = 86_400_000;

async function load(page: Page, name: string, events: Record<string, unknown>[]) {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  const now = Date.now();
  const game = makeGame({ name, updatedAt: now });
  const state = {
    ...emptyState(),
    games: [game],
    events: events.map((event) => ({
      gameId: game.id,
      type: 'event',
      dailyTouch: false,
      notify: true,
      notes: '',
      updatedAt: now,
      ...event,
    })),
  };
  await openSettings(page, 'Data');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'timeline.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page
    .getByRole('radiogroup', { name: 'Event view' })
    .getByRole('radio', { name: 'Timeline', exact: true })
    .click();
}

test('separate cycles share a row, and names stay clear of countdowns', async ({ page }, info) => {
  const now = Date.now();
  // Every event falls inside the phone's week as well as the wider four weeks.
  await load(page, 'Timeline regression', [
    { id: 'old-cycle', name: 'Stygian Onslaught', type: 'cycle', start: now - 6 * DAY, end: now + 2 * DAY },
    { id: 'new-cycle', name: 'Stygian Onslaught', type: 'cycle', start: now + 3 * DAY, end: now + 5 * DAY },
    { id: 'clipped-title', name: 'Bonus Star Pieces — Champions Cup', start: now + 4.5 * DAY, end: now + 40 * DAY },
    { id: 'long-title', name: 'Champions Cup — a long title in a narrow bar', start: now - DAY, end: now + 2.5 * DAY },
  ]);
  await expect(page.locator('[data-timeline-event-row]')).toHaveCount(4);
  // Two instances that do not overlap are packed onto one row, but stay two bars.
  const rowOf = (id: string) =>
    page.locator(`[data-event-id="${id}"]`).evaluate((node) => {
      const row = node.closest('.tl-row')!;
      return [...row.parentElement!.children].indexOf(row);
    });
  expect(await rowOf('old-cycle')).toBe(await rowOf('new-cycle'));
  await expect(page.locator('[data-event-id="clipped-title"]')).toHaveAttribute('data-cut-end', 'true');
  for (const id of ['clipped-title', 'long-title']) {
    const bar = page.locator(`[data-event-id="${id}"]`);
    await expect(bar.locator('[data-event-title]')).toBeVisible();
    const fits = await bar.evaluate((node) => {
      const title = node.querySelector('[data-event-title]')!.getBoundingClientRect();
      const bounds = node.getBoundingClientRect();
      // A countdown with no room is left to screen readers and drawn nowhere.
      const countdown = [...node.querySelectorAll('[data-event-countdown]')]
        .map((item) => item.getBoundingClientRect())
        .find((box) => box.width > 1);
      return (
        title.left >= bounds.left - 0.5 &&
        title.right <= bounds.right + 0.5 &&
        (!countdown || title.right <= countdown.left + 0.5)
      );
    });
    expect(fits).toBe(true);
    expect(await bar.locator('[data-event-title]').evaluate((node) => getComputedStyle(node).textOverflow)).toBe(
      'ellipsis',
    );
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('timeline-regressions.png') });
});

test('today is raised in the ruler, the now line runs through it, and Today brings it back', async ({ page }) => {
  const now = Date.now();
  await load(page, 'Today marker', [
    { id: 'crossing-a', name: 'Marker crossing', type: 'cycle', start: now - 3 * DAY, end: now + 9 * DAY },
    { id: 'crossing-b', name: 'Second crossing', start: now - DAY, end: now + 14 * DAY },
  ]);
  const today = page.locator('[data-timeline-tick][data-today]');
  const line = page.locator('[data-timeline-now]');
  await expect(today).toHaveCount(1);
  await expect(line).toBeVisible();
  const day = (await today.boundingBox())!;
  const now1 = (await line.boundingBox())!;
  expect(now1.x + now1.width / 2).toBeGreaterThanOrEqual(day.x - 1);
  expect(now1.x + now1.width / 2).toBeLessThanOrEqual(day.x + day.width + 1);

  // Ticks never overlap each other or leave the scale.
  const geometry = await page.locator('[data-timeline-scale]').evaluate((scale) => {
    const box = scale.getBoundingClientRect();
    const ticks = [...scale.querySelectorAll('[data-timeline-tick]')].map((tick) => tick.getBoundingClientRect());
    return { left: box.left, right: box.right, ticks: ticks.map((r) => ({ left: r.left, right: r.right })) };
  });
  expect(geometry.ticks[0]!.left).toBeGreaterThanOrEqual(geometry.left - 0.5);
  expect(geometry.ticks.at(-1)!.right).toBeLessThanOrEqual(geometry.right + 0.5);
  for (let index = 1; index < geometry.ticks.length; index++) {
    expect(geometry.ticks[index - 1]!.right).toBeLessThanOrEqual(geometry.ticks[index]!.left + 0.5);
  }

  await page.getByRole('button', { name: 'Later week', exact: true }).click();
  await page.getByRole('button', { name: 'Later week', exact: true }).click();
  await expect(line).toHaveCount(0);
  await page.getByRole('button', { name: 'Show today', exact: true }).click();
  await expect(line).toBeVisible();
  await expect(today).toHaveCount(1);
});

test('a bar is ticked done from the keyboard and fades in place', async ({ page }, info) => {
  test.skip(
    info.project.name === 'android-s23' || (page.viewportSize()?.width ?? 0) < 768,
    'Phones tick from the quick view',
  );
  const now = Date.now();
  await load(page, 'Tick test', [{ id: 'tick-me', name: 'Login gift', start: now - DAY, end: now + 4 * DAY }]);
  const open = page.getByRole('button', { name: 'Open Tick test event: Login gift', exact: true });
  await open.focus();
  await page.keyboard.press('Tab');
  const tick = page.getByRole('button', { name: 'Mark Login gift done', exact: true });
  await expect(tick).toBeFocused();
  expect(await tick.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  await page.keyboard.press('Enter');
  const bar = page.locator('[data-event-id="tick-me"]');
  await expect(bar).toHaveAttribute('data-done', 'true');
  await expect(bar.locator('[data-event-title]')).toHaveCSS('text-decoration-line', 'line-through');
  await expect(bar.locator('[data-event-countdown]')).toHaveText('done');
  await page.getByRole('button', { name: 'Restore Login gift', exact: true }).click();
  await expect(bar).not.toHaveAttribute('data-done');
});
