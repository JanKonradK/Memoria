import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';

test('24 events fit in a single desktop viewport with controls in the app bar', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Measured at a 1365 × 768 CSS viewport, including zoom-sized layouts');
  await page.setViewportSize({ width: 1365, height: 768 });
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
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
    end: now + 23 * day,
  });
  Object.assign(state.events[2]!, { name: 'Spiral Abyss', type: 'cycle', start: now + 5 * day, end: now + 35 * day });
  Object.assign(state.events[3]!, {
    name: 'Imaginarium Theater',
    type: 'cycle',
    start: now + 23 * day,
    end: now + 53 * day,
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
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'density.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('header').getByRole('combobox', { name: 'Focus game' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Event', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-timeline-event-row]')).toHaveCount(24);
  await page.waitForTimeout(350);
  const bounds = await page.locator('[data-timeline-event-row]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    }),
  );
  expect(bounds[0]!.top).toBeGreaterThan(50);
  expect(bounds.at(-1)!.bottom).toBeLessThanOrEqual(768);
  expect(bounds.every((row) => row.height >= 26 && row.height <= 27)).toBe(true);
  const board = await page
    .locator('.timeline-board')
    .evaluate((node) => ({ height: node.clientHeight, scroll: node.scrollHeight }));
  expect(board.scroll).toBeLessThanOrEqual(board.height);
  const ids = await page
    .locator('[data-timeline-event-row]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-event-id')));
  expect(ids.indexOf('density-2')).toBe(ids.indexOf('density-0') + 1);
  expect(ids.indexOf('density-3')).toBe(ids.indexOf('density-1') + 1);
  const future = page.locator('[data-event-id="density-3"]');
  await expect(future.locator('[data-event-bar]')).toHaveText('Imaginarium Theater');
  const bar = await future.locator('[data-event-bar]').boundingBox();
  const countdown = await future.locator('[data-event-countdown]').boundingBox();
  expect(countdown!.x + countdown!.width).toBeLessThan(bar!.x);
  for (const id of ['density-22', 'density-23']) {
    await expect(page.locator(`[data-event-id="${id}"] [data-event-bar]`)).toHaveText('');
  }
  await page.screenshot({ path: info.outputPath('24-visible-rows.png') });
});

test('the tour highlights live controls, walks pages, and finishes only once', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-390'].includes(info.project.name), 'Tour keyboard and phone flow');
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Your daily run starts here' })).toBeVisible();
  await expect(page.locator('[data-tour-highlight]')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Build your roster' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Your daily run starts here' })).toBeVisible();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Make yourself at home' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
  await expect(page.locator('[data-tour="settings"]')).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: info.outputPath('spotlight-guide.png') });
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add your first game' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'User guide', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Your daily run starts here' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
});
