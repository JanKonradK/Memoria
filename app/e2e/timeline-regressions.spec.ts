import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';

test('separate cycles stay separate and clipped titles stay clear of countdowns', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const now = Date.now();
  const day = 86_400_000;
  const game = makeGame({ name: 'Timeline regression', updatedAt: now });
  const state = {
    ...emptyState(),
    games: [game],
    events: [
      { id: 'old-cycle', name: 'Stygian Onslaught', type: 'cycle', start: now - 12 * day, end: now + 2 * day },
      { id: 'new-cycle', name: 'Stygian Onslaught', type: 'cycle', start: now + 13 * day, end: now + 25 * day },
      {
        id: 'clipped-title',
        name: 'Bonus Star Pieces — Champions Cup',
        type: 'event',
        start: now + 26.5 * day,
        end: now + 29 * day,
      },
      {
        id: 'long-title',
        name: 'Champions Cup — a long title in a narrow bar',
        type: 'event',
        start: now + 18 * day,
        end: now + 30 * day,
      },
    ].map((event) => ({ ...event, gameId: game.id, dailyTouch: false, notify: true, notes: '', updatedAt: now })),
  };
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'timeline.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('[data-timeline-event-row]')).toHaveCount(4);
  await expect(page.locator('[data-cycle-connectors] path')).toHaveCount(0);
  for (const id of ['clipped-title', 'long-title']) {
    const row = page.locator(`[data-event-id="${id}"]`);
    await expect(row.locator('[data-event-title]')).toBeVisible();
    await expect
      .poll(async () =>
        row.evaluate((node) => {
          const title = node.querySelector('[data-event-title]')!.getBoundingClientRect();
          const controls = node.querySelector('[data-event-countdown]')!.getBoundingClientRect();
          const bounds = node.getBoundingClientRect();
          const bar = node.querySelector('[data-event-bar]')!.getBoundingClientRect();
          return (
            bar.right <= bounds.right + 1 &&
            title.left >= bounds.left &&
            title.right <= bounds.right + 1 &&
            (title.right <= controls.left + 1 || title.left >= controls.right - 1)
          );
        }),
      )
      .toBe(true);
    const truncation = await row.locator('[data-event-title]').evaluate((node) => getComputedStyle(node).textOverflow);
    expect(truncation).toBe('ellipsis');
  }
  await page.screenshot({ path: info.outputPath('timeline-regressions.png') });
});
