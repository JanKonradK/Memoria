import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openSettings } from './support';

/** Memoria's Select is a listbox behind a combobox button. */
async function choose(
  page: import('@playwright/test').Page,
  scope: import('@playwright/test').Locator,
  label: string,
  option: RegExp,
) {
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option }).click();
}

/** A Windows app stand-in whose toast permission and test calls the page can read back. */
function installDesktop(page: import('@playwright/test').Page, windows: string, remindersOnPc: boolean) {
  return page.addInitScript(
    ({ windows, remindersOnPc }) => {
      localStorage.setItem('memoria-onboarding', 'complete');
      const preferences = {
        openAtLogin: true,
        closeToTray: true,
        gameStartNotices: true,
        remindersOnPc,
        canStartWithWindows: true,
        gameWatch: true,
      };
      const calls: string[] = [];
      (window as unknown as { testCalls: string[] }).testCalls = calls;
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
          notificationStatus: async () => ({ windows: windows as 'enabled' }),
          testNotification: async (style: string, tone: string) => {
            calls.push(`test:${style}:${tone}`);
            return { windows: windows as 'enabled' };
          },
          openNotificationSettings: async () => {
            calls.push('settings');
          },
          onChanged: () => () => {},
          onGameStarted: () => () => {},
          onOpenGame: () => () => {},
        },
      };
    },
    { windows, remindersOnPc },
  );
}

test('Today asks to turn PC reminders on, once, and remembers Not now', async ({ page }) => {
  await installDesktop(page, 'enabled', false);
  await page.goto('/');
  const prompt = page.getByRole('region', { name: 'Reminders' });
  await expect(prompt.getByText('Reminders are off on this PC')).toBeVisible();
  await prompt.getByRole('button', { name: 'Turn on' }).click();
  await expect(prompt).toHaveCount(0);
  expect(await page.evaluate(async () => (await window.memoriaDesktop!.presence!.get()).remindersOnPc)).toBe(true);
});

test('Today says when Windows hides Memoria’s toasts and opens the right settings page', async ({ page }) => {
  await installDesktop(page, 'app', true);
  await page.goto('/');
  const prompt = page.getByRole('region', { name: 'Reminders' });
  await expect(prompt.getByText('Windows is hiding Memoria’s reminders')).toBeVisible();
  await prompt.getByRole('button', { name: 'Open Windows settings' }).click();
  expect(await page.evaluate(() => (window as unknown as { testCalls: string[] }).testCalls)).toContain('settings');
  await prompt.getByRole('button', { name: 'Not now: reminders' }).click();
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { flushPersist } = await import(path);
    await flushPersist();
  });
  await page.reload();
  await expect(page.getByText('Windows is hiding Memoria’s reminders')).toHaveCount(0);
});

test('each kind of reminder has a style, alarms have a ring, and Test sends a sample', async ({ page }) => {
  await installDesktop(page, 'enabled', true);
  await page.goto('/');
  await openSettings(page, 'Reminders');
  const daily = page.getByRole('combobox', { name: 'Dailies before reset style', exact: true });
  await expect(daily).toContainText('Standard');
  await expect(page.getByRole('combobox', { name: 'Energy capping style', exact: true })).toContainText('Gentle');
  await choose(page, page.locator('body'), 'Dailies before reset style', /^Alarm$/);
  await choose(page, page.locator('body'), 'Alarm ring', /^Chime$/);
  await page.getByRole('button', { name: 'Test Dailies before reset style' }).click();
  await expect(page.getByText('Sent a test in the Alarm style.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { testCalls: string[] }).testCalls)).toContain(
    'test:alarm:chime',
  );

  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { flushPersist } = await import(path);
    await flushPersist();
  });
  await page.reload();
  await openSettings(page, 'Reminders');
  await expect(page.getByRole('combobox', { name: 'Dailies before reset style', exact: true })).toContainText('Alarm');

  const results = await new AxeBuilder({ page }).include('.settings-rows').analyze();
  expect(results.violations).toEqual([]);
});

test('a reminder can ring as an alarm on its own', async ({ page }) => {
  await installDesktop(page, 'enabled', true);
  await page.goto('/');
  await openSettings(page, 'Reminders');
  await page.getByRole('button', { name: 'New reminder' }).click();
  const sheet = page.getByRole('dialog', { name: 'New reminder' });
  await sheet.getByLabel('Message').fill('Spend Trailblaze Power');
  await choose(page, sheet, 'Arrives as', /^Alarm:/);
  await sheet.getByRole('button', { name: 'Add reminder' }).click();
  await expect(page.getByText('Spend Trailblaze Power')).toBeVisible();
  await expect(page.getByText(/Alarm/).first()).toBeVisible();
});
