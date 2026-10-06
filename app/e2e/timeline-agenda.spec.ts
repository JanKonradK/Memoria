import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';

test('agenda keeps full titles, actions and route-return choices usable at every width', async ({ page }, info) => {
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
  await expect(page.getByRole('button', { name: 'Find events', exact: true })).toHaveText('Find');
  await expect(page.getByRole('button', { name: 'Show finished events', exact: true })).toHaveText('Finished');
  for (const name of ['Find events', 'Show finished events']) {
    const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    if (page.viewportSize()!.width < 768) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const row = page.locator('[data-list-event="agenda-0"]');
  await expect(row.getByRole('button', { name: /^Edit/ })).toBeVisible();
  await expect(row.getByRole('checkbox')).toBeVisible();
  await expect(row.locator('time')).toHaveCount(2);
  await expect(row.getByText('Starts', { exact: true })).toBeVisible();
  await expect(row.getByText('Ends', { exact: true })).toBeVisible();
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
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const phone = page.viewportSize()!.width < 768;
  const scrollPosition = await page.evaluate((onPhone) => {
    if (onPhone) {
      window.scrollTo({ top: 320, behavior: 'instant' });
      return window.scrollY;
    }
    const board = document.querySelector<HTMLElement>('.timeline-board')!;
    board.scrollTop = 320;
    return board.scrollTop;
  }, phone);
  expect(scrollPosition).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        (onPhone) => (onPhone ? window.scrollY : document.querySelector<HTMLElement>('.timeline-board')!.scrollTop),
        phone,
      ),
    )
    .toBeCloseTo(scrollPosition, 0);

  // Use a non-default view so returning to the route cannot pass by resetting
  // to its device default. Filters should travel with that choice too.
  const chosenView = phone ? 'Timeline' : 'List';
  const viewControls = page.getByRole('radiogroup', { name: 'Event view' });
  await viewControls.getByRole('radio', { name: chosenView, exact: true }).click();
  await page.getByRole('button', { name: 'Show finished events', exact: true }).click();
  await page.getByRole('button', { name: 'Find events', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search events' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Search events' }).fill('No matching event');
  await page.getByRole('dialog', { name: 'Find events' }).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Find events', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(viewControls.getByRole('radio', { name: chosenView, exact: true })).toHaveAttribute('data-state', 'on');
  await expect(page.getByRole('button', { name: 'Show finished events', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Clear event search', exact: true })).toContainText(
    'No matching event',
  );
  await viewControls.getByRole('radio', { name: 'List', exact: true }).click();
  await expect(
    page.getByText('No events match “No matching event”. Clear the search to see all events.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear event search', exact: true }).click();
  await expect(page.locator('[data-list-event]')).toHaveCount(12);
});
