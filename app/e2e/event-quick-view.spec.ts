import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeEvent, makeGame } from '../../shared/test/helpers';

test('an event on the calendar opens a quick view where it is pinned and ticked off', async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23'].includes(info.project.name), 'Desktop dialog and phone sheet');
  const now = Date.now();
  const day = 86_400_000;
  const game = makeGame({ id: 'quick-game', name: 'Quick view game', updatedAt: now });
  const state = {
    ...emptyState(),
    games: [game],
    events: [
      makeEvent({
        id: 'quick-event',
        gameId: game.id,
        name: 'Anniversary story',
        type: 'event',
        parts: 3,
        notes: 'Three chapters.',
        start: now - 2 * day,
        end: now + 20 * day,
        updatedAt: now,
      }),
    ],
  };
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'quick-view.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page
    .getByRole('radiogroup', { name: 'Event view' })
    .getByRole('radio', { name: 'Timeline', exact: true })
    .click();

  const bar = page.getByRole('button', { name: 'Open Quick view game event: Anniversary story', exact: true });
  await bar.click();
  const view = page.getByRole('dialog', { name: 'Anniversary story' });
  await expect(view).toBeVisible();
  // The quick view is not the editor: nothing to type into.
  await expect(view.getByRole('textbox')).toHaveCount(0);
  await expect(view.getByText('Three chapters.')).toBeVisible();
  for (const name of ['Edit', 'Pin', 'Mark done']) {
    await expect(view.getByRole('button', { name, exact: true })).toBeInViewport();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Scan the settled sheet, not a frame of its entrance fade.
  await expect(view.locator('..')).toHaveCSS('transform', 'none');
  await page.waitForTimeout(400);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('event-quick-view.png') });

  await view.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(view.getByRole('button', { name: 'Pinned', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const parts = view.getByRole('group', { name: /parts done$/ });
  await parts.getByRole('button').nth(1).click();
  await expect(parts).toHaveAccessibleName('Anniversary story: 2 of 3 parts done');
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  await expect(page.locator('[data-event-id="quick-event"] [data-event-bar]')).toHaveAttribute('data-pinned', 'true');

  await bar.click();
  await view.getByRole('button', { name: 'Mark done', exact: true }).click();
  await expect(view.getByRole('button', { name: 'Done — undo', exact: true })).toBeVisible();
  await view.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit event' }).getByRole('textbox', { name: 'Name' })).toHaveValue(
    'Anniversary story',
  );
});
