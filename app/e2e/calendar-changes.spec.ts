import { expect, test } from '@playwright/test';

test('calendar changes need confirmation and keep edited events', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T12:00:00Z'));
  await page.route('https://raw.githubusercontent.com/**/events.json', (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Exercise the same validated import boundary as the verified network feed.
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { useApp } = await import(/* @vite-ignore */ path);
    const feed = {
      version: 2,
      generatedAt: '2026-11-09T10:00:00Z',
      seedUpdated: '2026-11-09',
      revision: 'e2e-1',
      events: [
        {
          game: 'genshin',
          sourceKey: 'e2e:changes',
          name: 'Calendar test event',
          type: 'event',
          start: '2026-11-10 10:00',
          end: '2026-11-13 10:00',
          timezone: 'UTC',
        },
      ],
      withdrawn: [],
    };
    useApp.getState().importRemoteEvents(feed);
    const event = useApp
      .getState()
      .state.events.find((item: { sourceKey?: string }) => item.sourceKey === 'e2e:changes');
    useApp.getState().upsertEvent({ ...event, name: 'My calendar name', notes: 'My calendar notes' });
    useApp.getState().importRemoteEvents({
      ...feed,
      revision: 'e2e-2',
      generatedAt: '2026-11-09T11:00:00Z',
      events: [{ ...feed.events[0], end: '2026-11-14 10:00' }],
    });
  });
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Timeline', exact: true })
    .click();
  await expect(page.getByText('Feed published 2026-11-09', { exact: true })).toBeVisible();
  const changes = page.getByRole('button', { name: /^Calendar changes \(/ });
  await changes.click();
  const dialog = page.getByRole('dialog', { name: 'Calendar changes' });
  const row = dialog.getByRole('article').filter({ hasText: 'rescheduled' }).filter({ hasText: 'Calendar test event' });
  await expect(row).toContainText('My calendar notes');
  await expect(row).toContainText('Your event was kept.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Timeline', exact: true })
    .click();
  await changes.click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Confirm read' }).click();
  await expect(row).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Timeline', exact: true })
    .click();
  await changes.click();
  await expect(row).toHaveCount(0);
});
