import { expect, test, type Page } from '@playwright/test';
import { emptyState, PRESETS } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';
import { openGame, openSettings } from './support';

const zzz = PRESETS.find((preset) => preset.key === 'zzz')!;

async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<import('@memoria/shared').AppState>((resolve, reject) => {
        const request = indexedDB.open('keyval-store');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const get = request.result.transaction('keyval').objectStore('keyval').get('memoria-state');
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        };
      }),
  );
}

test('a game page lays out livestreams and notes, tracking, and events side by side', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-390'].includes(info.project.name), 'One wide and one phone layout');
  const now = Date.parse('2026-11-05T12:00:00Z');
  await page.clock.setFixedTime(new Date(now));
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Add a game', exact: true }).click();
  await page.getByRole('button', { name: /Zenless Zone Zero/ }).click();
  await page.getByRole('button', { name: 'Add ZZZ', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  // A legacy game saved before preset keys existed gets its artwork and face back on load.
  const legacy = makeGame({
    id: 'legacy',
    name: 'Honkai: Star Rail',
    short: 'HSR',
    presetKey: undefined,
    updatedAt: now,
  });
  await openSettings(page, 'Data');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'legacy.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...emptyState(), games: [legacy] })),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await openGame(page, zzz.name);

  const context = page.getByRole('complementary', { name: `${zzz.name} livestreams and notes` });
  await expect(context.getByRole('region', { name: 'Last livestream' })).toBeVisible();
  await expect(context.getByRole('region', { name: 'Next livestream' })).toBeVisible();
  const notes = context.getByRole('textbox', { name: 'Notes' });
  await notes.fill('Save pulls for Severian.');
  await notes.blur();
  await expect
    .poll(async () => (await stored(page)).games.find((game) => game.name === zzz.name)?.notes)
    .toBe('Save pulls for Severian.');
  // The legacy game now carries its preset, so its logo can draw the artwork.
  expect((await stored(page)).games.find((game) => game.id === 'legacy')?.presetKey).toBe('hsr');

  const track = (await page.locator('.focus-track').boundingBox())!;
  const side = (await page.locator('.focus-context').boundingBox())!;
  const events = (await page.locator('.focus-events').boundingBox())!;
  if (info.project.name === 'desktop') {
    expect(side.x + side.width).toBeLessThanOrEqual(track.x + 1);
    expect(track.x + track.width).toBeLessThanOrEqual(events.x + 1);
  } else {
    expect(track.y).toBeLessThan(side.y);
    expect(side.y).toBeLessThan(events.y);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('game-page.png') });
});
