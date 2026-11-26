import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { emptyState, PRESETS } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';
import { openGame, openSettings } from './support';

const genshin = PRESETS.find((preset) => preset.key === 'genshin')!;

async function openGenshin(page: import('@playwright/test').Page, now: number) {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const game = makeGame({
    name: genshin.name,
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
        id: 'stream',
        gameId: game.id,
        name: 'Genshin 7.3 Special Program — predicted window',
        type: 'livestream',
        start: now + 30 * 86_400_000,
        end: now + 31 * 86_400_000,
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
    .setInputFiles({ name: 'catch-up.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
}

/** Catch up is the game's News tab. */
async function openNews(page: import('@playwright/test').Page) {
  await openGame(page, genshin.name);
  await page.getByRole('tab', { name: /^News/ }).click();
  return page.getByRole('tabpanel');
}

test('a game page catches up in its News tab, which marks versions read and stays honest about gaps', async ({
  page,
}, info) => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  await page.clock.setFixedTime(new Date(now));
  await openGenshin(page, now);
  // Every width opens the game's page from Today, then its News tab.
  const news = await openNews(page);
  await expect(page.getByRole('tab', { name: /^News.*2 new$/ })).toBeVisible();
  await expect(news.getByRole('heading', { name: /Version 7\.2/ })).toBeVisible();
  await expect(news.getByText('Mitya', { exact: true })).toBeVisible();
  // The estimated stream window is labelled, not counted down.
  await expect(news.getByLabel('Next livestream')).toContainText('Estimated');
  // The last stream that aired links its replay.
  await expect(news.getByRole('region', { name: 'Last livestream' }).getByRole('link')).toHaveAttribute(
    'href',
    /^https:\/\//,
  );
  // A section nobody has checked never reads as "none".
  await expect(news.getByText('No summary yet for this version.').first()).toBeVisible();
  // Expired codes stay folded away.
  await expect(news.getByRole('button', { name: 'Copy HourofRuin', exact: true })).toBeHidden();
  expect(
    (await new AxeBuilder({ page }).include('[role="tabpanel"]').analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('catch-up.png') });
  await news.getByText('Quality of life', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('catch-up-body.png') });
  await news.getByRole('button', { name: 'Mark all 2 read', exact: true }).click();
  await expect(news.getByRole('button', { name: /^Mark/ })).toHaveCount(0);
  // Nothing new is left, so the tab loses its dot.
  await expect(page.getByRole('tab', { name: 'News', exact: true })).toBeVisible();
});

test('codes copy, link to the official page and expire while the tab stays open', async ({ page, context }) => {
  // Genshin 7.2 codes expire October 26 at 00:00 (UTC-4), two minutes from here.
  const now = Date.parse('2026-10-26T03:58:00Z');
  await page.clock.install({ time: new Date(now) });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openGenshin(page, now);
  const news = await openNews(page);
  const codes = news.getByRole('region', { name: 'Version 7.2 reward codes' });
  await codes.getByRole('button', { name: 'Copy HourofRuin', exact: true }).click();
  await expect(codes.getByRole('status')).toHaveText('Copied HourofRuin');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('HourofRuin');
  await expect(codes.getByRole('link', { name: 'Redeem HourofRuin' })).toHaveAttribute(
    'href',
    'https://genshin.hoyoverse.com/en/gift?code=HourofRuin',
  );
  await page.clock.fastForward(150_000);
  await codes.getByText('Expired codes (3)', { exact: true }).click();
  await expect(codes.getByRole('button', { name: 'Copy HourofRuin', exact: true })).toBeDisabled();
});
