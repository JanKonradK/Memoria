import { expect, test, type Page } from '@playwright/test';
import { openSettings } from './support';

/** A Windows host whose reminder preference the page can read back. */
async function withPcBridge(page: Page) {
  await page.addInitScript(() => {
    const preferences = {
      openAtLogin: true,
      closeToTray: true,
      gameStartNotices: true,
      remindersOnPc: true,
      canStartWithWindows: true,
      gameWatch: true,
    };
    window.memoriaDesktop = {
      version: 1,
      onCloseRequested: () => () => {},
      completeClose: () => {},
      presence: {
        get: async () => ({ ...preferences }),
        set: async (changes) => {
          Object.assign(preferences, changes);
          return { ...preferences };
        },
        watch: async () => true,
        notify: async () => true,
        onChanged: () => () => {},
        onGameStarted: () => () => {},
        onOpenGame: () => () => {},
      },
    };
  });
}

test('first run on the PC offers reminders before creating the dashboard', async ({ page }) => {
  await withPcBridge(page);
  await page.addInitScript(() => localStorage.removeItem('memoria-onboarding'));
  await page.goto('/');
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: /^Next/ }).click();
  await page.getByRole('button', { name: 'Add a Genshin Impact account on Europe' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Remind me before I lose something' })).toBeVisible();
  // Quiet hours start off, so a 02:00 reminder before a 03:00 reset is not held back.
  const quiet = page.getByRole('switch', { name: 'Quiet hours' });
  await expect(quiet).not.toBeChecked();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('dialog', { name: 'Pages' })).toBeVisible();
  expect(await page.evaluate(async () => (await window.memoriaDesktop!.presence!.get()).remindersOnPc)).toBe(false);
});

test('quiet hours are off by default and move reminders rather than drop them', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await openSettings(page, 'General');
  const quiet = page.getByRole('switch', { name: 'Quiet hours' });
  await expect(quiet).not.toBeChecked();
  await expect(page.getByText('Off. Reminders arrive at any hour')).toBeVisible();
  await quiet.click();
  await expect(quiet).toBeChecked();
  await page.getByLabel('Quiet hours start').fill('01:00');
  await expect(page.getByText('arrive at 00:59 instead. None are dropped.')).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { flushPersist } = await import(path);
    await flushPersist();
  });
  await page.reload();
  await openSettings(page, 'General');
  await expect(page.getByRole('switch', { name: 'Quiet hours' })).toBeChecked();
  await expect(page.getByLabel('Quiet hours start')).toHaveValue('01:00');
});
