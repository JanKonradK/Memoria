import { expect, test } from '@playwright/test';

test('a game starting on the PC checks in two minutes later with dailies and energy', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('memoria-onboarding', 'complete');
    const started = new Set<(gameId: string) => void>();
    window.addEventListener('test-game-started', (event) => {
      for (const listener of started) listener((event as CustomEvent<string>).detail);
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
        onGameStarted: (listener: (gameId: string) => void) => {
          started.add(listener);
          return () => started.delete(listener);
        },
        onGameStopped: () => () => {},
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
  // Two minutes in the app; a second here.
  await page.evaluate(async () => {
    const path = '/src/presence.ts';
    const { checkInTiming } = await import(path);
    checkInTiming.delayMs = 1_000;
  });
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent('test-game-started', { detail: id })), gameId);
  const sheet = page.getByRole('dialog', { name: 'Genshin Impact check-in' });
  await expect(sheet).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Original Resin now').fill('12');
  await sheet.getByLabel('Already done them').check();
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
