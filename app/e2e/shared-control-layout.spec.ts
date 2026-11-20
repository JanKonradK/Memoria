import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { openSettings } from './support';
import { makeGame } from '../../shared/test/helpers';

test('long game choices fit the viewport and backup import has visible keyboard focus', async ({ page }) => {
  const name = 'A very long game name with several words and an account that needs room';
  const accountLabel = 'UnbrokenAccountName'.repeat(5);
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await openSettings(page, 'Data');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'long-game.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        ...emptyState(),
        games: [makeGame({ id: 'long', name, accountLabel }), makeGame({ id: 'short', name: 'Short', sort: 1 })],
      }),
    ),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Calendar', exact: true })
    .click();
  // A phone or upright tablet keeps the game filter behind one button in the bar; a PC shows it inline.
  if (page.viewportSize()!.width < 1024) {
    const choose = page.getByRole('button', { name: 'Choose games', exact: true });
    await choose.click();
    await expect(choose).toHaveAttribute('aria-expanded', 'true');
  }
  const scope = page.getByRole('group', { name: 'Games shown' });
  await expect(scope).toBeVisible();
  const longGame = scope.getByRole('button', { name: new RegExp(`^${name}, .*${accountLabel}$`) });
  await expect(longGame).toHaveAttribute('aria-pressed', 'true');
  const width = page.viewportSize()!.width;
  // Every logo is whole, inside the window, and clear of the bar's other controls.
  const layout = await page.locator('.calendar-bar').evaluate((bar) => {
    const box = (node: Element) => node.getBoundingClientRect();
    const toggles = [...bar.querySelectorAll('.calendar-game-toggle')].map(box);
    const others = [...bar.querySelectorAll('button, [role="radiogroup"], h1')]
      .filter((node) => !node.closest('.calendar-games') && !node.closest('[role="radiogroup"] button'))
      .map(box)
      .filter((rect) => rect.width > 0);
    const overlaps = toggles.some((t) =>
      others.some((o) => t.left < o.right - 1 && o.left < t.right - 1 && t.top < o.bottom - 1 && o.top < t.bottom - 1),
    );
    return { toggles: toggles.map((t) => ({ left: t.left, right: t.right, width: t.width })), overlaps };
  });
  expect(layout.overlaps).toBe(false);
  for (const toggle of layout.toggles) {
    expect(toggle.left).toBeGreaterThanOrEqual(0);
    expect(toggle.right).toBeLessThanOrEqual(width);
    if (width < 640) expect(toggle.width).toBeGreaterThanOrEqual(44);
  }
  // Pressing a logo hides that game, and pressing it again brings it back.
  await longGame.click();
  await expect(longGame).toHaveAttribute('aria-pressed', 'false');
  await longGame.click();
  await expect(longGame).toHaveAttribute('aria-pressed', 'true');
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    elements: Array.from(document.querySelectorAll('body *'))
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && (bounds.right > innerWidth + 1 || bounds.left < -1);
      })
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          class: element.getAttribute('class'),
          left: bounds.left,
          right: bounds.right,
          width: bounds.width,
          overflowX: style.overflowX,
          minWidth: style.minWidth,
          whiteSpace: style.whiteSpace,
        };
      }),
  }));
  expect(overflow.scrollWidth, JSON.stringify(overflow, null, 2)).toBeLessThanOrEqual(overflow.width);

  await openSettings(page, 'Data');
  await page.getByRole('button', { name: 'Export backup', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('input[type="file"]')).toBeFocused();
  await expect(page.locator('label').filter({ has: page.locator('input[type="file"]') })).toHaveCSS(
    'outline-style',
    'solid',
  );
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? ''))).toEqual([]);
});
