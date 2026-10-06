import { expect, test } from '@playwright/test';
import { emptyState, PRESETS } from '@memoria/shared';
import { makeGame } from '../../shared/test/helpers';

test('saved sheets animate out and lazy editors can open after dismissal', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'mobile-390'].includes(testInfo.project.name), 'Desktop dialog and mobile sheet');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
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
  await page.getByRole('button', { name: '+ Custom', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Motion preview' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.screenshot({ path: testInfo.outputPath('light-dashboard.png') });
});

test('desktop summaries open an integrated page and return to the same overview geometry', async ({
  page,
}, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1280, 'Desktop stage');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
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
  await expect(page.locator('.nexus-node')).toHaveCount(3);
  const readGeometry = () =>
    page.evaluate(() => {
      const hub = document.querySelector('[aria-label="Across every game"]')!.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>('.nexus-node')].map((card) => {
        const bounds = card.getBoundingClientRect();
        return {
          id: card.dataset.gameId,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          hubWidth: hub.width,
        };
      });
    });
  const before = await readGeometry();
  for (const card of before) expect(Math.abs(card.width - card.hubWidth)).toBeLessThan(2);
  const open = page.getByRole('button', { name: 'Open Honkai: Star Rail controls', exact: true });
  await open.click();
  const workspace = page.getByRole('region', { name: 'Honkai: Star Rail focus workspace' });
  await expect(workspace).toBeVisible();
  await expect(workspace).not.toHaveClass(/\bcard-shell\b/);
  await expect(page.locator('.nexus-stage')).toHaveCount(0);
  const back = page.getByRole('button', { name: 'Back to dashboard', exact: true });
  await expect(back).toBeFocused();
  // Reverse while the content arrives; navigation and controls stay usable.
  await back.click();
  await expect(open).toBeFocused();
  await expect(page.locator('.nexus-stage')).toHaveCSS('transform', 'none');
  const after = await readGeometry();
  expect(after.map((card) => card.id)).toEqual(before.map((card) => card.id));
  for (let index = 0; index < before.length; index++) {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(after[index]![key]).toBeCloseTo(before[index]![key], 0);
    }
  }
  await open.press('Enter');
  await expect(back).toBeFocused();
  await expect(workspace.getByRole('button', { name: 'Edit Honkai: Star Rail', exact: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('integrated-game-page.png') });
});

test('a long desktop roster restores its scroll and supports repeated page visits', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'wide-short'].includes(testInfo.project.name), 'Long roster at two desktop heights');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
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
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.nexus-node')).toHaveCount(24);
  const area = page.getByRole('complementary', { name: 'Game controls' });
  const trigger = page.locator('.nexus-summary').last();
  const triggerName = (await trigger.getAttribute('aria-label'))!;
  await trigger.scrollIntoViewIfNeeded();
  const savedScroll = await area.evaluate((node) => node.scrollTop);
  expect(savedScroll).toBeGreaterThan(0);
  const order = await page
    .locator('.nexus-node')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-game-id')));
  for (let visit = 0; visit < 3; visit++) {
    await page.getByRole('button', { name: triggerName, exact: true }).click();
    const back = page.getByRole('button', { name: 'Back to dashboard', exact: true });
    await expect(back).toBeFocused();
    await expect(page.locator('.focus-workspace')).toBeVisible();
    await back.click();
    await expect(page.getByRole('button', { name: triggerName, exact: true })).toBeFocused();
    await expect.poll(() => area.evaluate((node) => node.scrollTop)).toBeCloseTo(savedScroll, 0);
    expect(
      await page.locator('.nexus-node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-game-id'))),
    ).toEqual(order);
  }
  const geometry = await page.evaluate(() => {
    const card = document.querySelector('.nexus-node')!.getBoundingClientRect();
    const hub = document.querySelector('[aria-label="Across every game"]')!.getBoundingClientRect();
    const area = document.querySelector('.nexus-games-scroll')!.getBoundingClientRect();
    return {
      cardWidth: card.width,
      hubWidth: hub.width,
      hubTop: hub.top,
      areaTop: area.top,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(Math.abs(geometry.cardWidth - geometry.hubWidth)).toBeLessThan(2);
  expect(Math.abs(geometry.hubTop - geometry.areaTop)).toBeLessThan(2);
  expect(geometry.overflow).toBe(false);
});

test('a phone sheet follows its drag, returns smoothly, and dismisses from the release point', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'android-s23', 'Touch sheet');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
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
