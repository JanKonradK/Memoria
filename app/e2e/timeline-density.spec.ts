import { expect, test } from '@playwright/test';
import { openSettings } from './support';
import { emptyState } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';

test('24 events remain reachable in the packed timeline with controls in the Calendar bar', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Measured at a 1365 × 768 CSS viewport, including zoom-sized layouts');
  await page.setViewportSize({ width: 1365, height: 768 });
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const now = Date.now();
  const day = 86_400_000;
  const game = makeGame({ name: 'Density test', updatedAt: now });
  const state = {
    ...emptyState(),
    games: [game],
    events: Array.from({ length: 24 }, (_, i) => ({
      id: `density-${i}`,
      gameId: game.id,
      name: `Event ${String(i + 1).padStart(2, '0')}`,
      type: 'event',
      start: now - (i % 8) * day,
      end: now + (i + 1) * day,
      dailyTouch: false,
      notify: true,
      notes: '',
      updatedAt: now,
    })),
  };
  Object.assign(state.events[0]!, { name: 'Spiral Abyss', type: 'cycle', start: now - 10 * day, end: now + 5 * day });
  Object.assign(state.events[1]!, {
    name: 'Imaginarium Theater',
    type: 'cycle',
    start: now - 7 * day,
    end: now + 19.5 * day,
  });
  Object.assign(state.events[2]!, { name: 'Spiral Abyss', type: 'cycle', start: now + 5 * day, end: now + 35 * day });
  Object.assign(state.events[3]!, {
    name: 'Imaginarium Theater',
    type: 'cycle',
    // Inside the three weeks ahead, but clipped by the window's right edge.
    start: now + 19.5 * day,
    end: now + 49.5 * day,
  });
  Object.assign(state.events[22]!, {
    name: 'Special Program',
    type: 'livestream',
    start: now + 4 * day,
    end: now + 4 * day + 3_600_000,
  });
  Object.assign(state.events[23]!, {
    name: 'Update maintenance',
    type: 'maintenance',
    start: now + 15 * day,
    end: now + 15 * day + 6 * 3_600_000,
  });
  await openSettings(page, 'Data');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'density.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  // The page's own bar holds its controls: views, the game filter, the range, Today, finished events and Add.
  const bar = page.locator('.calendar-bar');
  await expect(bar.getByRole('radiogroup', { name: 'Event view' })).toBeVisible();
  // One game needs no game filter.
  await expect(bar.getByRole('group', { name: 'Games shown' })).toHaveCount(0);
  await expect(bar.getByRole('group', { name: 'Range' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Show today', exact: true })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Show finished events', exact: true })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Add an event', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Event', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-timeline-event-row]')).toHaveCount(24);
  await page.waitForTimeout(350);
  const bars = page.locator('.tl-bar');
  const bounds = await bars.evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return { top: r.top, height: r.height };
    }),
  );
  expect(bounds[0]!.top).toBeGreaterThan(50);
  // Every bar keeps one height, tall enough for its name and countdown.
  expect(new Set(bounds.map((row) => Math.round(row.height))).size).toBe(1);
  expect(bounds[0]!.height).toBeGreaterThanOrEqual(24);
  // The page is the only scroller: the board never grows a scrollbar of its own.
  const board = page.locator('.timeline-board');
  expect(await board.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
  for (const row of await page.locator('[data-timeline-event-row]').all()) {
    await row.scrollIntoViewIfNeeded();
    const box = (await row.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(768);
  }
  // Events that do not overlap are packed into shared rows, so 22 bars need fewer rows.
  const rows = await bars.evaluateAll((nodes) => new Set(nodes.map((node) => node.closest('.tl-row'))).size);
  expect(rows).toBeLessThan(22);
  // In the default four weeks, a cycle running past the range is cut with a dashed end, its name still on the bar.
  await expect(page.locator('[data-event-id="density-3"]')).toHaveAttribute('data-cut-end', 'true');
  await expect(page.locator('[data-event-id="density-3"] [data-event-title]')).toHaveText('Imaginarium Theater');
  // A livestream is a diamond and maintenance a band: neither draws text on its mark.
  for (const id of ['density-22', 'density-23']) {
    await expect(page.locator(`[data-event-id="${id}"] [data-event-bar]`)).toHaveText('');
  }
  await page.screenshot({ path: info.outputPath('24-reachable-rows.png') });
});

test('first-run hints appear in place, once, and can be shown again', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-390'].includes(info.project.name), 'First-run hints at desktop and phone sizes');
  await page.goto('/');
  // Skipping setup opens no tour: the app is shown as it is.
  await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Calendar', exact: true })
    .click();
  const hint = page.locator('[data-hint="events"]');
  await expect(hint).toContainText('Events live here');
  await page.screenshot({ path: info.outputPath('events-hint.png') });
  await hint.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(hint).toHaveCount(0);
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Calendar', exact: true })
    .click();
  await expect(page.getByRole('radiogroup', { name: 'Event view' })).toBeVisible();
  await expect(hint).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Show hints again', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Calendar', exact: true })
    .click();
  await expect(hint).toBeVisible();
});
