import { expect, test } from '@playwright/test';

// Every other spec runs without the intro: index.html skips it for automated
// browsers. Here the browser passes for a person's.
// The suite runs with reduced motion; the intro is the thing under test here.
test.use({ reducedMotion: 'no-preference' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
});

test('the intro plays over the loading app, then hands it over', async ({ page }) => {
  await page.goto('/');
  const splash = page.locator('#splash');
  await expect(splash).toHaveClass(/\bgo\b/);
  // Composited properties only: anything else would stall while the app parses.
  const animated = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => (animation.effect as KeyframeEffect).target?.closest('#splash'))
      .flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes())
      .flatMap((frame) => Object.keys(frame))
      .filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)),
  );
  expect(animated.length).toBeGreaterThan(0);
  expect(new Set(animated)).toEqual(new Set(['opacity', 'transform']));
  // Still up while the intro plays, even though the app is ready long before.
  await page.waitForTimeout(1500);
  await expect(splash).toBeAttached();
  await expect(splash).not.toBeAttached({ timeout: 6000 });
  await expect(page.locator('#root > *').first()).toBeVisible();
});

test('a tap skips the rest of the intro once the app is ready', async ({ page }) => {
  await page.goto('/');
  const splash = page.locator('#splash');
  await expect(splash).toHaveClass(/\bgo\b/);
  // Taps before the app has drawn do nothing; the first one after it does.
  await expect(async () => {
    await page.mouse.click(20, 20);
    await expect(splash).toHaveClass(/\bleave\b/, { timeout: 150 });
  }).toPass({ timeout: 1500 });
  const sinceStart = await page.evaluate(() => performance.now() - (window.__memoriaSplashAt ?? 0));
  expect(sinceStart).toBeLessThan(2000);
  await expect(splash).not.toBeAttached({ timeout: 2000 });
});
