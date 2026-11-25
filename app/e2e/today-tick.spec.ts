import { expect, test } from '@playwright/test';
import { addFromShell, showTodayGames } from './support';

test('tapping a game on Today opens it without ticking; its card ticks all dailies, with Undo', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await addFromShell(page, 'Add game');
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('combobox', { name: 'Server' }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await showTodayGames(page);
  // The row has no tick of its own any more: a tap anywhere on it selects or opens the game.
  await expect(page.getByRole('button', { name: 'Tick all Genshin Impact dailies' })).toHaveCount(0);
  await page.locator('[data-roster-game]').first().click();
  const tick = page.getByRole('button', { name: 'Tick all dailies for Genshin Impact' });
  await expect(tick).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo completing dailies for Genshin Impact' })).toHaveCount(0);
  await tick.click();
  const undo = page.getByRole('button', { name: 'Undo completing dailies for Genshin Impact' });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(tick).toBeVisible();
});

test('with every daily done and nothing capping before the reset, Today says all clear', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-390'].includes(info.project.name), 'All clear at desktop and phone sizes');
  await page.clock.setFixedTime(new Date('2026-11-13T12:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await addFromShell(page, 'Add game');
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('combobox', { name: 'Server' }).click();
  await page.getByRole('option', { name: /^Europe/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await showTodayGames(page);
  const clear = page.locator('[data-all-clear]');
  const mobile = info.project.name !== 'desktop';
  if (mobile) await page.getByRole('button', { name: 'Open Genshin Impact', exact: true }).click();
  await page.getByRole('button', { name: 'Tick all dailies for Genshin Impact' }).click();
  // Tick all also collects and resends the expeditions.
  await expect(
    page.getByRole('button', { name: 'Expeditions (collect + resend): collected — resend again now' }),
  ).toBeVisible();
  // A starting estimate may cap overnight; an empty bar takes over a day to fill.
  const resin = page.getByLabel('Original Resin current value');
  await resin.fill('0');
  await resin.press('Enter');
  if (mobile) {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  }
  await expect(clear.getByRole('heading')).toHaveText(/^All clear until (\w{3} )?\d\d:\d\d$/);
  if (info.project.name === 'mobile-390') {
    await expect(page.getByRole('list', { name: 'Games' })).toBeHidden();
    await clear.getByRole('button', { name: /Show games/ }).click();
    await expect(page.getByRole('list', { name: 'Games' })).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath('all-clear.png') });
});
