import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(
    overflow.document,
    `document width ${overflow.document}px should fit ${overflow.viewport}px`,
  ).toBeLessThanOrEqual(overflow.viewport);
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  // Audit the settled UI, not a partially transparent Framer Motion entrance frame.
  await page.waitForTimeout(500);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual(
    [],
  );
}

async function addPreset(page: Page, name: string, short: string, first = false) {
  await page.getByRole('button', first ? { name: 'Add your first game' } : { name: 'Add game', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add a game' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: `Add ${short}` }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function addGenshin(page: Page) {
  await addPreset(page, 'Genshin Impact', 'GI', true);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add your first game' })).toBeVisible();
});

test('empty app is accessible and fits the viewport', async ({ page }) => {
  await expect.poll(() => page.locator('header').evaluate((header) => getComputedStyle(header).position)).toBe('fixed');
  await expectNoPageOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole('button', { name: 'Timeline' }).click();
  await expect(page.getByRole('heading', { name: 'Event timeline' })).toBeVisible();
  await expectNoPageOverflow(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expectNoPageOverflow(page);
});

test('public trust pages are readable and accessible', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  await expectNoPageOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);

  await page.goto('/security');
  await expect(page.getByRole('heading', { name: 'Security and data flow' })).toBeVisible();
  await expectNoPageOverflow(page);
});

test('game dashboard and editor remain usable at narrow widths', async ({ page }) => {
  await addGenshin(page);
  await expectNoPageOverflow(page);

  await page.getByRole('button', { name: 'Edit Genshin Impact' }).click();
  const dialog = page.getByRole('dialog', { name: 'Genshin Impact' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Quick spend')).toBeVisible();
  await dialog.getByPlaceholder('Label, e.g. Domain').fill('Domain');
  await dialog.getByRole('button', { name: '+ Shortcut' }).click();
  await expectNoPageOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /Domain -20/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /start timer/i })).toBeVisible();

  const resin = page.getByLabel('Original Resin current value');
  await resin.fill('0');
  await resin.blur();
  await page.getByRole('button', { name: '-1' }).first().click();
  await expect(resin).toHaveValue('0');

  const bossRow = page.getByRole('button', { name: /Weekly Bosses ×3: 0 of 3 done/ });
  await bossRow.scrollIntoViewIfNeeded();
  await bossRow.click();
  await expect(page.getByRole('button', { name: /Weekly Bosses ×3: 1 of 3 done/ })).toBeVisible();

  await addPreset(page, 'Honkai: Star Rail', 'HSR');
  await page.getByRole('heading', { name: 'Honkai: Star Rail', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel(/Reserve TB Power for Trailblaze Power/)).toBeVisible();

  await page.getByRole('button', { name: 'Add game', exact: true }).click();
  await page.getByRole('button', { name: /Neverness to Everness/ }).click();
  await page.locator('label:has-text("City Stamina cap") input').fill('100');
  await page.getByRole('button', { name: 'Add NTE' }).click();
  await expect(page.getByRole('heading', { name: 'Neverness to Everness', exact: true })).toBeVisible();
});

test('tabs, timeline controls, and settings fit after adding a game', async ({ page }) => {
  await addGenshin(page);

  await page.getByRole('button', { name: 'Timeline' }).click();
  await expectNoPageOverflow(page);
  await page.getByRole('button', { name: '+ Event' }).click();
  await expect(page.getByRole('dialog', { name: 'New event' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Per-game alert overrides')).toBeVisible();
  await expect(page.getByLabel('Sleep window (hours)')).toHaveValue('8');
  await expectNoPageOverflow(page);
});

test('full 16:9 dashboard fits five games and timeline bars stay in scale', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-16x9', '16:9 desktop layout check');

  await addGenshin(page);
  await addPreset(page, 'Honkai: Star Rail', 'HSR');
  await addPreset(page, 'Zenless Zone Zero', 'ZZZ');
  await addPreset(page, 'Wuthering Waves', 'WuWa');
  await addPreset(page, 'Neverness to Everness', 'NTE');

  await expect
    .poll(async () => {
      const cards = await Promise.all(
        ['Genshin Impact', 'Honkai: Star Rail', 'Zenless Zone Zero', 'Wuthering Waves', 'Neverness to Everness'].map(
          (name) => page.getByRole('heading', { name, exact: true }).boundingBox(),
        ),
      );
      return new Set(cards.map((box) => Math.round(box!.y))).size;
    })
    .toBe(1);
  await expect(page.getByRole('button', { name: 'Add game', exact: true })).toBeVisible();
  await expectNoPageOverflow(page);

  await page.getByRole('button', { name: 'Timeline' }).click();
  const importButton = page.getByRole('button', { name: /^Import \d+$/ });
  await expect(importButton).toBeVisible();
  await importButton.click();
  await expect(page.getByText('Neverness to Everness', { exact: true })).toBeVisible();
  const outOfScale = await page.locator('[data-event-bar]').evaluateAll(
    (bars) =>
      bars.filter((bar) => {
        const barBox = bar.getBoundingClientRect();
        const rowBox = bar.parentElement!.getBoundingClientRect();
        return barBox.left < rowBox.left - 0.5 || barBox.right > rowBox.right + 0.5;
      }).length,
  );
  expect(outOfScale).toBe(0);
  await expectNoPageOverflow(page);
});
