import { expect, test, type Page } from '@playwright/test';
import { PRESETS, serversFor } from '@memoria/shared';
import { openGame } from './support';

test.skip(({ viewport }) => viewport?.width !== 390, 'Touch gestures on a phone');

/** Genshin on its first server, added straight through the store. */
async function seed(page: Page) {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('nav[aria-label="Primary"]'));
  const preset = PRESETS.find((item) => item.key === 'genshin')!;
  const server = serversFor('genshin')[0];
  await page.evaluate(
    async ({ preset, pick }) => {
      const path = '/src/store.ts';
      const { useApp, flushPersist } = await import(/* @vite-ignore */ path);
      useApp.getState().addGameFromPreset(preset, pick);
      await flushPersist();
    },
    { preset, pick: server ? { server: server.id, tz: server.tz } : { tz: preset.tz } },
  );
  await page.reload();
  // Today's page is a lazy chunk: wait for it, not only the rail.
  await expect(page.getByRole('heading', { level: 1, name: 'Today', exact: true })).toBeVisible();
}

/** A finger on the first element matching `selector`, as pointer events at one height. */
function finger(page: Page, selector: string) {
  return (type: 'pointerdown' | 'pointermove' | 'pointerup', x: number) =>
    page.evaluate(
      ([selector, type, x]) => {
        document.querySelector(selector as string)!.dispatchEvent(
          new PointerEvent(type as string, {
            bubbles: true,
            pointerId: 7,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x as number,
            clientY: 300,
          }),
        );
      },
      [selector, type, x] as const,
    );
}

const shift = (page: Page) =>
  page.locator('.game-tab-panel').evaluate((node) => {
    const raw = getComputedStyle(node).translate;
    return raw === 'none' ? 0 : parseFloat(raw);
  });

const barPositions = (page: Page) =>
  page.evaluate(() => ({
    bar: document.querySelector<HTMLElement>('.game-bar')!.getBoundingClientRect().left,
    tabs: document.querySelector<HTMLElement>('.game-tabs')!.getBoundingClientRect().left,
  }));

test('only a game page swipes: Today, Calendar, Notes and Settings stay put', async ({ page }) => {
  await seed(page);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  for (const place of ['Today', 'Calendar', 'Notes', 'Settings']) {
    const button = nav.getByRole('button', { name: place, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#main-content h1')).toBeVisible();
    const send = finger(page, '#main-content h1');
    await send('pointerdown', 300);
    await send('pointermove', 220);
    await send('pointermove', 120);
    await expect(page.locator('.page-enter[data-swiping]')).toHaveCount(0);
    await send('pointerup', 100);
    await expect(button).toHaveAttribute('aria-current', 'page');
  }
});

test('a game page swipes through its tabs and rubber-bands at either end', async ({ page }) => {
  await seed(page);
  await openGame(page, 'Genshin Impact');
  const heading = page.getByRole('heading', { level: 1, name: 'Genshin Impact' });
  const tab = (name: string | RegExp) => page.getByRole('tab', { name });
  const send = finger(page, '.focus-workspace h1');

  const resting = await barPositions(page);

  // Drag left: the page follows the finger a little, while the bar stays put, then the next tab opens.
  await send('pointerdown', 300);
  await send('pointermove', 260);
  await send('pointermove', 200);
  await expect(page.locator('.page-enter[data-swiping]')).toHaveCount(1);
  expect(await shift(page)).toBeLessThan(-10);
  expect((await barPositions(page)).bar).toBeCloseTo(resting.bar, 0);
  expect((await barPositions(page)).tabs).toBeCloseTo(resting.tabs, 0);
  await send('pointerup', 180);
  await expect(tab(/^Events/)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.page-enter[data-swiping]')).toHaveCount(0);

  // Back to Track, the first tab; past it the page only stretches, at most 48px, and stays.
  for (let swipe = 0; swipe < 2; swipe++) {
    await send('pointerdown', 100);
    await send('pointermove', 200);
    await send('pointermove', 340);
    if (swipe === 1) {
      await expect(page.locator('.page-enter[data-swiping]')).toHaveCount(1);
      const stretch = await shift(page);
      expect(stretch).toBeGreaterThan(10);
      expect(stretch).toBeLessThanOrEqual(48);
      expect((await barPositions(page)).bar).toBeCloseTo(resting.bar, 0);
      expect((await barPositions(page)).tabs).toBeCloseTo(resting.tabs, 0);
    }
    await send('pointerup', 360);
  }
  await expect(tab('Track')).toHaveAttribute('aria-selected', 'true');
  await expect(heading).toBeVisible();

  // The last tab has nothing after it: no next game, no next place.
  await tab('Notes').click();
  await send('pointerdown', 340);
  await send('pointermove', 240);
  await send('pointermove', 100);
  await send('pointerup', 80);
  await expect(tab('Notes')).toHaveAttribute('aria-selected', 'true');
  await expect(heading).toBeVisible();
  await expect(page.locator('.page-enter[data-swiping]')).toHaveCount(0);
});

test('a drag from the screen edge or along the tab strip leaves the tabs alone', async ({ page }) => {
  await seed(page);
  await openGame(page, 'Genshin Impact');
  const track = page.getByRole('tab', { name: 'Track' });
  await expect(track).toHaveAttribute('aria-selected', 'true');

  // Within 24px of the edge belongs to the system's back gesture.
  const onHeading = finger(page, '.focus-workspace h1');
  await onHeading('pointerdown', 12);
  await onHeading('pointermove', 140);
  await onHeading('pointermove', 280);
  await expect(page.locator('.page-enter[data-swiping]')).toHaveCount(0);
  await onHeading('pointerup', 300);
  const right = page.viewportSize()!.width - 10;
  await onHeading('pointerdown', right);
  await onHeading('pointermove', right - 140);
  await onHeading('pointermove', right - 280);
  await onHeading('pointerup', right - 300);
  await expect(track).toHaveAttribute('aria-selected', 'true');

  // The tab strip scrolls sideways itself.
  const onTabs = finger(page, '.game-tabs');
  await onTabs('pointerdown', 320);
  await onTabs('pointermove', 220);
  await onTabs('pointermove', 100);
  await expect(page.locator('.page-enter[data-swiping]')).toHaveCount(0);
  await onTabs('pointerup', 80);
  await expect(track).toHaveAttribute('aria-selected', 'true');
});
