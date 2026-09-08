import { expect, test } from '@playwright/test';
import { PRESETS } from '@memoria/shared';

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

test('game cards keep their nodes and interpolate through expansion and collapse', async ({ page }, testInfo) => {
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
  await page.waitForTimeout(500);

  const frames = await page.evaluate(async () => {
    const cards = [...document.querySelectorAll<HTMLElement>('.nexus-node')];
    const card = cards[1]!;
    const hub = document.querySelector<HTMLElement>('[aria-label="Across every game"]')!;
    const bounds = () => ({
      height: card.getBoundingClientRect().height,
      width: card.getBoundingClientRect().width,
      hubX: hub.getBoundingClientRect().x,
      hubWidth: hub.getBoundingClientRect().width,
      positions: cards.map((node) => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })),
    });
    const sample = async () => {
      const samples = [bounds()];
      const start = performance.now();
      while (performance.now() - start < 600) {
        await new Promise(requestAnimationFrame);
        samples.push(bounds());
      }
      return samples;
    };
    const before = bounds();
    card.querySelector<HTMLButtonElement>('.nexus-summary')!.click();
    const opening = await sample();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const closing = await sample();
    return {
      before,
      opening,
      closing,
      triggerLabel: card.querySelector('.nexus-summary')!.getAttribute('aria-label')!,
      sameNodes: cards.every((node) => node.isConnected),
    };
  });

  expect(frames.sameNodes).toBe(true);
  const expandedHeight = frames.opening.at(-1)!.height;
  expect(expandedHeight).toBeGreaterThan(frames.before.height + 100);
  for (const samples of [frames.opening, frames.closing]) {
    const intermediate = samples.filter(
      (frame) => frame.height > frames.before.height + 2 && frame.height < expandedHeight - 2,
    );
    expect(intermediate.length, 'several painted intermediate heights, in both directions').toBeGreaterThan(3);
    for (const frame of samples) {
      expect(Math.abs(frame.width - frame.hubWidth)).toBeLessThan(2);
      expect(Math.abs(frame.hubX - frames.before.hubX)).toBeLessThan(1);
    }
  }
  expect(frames.closing.at(-1)!.height).toBeCloseTo(frames.before.height, 0);
  const trigger = page.getByRole('button', { name: frames.triggerLabel, exact: true });
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.locator('.nexus-node[data-expanded="true"]')).toHaveAttribute('data-settled', 'true');
  await page.screenshot({ path: testInfo.outputPath('expanded-stage.png') });
});

test('a long roster scrolls beside a fixed expanded card and tolerates rapid switches', async ({ page }, testInfo) => {
  test.skip(!['desktop', 'wide-short'].includes(testInfo.project.name), 'Long roster at two desktop heights');
  test.setTimeout(60_000);
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  for (const [index, preset] of PRESETS.entries()) {
    if (index === 0) await page.getByRole('button', { name: 'Add your first game' }).click();
    else {
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Add game', exact: true }).click();
    }
    await page.getByRole('button', { name: new RegExp(preset.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    await page.getByRole('button', { name: `Add ${preset.short}`, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const cards = page.locator('.nexus-node');
  await expect(cards).toHaveCount(PRESETS.length);
  await cards
    .last()
    .getByRole('button', { name: /^Expand/ })
    .click();
  await expect(page.locator('.nexus-node[data-expanded="true"]')).toHaveAttribute('data-settled', 'true');
  const area = page.getByRole('complementary', { name: 'Game controls' });
  await area.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const geometry = await page.evaluate(() => {
    const card = document.querySelector('.nexus-node[data-expanded="true"]')!.getBoundingClientRect();
    const hub = document.querySelector('[aria-label="Across every game"]')!.getBoundingClientRect();
    const area = document.querySelector('.nexus-games-scroll')!.getBoundingClientRect();
    return { card: { width: card.width, top: card.top }, hubWidth: hub.width, areaTop: area.top };
  });
  expect(Math.abs(geometry.card.width - geometry.hubWidth)).toBeLessThan(2);
  expect(Math.abs(geometry.card.top - geometry.areaTop)).toBeLessThan(2);
  const stable = await page.evaluate(async () => {
    const nodes = [...document.querySelectorAll<HTMLElement>('.nexus-node')];
    for (const node of nodes.slice(0, 4)) {
      node.querySelector<HTMLButtonElement>('.nexus-summary')!.click();
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    await new Promise((resolve) => setTimeout(resolve, 650));
    return nodes.every((node) => node.isConnected);
  });
  expect(stable).toBe(true);
  await expect(page.locator('.nexus-node[data-expanded="true"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.nexus-node[data-expanded="true"]')).toHaveCount(0);
});
