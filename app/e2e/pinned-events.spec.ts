import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
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
  const trackOf = (id: string) =>
    page
      .locator(`[data-event-id="${id}"] .timeline-event-track`)
      .evaluate((node) => getComputedStyle(node).backgroundColor);
  const pinnedTrack = await trackOf('pinned-event');
  const plainTrack = await trackOf('plain-event');
  expect(pinnedTrack).not.toBe('transparent');
  expect(pinnedTrack).not.toBe('rgba(0, 0, 0, 0)');
  expect(pinnedTrack).not.toBe(plainTrack);
  // Scan the settled lanes, not a frame of their entrance animation.
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('pinned-events-timeline.png') });

  await page.getByRole('radiogroup', { name: 'Event view' }).getByRole('radio', { name: 'List', exact: true }).click();
  await expect(page.locator('[data-list-event="pinned-event"]')).toHaveAttribute('data-pinned', 'true');
  await expect(page.locator('[data-list-event="plain-event"]')).not.toHaveAttribute('data-pinned');

  await page.getByRole('button', { name: 'Pin Strip game event: Pinned strip event', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Pinned events' })).toHaveCount(0);
  await expect(page.locator('[data-list-event="pinned-event"]')).not.toHaveAttribute('data-pinned');
});
