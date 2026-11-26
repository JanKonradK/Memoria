import { expect, test, type Page } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeEvent, makeGame } from '../../shared/test/helpers';
import { gameRow, openSettings, showTimeline, showTodayGames } from './support';

// The suite runs under reduced motion; this file is about the motion itself.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

const DAY = 86_400_000;

/** Two games and one running event, straight through the store, then a fresh load on Today. */
async function seed(page: Page) {
  const now = Date.now();
  const games = [
    makeGame({ id: 'motion-one', name: 'Motion one', short: 'M1', color: '#38bdf8', sort: 0, updatedAt: now }),
    makeGame({ id: 'motion-two', name: 'Motion two', short: 'M2', color: '#f472b6', sort: 1, updatedAt: now }),
  ];
  const events = [
    makeEvent({
      id: 'motion-event',
      gameId: 'motion-one',
      name: 'Handoff story',
      type: 'event',
      start: now - 2 * DAY,
      end: now + 20 * DAY,
      updatedAt: now,
    }),
  ];
  await page.addInitScript(() => {
    localStorage.setItem('memoria-onboarding', 'complete');
    // Which kinds of view transition the app starts, as CSS scopes them.
    const started: string[] = [];
    Object.assign(window, { __viewTransitions: started });
    const start = Document.prototype.startViewTransition;
    if (typeof start !== 'function') return;
    Document.prototype.startViewTransition = function (this: Document, options) {
      started.push(typeof options === 'function' ? 'untyped' : (options?.types ?? []).join(' ') || 'untyped');
      return start.call(this, options);
    } as typeof start;
  });
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('nav[aria-label="Primary"]'));
  await page.evaluate(
    async (text) => {
      const path = '/src/store.ts';
      const { useApp, flushPersist } = await import(/* @vite-ignore */ path);
      useApp.getState().importJson(text);
      await flushPersist();
    },
    JSON.stringify({ ...emptyState(), games, events }),
  );
  await page.reload();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today', exact: true })).toBeVisible();
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('a game opens through its logo morph and Today takes the next click at once', async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23'].includes(info.project.name), 'A wide rail and a phone dock');
  await seed(page);
  await showTodayGames(page);
  const row = gameRow(page, 'Motion one');
  await row.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  await row.click();
  await expect(page.locator('.focus-workspace h1')).toBeFocused();
  // Straight back while the logo may still be in the air: its layer lets the click through.
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await expect(row).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0);
  // Both ways were the logo's own kind of transition, never a look's cross-fade.
  const kinds = await page.evaluate(() => (window as unknown as { __viewTransitions: string[] }).__viewTransitions);
  expect(kinds.length).toBeGreaterThan(0);
  expect(new Set(kinds)).toEqual(new Set(['game-logo']));
  // Nothing is left on the root once it lands: it is captured again by the next transition as usual.
  await expect.poll(() => page.evaluate(() => document.documentElement.style.viewTransitionName)).toBe('');
  await expect(page.locator('html')).not.toHaveAttribute('data-vt');
  // The page under the morph stays usable: the same row opens the game again.
  await row.click();
  await expect(page.locator('.focus-workspace h1')).toBeFocused();
  expect(await noSidewaysScroll(page)).toBe(true);
});

/** Frame by frame from a click on a rail place: where the page bar is drawn, and what under it arrives. */
function sampleArrival(page: Page, place: string) {
  return page.evaluate(async (place) => {
    const nav = document.querySelector('nav[aria-label="Primary"]')!;
    const button = [...nav.querySelectorAll<HTMLElement>('.rail-view')].find(
      (node) => node.querySelector('.rail-label')?.textContent === place,
    )!;
    button.click();
    const frames: { bar: number | null; transform: string | null; overflow: boolean; moving: string[] }[] = [];
    const start = performance.now();
    while (performance.now() - start < 400) {
      await new Promise(requestAnimationFrame);
      const bar = document.querySelector<HTMLElement>('.page-enter .page-bar');
      const moving = [...document.querySelectorAll('.page-enter .app-page > *, .page-enter .focus-workspace > *')]
        .flatMap((node) => node.getAnimations().filter((animation) => animation.id === 'page-arrival'))
        .flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes())
        .flatMap((frame) => Object.keys(frame).filter((key) => key === 'opacity' || key === 'transform'));
      frames.push({
        bar: bar ? bar.getBoundingClientRect().left : null,
        transform: bar ? getComputedStyle(bar).transform : null,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        moving,
      });
    }
    return frames;
  }, place);
}

test('a place arrives under its page bar, which never moves', async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23', 'landscape-667'].includes(info.project.name), 'Rail, dock, phone on its side');
  await seed(page);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  // Each place once first, so its chunk is here and what is measured is the arrival itself.
  for (const place of ['Calendar', 'Notes', 'Settings', 'Today']) {
    await nav.getByRole('button', { name: place, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: place, exact: true })).toBeVisible();
  }
  const upright = (page.viewportSize()?.height ?? 0) > (page.viewportSize()?.width ?? 0);
  for (const place of ['Notes', 'Calendar', 'Today']) {
    const frames = (await sampleArrival(page, place)).filter((frame) => frame.bar !== null);
    expect(frames.length).toBeGreaterThan(0);
    // The bar is drawn in one place, untransformed, from the first frame of the arrival to its last.
    const resting = frames.at(-1)!.bar!;
    for (const frame of frames) {
      expect(frame.bar!).toBeCloseTo(resting, 0);
      expect(frame.transform).toBe('none');
      expect(frame.overflow).toBe(false);
    }
    // What is under it did arrive: a fade down the side rail, a fade and a short glide on the dock.
    const animated = new Set(frames.flatMap((frame) => frame.moving));
    expect(animated.has('opacity')).toBe(true);
    expect(animated.has('transform')).toBe(upright);
    await expect(page.getByRole('heading', { level: 1, name: place, exact: true })).toBeVisible();
  }
  expect(await noSidewaysScroll(page)).toBe(true);
});

test('a quick view hands over to its editor without the scrim letting go', async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23'].includes(info.project.name), 'Desktop dialog and phone sheet');
  await seed(page);
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Calendar', exact: true })
    .click();
  await showTimeline(page);
  await page.getByRole('button', { name: 'Open Motion one event: Handoff story', exact: true }).click();
  const view = page.getByRole('dialog', { name: 'Handoff story' });
  await expect(view).toBeVisible();
  if (info.project.name === 'desktop') {
    // Closing back to a bar on desktop returns focus quietly without popping its hover tooltip.
    await page.keyboard.press('Escape');
    await expect(view).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open Motion one event: Handoff story', exact: true })).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open Motion one event: Handoff story', exact: true }).click();
    await expect(view).toBeVisible();
  }
  await page.waitForTimeout(400);
  // Edit, then every frame until the editor is up: some scrim is always fully drawn.
  const frames = await page.evaluate(async () => {
    const edit = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find(
      (node) => node.textContent?.trim() === 'Edit',
    )!;
    edit.click();
    const covered: boolean[] = [];
    const start = performance.now();
    while (performance.now() - start < 1500) {
      await new Promise(requestAnimationFrame);
      covered.push(
        [...document.querySelectorAll('.sheet-scrim')].some((scrim) => Number(getComputedStyle(scrim).opacity) > 0.98),
      );
      const editor = document.querySelector('[role="dialog"][aria-labelledby]');
      if (editor?.querySelector('input') && covered.length > 4) break;
    }
    return covered;
  });
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every(Boolean)).toBe(true);
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('Handoff story');
  await expect.poll(() => editor.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  // Leaving the editor for no sheet fades the scrim out, and leaves nothing behind.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-layer=sheet]')).toHaveCount(0);
  await expect(page.locator('.sheet-scrim')).toHaveCount(0);
});

test('a confirm keeps its words through its exit and leaves the draft as it was', async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23'].includes(info.project.name), 'Desktop dialog and phone sheet');
  await seed(page);
  await openSettings(page, 'Reminders');
  await page.getByRole('button', { name: 'New reminder', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'New reminder' });
  const message = sheet.getByRole('textbox', { name: 'Message' });
  await message.fill('Keep me');
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('alertdialog', { name: 'Discard your unsaved changes?' });
  await expect(confirm).toBeVisible();
  await page.waitForTimeout(300);
  const frames = await page.evaluate(async () => {
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
    const keep = [...dialog.querySelectorAll<HTMLElement>('button')].find(
      (node) => node.textContent?.trim() === 'Keep editing',
    )!;
    keep.click();
    const seen: { state: string | null; title: string; buttons: string[] }[] = [];
    const start = performance.now();
    while (dialog.isConnected && performance.now() - start < 1000) {
      seen.push({
        state: dialog.getAttribute('data-state'),
        title: dialog.querySelector('h2')?.textContent ?? '',
        buttons: [...dialog.querySelectorAll('button')].map((node) => node.textContent ?? ''),
      });
      await new Promise(requestAnimationFrame);
    }
    return { seen, gone: !dialog.isConnected };
  });
  expect(frames.gone).toBe(true);
  // It animated out (at least one frame closing), and no frame of that exit lost its words.
  expect(frames.seen.some((frame) => frame.state === 'closed')).toBe(true);
  for (const frame of frames.seen) {
    expect(frame.title).toBe('Discard your unsaved changes?');
    expect(frame.buttons).toEqual(['Keep editing', 'Discard']);
  }
  await expect(confirm).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(message).toHaveValue('Keep me');
});

test('on a phone a Settings section pushes in and Back slides the menu home', async ({ page }, info) => {
  test.skip(info.project.name !== 'android-s23', 'The narrow Settings menu');
  await seed(page);
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  const menu = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(menu).toBeVisible();
  const layout = page.locator('.settings-layout');
  // A first arrival is the page's own; the menu itself does not slide.
  await expect(layout).not.toHaveAttribute('data-step');
  await menu.getByRole('button', { name: /^Appearance/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Appearance', exact: true })).toBeVisible();
  await expect(layout).toHaveAttribute('data-step', 'forward');
  await expect(page.locator('.settings-pane')).toHaveCSS('animation-name', 'settingsPush');
  await expect(page.locator('.settings-page .page-bar')).toHaveCSS('transform', 'none');
  await page.getByRole('button', { name: 'Back to Settings', exact: true }).click();
  await expect(menu).toBeVisible();
  await expect(layout).toHaveAttribute('data-step', 'back');
  await expect(page.locator('.settings-menu')).toHaveCSS('animation-name', 'settingsPop');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});

test('a game page slides one underline between its tabs', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile-390'].includes(info.project.name), 'A one-row bar and a narrow, scrolling strip');
  await seed(page);
  await showTodayGames(page);
  await gameRow(page, 'Motion one').click();
  const strip = page.getByRole('tablist', { name: 'Motion one sections' });
  await expect(strip).toBeVisible();
  const underline = strip.locator('.game-tab-underline');
  await expect(underline).toHaveCount(1);
  // Each tab no longer draws a line of its own.
  expect(
    await strip.getByRole('tab', { name: 'Track' }).evaluate((node) => getComputedStyle(node, '::after').content),
  ).toBe('none');
  /** The underline's box against the chosen tab's. */
  const placement = () =>
    strip.evaluate((node) => {
      const line = node.querySelector<HTMLElement>('.game-tab-underline')!;
      const tab = node.querySelector<HTMLElement>('[aria-selected="true"]')!;
      return {
        x: new DOMMatrixReadOnly(getComputedStyle(line).transform).m41,
        width: line.getBoundingClientRect().width,
        tabX: tab.offsetLeft,
        tabWidth: tab.clientWidth,
      };
    });
  await expect.poll(async () => (await placement()).x).toBeCloseTo((await placement()).tabX, 0);
  const from = await placement();
  expect(from.width).toBeCloseTo(from.tabWidth, 0);
  await strip.getByRole('tab', { name: /^Events/ }).click();
  await expect(strip.getByRole('tab', { name: /^Events/ })).toHaveAttribute('aria-selected', 'true');
  // It slides on the compositor, from one tab to the next.
  expect(await underline.evaluate((node) => getComputedStyle(node).transitionProperty)).toContain('transform');
  await expect
    .poll(async () => {
      const at = await placement();
      return Math.abs(at.x - at.tabX) < 0.5 && Math.abs(at.width - at.tabWidth) < 0.5;
    })
    .toBe(true);
  expect((await placement()).x).toBeGreaterThan(from.x);
  // The keyboard moves it too.
  await strip.getByRole('tab', { name: /^Events/ }).press('ArrowLeft');
  await expect(strip.getByRole('tab', { name: 'Track' })).toBeFocused();
  await expect.poll(async () => (await placement()).x).toBeCloseTo(from.x, 0);
  expect(await noSidewaysScroll(page)).toBe(true);
});

test('under reduced motion nothing slides or fades on its way in', async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23'].includes(info.project.name), 'A wide rail and a phone dock');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  for (const place of ['Calendar', 'Notes', 'Today']) {
    await nav.getByRole('button', { name: place, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: place, exact: true })).toBeVisible();
  }
  const frames = (await sampleArrival(page, 'Notes')).filter((frame) => frame.bar !== null);
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every((frame) => frame.moving.length === 0 && frame.transform === 'none')).toBe(true);
  // A game opens with no logo morph and no arrival, and its underline jumps.
  await nav.getByRole('button', { name: 'Today', exact: true }).click();
  await showTodayGames(page);
  await gameRow(page, 'Motion one').click();
  await expect(page.locator('.focus-workspace h1')).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __viewTransitions: string[] }).__viewTransitions)).toEqual(
    [],
  );
  const underline = page.locator('.game-tab-underline');
  await page.getByRole('tab', { name: /^Events/ }).click();
  expect(await underline.evaluate((node) => getComputedStyle(node).transitionProperty)).not.toContain('transform');
  // A confirm still opens and closes, just at once.
  await openSettings(page, 'Reminders');
  await page.getByRole('button', { name: 'New reminder', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Reduced');
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('alertdialog', { name: 'Discard your unsaved changes?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('crossing the Settings split width does not slide the menu in as Back', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Wide Settings resizing across 900px');
  await seed(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  await expect(page.locator('.settings-layout')).not.toHaveAttribute('data-step');
});
