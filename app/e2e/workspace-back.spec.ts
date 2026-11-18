import { expect, test } from '@playwright/test';
import { gameRow, openGame, addFromShell } from './support';

test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23', 'mobile-320'].includes(info.project.name), 'Workspace return sizes');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Add a game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  // No server is chosen for you: pick the game's first one.
  await page.getByRole('combobox', { name: 'Server' }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openGame(page, 'Genshin Impact');
  await expect(page.locator('.focus-workspace')).toBeVisible();
});

test('Alt+Left returns to the game card and keeps a typed energy value', async ({ page }) => {
  const energy = page.getByLabel('Original Resin current value', { exact: true });
  await energy.fill('99');
  await page.keyboard.press('Alt+ArrowLeft');
  const card = gameRow(page, 'Genshin Impact');
  await expect(card).toBeFocused();
  await openGame(page, 'Genshin Impact');
  await expect(energy).toHaveValue('99');
  await energy.fill('12');
  await energy.press('Escape');
  await expect(energy).toHaveValue('99');
  await expect(page.locator('.focus-workspace')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(card).toBeFocused();
});

test('browser Back and Forward use the same workspace and focus path as the arrow', async ({ page }) => {
  const card = gameRow(page, 'Genshin Impact');
  await page.goBack();
  await expect(card).toBeFocused();
  await page.goForward();
  const back = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true });
  await expect(back).toBeFocused();
  await expect(back).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft');
  await back.click();
  await expect(card).toBeFocused();
  await page.goForward();
  await expect(back).toBeFocused();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(card).toBeFocused();
});

test('returning dismisses an event first and preserves a rejected dirty draft', async ({ page }) => {
  const gameId = await page.evaluate(() => history.state.memoriaWorkspace as string);
  await addFromShell(page, 'Event');
  const editor = page.getByRole('dialog', { name: 'New event', exact: true });
  await editor.getByLabel('Name', { exact: true }).fill('Keep my event draft');
  let discard = false;
  page.on('dialog', (dialog) => (discard ? dialog.accept() : dialog.dismiss()));
  await page.goBack();
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Keep my event draft');
  await expect.poll(() => page.evaluate(() => history.state.memoriaWorkspace)).toBe(gameId);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Keep my event draft');
  discard = true;
  await page.goBack();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.focus-workspace')).toBeVisible();
  await expect.poll(() => page.evaluate(() => history.state.memoriaWorkspace)).toBe(gameId);
  await page.goBack();
  await expect(gameRow(page, 'Genshin Impact')).toBeFocused();
});
