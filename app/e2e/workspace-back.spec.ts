import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23', 'mobile-320'].includes(info.project.name), 'Workspace return sizes');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Add your first game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Genshin Impact controls', exact: true }).click();
  await expect(page.locator('.focus-workspace')).toBeVisible();
});

test('Alt+Left returns to the game card and keeps a typed energy value', async ({ page }) => {
  const energy = page.getByLabel('Original Resin current value', { exact: true });
  await energy.fill('99');
  await page.keyboard.press('Alt+ArrowLeft');
  const card = page.getByRole('button', { name: 'Open Genshin Impact controls', exact: true });
  await expect(card).toBeFocused();
  await card.click();
  await expect(energy).toHaveValue('99');
  await energy.fill('12');
  await energy.press('Escape');
  await expect(energy).toHaveValue('99');
  await expect(page.locator('.focus-workspace')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(card).toBeFocused();
});

test('browser Back and Forward use the same workspace and focus path as the arrow', async ({ page }) => {
  const card = page.getByRole('button', { name: 'Open Genshin Impact controls', exact: true });
  await page.goBack();
  await expect(card).toBeFocused();
  await page.goForward();
  const back = page.getByRole('button', { name: 'Back to dashboard', exact: true });
  await expect(back).toBeFocused();
  await expect(back).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft');
  await back.click();
  await expect(card).toBeFocused();
  await page.goForward();
  await expect(back).toBeFocused();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(card).toBeFocused();
});

test('Alt+Left from a move handle returns without changing the item order', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit Genshin Impact', exact: true }).last().click();
  const grid = page.locator('.game-widget-grid');
  const order = () =>
    grid
      .locator(':scope > [data-layout-item]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-layout-item')));
  const original = await order();
  await page.getByRole('button', { name: 'Move Original Resin', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowLeft');
  const card = page.getByRole('button', { name: 'Open Genshin Impact controls', exact: true });
  await expect(card).toBeFocused();
  await card.click();
  await page.getByRole('button', { name: 'Edit Genshin Impact', exact: true }).last().click();
  expect(await order()).toEqual(original);
});

test('returning dismisses an event first and preserves a rejected dirty draft', async ({ page }) => {
  const gameId = await page.evaluate(() => history.state.memoriaWorkspace as string);
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
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
  await expect(page.getByRole('button', { name: 'Open Genshin Impact controls', exact: true })).toBeFocused();
});
