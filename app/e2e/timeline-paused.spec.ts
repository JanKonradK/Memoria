import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeEvent, makeGame } from '../../shared/test/helpers';

async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<import('@memoria/shared').AppState>((resolve, reject) => {
        const request = indexedDB.open('keyval-store');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const document = db.transaction('keyval').objectStore('keyval').get('memoria-state');
          document.onsuccess = () => {
            resolve(document.result);
            db.close();
          };
          document.onerror = () => {
            reject(document.error);
            db.close();
          };
        };
      }),
  );
}

test('paused accounts stay compact in both views and resume their saved events', async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23', 'mobile-320'].includes(info.project.name), 'Timeline and editing sizes');
  const now = Date.parse('2026-10-03T12:00:00Z');
  const day = 86_400_000;
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  const main = makeGame({ id: 'main', name: 'Shared game', accountLabel: 'Main', updatedAt: now });
  const alt = makeGame({ ...main, id: 'alt', accountLabel: 'Alt', tz: 'Etc/GMT-8', paused: true, sort: 1 });
  const long = makeGame({
    id: 'long',
    name: 'The Long Road: Chronicle of the Falling Stars',
    accountLabel: 'Evening account with a long nickname',
    paused: true,
    sort: 2,
    updatedAt: now,
  });
  const state = {
    ...emptyState(),
    games: [main, alt, long],
    events: [
      makeEvent({
        id: 'main-event',
        gameId: main.id,
        name: 'Main account event',
        start: now - day,
        end: now + day,
        updatedAt: now,
      }),
      makeEvent({
        id: 'alt-live',
        gameId: alt.id,
        name: 'Alt active event',
        start: now - day,
        end: now + day,
        updatedAt: now,
      }),
      makeEvent({
        id: 'alt-next',
        gameId: alt.id,
        name: 'Alt upcoming event',
        start: now + day,
        end: now + 2 * day,
        updatedAt: now,
      }),
      makeEvent({
        id: 'alt-done',
        gameId: alt.id,
        name: 'Alt finished event',
        done: true,
        start: now - day,
        end: now + day,
        updatedAt: now,
      }),
    ],
  };
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'paused.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  const view = page.getByRole('radiogroup', { name: 'Event view' });
  const altRows = page.locator('[data-event-id^="alt-"], [data-list-event^="alt-"]');
  const altPause = page.locator('[data-paused-game="alt"]');
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
    for (const mode of ['Timeline', 'List']) {
      await view.getByRole('radio', { name: mode, exact: true }).click();
      await expect(altPause).toBeVisible();
      await expect(altRows).toHaveCount(0);
      await expect(page.locator('.timeline-caption')).toContainText('1 event');
      if (mode === 'Timeline') {
        await expect(page.locator('[data-event-id="main-event"]')).toBeInViewport();
      }
      const row = await altPause.boundingBox();
      expect(row!.height).toBeLessThanOrEqual(88);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().iterations)))
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      await page.screenshot({ path: info.outputPath(`paused-${mode.toLowerCase()}-${theme}.png`) });
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
          ['serious', 'critical'].includes(issue.impact ?? ''),
        ),
      ).toEqual([]);
    }
  }
  await page.getByRole('button', { name: 'Show finished events' }).click();
  await expect(altRows).toHaveCount(0);
  await page.getByRole('button', { name: 'Find events', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search events', exact: true }).fill('Alt');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.timeline-caption')).toContainText('0 events');
  await expect(altRows).toHaveCount(0);
  await altPause.getByRole('button', { name: 'Resume tracking for Shared game, Alt, ASIA', exact: true }).click();
  await expect(altRows).toHaveCount(3);
  await expect(page.locator('.timeline-caption')).toContainText('3 events');
  await expect(
    page.getByRole('button', { name: 'Edit Shared game (Alt) event: Alt active event', exact: true }),
  ).toBeFocused();
  await expect(page.locator('[data-paused-game="long"]')).toBeVisible();
  await expect.poll(async () => (await stored(page)).games.find((game) => game.id === alt.id)?.paused).toBe(false);
  expect((await stored(page)).events.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    [...state.events].sort((a, b) => a.id.localeCompare(b.id)),
  );
  await page.reload();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await view.getByRole('radio', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('[data-event-id^="alt-"]')).toHaveCount(2);
  await expect(page.locator('[data-paused-game="alt"]')).toHaveCount(0);
});
