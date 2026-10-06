import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function addGames(page: Page) {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  for (const [index, name, short] of [
    [0, 'Genshin Impact', 'Genshin'],
    [1, 'Honkai: Star Rail', 'HSR'],
    [2, 'Neverness to Everness', 'NTE'],
  ] as const) {
    if (index === 0) await page.getByRole('button', { name: 'Add your first game' }).click();
    else {
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Add game', exact: true }).click();
    }
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await page.getByRole('button', { name: `Add ${short}`, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
}

test('Tonight positions keep equal columns and persist after reload', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'wide-short'].includes(testInfo.project.name), 'Desktop placement');
  await addGames(page);
  for (const position of ['Left', 'Right', 'Middle'] as const) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('radiogroup', { name: 'Tonight position' })
      .getByRole('radio', { name: position, exact: true })
      .click();
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await expect(page.locator('.nexus-stage')).toHaveAttribute('data-tonight', position.toLowerCase());
    const geometry = await page.evaluate(() => {
      const hub = document.querySelector('[aria-label="Across every game"]')!.getBoundingClientRect();
      const cards = [...document.querySelectorAll('.nexus-node')].map((node) => node.getBoundingClientRect());
      return {
        hub: { x: hub.x, width: hub.width },
        cards: cards.map((r) => ({ x: r.x, width: r.width })),
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
      };
    });
    for (const card of geometry.cards) {
      expect(Math.abs(card.width - geometry.hub.width)).toBeLessThan(2);
      expect(Math.abs(card.x - geometry.hub.x)).toBeGreaterThan(card.width);
    }
    const xs = geometry.cards.map((card) => card.x);
    if (position === 'Left') expect(geometry.hub.x).toBeLessThan(Math.min(...xs));
    if (position === 'Right') expect(geometry.hub.x).toBeGreaterThan(Math.max(...xs));
    if (position === 'Middle') {
      expect(geometry.hub.x).toBeGreaterThan(Math.min(...xs));
      expect(geometry.hub.x).toBeLessThan(Math.max(...xs));
    }
    expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
    await page.screenshot({ path: testInfo.outputPath(`tonight-${position.toLowerCase()}.png`) });
    const open = page.locator('.nexus-summary').first();
    const name = (await open.getAttribute('aria-label'))!;
    await open.click();
    await expect(page.locator('.focus-workspace')).toBeVisible();
    await page.getByRole('button', { name: 'Back to dashboard', exact: true }).click();
    await expect(page.getByRole('button', { name, exact: true })).toBeFocused();
    await expect(page.locator('.nexus-stage')).toHaveAttribute('data-tonight', position.toLowerCase());
  }
  await page.reload();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await expect(page.locator('.nexus-stage')).toHaveAttribute('data-tonight', 'middle');
});

test('shared game focus, event editing, and the guide work at every size', async ({ page }, testInfo) => {
  await addGames(page);
  await expect(page.getByRole('combobox', { name: 'Focus game' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  const focus = page.getByRole('combobox', { name: 'Focus game' });
  await focus.click();
  await page.getByRole('option', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Games', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'Genshin Impact focus workspace' });
  await expect(workspace).toBeVisible();
  await expect(workspace).not.toHaveClass(/\bcard-shell\b/);
  await expect(page.getByRole('combobox', { name: 'Focus game' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to dashboard', exact: true })).toHaveCount(1);
  await expect(workspace.getByRole('button', { name: 'Edit Genshin Impact', exact: true })).toHaveCount(1);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
      ['serious', 'critical'].includes(issue.impact ?? ''),
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('game-page.png') });
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Focus game' })).toContainText('Genshin Impact');
  await page.getByRole('radiogroup', { name: 'Event view' }).getByRole('radio', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Event', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Review window');
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep these notes.');
  await page.getByRole('button', { name: 'End 3 days after start', exact: true }).click();
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Find events', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search events' }).fill('Review window');
  await page
    .getByRole('dialog', { name: 'Find events', exact: true })
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit Genshin Impact event: Review window', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep these notes.');
  const start = await page.getByLabel('Starts', { exact: true }).inputValue();
  await page.getByLabel('Ends', { exact: true }).fill(start);
  await expect(page.getByRole('alert')).toContainText('end must be after');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'End 7 days after start', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('timeline-list.png') });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Focus game' })).toContainText('Genshin Impact');
  await page.getByRole('button', { name: 'User guide', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Your daily run starts here' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Back to dashboard', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Genshin Impact focus workspace' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Focus game' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('first launch opens a spotlight tour and skip persists', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'mobile-390'].includes(testInfo.project.name), 'First-run guide at desktop and phone sizes');
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Your daily run starts here' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Focus game' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add your first game' })).toBeVisible();
  await page.reload();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add your first game' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
