import { expect, test } from '@playwright/test';
import { openSettings } from './support';

test('PC reminders use the native preference bridge and show the two-device hint', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('memoria-onboarding', 'complete');
    const preferences = {
      openAtLogin: true,
      closeToTray: true,
      gameStartNotices: true,
      remindersOnPc: localStorage.getItem('test-native-reminders') === 'true',
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
          localStorage.setItem('test-native-reminders', String(preferences.remindersOnPc));
          return { ...preferences };
        },
        watch: async () => true,
        notify: async () => true,
        onChanged: (listener) => {
          const changed = () => {
            preferences.remindersOnPc = false;
            listener({ ...preferences });
          };
          window.addEventListener('test-tray-reminders-off', changed);
          return () => window.removeEventListener('test-tray-reminders-off', changed);
        },
        onGameStarted: () => () => {},
        onOpenGame: () => () => {},
      },
    };
  });
  await page.goto('/');
  await openSettings(page, 'On this PC');
  const toggle = page.getByRole('switch', { name: 'Reminders on this PC', exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText('If phone reminders are also on, both devices will alert.')).toBeVisible();
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(await page.evaluate(async () => (await window.memoriaDesktop!.presence!.get()).remindersOnPc)).toBe(true);
  await page.reload();
  await openSettings(page, 'On this PC');
  await expect(toggle).toBeChecked();
  // Tray changes reach the same Settings control through the existing event bridge.
  await page.evaluate(() => window.dispatchEvent(new Event('test-tray-reminders-off')));
  await expect(toggle).not.toBeChecked();
});
