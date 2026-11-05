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
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  // Catch up sits in the game's heading, on its own page at every width.
  await openGame(page, genshin.name);
}

test('a game page opens its catch-up, which marks versions read and stays honest about gaps', async ({
  page,
}, info) => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  await page.clock.setFixedTime(new Date(now));
  await openGenshin(page, now);
  const open = page.getByRole('button', { name: /^Catch up on Genshin Impact, 2 new/ }).first();
  await open.click();
  const sheet = page.getByRole('dialog', { name: 'Catch up: Genshin Impact' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: /Version 7\.2/ })).toBeVisible();
  await expect(sheet.getByText('Mitya', { exact: true })).toBeVisible();
  // The estimated stream window is labelled, not counted down.
  await expect(sheet.getByLabel('Next livestream')).toContainText('Estimated');
  // A section nobody has checked never reads as "none".
  await expect(sheet.getByText('Not reviewed yet.').first()).toBeVisible();
  // Expired codes stay folded away.
  await expect(sheet.getByRole('button', { name: 'Copy HourofRuin', exact: true })).toBeHidden();
  // Let the sheet finish sliding in, or the scan reads half-faded text.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('catch-up.png') });
  await sheet
    .getByRole('heading', { name: 'Quality of life' })
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await sheet.getByText('Quality of life', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('catch-up-body.png') });
  await sheet.getByRole('button', { name: 'Mark all 2 read', exact: true }).click();
  await expect(sheet.getByRole('button', { name: /^Mark/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Catch up on Genshin Impact', exact: true }).first()).toBeVisible();
});

test('codes copy, link to the official page and expire while the sheet stays open', async ({ page, context }) => {
  // Genshin 7.2 codes expire October 26 at 00:00 (UTC-4), two minutes from here.
  const now = Date.parse('2026-10-26T03:58:00Z');
  await page.clock.install({ time: new Date(now) });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openGenshin(page, now);
  await page
    .getByRole('button', { name: /^Catch up on Genshin Impact/ })
    .first()
    .click();
  const codes = page.getByRole('region', { name: 'Version 7.2 reward codes' });
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
