import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';
import { planSeedImport } from '../src/data/seed-events';

test('event handles reorder with mouse, touch, and keyboard and persist across reload', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const now = Date.now();
  const game = makeGame({ name: 'Ordering', updatedAt: now });
  const state = {
    ...emptyState(),
    games: [game],
    events: ['First', 'Second', 'Third'].map((name, index) => ({
      id: name,
      gameId: game.id,
      name,
      type: 'event',
      start: now - 1000,
      end: now + (index + 1) * 86400000,
      dailyTouch: false,
      notify: true,
      notes: '',
      updatedAt: now,
    })),
  };
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'order.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  const order = () =>
    page
      .locator('[data-timeline-event-row]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-event-id')));
  await expect.poll(order).toEqual(['First', 'Second', 'Third']);
  const first = await page.getByRole('button', { name: 'Reorder First', exact: true }).boundingBox();
  const third = await page.getByRole('button', { name: 'Reorder Third', exact: true }).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(third!.x + third!.width / 2, third!.y + third!.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(order).toEqual(['Second', 'Third', 'First']);
  await page.getByRole('button', { name: 'Reorder First', exact: true }).press('ArrowUp');
  await expect.poll(order).toEqual(['Second', 'First', 'Third']);
  await expect(page.getByRole('button', { name: 'Reorder First', exact: true })).toBeFocused();
  // Chromium's real touch input exercises capture and touch-action, unlike synthetic pointer events.
  const cdp = await context.newCDPSession(page);
  const start = await page.getByRole('button', { name: 'Reorder Third', exact: true }).boundingBox();
  const end = await page.getByRole('button', { name: 'Reorder Second', exact: true }).boundingBox();
  const x = start!.x + start!.width / 2;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: start!.y + start!.height / 2 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: end!.y + end!.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(order).toEqual(['Third', 'Second', 'First']);
  await expect(page.getByRole('button', { name: 'Reset automatic order' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Third moved to position 1 of 3.' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        return await new Promise<number | undefined>((resolve, reject) => {
          const open = indexedDB.open('keyval-store');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const read = db.transaction('keyval').objectStore('keyval').get('memoria-state');
            read.onsuccess = () => {
              resolve(read.result?.events.find((event: { id: string }) => event.id === 'Third')?.sort);
              db.close();
            };
            read.onerror = () => {
              reject(read.error);
              db.close();
            };
          };
        });
      }),
    )
    .toBe(0);
  await page.reload();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect.poll(order).toEqual(['Third', 'Second', 'First']);
  await page.getByRole('button', { name: 'Mark Third done', exact: true }).click();
  await expect.poll(order).toEqual(['Second', 'First']);
  await page.getByRole('button', { name: 'Open Ordering event: First', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reset automatic order' }).click();
  await expect.poll(order).toEqual(['First', 'Second']);
});

test('seeded Genshin events reorder across MW and Teyvat and stay after a scrolled drag and reload', async ({
  page,
}, info) => {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  const now = Date.now();
  const game = makeGame({ name: 'Genshin Impact', short: 'GI', presetKey: 'genshin', updatedAt: now });
  const state = { ...emptyState(), games: [game] };
  state.events = planSeedImport(state, now)
    .filter((item) => item.kind === 'add')
    .map((item, index) => ({
      id: `seed-${index}`,
      gameId: game.id,
      name: item.seed!.name,
      type: item.seed!.type,
      category: item.seed!.category,
      start: item.start!,
      end: item.end!,
      dailyTouch: item.seed!.dailyTouch ?? false,
      notify: item.seed!.notify ?? true,
      notes: item.seed!.notes ?? '',
      sourceKey: item.seed!.sourceKey,
      seedHash: item.hash,
      updatedAt: now,
    }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'seeds.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  const rows = page.locator('[data-timeline-event-row]');
  const order = () => rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-event-id')));
  await expect.poll(async () => (await order()).length).toBeGreaterThan(10);
  await page.screenshot({ path: info.outputPath('seeded-tags.png'), fullPage: true });
  const original = await order();
  const draggedId = [...original]
    .reverse()
    .find((id) => state.events.find((event) => event.id === id)?.category !== 'miliastra')!;
  expect(draggedId).toBeTruthy();
  expect(
    original
      .slice(0, original.indexOf(draggedId))
      .some((id) => state.events.find((event) => event.id === id)?.category === 'miliastra'),
  ).toBe(true);
  const handle = page.locator(`[data-event-id="${draggedId}"] button[aria-label^="Reorder "]`);
  await handle.scrollIntoViewIfNeeded();
  const start = (await handle.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  // Scroll the actual app scroll container while the pointer remains captured.
  await rows.first().evaluate((row) => {
    for (let ancestor = row.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.scrollHeight > ancestor.clientHeight && /auto|scroll/.test(getComputedStyle(ancestor).overflowY))
        ancestor.scrollTop = 0;
    }
  });
  const first = (await rows.first().boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, first.y + first.height / 2, { steps: 20 });
  await page.mouse.up();
  const expected = [draggedId, ...original.filter((id) => id !== draggedId)];
  await expect.poll(order).toEqual(expected);
  await expect(page.getByRole('status').filter({ hasText: /moved to position 1 of/ })).toBeVisible();
  // Switch views before reloading so this checks committed state, not the drag preview.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect.poll(order).toEqual(expected);
  await page.reload();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect.poll(order).toEqual(expected);
});
