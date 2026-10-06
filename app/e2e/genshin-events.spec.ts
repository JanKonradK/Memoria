import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeGame, makeEvent } from '../../shared/test/helpers';

test('Genshin keeps complete Teyvat, Wonderland and banner groups through editing', async ({ page }, info) => {
  const now = Date.now();
  const game = makeGame({ name: 'Genshin Impact', presetKey: 'genshin', updatedAt: now });
  const events = [
    ...Array.from({ length: 6 }, (_, index) =>
      makeEvent({
        id: `teyvat-${index}`,
        gameId: game.id,
        name: `Personal Teyvat ${index}`,
        type: 'event',
        start: now - 60_000,
        end: now + 86_400_000,
        updatedAt: now,
      }),
    ),
    makeEvent({
      id: 'mw',
      gameId: game.id,
      name: 'Personal Wonderland',
      type: 'event',
      category: 'miliastra',
      start: now - 60_000,
      end: now + 86_400_000,
      updatedAt: now,
    }),
    makeEvent({
      id: 'draw',
      gameId: game.id,
      name: 'Personal cosmetic draw',
      type: 'banner',
      category: 'miliastra',
      bannerKind: 'other',
      start: now - 60_000,
      end: now + 86_400_000,
      updatedAt: now,
    }),
  ];
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'genshin-groups.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...emptyState(), games: [game], events })),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Open Genshin Impact controls', exact: true }).click();
  const teyvat = page.getByRole('region', { name: 'Teyvat events for Genshin Impact', exact: true });
  const mw = page.getByRole('region', { name: 'Miliastra Wonderland events for Genshin Impact', exact: true });
  const banners = page.getByRole('region', { name: 'Banners events for Genshin Impact', exact: true });
  const groups = page.locator('section[aria-label$="events for Genshin Impact"]');
  await expect(groups).toHaveCount(3);
  expect(await groups.evaluateAll((sections) => sections.map((section) => section.getAttribute('aria-label')))).toEqual(
    [
      'Teyvat events for Genshin Impact',
      'Miliastra Wonderland events for Genshin Impact',
      'Banners events for Genshin Impact',
    ],
  );
  await expect(teyvat.getByRole('button', { name: /Personal Teyvat/ })).toHaveCount(6);
  await expect(mw.getByRole('button', { name: /Personal Wonderland/ })).toBeVisible();
  await expect(banners.getByRole('button', { name: /Personal cosmetic draw/ })).toBeVisible();
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
    await page.evaluate(async () => {
      await document.fonts.ready;
      const finite = document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime));
      await Promise.all(finite.map((animation) => animation.finished.catch(() => {})));
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
        ['serious', 'critical'].includes(issue.impact ?? ''),
      ),
    ).toEqual([]);
    await teyvat.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`genshin-teyvat-${theme}.png`) });
    await banners.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`genshin-banners-${theme}.png`) });
  }
  await banners.getByRole('button', { name: /Personal cosmetic draw/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit event' });
  await expect(dialog.getByRole('combobox', { name: 'Genshin world' })).toContainText('Miliastra Wonderland');
  await dialog.getByRole('combobox', { name: 'Type', exact: true }).click();
  await page.getByRole('option', { name: 'event', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(mw.getByRole('button', { name: /Personal cosmetic draw/ })).toBeVisible();
  await expect(banners.getByRole('button', { name: /Personal cosmetic draw/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage events', exact: true }).click();
  const manager = page.getByRole('region', { name: 'Events for Genshin Impact', exact: true });
  await manager.getByRole('searchbox', { name: 'Find event' }).fill('Personal cosmetic');
  await expect(manager.getByRole('heading', { level: 4 })).toHaveText('Miliastra Wonderland');
  await manager.getByRole('button', { name: 'Edit Genshin Impact event: Personal cosmetic draw', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Type', exact: true })).toContainText('event');
});
