import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';

test('agenda keeps full titles, dates and actions usable at every width', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const now = Date.now();
  const day = 86_400_000;
  const game = makeGame({ name: 'Agenda test', updatedAt: now });
  const titles = [
    'Clink, Clank, Pinball Knight!',
    'All-New Program — 7-day login',
    'Angels Support Operation',
    'New Eridu City Fund',
    'A long event name that should wrap and keep its edit control available',
  ];
  const state = {
    ...emptyState(),
    games: [game],
    events: Array.from({ length: 12 }, (_, i) => ({
      id: `agenda-${i}`,
      gameId: game.id,
      name: titles[i % titles.length],
      type: 'event',
      start: now + (i < 6 ? -day : i * day),
      end: now + (i + 1) * day,
      dailyTouch: false,
      notify: true,
      notes: '',
      updatedAt: now,
    })),
  };
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'agenda.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Event view' }).getByRole('radio', { name: 'List', exact: true }).click();
  await expect(page.locator('[data-list-event]')).toHaveCount(12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const row = page.locator('[data-list-event="agenda-0"]');
  await expect(row.getByRole('button', { name: /^Edit/ })).toBeVisible();
  await expect(row.getByRole('checkbox')).toBeVisible();
  const boxes = await row.evaluate((node) =>
    [...node.children].map((child) => {
      const b = child.getBoundingClientRect();
      return { x: b.x, right: b.right, y: b.y, bottom: b.bottom };
    }),
  );
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      expect(
        Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1,
      ).toBe(false);
    }
  await page.screenshot({ path: info.outputPath('agenda.png') });
  await row.getByRole('button', { name: /^Edit/ }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(titles[0]!);
});
