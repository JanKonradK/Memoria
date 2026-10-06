import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function openControls(page: Page) {
  const open = page.getByRole('button', { name: 'Open Genshin Impact controls', exact: true });
  const edit = page.getByRole('button', { name: 'Edit Genshin Impact', exact: true });
  await expect(open.or(edit)).toBeVisible();
  if (await open.isVisible()) await open.click();
}

async function stored(page: Page) {
  // Read the debounced persisted document, not a second Vite module instance.
  await page.waitForTimeout(400);
  return page.evaluate(async () => {
    const state = await new Promise<import('@memoria/shared').AppState>((resolve, reject) => {
      const open = indexedDB.open('keyval-store');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('keyval').objectStore('keyval').get('memoria-state');
        request.onsuccess = () => {
          resolve(request.result);
          db.close();
        };
        request.onerror = () => {
          reject(request.error);
          db.close();
        };
      };
    });
    return {
      layout: state.games[0]!.cardLayout,
      snapshots: state.snapshots,
      completions: state.completions,
      games: state.games,
      tasks: state.tasks,
      resources: state.resources,
    };
  });
}

test.beforeEach(async ({ page }, info) => {
  test.skip(!['android-s23', 'mobile-320', 'desktop'].includes(info.project.name), 'Widget layout sizes');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Add your first game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openControls(page);
});

test('each widget stays full width and can be moved, hidden, restored, and saved without changing tracking', async ({
  page,
}, info) => {
  const before = await stored(page);
  await page.getByRole('button', { name: 'Edit Genshin Impact', exact: true }).last().click();
  await expect(page.getByRole('region', { name: 'Layout editor for Genshin Impact' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const resin = page.getByRole('button', { name: 'Move Original Resin', exact: true });
  const resinWidget = page.locator('[data-layout-item]').filter({ has: resin });
  await resin.focus();
  await resin.press('ArrowDown');
  await page.getByRole('button', { name: 'Edit item Original Resin', exact: true }).click();
  await page.getByRole('button', { name: 'Move Original Resin up', exact: true }).click();
  await expect(page.locator('.game-widget-grid > [data-layout-item]').first()).toHaveAttribute(
    'data-layout-item',
    await resinWidget.getAttribute('data-layout-item'),
  );
  await expect(page.getByRole('button', { name: 'Move Original Resin up', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Move Original Resin down', exact: true }).click();
  await page.getByRole('button', { name: 'Capacity and regeneration settings', exact: true }).click();
  const resourceSettings = page.getByRole('dialog', { name: 'Genshin Impact', exact: true });
  await expect(resourceSettings.getByRole('tab', { name: 'Energy', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(resourceSettings.getByLabel('Resource name', { exact: true }).first()).toHaveValue('Original Resin');
  await resourceSettings.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Edit item Quick spend', exact: true }).click();
  await page.getByRole('button', { name: 'Edit quick spends', exact: true }).click();
  const quickSettings = page.getByRole('dialog', { name: 'Genshin Impact', exact: true });
  await expect(quickSettings.getByRole('tab', { name: 'Quick spend', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await quickSettings.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Edit item Original Resin', exact: true }).click();
  await expect(page.getByRole('button', { name: /Half width|Full width|Resize/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide Original Resin', exact: true }).click();
  await expect(resin).toHaveCount(0);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Original Resin', exact: true }).click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Condensed Resin', exact: true }).click();
  await page.getByRole('button', { name: 'Edit item Condensed Resin', exact: true }).click();
  await page.getByRole('button', { name: 'Close item', exact: true }).click();
  await page.getByRole('button', { name: 'Edit item Daily Commissions ×4', exact: true }).click();
  await page.getByRole('button', { name: 'Close item', exact: true }).click();
  await expect
    .poll(() =>
      page.locator('.game-widget-grid > [data-layout-item]').evaluateAll((nodes) => {
        const boxes = nodes.map((node) => node.getBoundingClientRect());
        return (
          nodes.every((node) => node.scrollWidth <= node.clientWidth + 1) &&
          boxes.every((box, i) =>
            boxes
              .slice(i + 1)
              .every(
                (other) =>
                  Math.min(box.right, other.right) <= Math.max(box.left, other.left) + 1 ||
                  Math.min(box.bottom, other.bottom) <= Math.max(box.top, other.top) + 1,
              ),
          )
        );
      }),
    )
    .toBe(true);
  // Each item fills the same single column without overflow or overlap.
  const fullRows = await page.locator('.game-widget-grid > [data-layout-item]').evaluateAll((nodes) => {
    const first = nodes[0]!.getBoundingClientRect();
    return nodes.every((node) => Math.abs(node.getBoundingClientRect().width - first.width) < 1);
  });
  expect(fullRows).toBe(true);
  await expect.poll(() => resinWidget.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await resin.scrollIntoViewIfNeeded();
  const doneBox = (await page.getByRole('button', { name: 'Done', exact: true }).boundingBox())!;
  const navBox = (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())!;
  if (page.viewportSize()!.width < 640) expect(doneBox.y + doneBox.height).toBeLessThanOrEqual(navBox.y);
  await page.screenshot({ path: info.outputPath('layout-editor.png') });
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    ),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const saved = await stored(page);
  expect(saved.snapshots).toEqual(before.snapshots);
  expect(saved.completions).toEqual(before.completions);
  expect(saved.layout?.find((item) => item.id.startsWith('resource:'))).toBeDefined();
  expect(saved.layout?.every((item) => !('width' in item))).toBe(true);
  await page.reload();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await openControls(page);
  expect((await stored(page)).layout).toEqual(saved.layout);
  const value = page.getByLabel('Original Resin current value');
  await value.fill('99');
  await value.press('Enter');
  await expect(value).toHaveValue('99');
  await page.getByRole('button', { name: /Daily Commissions/ }).click();
  await expect(page.getByRole('button', { name: /Daily Commissions/ })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('custom-layout.png') });
  await page.getByRole('button', { name: 'Edit Genshin Impact', exact: true }).last().click();
  await page.getByRole('button', { name: 'Reset layout', exact: true }).click();
  await page.getByRole('button', { name: 'Undo layout changes', exact: true }).click();
  expect((await stored(page)).layout).toEqual(saved.layout);
  await page.getByRole('button', { name: 'Edit Genshin Impact', exact: true }).last().click();
  await page.getByRole('button', { name: 'Reset layout', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await stored(page)).layout).toBeUndefined();
  await expect(value).toHaveValue('99');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pointer dragging reorders widgets and cancellation leaves saved order intact', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Edit Genshin Impact', exact: true }).last().click();
  const grid = page.locator('.game-widget-grid');
  const order = () =>
    grid
      .locator(':scope > [data-layout-item]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-layout-item')));
  const original = await order();
  const first = grid.locator(':scope > [data-layout-item]').first();
  await first.scrollIntoViewIfNeeded();
  const handle = first.getByRole('button', { name: /^Move / });
  const a = (await handle.boundingBox())!;
  const b = (await grid.locator(':scope > [data-layout-item]').nth(1).boundingBox())!;
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const end = { x: b.x + b.width / 2, y: Math.min(b.y + b.height / 2, page.viewportSize()!.height - 100) };
  await page.screenshot({ path: info.outputPath('before-drag.png') });
  if (info.project.name === 'android-s23') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await page.waitForTimeout(450);
    await expect(page.getByRole('status').filter({ hasText: 'lifted' })).toHaveCount(1);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
    await expect.poll(order).not.toEqual(original);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await expect.poll(order).not.toEqual(original);
    await page.mouse.up();
  }
  await expect.poll(order).not.toEqual(original);
  const saved = await stored(page);
  const currentHandle = grid.getByRole('button', { name: 'Move Original Resin', exact: true });
  await currentHandle.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await expect
    .poll(() => currentHandle.evaluate((node) => getComputedStyle(node.closest('[data-layout-item]')!).transform))
    .toBe('none');
  const box = (await currentHandle.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y - 70, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await stored(page)).layout).toEqual(saved.layout);
  await expect(page.getByRole('region', { name: 'Layout editor for Genshin Impact' })).toBeVisible();
});

test('Edit changes the game title and creates, renames, deletes, and restores real items', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit Genshin Impact', exact: true }).last().click();
  await expect(page.getByLabel('Selected widget controls')).toHaveCount(0);
  await page.getByLabel('Game title', { exact: true }).fill('Evening check-in');
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.locator('form').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter a name.');
  await page.getByLabel('New item name').fill('Claim mail');
  await page.locator('form').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move Claim mail', exact: true })).toBeVisible();
  await page.getByLabel('Item title', { exact: true }).fill('Collect mail');
  await page.getByRole('button', { name: 'Delete Collect mail', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move Collect mail', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo delete', exact: true }).click();
  await page.getByRole('button', { name: 'Edit item Collect mail', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Collect mail', exact: true }).click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByRole('combobox', { name: 'New item type' }).click();
  await page.getByRole('option', { name: 'Counter', exact: true }).click();
  await page.getByLabel('New item name').fill('Tickets');
  await page.getByLabel('New resource cap').fill('12');
  await page.locator('form').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByLabel('Tickets current value').fill('7');
  await page.getByLabel('Tickets current value').press('Enter');
  await page.getByRole('button', { name: 'Edit Evening check-in', exact: true }).last().click();
  await page.getByRole('button', { name: 'Edit item Tickets', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Tickets', exact: true }).click();
  await page.getByRole('button', { name: 'Undo delete', exact: true }).click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByRole('combobox', { name: 'New item type' }).click();
  await page.getByRole('option', { name: 'Energy', exact: true }).click();
  await page.getByLabel('New item name').fill('Stamina');
  await page.getByLabel('New resource cap').fill('180');
  await page.getByLabel('New resource minutes per point').fill('8');
  await page.locator('form').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByLabel('Tickets current value')).toHaveValue('7');
  const saved = await stored(page);
  expect(saved.games[0]!.name).toBe('Evening check-in');
  expect(saved.tasks.find((item) => item.name === 'Collect mail')?.deleted).toBe(true);
  expect(saved.resources.find((item) => item.name === 'Tickets')).toMatchObject({ cap: 12, kind: 'counter' });
  expect(saved.resources.find((item) => item.name === 'Stamina')).toMatchObject({
    cap: 180,
    kind: 'regen',
    regenMinutes: 8,
  });
  await page.reload();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  const open = page.getByRole('button', { name: /^(Open|Expand) Evening check-in controls$/ });
  await expect(open.or(page.getByLabel('Tickets current value'))).toBeVisible();
  if (await open.isVisible()) await open.click();
  await expect(page.getByLabel('Tickets current value')).toHaveValue('7');
  await expect(page.getByRole('button', { name: /Collect mail/ })).toHaveCount(0);
});

test('a quick touch swipe scrolls instead of moving an item', async ({ page }, info) => {
  test.skip(info.project.name !== 'android-s23', 'Native Android touch scroll');
  await page.getByRole('button', { name: 'Edit Genshin Impact', exact: true }).last().click();
  const handle = page.getByRole('button', { name: 'Move Original Resin', exact: true });
  await handle.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  const box = (await handle.boundingBox())!;
  const before = await handle.evaluate((node) => node.getBoundingClientRect().top);
  const cdp = await page.context().newCDPSession(page);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  for (const offset of [25, 60, 110])
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y - offset }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect.poll(() => handle.evaluate((node) => node.getBoundingClientRect().top)).toBeLessThan(before - 30);
  expect((await stored(page)).layout).toBeUndefined();
  await expect(page.getByLabel('Item title', { exact: true })).toHaveCount(0);
});
