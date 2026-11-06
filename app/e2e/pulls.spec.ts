import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { emptyState, PRESETS } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';
import { openSettings } from './support';

const genshin = PRESETS.find((preset) => preset.key === 'genshin')!;
const DAY = 86_400_000;

async function loadGenshin(page: import('@playwright/test').Page, now: number) {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  const game = makeGame({
    name: genshin.name,
    short: genshin.short,
    presetKey: genshin.key,
    color: genshin.color,
    color2: genshin.color2,
    updatedAt: now,
  });
  const state = {
    ...emptyState(),
    games: [game],
    events: [
      {
        id: 'banner',
        gameId: game.id,
        name: 'Columbina — Moonlit Requiem',
        type: 'banner',
        bannerKind: 'character',
        start: now - DAY,
        end: now + 40 * DAY,
        dailyTouch: false,
        notify: true,
        notes: '',
        updatedAt: now,
      },
    ],
  };
  await openSettings(page, 'Data');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'pulls.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Pulls', exact: true }).click();
}

test('saving for a banner shows pulls on hand and a forecast range from version history', async ({ page }, info) => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  await page.clock.setFixedTime(new Date(now));
  await loadGenshin(page, now);

  const card = page.getByRole('region', { name: genshin.name });
  await card.getByLabel('Primogems').fill('8000');
  await card.getByLabel('Pull tickets').fill('12');
  await card.getByRole('button', { name: 'Save balance' }).click();
  await expect(card.getByText('pulls saved')).toBeVisible();
  // 12 tickets + 8000 / 160.
  await expect(card.getByText('62', { exact: true })).toBeVisible();
  await expect(card.getByText(/Primogems a day/)).toBeVisible();
  await expect(card.getByText(/a day in versions/)).toBeVisible();

  // A pass you buy adds to the daily income.
  await card.getByRole('switch', { name: /Welkin Moon/ }).click();
  await expect(card.getByText(/free \+ 100 paid/)).toBeVisible();

  await card.getByRole('button', { name: 'Add goal' }).isDisabled();
  await card.getByRole('combobox', { name: 'Save for' }).click();
  await page.getByRole('option', { name: /Columbina/ }).click();
  await card.getByLabel('Pulls', { exact: true }).fill('90');
  await card.getByRole('button', { name: 'Add goal' }).click();

  const goal = card.getByRole('list', { name: 'Goals' }).getByRole('listitem').first();
  await expect(goal.getByText('Columbina — Moonlit Requiem')).toBeVisible();
  await expect(goal.getByText(/Covered now|On track|Depends on events|Short by about/)).toBeVisible();
  await expect(card.getByRole('img', { name: 'Expected pulls up to your last goal' })).toBeVisible();

  await page.screenshot({ path: info.outputPath('savings.png'), fullPage: true });
  const savingsAxe = await new AxeBuilder({ page }).include('.history-page').analyze();
  expect(savingsAxe.violations).toEqual([]);

  // The plan is stored with the game, so it survives a reload.
  await page.reload();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Pulls', exact: true }).click();
  const reloaded = page.getByRole('region', { name: genshin.name });
  await expect(reloaded.getByRole('list', { name: 'Goals' }).getByText('Columbina — Moonlit Requiem')).toBeVisible();
  // A banner with a goal is no longer offered as a new one.
  await expect(reloaded.locator('option', { hasText: 'Columbina' })).toHaveCount(0);
});

test('version history compares free pulls across games and lists every version with sources', async ({
  page,
}, info) => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  await page.clock.setFixedTime(new Date(now));
  await loadGenshin(page, now);
  await page.getByRole('radio', { name: 'Version history' }).click();

  await expect(page.getByRole('heading', { name: 'Version history', level: 1 })).toBeVisible();
  // Only the tracked game is selected at first.
  await expect(page.getByRole('button', { name: 'Genshin', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'HSR', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'ZZZ', exact: true }).click();

  await expect(page.getByRole('img', { name: 'Free pulls per version for each selected game' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Primogems per Genshin Impact version' })).toBeVisible();
  // Hover, not focus: on a small screen focus scrolls the page under the resting pointer,
  // which then hovers a different bar.
  await page.getByRole('button', { name: /^5\.0: 19,940 Primogems$/ }).hover();
  await expect(page.getByRole('status').filter({ hasText: '19,940 Primogems' })).toBeVisible();

  await page
    .getByRole('region', { name: /Genshin Impact · Primogems per version/ })
    .getByRole('button', { name: 'Show table' })
    .click();
  const table = page.getByRole('table').first();
  await expect(table.getByRole('rowheader', { name: /^4\.4/ })).toBeVisible();
  await expect(table.getByRole('link').first()).toHaveAttribute('href', /^https:\/\//);

  await page.screenshot({ path: info.outputPath('history.png'), fullPage: true });
  const axe = await new AxeBuilder({ page }).include('.history-page').analyze();
  expect(axe.violations).toEqual([]);
});

test('an out-of-range number says so instead of failing silently', async ({ page }) => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  await page.clock.setFixedTime(new Date(now));
  await loadGenshin(page, now);
  const card = page.getByRole('region', { name: genshin.name });
  const amount = card.getByLabel('Primogems');
  // Skip the browser's own range check to reach the app's.
  await amount.evaluate((input) => input.removeAttribute('max'));
  await amount.fill('100000001');
  await card.getByRole('button', { name: 'Save balance' }).click();
  await expect(card.getByRole('alert')).toHaveText(/out of range/);
  await expect(card.getByText('pulls saved').locator('..')).toContainText('0 pulls saved');
});

test('the pity tracker counts pulls, records a lost 50/50 and feeds the savings goal', async ({ page }, info) => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  await page.clock.setFixedTime(new Date(now));
  await loadGenshin(page, now);

  const card = page.getByRole('region', { name: genshin.name });
  const track = card.getByRole('group', { name: 'Character event' });
  await track.getByRole('button', { name: 'Add 10 pulls to Character event' }).click();
  await track.getByRole('button', { name: 'Add 10 pulls to Character event' }).click();
  await expect(track.getByRole('meter', { name: 'Character event pity' })).toHaveAttribute('aria-valuenow', '20');
  // 70 left on this pity, then a full 90 if the 50/50 is lost.
  await expect(track.getByText(/within\s*160\s*pulls/)).toBeVisible();

  await track.getByRole('button', { name: 'Got a 5★' }).click();
  await track.getByLabel('On pull').fill('17');
  await track.getByLabel('Who or what (optional)').fill('Qiqi');
  await track.getByRole('radio', { name: 'No, lost' }).click();
  await expect(track.getByText('3 pulls after it stay counted toward the next 5★.')).toBeVisible();
  await track.getByRole('button', { name: 'Record 5★' }).click();

  await expect(track.getByText('Next 5★ is the featured one')).toBeVisible();
  await expect(track.getByRole('meter', { name: 'Character event pity' })).toHaveAttribute('aria-valuenow', '3');
  await expect(track.getByText(/within\s*87\s*pulls/)).toBeVisible();
  await expect(track.getByRole('img', { name: 'Pull each Character event 5★ came on' })).toBeVisible();
  await expect(track.getByText('0 of 1')).toBeVisible();

  await page.screenshot({ path: info.outputPath('pity.png'), fullPage: true });
  const axe = await new AxeBuilder({ page }).include('.history-page').analyze();
  expect(axe.violations).toEqual([]);

  // A character banner goal starts from the pulls the tracker says guarantee it.
  await card.getByRole('combobox', { name: 'Save for' }).click();
  await page.getByRole('option', { name: /Columbina/ }).click();
  await expect(card.getByLabel('Pulls', { exact: true })).toHaveValue('87');
  await expect(card.getByRole('button', { name: /Typical · \d+/ })).toBeVisible();

  // Stored with the game, so it survives a reload.
  await page.reload();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Pulls', exact: true }).click();
  await expect(
    card.getByRole('group', { name: 'Character event' }).getByRole('meter', { name: 'Character event pity' }),
  ).toHaveAttribute('aria-valuenow', '3');
});
