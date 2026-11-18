import { expect, test } from '@playwright/test';

test('a game starting on the PC opens its page, brings the reading forward and nudges a minute in', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('memoria-onboarding', 'complete');
    (window as unknown as { notices: unknown[] }).notices = [];
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
        notify: async (notice: { title: string; body: string }) => {
          (window as unknown as { notices: unknown[] }).notices.push(notice);
          return true;
        },
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
  // A minute in the app; a second here.
  await page.evaluate(async () => {
    const path = '/src/presence.ts';
    const { nudgeTiming } = await import(path);
    nudgeTiming.delayMs = 1_000;
  });
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent('test-game-started', { detail: id })), gameId);
  // No pop-up: the game's page comes forward with the reading as its question.
  await expect(page.locator('.focus-workspace')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const reading = page.locator('[data-energy-row][data-need="value"]');
  await expect(reading).toBeVisible();
  await expect(reading).not.toHaveAttribute('data-pulse');
  // Still owed a minute in: one notice, and the reading pulses.
  await expect(reading).toHaveAttribute('data-pulse', 'true');
  const notices = await page.evaluate(
    () => (window as unknown as { notices: { title: string; body: string }[] }).notices,
  );
  expect(notices).toEqual([
    { gameId, title: 'Genshin Impact', body: expect.stringMatching(/^Original Resin\? · \d+ dailies left$/) },
  ]);
  const field = page.getByLabel('Original Resin current value');
  await field.fill('12');
  await field.press('Enter');
  // The reading is in, so the dailies come forward.
  await expect(page.locator('[data-session-need="dailies"]')).toBeVisible();
  await expect(page.locator('[data-energy-row][data-need]')).toHaveCount(0);
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
