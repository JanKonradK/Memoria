import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';

test('Tonight tags banners and limits Closing to ten days', async ({ page }, info) => {
  test.skip(!['desktop', 'wide-short'].includes(info.project.name), 'Tonight is part of the desktop dashboard');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const now = Date.now();
  const day = 86_400_000;
  const game = makeGame({ name: 'NTE example', short: 'NTE', updatedAt: now });
  const state = {
    ...emptyState(),
    games: [game],
    events: Array.from({ length: 6 }, (_, i) => ({
      id: `separation-${i}`,
      gameId: game.id,
      name: i < 4 ? `Character or weapon banner ${i + 1}` : i === 4 ? 'Complete the challenge' : 'Later challenge',
      type: i < 4 ? 'banner' : 'event',
      start: now - 4 * day,
      end: now + (i === 5 ? 11 : 8) * day,
      dailyTouch: false,
      notify: true,
      notes: '',
      updatedAt: now,
    })),
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: 'separation.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const closing = page.getByRole('region', { name: 'Closing', exact: true });
  await expect(closing.getByText('Next 10 days')).toBeVisible();
  await expect(closing.getByText('Banner', { exact: true })).toHaveCount(4);
  await expect(closing.getByRole('heading')).toHaveCount(0);
  await expect(
    closing.getByRole('button', { name: /Complete the challenge/ }).getByText('Banner', { exact: true }),
  ).toHaveCount(0);
  await expect(closing.getByRole('button', { name: /Later challenge/ })).toHaveCount(0);
  await expect(closing.getByRole('button')).toHaveCount(5);
  await closing.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('banner-separation.png') });
  await closing.getByRole('button', { name: /Character or weapon banner 1/ }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Character or weapon banner 1');
});
