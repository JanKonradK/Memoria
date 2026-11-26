import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openSettings, showTodayGames } from './support';
import { emptyState, PRESETS } from '@memoria/shared';
import { makeGame, makeResource, makeSnapshot, makeTask } from '../../shared/test/helpers';

test('Today fits more games and keeps compact summaries readable and actionable', async ({ page }, info) => {
  const now = Date.parse('2026-10-03T16:00:00Z');
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  const presets = ['uma', 'nikke', 'nte', 'genshin', 'hsr', 'zzz', 'wuwa', 'lads', 'endfield'].map((key) =>
    PRESETS.find((preset) => preset.key === key)!,
  );
  const state = emptyState();
  state.games = presets.map((preset, index) =>
    makeGame({
      ...preset,
      id: `game-${preset.key}`,
      presetKey: preset.key,
      sort: index,
      accountLabel: ['Main', '', 'Satoru Gojo', 'Technoplane!!', 'Mai', 'Mai', 'Mai', 'Main', 'Main'][index],
      updatedAt: now,
    }),
  );
  state.resources = presets.flatMap((preset) =>
    preset.resources.map((resource, index) =>
      makeResource({
        ...resource,
        id: `resource-${preset.key}-${index}`,
        gameId: `game-${preset.key}`,
        sort: index,
        updatedAt: now,
      }),
    ),
  );
  state.snapshots = state.resources.map((resource) =>
    makeSnapshot({
      id: `snapshot-${resource.id}`,
      resourceId: resource.id,
      value: Math.floor(resource.cap * 0.8),
      takenAt: now,
    }),
  );
  state.tasks = presets.flatMap((preset) =>
    preset.tasks.map((task, index) =>
      makeTask({
        ...task,
        id: `task-${preset.key}-${index}`,
        gameId: `game-${preset.key}`,
        presetTaskKey: task.key,
        sort: index,
        updatedAt: now,
      }),
    ),
  );
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await openSettings(page, 'Data');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'roster.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await showTodayGames(page);
  const cards = page.locator('[data-roster-game]');
  await expect(cards).toHaveCount(presets.length);
  await expect(page.getByText('Your daily check-in', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toHaveCount(1);
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    await page.screenshot({ path: info.outputPath(`compact-roster-${theme}.png`) });
    const geometry = await cards.evaluateAll((nodes) => {
      const headerBottom = document.querySelector('header')!.getBoundingClientRect().bottom;
      // Nothing sits along the bottom: the rail is across the top or down the side.
      const boundary = innerHeight;
      const rects = nodes.map((node) => node.getBoundingClientRect());
      return {
        visible: rects.filter((rect) => rect.top >= headerBottom && rect.bottom <= boundary + 1).length,
        smallestTarget: Math.min(...rects.map((rect) => rect.height)),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    await info.attach(`roster-geometry-${theme}`, { body: JSON.stringify(geometry), contentType: 'application/json' });
    expect(geometry.overflow).toBe(false);
    expect(geometry.smallestTarget).toBeGreaterThanOrEqual(44);
    if (page.viewportSize()!.height >= 720) {
      const { width, height } = page.viewportSize()!;
      // The narrowest phone wraps long names onto two lines, so a row is taller there.
      expect(geometry.visible).toBeGreaterThanOrEqual(width < 360 ? 3 : width < 768 && height < 900 ? 4 : 5);
    }
    // The rail's game buttons fail label-content-name-mismatch; the rail owns that fix.
    expect(
      (await new AxeBuilder({ page }).exclude('.rail-game').analyze()).violations.filter((issue) =>
        ['serious', 'critical'].includes(issue.impact ?? ''),
      ),
    ).toEqual([]);
  }
  const trigger = cards.first();
  const game = (await trigger.getAttribute('data-roster-game'))!;
  // The row opens the game's page at every width.
  await trigger.press('Enter');
  await expect(page.locator('.focus-workspace')).toBeVisible();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.locator(`[data-roster-game="${game}"]`)).toBeFocused();
  if (page.viewportSize()!.width < 1280) {
    // Scope large-text verification to the changed summary component.
    // Its rows can grow; density is a default-size target.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await expect
      .poll(() =>
        cards.evaluateAll((nodes) =>
          nodes.every((node) => {
            const rect = node.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth + 1;
          }),
        ),
      )
      .toBe(true);
    await page.screenshot({ path: info.outputPath('compact-roster-large-text.png') });
  }
});
