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

async function expectTimelineTicksToFit(page: Page) {
  const scale = page.locator('[data-timeline-scale]');
  const ticks = page.locator('[data-timeline-tick]');
  await expect(ticks.first()).toBeVisible();
  const geometry = await scale.evaluate((element) => {
    const scaleBox = element.getBoundingClientRect();
    const tickBoxes = [...element.querySelectorAll<HTMLElement>('[data-timeline-tick]')].map((tick) => {
      const box = tick.getBoundingClientRect();
      return { left: box.left, right: box.right };
    });
    return { left: scaleBox.left, right: scaleBox.right, ticks: tickBoxes };
  });

  expect(geometry.ticks.length).toBeGreaterThanOrEqual(2);
  expect(geometry.ticks[0]!.left).toBeGreaterThanOrEqual(geometry.left - 0.5);
  expect(geometry.ticks.at(-1)!.right).toBeLessThanOrEqual(geometry.right + 0.5);
  for (let index = 1; index < geometry.ticks.length; index++) {
    expect(geometry.ticks[index - 1]!.right).toBeLessThanOrEqual(geometry.ticks[index]!.left + 0.5);
  }
}

async function addPreset(page: Page, name: string, short: string, first = false) {
  await page.getByRole('button', first ? { name: 'Add your first game' } : { name: 'Add game', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add a game' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: `Add ${short}` }).click();
  const expandButton = page.getByRole('button', { name: `Expand ${name} controls` });
  if (await expandButton.isVisible()) await expandButton.click();
  const focusButton = page.getByRole('button', { name: `Focus ${name}` });
  if (await focusButton.isVisible()) await focusButton.click();
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
  await expect(page.locator('header')).toHaveCount(0);
  const navRail = page.locator('[data-nav-rail]');
  await expect(navRail).toBeVisible();
  await expect.poll(() => navRail.evaluate((rail) => getComputedStyle(rail).position)).toBe('fixed');
  await expect(page.getByRole('button', { name: 'Games', exact: true })).toHaveAttribute('aria-current', 'page');
  await expectNoPageOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Event timeline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Timeline', exact: true })).toHaveAttribute('aria-current', 'page');
  await expectNoPageOverflow(page);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  // exact: the accordion section triggers are headings too ("Expand Data settings" etc.)
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
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
  await dialog.getByRole('radio', { name: 'Resources', exact: true }).click();
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
  await page.getByRole('button', { name: 'Decrease Original Resin' }).click();
  await expect(resin).toHaveValue('0');

  const bossRow = page.getByRole('button', { name: /Weekly Bosses ×3: 0 of 3 done/ });
  await bossRow.scrollIntoViewIfNeeded();
  await bossRow.click();
  await expect(page.getByRole('button', { name: /Weekly Bosses ×3: 1 of 3 done/ })).toBeVisible();

  await addPreset(page, 'Honkai: Star Rail', 'HSR');
  await page.getByRole('heading', { name: 'Honkai: Star Rail', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /Reserve TB Power/ }).click();
  await expect(page.getByLabel(/Reserve TB Power for Trailblaze Power/)).toBeVisible();

  await page.getByRole('button', { name: 'Add game', exact: true }).click();
  await page.getByRole('button', { name: /Neverness to Everness/ }).click();
  await page.locator('label:has-text("City Stamina cap") input').fill('100');
  await page.getByRole('button', { name: 'Add NTE' }).click();
  // On wide desktop the new card lands collapsed in the Nexus layout, where the
  // name is a <span>; expand it to get the <h2> heading (as addPreset does).
  const expandNte = page.getByRole('button', { name: 'Expand Neverness to Everness controls' });
  if (await expandNte.isVisible()) await expandNte.click();
  await expect(page.getByRole('heading', { name: 'Neverness to Everness', exact: true })).toBeVisible();
});

test('tabs, timeline controls, and settings fit after adding a game', async ({ page }) => {
  await addGenshin(page);

  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expectNoPageOverflow(page);
  const timelineRange = page.getByRole('radiogroup', { name: 'Timeline range' });
  await expect(timelineRange.getByRole('radio', { name: '30d', exact: true })).toHaveAttribute('data-state', 'on');
  for (const range of ['7d', '30d', '90d']) {
    await timelineRange.getByRole('radio', { name: range, exact: true }).click();
    await expect(timelineRange.getByRole('radio', { name: range, exact: true })).toHaveAttribute('data-state', 'on');
    await expectTimelineTicksToFit(page);
  }
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('void-ui') || '{}')?.state?.timelineRange))
    .toBe('90d');
  await page.getByRole('button', { name: '+ Event' }).click();
  await expect(page.getByRole('dialog', { name: 'New event' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Expand Display settings' }).click();
  await expect(page.getByLabel('Sleep window (hours)')).toHaveValue('8');
  const textSize = page.getByRole('radiogroup', { name: 'Text size' });
  await expect(textSize.getByRole('radio', { name: 'M', exact: true })).toHaveAttribute('data-state', 'on');
  await textSize.getByRole('radio', { name: 'XL', exact: true }).click();
  await expect
    .poll(() => page.locator('html').evaluate((html) => parseFloat(getComputedStyle(html).fontSize)))
    .toBe(20.48);
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('void-ui') || '{}')?.state?.textSize as string))
    .toBe('xl');
  await expectNoPageOverflow(page);

  await page.getByRole('button', { name: 'Expand Games settings' }).click();
  const gameSettings = page.getByRole('region', { name: 'Games' });
  await expect(gameSettings.getByText('Genshin Impact', { exact: true })).toBeVisible();
  await gameSettings.getByRole('button', { name: 'Edit Genshin Impact' }).click();
  await expect(page.getByRole('dialog', { name: 'Genshin Impact' })).toBeVisible();
});

test('wide dashboard switches between nexus and cards rail while timeline bars stay in scale', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-16x9', '16:9 desktop layout check');

  await addGenshin(page);
  await addPreset(page, 'Honkai: Star Rail', 'HSR');
  await addPreset(page, 'Zenless Zone Zero', 'ZZZ');
  await addPreset(page, 'Wuthering Waves', 'WuWa');
  await addPreset(page, 'Neverness to Everness', 'NTE');

  await expect(page.getByRole('region', { name: 'Across every game' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'left game rail' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'right game rail' })).toBeVisible();
  await expect(page.locator('.nexus-node')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Add game', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand Honkai: Star Rail controls' }).click();
  await expect(page.getByRole('region', { name: 'Honkai: Star Rail controls' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse Honkai: Star Rail controls' })).toBeVisible();
  await expectNoPageOverflow(page);
  // The open card has no collapse control: its background and Escape close it.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Expand Honkai: Star Rail controls' })).toBeVisible();

  await page.getByRole('radio', { name: 'Cards', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Event horizon' })).toBeVisible();
  for (const name of [
    'Genshin Impact',
    'Honkai: Star Rail',
    'Zenless Zone Zero',
    'Wuthering Waves',
    'Neverness to Everness',
  ]) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  // Games deal across three columns; the event horizon owns a fourth and sticks.
  const cardColumns = await Promise.all(
    ['Genshin Impact', 'Honkai: Star Rail', 'Zenless Zone Zero', 'Wuthering Waves', 'Neverness to Everness'].map(
      async (name) => Math.round((await page.getByRole('heading', { name, exact: true }).boundingBox())!.x),
    ),
  );
  expect(new Set(cardColumns).size).toBe(3);
  // No card is taller than what is inside it. The old row grid stretched every
  // card to the height of the tallest thing beside it, which was the horizon.
  const stretched = await page
    .locator('[data-game-card]')
    .evaluateAll(
      (cards) => cards.filter((card) => card.getBoundingClientRect().height - card.scrollHeight > 24).length,
    );
  expect(stretched).toBe(0);
  await expect(page.getByRole('complementary', { name: 'Event horizon' })).toHaveCSS('position', 'sticky');
  await expect(page.getByRole('button', { name: 'Add game', exact: true })).toBeVisible();
  await expectNoPageOverflow(page);

  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
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

  // Seed events age out of the agenda window over time, so assert on the
  // section structure and that at least one seeded event row rendered.
  await page.getByRole('radio', { name: 'Agenda' }).click();
  await expect(page.getByRole('heading', { name: 'Live now' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open .+ event: / }).first()).toBeVisible();
  await expectNoPageOverflow(page);
});
