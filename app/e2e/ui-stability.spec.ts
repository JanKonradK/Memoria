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

async function expectNoPageVerticalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    viewport: window.innerHeight,
    document: document.documentElement.scrollHeight,
  }));
  expect(
    overflow.document,
    `document height ${overflow.document}px should fit ${overflow.viewport}px`,
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

/**
 * Document structure, which the check above cannot see: `heading-order` is
 * `moderate` impact so the serious/critical filter drops it, and
 * `page-has-heading-one` / `landmark-one-main` are best-practice rules that
 * `withTags(['wcag2a', …])` never runs. Every route missing an h1 was invisible
 * to this suite.
 */
async function expectSoundDocumentStructure(page: Page) {
  await page.waitForTimeout(500);
  const results = await new AxeBuilder({ page })
    .withRules(['page-has-heading-one', 'heading-order', 'landmark-one-main'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
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

/** Adding anything now goes through the app bar's single "+" menu. */
async function openAddMenu(page: Page, item: 'Add game' | 'Event' | 'Reminder') {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function addPreset(page: Page, name: string, short: string, first = false) {
  if (first) await page.getByRole('button', { name: 'Add your first game' }).click();
  else await openAddMenu(page, 'Add game');
  await expect(page.getByRole('dialog', { name: 'Add a game' })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: `Add ${short}` }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // On the wide stage a resting card shows its name in a span; the heading only
  // exists once the card is open, so open it before asserting on the heading.
  const expandButton = page.getByRole('button', { name: `Expand ${name} controls` });
  if (await expandButton.isVisible()) await expandButton.click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function addGenshin(page: Page) {
  await addPreset(page, 'Genshin Impact', 'Genshin', true);
}

test.beforeEach(async ({ page }) => {
  // Every test below starts from the dashboard, so skip first-run onboarding.
  // The onboarding screen itself is covered by its own test.
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add your first game' })).toBeVisible();
});

test('first run opens the spotlight tour and fits the viewport', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('memoria-onboarding'));
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Your daily run starts here' })).toBeVisible();
  await expectNoPageOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
});

test('empty app is accessible and fits the viewport', async ({ page }) => {
  const appBar = page.locator('header');
  await expect(appBar).toBeVisible();
  await expect.poll(() => appBar.evaluate((bar) => getComputedStyle(bar).position)).toBe('sticky');
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
  await expectNoPageOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
  await expectSoundDocumentStructure(page);

  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Event timeline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Timeline', exact: true })).toHaveAttribute('aria-current', 'page');
  await expectNoPageOverflow(page);
  await expectSoundDocumentStructure(page);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  // exact: the accordion section triggers are headings too ("Expand Data settings" etc.)
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
  await expectNoPageOverflow(page);
  await expectSoundDocumentStructure(page);
});

test('game dashboard and editor remain usable at narrow widths', async ({ page }) => {
  await addGenshin(page);
  await expectNoPageOverflow(page);

  // The title and pencil both open the same complete game editor.
  await page.getByRole('button', { name: 'Edit Genshin Impact' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Genshin Impact' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radiogroup', { name: 'Server' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delete game…' })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  // By role: the section heading and the "+ Quick spend" button share text.
  await dialog.getByRole('heading', { name: 'Quick spend' }).scrollIntoViewIfNeeded();
  await dialog.getByPlaceholder('Label, e.g. Domain').fill('Domain');
  await dialog.getByRole('button', { name: '+ Quick spend' }).click();
  await expectNoPageOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // Card expansion is per-visit state on the wide stage, so coming back from
  // Settings lands on a collapsed card and its chips are not in the DOM.
  const reopenGenshin = page.getByRole('button', { name: 'Expand Genshin Impact controls' });
  if (await reopenGenshin.isVisible()) await reopenGenshin.click();
  await expect(page.getByRole('button', { name: /Domain -20/ })).toBeVisible();
  const timer = page.getByRole('button', { name: 'Crystalfly Trap (Crystal Cores): mark collected and resent' });
  await timer.scrollIntoViewIfNeeded();
  await expect(timer).toBeVisible();

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

  await openAddMenu(page, 'Add game');
  await page.getByRole('button', { name: /Neverness to Everness/ }).click();
  await page.locator('label:has-text("City Stamina cap") input').fill('100');
  await page.getByRole('button', { name: 'Add NTE' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
  // The 7d/40d control is retired: the window is fixed at 40 days, so the only
  // thing left to hold is that the ruler still fits whatever width it is given.
  await expectTimelineTicksToFit(page);
  await expect(page.getByRole('radiogroup', { name: 'Timeline range' })).toHaveCount(0);
  await openAddMenu(page, 'Event');
  await expect(page.getByRole('dialog', { name: 'New event' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Sleep window (hours)')).toHaveValue('8');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('light');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('memoria-ui') || '{}')?.state?.theme as string))
    .toBe('light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expectNoPageOverflow(page);

  const gameSettings = page.getByRole('region', { name: 'Games' });
  await expect(gameSettings.getByText('Genshin Impact', { exact: true })).toBeVisible();
  await gameSettings.getByRole('button', { name: 'Edit Genshin Impact' }).click();
  await expect(page.getByRole('dialog', { name: 'Genshin Impact' })).toBeVisible();
});

test('wide dashboard stage expands a card while timeline bars stay in scale', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-16x9', '16:9 desktop layout check');

  await addGenshin(page);
  await addPreset(page, 'Honkai: Star Rail', 'HSR');
  await addPreset(page, 'Zenless Zone Zero', 'ZZZ');
  await addPreset(page, 'Wuthering Waves', 'WuWa');
  await addPreset(page, 'Neverness to Everness', 'NTE');

  await expect(page.getByRole('region', { name: 'Across every game' })).toBeVisible();
  const gameArea = page.getByRole('complementary', { name: 'Game controls' });
  const leftRail = gameArea.locator('.nexus-node[data-column="1"]');
  const rightRail = gameArea.locator('.nexus-node[data-column="2"]');
  await expect(gameArea).toBeVisible();
  await expect(gameArea).toHaveCSS('overflow-y', 'auto');
  await expect(page.locator('.nexus-node')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  // Freeze the current order as the oracle. Urgency changes with server time,
  // so a hard-coded game order is not stable across days.
  await page.keyboard.press('Escape');
  const restingOrder = await page
    .locator('.nexus-node button[aria-label^="Expand "]')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
  const startingColumn = await page
    .getByRole('button', { name: 'Expand Honkai: Star Rail controls' })
    .evaluate((button) => button.closest('.nexus-node')?.getAttribute('data-column'));
  const expandedRail = startingColumn === '1' ? leftRail : rightRail;
  const collapsedRail = startingColumn === '1' ? rightRail : leftRail;
  await page.getByRole('button', { name: 'Expand Honkai: Star Rail controls' }).click();
  await expect(page.getByRole('region', { name: 'Honkai: Star Rail controls' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse Honkai: Star Rail controls' })).toHaveCount(0);
  await expect(expandedRail).toHaveCount(1);
  await expect(collapsedRail).toHaveCount(4);
  await expect(collapsedRail.getByRole('button', { name: /^Expand .+ controls$/ })).toHaveCount(4);
  await expect
    .poll(() =>
      collapsedRail.evaluateAll((cards) =>
        cards.map((card) => card.querySelector('button[aria-label^="Expand "]')?.getAttribute('aria-label')),
      ),
    )
    .toEqual(restingOrder.filter((label) => label !== 'Expand Honkai: Star Rail controls'));
  await expectNoPageOverflow(page);
  await expectNoPageVerticalOverflow(page);
  // The open card has no collapse control: Escape and a click outside close it.
  await page.keyboard.press('Escape');
  const starRailTrigger = page.getByRole('button', { name: 'Expand Honkai: Star Rail controls' });
  await expect(starRailTrigger).toBeVisible();
  await expect(starRailTrigger).toBeFocused();
  await expect(leftRail).toHaveCount(3);
  await expect(rightRail).toHaveCount(2);

  await starRailTrigger.click();
  await expect(page.getByRole('region', { name: 'Honkai: Star Rail controls' })).toBeVisible();
  await page.locator('.app-bar').click({ position: { x: 2, y: 2 } });
  await expect(starRailTrigger).toBeVisible();

  // The Cards masonry was retired: the stage is the only wide composition, and
  // every card reaches its controls in place rather than through a second layout.
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  await expectNoPageOverflow(page);

  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  // Importing the bundled feed is automatic on load, so the seeded lane is
  // present without anything being pressed. The button it replaced is gone.
  await expect(page.getByRole('button', { name: /^Import \d+$/ })).toHaveCount(0);
  await expect(page.getByText('Neverness to Everness', { exact: true }).first()).toBeVisible();
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

  // The Agenda view was retired; lanes are the timeline. What it used to prove —
  // that seeded events actually rendered — the lane bars above already cover.
  await expect(page.getByRole('radio', { name: 'Agenda' })).toHaveCount(0);
  await expectNoPageOverflow(page);
});

test('tabs cross-slide without spilling the page sideways', async ({ page }) => {
  await addGenshin(page);

  for (const [route, heading] of [
    ['Timeline', 'Event timeline'],
    ['Settings', 'Settings'],
    ['Dashboard', 'Dashboard'],
  ] as const) {
    await page.getByRole('button', { name: route, exact: true }).click();
    await expect(page.getByRole('button', { name: route, exact: true })).toHaveAttribute('aria-current', 'page');
    // Measured DURING the transition, not after it: the outgoing page is still
    // mounted and translated, which is exactly when a missing overflow clip
    // would show up as a horizontal scrollbar.
    await expectNoPageOverflow(page);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeAttached();
    await expectNoPageOverflow(page);
  }
});

test('animated Add menu transfers focus to a sheet and releases pointer input', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const add = page.getByRole('button', { name: 'Add', exact: true });
  await add.click();
  await expect(page.getByRole('menu')).toHaveCSS('animation-name', 'popoverOpen');
  await page.getByRole('menuitem', { name: 'Reminder', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await add.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await add.click();
  const duration = await page
    .getByRole('menu')
    .evaluate((node) => parseFloat(getComputedStyle(node).animationDuration));
  expect(duration).toBeLessThan(0.001);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expectNoPageOverflow(page);
});
