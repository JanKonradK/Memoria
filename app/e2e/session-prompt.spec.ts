import { expect, test } from '@playwright/test';

test('a game closing on the PC offers to record its energy and dailies', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('memoria-onboarding', 'complete');
    const stopped = new Set<(gameId: string) => void>();
    window.addEventListener('test-game-stopped', (event) => {
      for (const listener of stopped) listener((event as CustomEvent<string>).detail);
    });
    window.memoriaDesktop = {
      version: 1,
      onCloseRequested: () => () => {},
      completeClose: () => {},
      presence: {
        get: async () => ({
          openAtLogin: true,
          closeToTray: true,
          gameStartNotices: true,
          remindersOnPc: true,
          canStartWithWindows: true,
          gameWatch: true,
        }),
        set: async () => ({
          openAtLogin: true,
          closeToTray: true,
          gameStartNotices: true,
          remindersOnPc: true,
          canStartWithWindows: true,
          gameWatch: true,
        }),
        watch: async () => true,
        notify: async () => true,
        onChanged: () => () => {},
        onGameStarted: () => () => {},
        onGameStopped: (listener: (gameId: string) => void) => {
          stopped.add(listener);
          return () => stopped.delete(listener);
        },
        onOpenGame: () => () => {},
      },
    };
  });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Add a game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('combobox', { name: 'Server' }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const gameId = await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { useApp } = await import(path);
    return useApp.getState().state.games[0].id as string;
  });
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent('test-game-stopped', { detail: id })), gameId);
  const sheet = page.getByRole('dialog', { name: 'Genshin Impact closed' });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Original Resin now').fill('12');
  await sheet.getByLabel('Dailies done').check();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Genshin Impact/ }).first()).toBeVisible();
  const recorded = await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { useApp } = await import(path);
    const { state } = useApp.getState();
    return state.snapshots
      .filter((item: { provenance?: { kind: string } }) => item.provenance?.kind !== 'estimate')
      .map((item: { value: number }) => item.value);
  });
  expect(recorded).toContain(12);
});
