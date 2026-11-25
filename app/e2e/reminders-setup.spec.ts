import { expect, test, type Page } from '@playwright/test';
import { closeGuide, openSettings } from './support';

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
  // Looks wait for Settings: setup goes straight on to reminders.
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Remind me before I lose something' })).toBeVisible();
  // Quiet hours start off, so a 02:00 reminder before a 03:00 reset is not held back.
  const quiet = page.getByRole('switch', { name: 'Quiet hours' });
  await expect(quiet).not.toBeChecked();
  await page.getByRole('button', { name: 'Not now' }).click();
  // Setup ends on Today, under the guide.
  await closeGuide(page);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await window.memoriaDesktop!.presence!.get()).remindersOnPc)).toBe(false);
});

test('quiet hours are off by default and move reminders rather than drop them', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await openSettings(page, 'Reminders');
  const quiet = page.getByRole('switch', { name: 'Quiet hours' });
  await expect(quiet).not.toBeChecked();
  await expect(page.getByText('Off: reminders arrive at any hour.')).toBeVisible();
  await quiet.click();
  await expect(quiet).toBeChecked();
  await page.getByLabel('Quiet hours start').fill('01:00');
  await expect(page.getByText('arrive at 00:59 instead.', { exact: false })).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { flushPersist } = await import(path);
    await flushPersist();
  });
  await page.reload();
  await openSettings(page, 'Reminders');
  await expect(page.getByRole('switch', { name: 'Quiet hours' })).toBeChecked();
  await expect(page.getByLabel('Quiet hours start')).toHaveValue('01:00');
});

test('no-alarm times can be added, edited and kept, on every screen size', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await openSettings(page, 'Reminders');
  await page.getByRole('button', { name: 'Add a no-alarm time' }).click();
  // The first suggestion is a weekday working day.
  const work = page.getByRole('list', { name: 'No-alarm times' }).getByRole('listitem').first();
  await expect(work.getByLabel('Name of Work')).toHaveValue('Work');
  await expect(work.getByLabel('Work starts')).toHaveValue('09:00');
  const days = work.getByRole('group', { name: 'Days for Work' });
  await expect(days.getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'true');
  await expect(days.getByRole('button', { name: 'Saturday' })).toHaveAttribute('aria-pressed', 'false');
  await work.getByLabel('Work ends').fill('18:30');
  await days.getByRole('button', { name: 'Saturday' }).click();
  await expect(days.getByRole('button', { name: 'Saturday' })).toHaveAttribute('aria-pressed', 'true');
  // The next suggestion is sleep, every night.
  await page.getByRole('button', { name: 'Add a no-alarm time' }).click();
  await expect(page.getByLabel('Name of Sleep')).toHaveValue('Sleep');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { flushPersist } = await import(path);
    await flushPersist();
  });
  await page.reload();
  await openSettings(page, 'Reminders');
  await expect(page.getByLabel('Work ends')).toHaveValue('18:30');
  await expect(
    page.getByRole('group', { name: 'Days for Work' }).getByRole('button', { name: 'Saturday' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Delete Sleep' }).click();
  await page.getByRole('button', { name: 'Confirm delete Sleep' }).click();
  await expect(page.getByLabel('Name of Sleep')).toHaveCount(0);
});
