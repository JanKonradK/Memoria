import { expect, test } from '@playwright/test';
import { openGame, openSettings, gameRow } from './support';

test('Activity undoes dailies, keeps a later note and restores a deleted game', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openGame(page, 'Genshin Impact');
  await page.getByRole('button', { name: 'Complete dailies', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo dailies', exact: true })).toBeVisible();
  // A second independent edit must survive undo of the earlier bulk action.
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { useApp } = await import(path);
    useApp.getState().updateGame(useApp.getState().state.games[0].id, { notes: 'Keep my later note' });
  });
  await openSettings(page, 'Activity');
  const action = page.getByRole('group', { name: 'Complete dailies: Genshin Impact', exact: true });
  await action.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(action.getByRole('button', { name: 'Undone' })).toBeDisabled();
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { useApp, flushPersist } = await import(path);
    const state = useApp.getState().state;
    if (state.games[0].notes !== 'Keep my later note') throw new Error('Lost later note');
    if (state.completions.some((row: { done: boolean; deleted?: boolean }) => row.done && !row.deleted))
      throw new Error('Dailies still done');
    useApp.getState().deleteGame(state.games[0].id);
    await flushPersist();
  });
  const deletion = page.getByRole('group', { name: 'Delete: Genshin Impact', exact: true });
  await deletion.getByRole('button', { name: 'Restore this item', exact: true }).click();
  await expect(deletion.getByRole('button', { name: 'Undone' })).toBeDisabled();
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { flushPersist } = await import(path);
    await flushPersist();
  });
  await page.reload();
  await openSettings(page, 'Activity');
  await expect(
    page.getByRole('group', { name: 'Delete: Genshin Impact', exact: true }).getByRole('button', { name: 'Undone' }),
  ).toBeDisabled();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await expect(gameRow(page, 'Genshin Impact')).toBeVisible();
  await openGame(page, 'Genshin Impact');
  await expect(page.getByRole('button', { name: 'Complete dailies', exact: true })).toBeVisible();
  await expect(page.getByText('Keep my later note')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});
