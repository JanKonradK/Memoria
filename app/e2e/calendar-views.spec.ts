import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mergePresetCalendar } from './support';

// Wednesday 18 November 2026, 14:00 in Warsaw: CookieRun: Crumble's update day.
const NOW = Date.parse('2026-11-18T13:00:00Z');
const KEYS = ['crumble', 'nikke', 'zzz', 'wuwa', 'genshin', 'hsr'];

test.use({ timezoneId: 'Europe/Warsaw' });

async function openView(page: Page, view: 'Month' | 'Ending soon') {
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await mergePresetCalendar(page, NOW, KEYS);
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Calendar', exact: true })
    .click();
  await page.getByRole('radiogroup', { name: 'Event view' }).getByRole('radio', { name: view, exact: true }).click();
}

async function fitsAndPasses(page: Page, view: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // The page's own chrome is checked by its own specs; this checks the view.
  const { violations } = await new AxeBuilder({ page }).include(view).analyze();
  expect(violations.map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual(
    [],
  );
}

test('month grid shows the month, today and the chosen day, and opens events', async ({ page }, info) => {
  await openView(page, 'Month');
  const phone = page.viewportSize()!.width < 640;
  await expect(page.getByRole('heading', { name: 'November 2026', exact: true })).toBeVisible();
  const today = page.getByRole('button', { name: /^Wednesday 18 November, today/ });
  await expect(today).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Today · Wednesday 18 November', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Ends \d+$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Running now \d+/ })).toBeVisible();
  // What ends is named on a wide window, dotted on a phone.
  if (phone) {
    await expect(page.locator('.cal-end').first()).toBeHidden();
    await expect(page.locator('.cal-dots i').first()).toBeVisible();
  } else {
    await expect(page.locator('.cal-end').first()).toBeVisible();
  }
  // Controls follow the pointer: 44px under a finger, the shared 36px under a mouse at any width.
  const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  for (const name of ['Previous month', 'Next month', 'Today']) {
    const box = (await page.locator('.cal-month-nav').getByRole('button', { name, exact: true }).boundingBox())!;
    if (phone) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(touch ? 44 : 36);
  }
  await page.screenshot({ path: info.outputPath('month.png'), fullPage: true });
  await fitsAndPasses(page, '.cal-month');

  // The keyboard walks the days; leaving the month turns it.
  await today.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('heading', { name: 'Wednesday 25 November', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Wednesday 25 November/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  // The grid's trailing days belong to the month shown; a day beyond them turns it.
  await expect(page.getByRole('heading', { name: 'Wednesday 2 December', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'November 2026', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('heading', { name: 'December 2026', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Wednesday 9 December/ })).toBeFocused();
  await page.locator('.cal-month-nav').getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'November 2026', exact: true })).toBeVisible();

  // A day is chosen with a click, and a row in its panel opens the quick view.
  await page.getByRole('button', { name: /^Thursday 19 November/ }).click();
  await expect(page.getByRole('heading', { name: 'Thursday 19 November', exact: true })).toBeVisible();
  const row = page.locator('.cal-panel .cal-item-main').first();
  const name = (await row.locator('.cal-name').textContent())!;
  await row.click();
  await expect(page.getByRole('dialog', { name })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: info.outputPath('month-light.png'), fullPage: true });
  await fitsAndPasses(page, '.cal-month');
});

test('ending soon sorts what is left into four columns and ticks it off', async ({ page }, info) => {
  await openView(page, 'Ending soon');
  const phone = page.viewportSize()!.width < 640;
  for (const title of ['Today', 'By Sunday', 'Next week', 'Later'])
    await expect(page.getByRole('heading', { name: new RegExp(`^${title} \\d+$`) })).toBeVisible();
  const todayColumn = page.locator('[data-soon="today"]');
  await expect(todayColumn.locator('.cal-prog-end').first()).toHaveText(/^\d\d:\d\d · \d+[hm]$/);
  await expect(page.getByRole('meter').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('soon.png') });
  await fitsAndPasses(page, '.cal-soon');

  // Columns sit side by side on a wide window and stack on a phone.
  const boxes = await page
    .locator('.cal-col')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().y));
  if (phone) expect(boxes[1]!).toBeGreaterThan(boxes[0]!);
  else if (page.viewportSize()!.width >= 1024) expect(boxes[1]).toBe(boxes[0]);

  const item = todayColumn.locator('.cal-item').first();
  const tick = item.getByRole('checkbox').first();
  if (phone) {
    const box = (await tick.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  }
  await tick.click();
  await expect(tick).toHaveAttribute('aria-checked', 'true');
  await expect(item.locator('.cal-prog-end')).toHaveText('done');
  // Ticked here, it stays in place, marked, until the page is left.
  await page.locator('[data-done] .cal-item-main').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: info.outputPath('soon-light.png'), fullPage: true });
  await fitsAndPasses(page, '.cal-soon');
});
