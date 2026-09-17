import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { emptyState } from '@memoria/shared';
import { makeGame, makeEvent } from '../../shared/test/helpers';

test('MW uses an inline tag and owner tag changes persist', async ({ page }) => {
  const now = Date.parse('2026-09-17T12:00:00Z');
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const game = makeGame({ name: 'Genshin category test', presetKey: 'genshin', updatedAt: now });
  const state = {
    ...emptyState(),
    games: [game],
    events: [
      makeEvent({
        id: 'teyvat-test',
        gameId: game.id,
        name: 'Teyvat test',
        type: 'event',
        start: now - 1000,
        end: now + 86400000,
        updatedAt: now,
      }),
      makeEvent({
        id: 'mw-test',
        gameId: game.id,
        name: 'Miliastra test',
        type: 'event',
        category: 'miliastra',
        start: now - 1000,
        end: now + 86400000,
        updatedAt: now,
      }),
      makeEvent({
        id: 'shared-test',
        gameId: game.id,
        name: 'Shared maintenance',
        type: 'maintenance',
        start: now + 1000,
        end: now + 3600000,
        updatedAt: now,
      }),
    ],
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: 'categories.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('[data-event-id="teyvat-test"] [data-event-tag]')).toHaveCount(0);
  await expect(page.locator('[data-event-id="mw-test"] [data-event-tag]')).toHaveText('MW');
  await expect(page.locator('[data-event-category]')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Open Genshin category test event: Miliastra test', exact: true }).click();
  await page.getByRole('combobox', { name: 'Genshin world' }).click();
  await page.getByRole('option', { name: 'Teyvat', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-event-id="mw-test"] [data-event-tag]')).toHaveCount(0);
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('[data-event-id="mw-test"] [data-event-tag]')).toHaveCount(0);
});
