import { expect, test } from '@playwright/test';
import { openSettings, calendarAxe } from './support';
import { emptyState } from '@memoria/shared';
import { makeEvent, makeGame } from '../../shared/test/helpers';

test('a pinned event stands out on the calendar in both views and in its strip', async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23'].includes(info.project.name), 'Desktop lanes and phone list');
  const now = Date.now();
  const day = 86_400_000;
  const game = makeGame({ id: 'strip-game', name: 'Strip game', updatedAt: now });
  const state = {
    ...emptyState(),
    games: [game],
    events: [
      makeEvent({
        id: 'pinned-event',
        gameId: game.id,
        name: 'Pinned strip event',
        type: 'event',
        pinned: true,
        start: now - 2 * day,
        end: now + 20 * day,
        updatedAt: now,
      }),
      makeEvent({
        id: 'plain-event',
        gameId: game.id,
        name: 'Plain strip event',
        type: 'event',
        start: now - 2 * day,
        end: now + 20 * day,
        updatedAt: now,
      }),
    ],
  };
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await openSettings(page, 'Data');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'pinned-events.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();

  const strip = page.getByRole('region', { name: 'Pinned events' });
  await expect(strip.getByRole('button')).toHaveCount(1);
  await expect(strip.getByRole('button')).toContainText('Pinned strip event');

  await page
    .getByRole('radiogroup', { name: 'Event view' })
    .getByRole('radio', { name: 'Timeline', exact: true })
    .click();
  await expect(page.locator('[data-event-id="pinned-event"] [data-event-bar]')).toHaveAttribute('data-pinned', 'true');
  // The pinned bar wears the gold rim; its neighbour keeps its game's ink.
  const rimOf = (id: string) =>
    page.locator(`[data-event-id="${id}"] [data-event-bar]`).evaluate((node) => getComputedStyle(node).borderTopColor);
  const pinnedRim = await rimOf('pinned-event');
  expect(pinnedRim).not.toBe('rgba(0, 0, 0, 0)');
  expect(pinnedRim).not.toBe(await rimOf('plain-event'));
  // Scan the settled lanes, not a frame of their entrance animation.
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await calendarAxe(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath('pinned-events-timeline.png') });

  await page
    .getByRole('radiogroup', { name: 'Event view' })
    .getByRole('radio', { name: 'Agenda', exact: true })
    .click();
  await expect(page.locator('[data-list-event="pinned-event"]')).toHaveAttribute('data-pinned', 'true');
  await expect(page.locator('[data-list-event="plain-event"]')).not.toHaveAttribute('data-pinned');

  // A row opens the quick view, where the pin is turned off.
  await page.locator('[data-list-event="pinned-event"] .cal-row-main').click();
  const peek = page.getByRole('dialog', { name: 'Pinned strip event' });
  await peek.getByRole('button', { name: 'Pinned', exact: true }).click();
  await expect(peek.getByRole('button', { name: 'Pin', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Pinned events' })).toHaveCount(0);
  await expect(page.locator('[data-list-event="pinned-event"]')).not.toHaveAttribute('data-pinned');
});
