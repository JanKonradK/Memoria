import { expect, test } from '@playwright/test';
import { emptyState, PRESETS } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';
import { gameRow, openGame } from './support';

test('saved sheets animate out and lazy editors can open after dismissal', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'mobile-390'].includes(testInfo.project.name), 'Desktop dialog and mobile sheet');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  const add = page.getByRole('button', { name: 'Add', exact: true });
  await add.click();
  await page.getByRole('menuitem', { name: 'Reminder', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Animation check');
  await page.waitForTimeout(500);
  const samples = await page.evaluate(async () => {
    const layer = document.querySelector('[data-layer="sheet"]')!;
    const backdrop = layer.firstElementChild!;
    const save = [...layer.querySelectorAll('button')].find((node) => node.textContent === 'Add reminder')!;
    save.click();
    const frames: number[] = [];
    const start = performance.now();
    while (performance.now() - start < 400) {
      await new Promise(requestAnimationFrame);
      if (layer.isConnected) frames.push(Number(getComputedStyle(backdrop).opacity));
    }
    return frames;
  });
  expect(samples.filter((opacity) => opacity > 0.02 && opacity < 0.98).length).toBeGreaterThan(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await add.click();
  await page.getByRole('menuitem', { name: 'Reminder', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await add.click();
  await page.getByRole('menuitem', { name: 'Add game', exact: true }).click();
  await page.getByPlaceholder('Custom game name…').fill('Motion preview');
  await page.getByRole('button', { name: 'Add custom game', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Motion preview' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.screenshot({ path: testInfo.outputPath('light-dashboard.png') });
});

test('a desktop row opens an integrated page and returns to the same Today geometry', async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1280, 'Desktop stage');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  for (const [index, name, short] of [
    [0, 'Genshin Impact', 'Genshin'],
    [1, 'Honkai: Star Rail', 'HSR'],
    [2, 'Zenless Zone Zero', 'ZZZ'],
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
  const rows = page.locator('.today-priority-row');
  await expect(rows).toHaveCount(3);
  const readGeometry = () =>
    rows.evaluateAll((nodes) =>
      nodes.map((row) => {
        const bounds = row.getBoundingClientRect();
        return {
          id: (row as HTMLElement).dataset.rosterGame,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      }),
    );
  const open = gameRow(page, 'Honkai: Star Rail');
  await open.click();
  const before = await readGeometry();
  await page.getByRole('button', { name: 'Open full page' }).click();
  const workspace = page.getByRole('region', { name: 'Honkai: Star Rail focus workspace' });
  await expect(workspace).toBeVisible();
  await expect(workspace).not.toHaveClass(/\bcard-shell\b/);
  await expect(page.locator('.today-page')).toHaveCount(0);
  const back = page.getByRole('button', { name: 'Back to Today', exact: true });
  await expect(back).toBeFocused();
  // Reverse while the content arrives; navigation and controls stay usable.
  await back.click();
  await expect(open).toBeFocused();
  await expect(page.locator('.today-page')).toHaveCSS('transform', 'none');
  const after = await readGeometry();
  expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
  for (let index = 0; index < before.length; index++) {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(after[index]![key]).toBeCloseTo(before[index]![key], 0);
    }
  }
  await openGame(page, 'Honkai: Star Rail');
  await expect(back).toBeFocused();
  await expect(workspace.getByRole('button', { name: 'Edit Honkai: Star Rail', exact: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('integrated-game-page.png') });
});

test('a long desktop Today list restores its scroll and supports repeated page visits', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'wide-short'].includes(testInfo.project.name), 'Long roster at two desktop heights');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  const games = Array.from({ length: 24 }, (_, index) => {
    const preset = PRESETS[index % PRESETS.length]!;
    return makeGame({
      id: `roster-${index}`,
      name: preset.name,
      short: preset.short,
      color: preset.color,
      accountLabel: `Account ${index + 1}`,
      sort: index,
    });
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'long-roster.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...emptyState(), games })),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const rows = page.locator('.today-priority-row');
  await expect(rows).toHaveCount(24);
  const trigger = rows.last();
  const triggerName = (await trigger.getAttribute('aria-label'))!;
  const order = await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-roster-game')));
  const full = page.getByRole('button', { name: 'Open full page' });
  for (let visit = 0; visit < 3; visit++) {
    await page.getByRole('button', { name: triggerName, exact: true }).click();
    // A short window has the card at the top of the document, so read the
    // scroll the page is left from rather than where the row was.
    await full.scrollIntoViewIfNeeded();
    const savedScroll = await page.evaluate(() => scrollY);
    await full.click();
    const back = page.getByRole('button', { name: 'Back to Today', exact: true });
    await expect(back).toBeFocused();
    await expect(page.locator('.focus-workspace')).toBeVisible();
    await back.click();
    await expect(page.getByRole('button', { name: triggerName, exact: true })).toBeFocused();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(savedScroll, 0);
    expect(await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-roster-game')))).toEqual(
      order,
    );
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('a phone sheet follows its drag, returns smoothly, and dismisses from the release point', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'android-s23', 'Touch sheet');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Reminder', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New reminder' });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(650);
  const origin = (await dialog.boundingBox())!;
  const grab = { x: origin.x + origin.width / 2, y: origin.y + 32 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y + 60, { steps: 6 });
  const dragged = (await dialog.boundingBox())!;
  expect(dragged.y - origin.y).toBeCloseTo(60, 0);
  await page.waitForTimeout(150); // Release after holding still: this is not a fling.
  await page.mouse.up();
  await expect.poll(async () => (await dialog.boundingBox())!.y).toBeCloseTo(origin.y, 0);
  // If capture is interrupted, the surface returns without dismissing the
  // editor or waiting for a pointerup that the header will no longer receive.
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y + 60, { steps: 6 });
  await dialog.locator('.cursor-grab').evaluate((header) => header.releasePointerCapture(1));
  await page.mouse.move(grab.x, grab.y + 62);
  await expect.poll(async () => (await dialog.boundingBox())!.y).toBeCloseTo(origin.y, 0);
  await expect(dialog).toBeVisible();
  await page.mouse.up();
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y + 170, { steps: 8 });
  const release = (await dialog.boundingBox())!;
  await page.mouse.up();
  // The exit continues from the dragged position; it cannot jump back upwards.
  const exiting = await dialog.boundingBox();
  if (exiting) expect(exiting.y).toBeGreaterThanOrEqual(release.y - 2);
  await expect(dialog).toHaveCount(0);
});
