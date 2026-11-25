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

test('a game page lays out energy and tasks beside events, with codes and notes on their own tabs', async ({
  page,
}, info) => {
  test.skip(!['desktop', 'mobile-390'].includes(info.project.name), 'One wide and one phone layout');
  const now = Date.parse('2026-11-05T12:00:00Z');
  await page.clock.setFixedTime(new Date(now));
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Add a game', exact: true }).click();
  await page.getByRole('button', { name: /Zenless Zone Zero/ }).click();
  // No server is chosen for you: pick the game's first one.
  await page.getByRole('combobox', { name: 'Server' }).click();
  await page.getByRole('option').nth(1).click();
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

  // Livestreams live in the News tab and notes in their own, not beside the tracking.
  await expect(page.getByRole('region', { name: 'Last livestream' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: `${zzz.name} notes` })).toHaveCount(0);

  const track = (await page.locator('.focus-track').boundingBox())!;
  const tasks = (await page.locator('.game-track-tasks').boundingBox())!;
  const events = (await page.locator('.focus-events').boundingBox())!;
  if (info.project.name === 'desktop') {
    // Energy above tasks on the left; both strictly left of events.
    expect(track.y).toBeLessThan(tasks.y);
    expect(track.x + track.width).toBeLessThanOrEqual(events.x + 1);
    expect(tasks.x + tasks.width).toBeLessThanOrEqual(events.x + 1);
  } else {
    // One column: energy, then tasks, then events.
    expect(track.y).toBeLessThan(tasks.y);
    expect(tasks.y).toBeLessThan(events.y);
  }

  await page.getByRole('tab', { name: /^Codes/ }).click();
  await expect(page.getByRole('button', { name: `Add codes for ${zzz.name}`, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Track', exact: true }).click();

  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Save pulls for Severian.');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('list', { name: `${zzz.name} notes` })).toContainText('Save pulls for Severian.');
  await expect
    .poll(async () => {
      const state = await stored(page);
      const game = state.games.find((item) => item.name === zzz.name);
      return state.notes?.some((note) => note.gameId === game?.id && note.body === 'Save pulls for Severian.');
    })
    .toBe(true);
  // The legacy game now carries its preset, so its logo can draw the artwork.
  expect((await stored(page)).games.find((game) => game.id === 'legacy')?.presetKey).toBe('hsr');

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('game-page.png') });
});
