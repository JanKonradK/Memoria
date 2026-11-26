import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeGame, makeEvent } from '../../shared/test/helpers';
import { editFromQuickView, openSettings, calendarAxe, showTimeline } from './support';

test('banner tags distinguish rewards across games and can be edited', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const now = Date.now();
  const games = ['genshin', 'wuwa', 'hsr'].map((presetKey) => makeGame({ id: presetKey, name: presetKey, presetKey }));
  const events = games.flatMap((game) =>
    (['character', 'weapon'] as const).map((bannerKind) =>
      makeEvent({
        id: `${game.id}-${bannerKind}`,
        gameId: game.id,
        name: `${bannerKind} test`,
        type: 'banner',
        bannerKind,
        start: now - 86400000 * 20,
        end: now + 86400000 * 35,
      }),
    ),
  );
  await openSettings(page, 'Data');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'tags.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...emptyState(), games, events })),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await showTimeline(page);
  // Narrow timeline bars omit tags to keep the event name readable.
  const compact = (page.viewportSize()?.width ?? 0) <= 320;
  if (compact) await page.getByRole('radio', { name: 'Agenda', exact: true }).click();
  const rowAttribute = compact ? 'data-list-event' : 'data-event-id';
  for (const event of events) {
    await expect(page.locator(`[${rowAttribute}="${event.id}"] [data-event-tag]`)).toHaveText(
      event.bannerKind === 'character' ? 'Character' : 'Weapon',
    );
  }
  await page.screenshot({ path: info.outputPath('banner-tags.png') });
  expect(await calendarAxe(page, { all: true })).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A bar or an agenda row opens the quick view; its Edit button opens the editor.
  if (compact) await page.locator('[data-list-event="genshin-character"] .cal-row-main').click();
  else await page.getByRole('button', { name: 'Open genshin event: character test', exact: true }).click();
  await editFromQuickView(page);
  await page.getByRole('combobox', { name: 'Banner tag', exact: true }).click();
  await page.getByRole('option', { name: 'Weapon banner', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator(`[${rowAttribute}="genshin-character"] [data-event-tag]`)).toHaveText('Weapon');
  await page.getByRole('radio', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('[data-list-event="genshin-character"] [data-event-tag]')).toHaveText('Weapon');
});
