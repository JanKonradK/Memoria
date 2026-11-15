import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { emptyState, PRESETS } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';
import { openSettings } from './support';

const hsr = PRESETS.find((preset) => preset.key === 'hsr')!;

async function loadGame(page: import('@playwright/test').Page, now: number) {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  const game = makeGame({
    name: hsr.name,
    short: hsr.short,
    presetKey: hsr.key,
    color: hsr.color,
    color2: hsr.color2,
    updatedAt: now,
  });
  const state = {
    ...emptyState(),
    games: [game],
    events: [
      {
        id: 'story-event',
        gameId: game.id,
        name: 'Fluffy Movie Night',
        type: 'event',
        start: now - 86_400_000,
        end: now + 10 * 86_400_000,
        dailyTouch: false,
        notify: true,
        parts: 4,
        partsDone: 1,
        notes: '',
        updatedAt: now,
      },
    ],
  };
  await openSettings(page, 'Data');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'quests.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Quests', exact: true }).click();
}

test('quest parts tick done, then partly done, and the line shows its progress', async ({ page }) => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  await page.clock.setFixedTime(new Date(now));
  await loadGame(page, now);

  const page_ = page.getByRole('region', { name: `${hsr.name} quests` });
  await expect(page_.getByRole('heading', { name: hsr.name, level: 1 })).toBeVisible();
  // Events running now sit above the story, with their parts.
  await expect(page_.getByText('Fluffy Movie Night')).toBeVisible();
  await page_.getByRole('button', { name: 'One more part done for Fluffy Movie Night' }).click();
  await expect(page_.getByText(/2\/4 parts/)).toBeVisible();

  const main = page_.getByRole('region', { name: /^Main story/ }).first();
  const first = main.getByRole('listitem').first();
  await first.locator('.quests-row-title').click();
  const parts = first.locator('.quests-part');
  const total = await parts.count();
  expect(total).toBeGreaterThan(1);
  const box = parts.first().getByRole('checkbox');
  await box.click();
  await expect(box).toHaveAttribute('aria-checked', 'true');
  await expect(first.locator('.quests-row-title')).toContainText(`1/${total}`);
  await box.click();
  await expect(box).toHaveAttribute('aria-checked', 'mixed');
  await expect(first.locator('.quests-partial')).toHaveText('partly done');
  await expect(first.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'mixed');

  await first.getByRole('button', { name: 'Mark all done' }).click();
  await expect(first.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'true');

  // Progress survives a reload: it is part of the synced document.
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { flushPersist } = await import(path);
    await flushPersist();
  });
  await page.reload();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Quests', exact: true }).click();
  await expect(
    page
      .locator('.quests-row')
      .filter({ has: page.locator('[aria-checked="true"]') })
      .first(),
  ).toBeVisible();

  const results = await new AxeBuilder({ page }).include('.quests-page').analyze();
  expect(results.violations).toEqual([]);
});

test('search finds quests by character, and a player can add their own quest line', async ({ page }) => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  await page.clock.setFixedTime(new Date(now));
  await loadGame(page, now);

  await page.getByRole('button', { name: 'Add a quest line' }).click();
  const form = page.getByRole('form', { name: 'Add a quest line' });
  await form.getByLabel('Quest line').fill('Trash can hunt');
  await form.getByLabel('Parts, one per line').fill('Herta Space Station\nJarilo-VI\nLuofu');
  await form.getByLabel('Characters, separated by commas').fill('March 7th, Dan Heng');
  await form.getByRole('button', { name: 'Add quest line' }).click();

  await page.getByRole('searchbox', { name: 'Search quests' }).fill('trash can');
  const row = page.locator('.quests-row', { hasText: 'Trash can hunt' });
  await expect(row).toContainText('0/3');
  await row.locator('.quests-row-title').click();
  await row.getByRole('button', { name: 'Find quests with Dan Heng' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search quests' })).toHaveValue('Dan Heng');
  await expect(page.locator('.quests-row', { hasText: 'Trash can hunt' })).toBeVisible();
});
