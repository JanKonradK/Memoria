import { expect, test, type Page } from '@playwright/test';
import { PRESETS, serversFor } from '@memoria/shared';

/** Two games added straight through the store, then the app reloaded. */
async function seed(page: Page, before?: () => void) {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  if (before) await page.addInitScript(before);
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('nav[aria-label="Primary"]'));
  const list = ['genshin', 'zzz'].map((key) => {
    const preset = PRESETS.find((item) => item.key === key)!;
    const server = serversFor(key)[0];
    return { preset, pick: server ? { server: server.id, tz: server.tz } : { tz: preset.tz } };
  });
  await page.evaluate(async (entries) => {
    const { useApp, flushPersist } = await import(/* @vite-ignore */ '/src/store.ts');
    for (const { preset, pick } of entries) useApp.getState().addGameFromPreset(preset, pick);
    await flushPersist();
  }, list);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('nav[aria-label="Primary"]'));
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Primary' });

test('a game’s old notes become a note of their own', async ({ page }) => {
  await seed(page);
  await nav(page).getByRole('button', { name: 'Notes', exact: true }).click();
  // Each preset brings its own notes text; it now stands as that game's first note.
  await expect(page.getByRole('list', { name: 'Genshin Impact notes' }).locator('.note')).toHaveCount(1);
  const games = await page.evaluate(async () => {
    const { useApp } = await import(/* @vite-ignore */ '/src/store.ts');
    return useApp.getState().state.games.map((game: { notes?: string }) => game.notes ?? '');
  });
  expect(games.every((text: string) => text === '')).toBe(true);
});

test('a note is written, ticked, coloured, pinned, deleted and brought back', async ({ page }) => {
  await seed(page);
  await nav(page).getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('This patch');
  const body = page.getByRole('textbox', { name: 'Note', exact: true });
  await body.click();
  await page.getByRole('button', { name: 'Checklist' }).click();
  await body.pressSequentially('Spend Starglitter');
  await body.press('Enter');
  await body.pressSequentially('Clear the domain');
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  const note = page.locator('.note', { hasText: 'This patch' });
  const first = note.getByRole('checkbox', { name: 'Spend Starglitter' });
  await expect(first).toHaveAttribute('aria-checked', 'false');
  await expect(note.getByRole('checkbox', { name: 'Clear the domain' })).toBeVisible();
  await first.click();
  await expect(first).toHaveAttribute('aria-checked', 'true');
  await expect(note.locator('.note-count')).toHaveText('1/2');

  await note.getByRole('button', { name: 'More for This patch' }).click();
  await page.getByRole('menuitemradio', { name: 'Violet' }).click();
  await page.keyboard.press('Escape');
  await expect(note).toHaveAttribute('data-color', '');
  await note.getByRole('button', { name: 'More for This patch' }).click();
  await page.getByRole('menuitem', { name: 'Pin to the top' }).click();
  await expect(note).toHaveAttribute('data-pinned', 'true');

  await note.getByRole('button', { name: 'More for This patch' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.locator('.note', { hasText: 'This patch' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.note', { hasText: 'This patch' })).toBeVisible();

  // An empty new note leaves nothing behind.
  const before = await page.locator('.note').count();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).press('Escape');
  await expect(page.locator('.note')).toHaveCount(before);
});

test('down a wide screen the rail runs Today, Calendar, Notes, Games, with Settings at the foot', async ({ page }) => {
  await seed(page);
  const upright = await page.evaluate(() => matchMedia('(orientation: portrait)').matches);
  const names = await nav(page)
    .locator('.rail-places .rail-view, .rail-foot .rail-place')
    .evaluateAll((nodes) => nodes.map((node) => node.querySelector('.rail-label')?.textContent));
  expect(names).toEqual(
    upright ? ['Calendar', 'Games', 'Today', 'Notes', 'Settings'] : ['Today', 'Calendar', 'Notes', 'Games', 'Settings'],
  );
  // Alt+3 is Notes whichever order the dock shows.
  await page.keyboard.press('Alt+3');
  await expect(page.getByRole('heading', { level: 1, name: 'Notes' })).toBeVisible();
});

test('the month lists what ends each day and the day panel offers what is still running', async ({ page }) => {
  await seed(page);
  await nav(page).getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Event view' }).getByRole('radio', { name: 'Month', exact: true }).click();
  await expect(page.locator('.cal-month-summary')).toContainText(/end|Nothing ends/);
  const today = page.locator('.cal-cell[aria-current="date"]');
  await today.click();
  await expect(page.locator('.cal-panel')).toContainText(/Running now|Ends|Nothing ends/);
  // Some day this month has endings named in its cell (on a phone, dots).
  const wide = await page.evaluate(() => innerWidth >= 640);
  await expect(page.locator(wide ? '.cal-end' : '.cal-dots i').first()).toBeVisible();
});

test('Ending soon says how the day stands and suggests what to do next', async ({ page }) => {
  await seed(page);
  await nav(page).getByRole('button', { name: 'Calendar', exact: true }).click();
  await page
    .getByRole('radiogroup', { name: 'Event view' })
    .getByRole('radio', { name: 'Ending soon', exact: true })
    .click();
  await expect(page.locator('.soon-headline')).toBeVisible();
  await expect(page.getByRole('list', { name: 'The next 14 days' }).getByRole('listitem')).toHaveCount(14);
  const pick = page.locator('.soon-pick').first();
  await expect(pick).toBeVisible();
  const id = await pick.getAttribute('data-pick');
  await pick.getByRole('checkbox').click();
  await expect(page.locator(`.soon-pick[data-pick="${id}"]`)).toHaveCount(0);
});

test('icons come in sets, and a game can wear a symbol of its own', async ({ page }) => {
  await seed(page);
  await nav(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance' }).first().click();
  await page.getByRole('group', { name: 'Icons', exact: true }).getByRole('radio', { name: 'Solid' }).click();
  await expect(nav(page).locator('.rail-place .nav-icon').first()).toHaveAttribute('data-set', 'solid');

  await page.getByRole('combobox', { name: 'Zenless Zone Zero icon style' }).click();
  await page.getByRole('option', { name: 'Symbol', exact: true }).click();
  await page.getByRole('button', { name: /^Zenless Zone Zero symbol/ }).click();
  await page.getByRole('menuitemradio', { name: 'Bolt' }).click();
  await expect(nav(page).locator('[data-rail-game] [data-logo-style="symbol"]')).toHaveCount(1);
  // The others keep the coin.
  await expect(nav(page).locator('[data-rail-game] [data-logo-style]')).toHaveCount(1);
  await page.reload();
  await expect(nav(page).locator('[data-rail-game] [data-logo-style="symbol"]')).toHaveCount(1);
  await expect(nav(page).locator('.rail-place .nav-icon').first()).toHaveAttribute('data-set', 'solid');
});
