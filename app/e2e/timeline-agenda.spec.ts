import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { editFromQuickView, mergePresetCalendar } from './support';

// Wednesday 18 November 2026, 14:00 in Warsaw.
const NOW = Date.parse('2026-11-18T13:00:00Z');

test.use({ timezoneId: 'Europe/Warsaw' });

test('agenda lists each day’s moments, folds shared ends and keeps its controls usable', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await mergePresetCalendar(page, NOW, ['crumble', 'nikke', 'zzz', 'wuwa', 'genshin', 'hsr']);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('button', { name: 'Calendar', exact: true }).click();
  const views = page.getByRole('radiogroup', { name: 'Event view' });
  await views.getByRole('radio', { name: 'Agenda', exact: true }).click();
  const phone = page.viewportSize()!.width < 640;

  const today = page.getByRole('region', { name: /^Today Wednesday 18 November$/ });
  await expect(today).toBeVisible();
  await expect(page.getByRole('region', { name: /^Tomorrow Thursday 19 November$/ })).toBeVisible();
  await expect(today.locator('.cal-when span').first()).toHaveText(/^(ends|starts|live|down)$/);
  // Several events of one game ending together are one row with a count.
  const fold = today.locator('[data-list-fold]').first();
  await expect(fold).toBeVisible();
  const more = fold.locator('.cal-more');
  await expect(more).toHaveText(/^\+\d+/);
  const count = Number(await fold.getAttribute('data-list-fold'));
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(today.locator('.cal-row-nested')).toHaveCount(count);
  if (phone)
    for (const control of [more, today.getByRole('checkbox').first()]) {
      const box = (await control.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const { violations } = await new AxeBuilder({ page }).include('.cal-agenda').analyze();
  expect(violations.map((item) => item.id)).toEqual([]);
  await more.click();
  await page.screenshot({ path: info.outputPath('agenda.png') });

  // A tick finishes the event: it leaves the agenda until finished events are shown.
  const row = today.locator('[data-list-event]').first();
  const id = (await row.getAttribute('data-list-event'))!;
  await row.getByRole('checkbox').click();
  await expect(page.locator(`[data-list-event="${id}"]`)).toHaveCount(0);
  await page.getByRole('button', { name: 'Show finished events', exact: true }).click();
  await expect(page.locator(`[data-list-event="${id}"]`).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Hide finished events', exact: true }).click();

  // A row opens the quick view, and the editor is one step further.
  const next = today.locator('[data-list-event] .cal-row-main').first();
  const name = (await next.locator('.cal-name').textContent())!;
  await next.click();
  await expect(page.getByRole('dialog', { name })).toBeVisible();
  await editFromQuickView(page);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The page is the only scroller, and returning to the route keeps the place and the view.
  const scrollPosition = await page.evaluate(() => {
    window.scrollTo({ top: 320, behavior: 'instant' });
    return window.scrollY;
  });
  expect(scrollPosition).toBeGreaterThan(0);
  // Tapped where they are: a click() would first scroll the sticky rail's button "into view", to the top.
  for (const route of ['Settings', 'Calendar']) {
    const box = (await nav.getByRole('button', { name: route, exact: true }).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(scrollPosition, 0);
  await expect(views.getByRole('radio', { name: 'Agenda', exact: true })).toHaveAttribute('data-state', 'on');

  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: info.outputPath('agenda-light.png') });
  const light = await new AxeBuilder({ page }).include('.cal-agenda').analyze();
  expect(light.violations.map((item) => item.id)).toEqual([]);
});
