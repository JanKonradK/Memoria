import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { emptyState } from '@memoria/shared';
import { makeGame, makeResource, makeSnapshot } from '../../shared/test/helpers';

async function importRoster(page: Page) {
  const state = emptyState();
  state.games = Array.from({ length: 9 }, (_, index) =>
    makeGame({
      id: `adaptive-${index}`,
      name: index === 0 ? 'Genshin Impact' : `Game ${index + 1}`,
      presetKey: index === 0 ? 'genshin' : undefined,
      accountLabel: index === 0 ? 'LongAccountName'.repeat(5) : 'Main',
      sort: index,
    }),
  );
  state.resources = state.games.map((game) =>
    makeResource({ id: `energy-${game.id}`, gameId: game.id, name: 'Energy', cap: 200 }),
  );
  state.snapshots = state.resources.map((resource) =>
    makeSnapshot({ id: `snapshot-${resource.id}`, resourceId: resource.id, value: 200, takenAt: Date.now() }),
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'responsive-roster.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
}

test('Today and game controls adapt while a PC window is resized', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'One resize journey covers phone, snapped PC, short PC and 4K widths');
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem('memoria-onboarding', 'complete');
    localStorage.setItem('memoria-preset-gap-dismissed', '999');
    localStorage.setItem('memoria-legacy-home-timezone-dismissed', '1');
  });
  await page.goto('/');
  await importRoster(page);
  const primary = page.getByRole('navigation', { name: 'Primary', exact: true });
  await primary.getByRole('button', { name: 'Today', exact: true }).click();

  for (const viewport of [
    { width: 360, height: 740 },
    { width: 640, height: 500 },
    { width: 768, height: 600 },
    { width: 960, height: 650 },
    { width: 1280, height: 500 },
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.today-priority-row')).toHaveCount(9);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const geometry = await page.evaluate(() => {
      const bounds = document.querySelector('.today-page')!.getBoundingClientRect();
      const buttons = [...document.querySelectorAll<HTMLElement>('header button')].filter(
        (button) => button.offsetHeight > 0,
      );
      const rows = [...document.querySelectorAll('.today-priority-row')].map((row) => row.getBoundingClientRect());
      return {
        pageWidth: bounds.width,
        controlsFit: buttons.every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight;
        }),
        priorityColumns: new Set(rows.map((row) => Math.round(row.left))).size,
        rowsInside: rows.every((row) => row.left >= 0 && row.right <= innerWidth + 1),
      };
    });
    expect(geometry.pageWidth).toBe(viewport.width);
    expect(geometry.controlsFit).toBe(true);
    // One ranked column at every width, so fill levels and countdowns compare down the list.
    expect(geometry.priorityColumns).toBe(1);
    expect(geometry.rowsInside).toBe(true);
    await expect(page.locator('.today-detail')).toBeVisible({ visible: viewport.width >= 900 });
    await page.screenshot({ path: info.outputPath(`today-${viewport.width}.png`) });
  }

  // A snapped PC window keeps Tonight under the list, and a game's page keeps a typed value while it resizes.
  await page.setViewportSize({ width: 960, height: 650 });
  await expect(page.getByRole('region', { name: 'Across every game', exact: true })).toBeVisible();
  await page.locator('[data-roster-game="adaptive-0"]').click();
  await page.getByRole('button', { name: 'Open full page' }).click();
  const energy = page.getByLabel('Energy current value', { exact: true });
  await energy.fill('83');
  await page.setViewportSize({ width: 360, height: 600 });
  await expect(energy).toHaveValue('83');
  await energy.press('Enter');
  await page.getByRole('button', { name: 'Edit Genshin Impact', exact: true }).click();
  await page.getByRole('button', { name: 'Game settings', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 400 });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const done = dialog.getByRole('button', { name: 'Done', exact: true });
  await expect(done).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  await done.click();
  await page
    .getByRole('region', { name: 'Layout editor for Genshin Impact' })
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await expect(energy).toHaveValue('83');
});
