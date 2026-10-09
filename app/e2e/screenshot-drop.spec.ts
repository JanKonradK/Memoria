import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeGame, makeResource } from '../../shared/test/helpers';

test('a screenshot dropped on the app opens a protected OCR review', async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23'].includes(info.project.name), 'Desktop drop flow and narrow-screen layout');
  const state = emptyState();
  state.games = [makeGame({ name: 'Screenshot game' })];
  state.resources = [makeResource({ name: 'Original Resin', cap: 200 })];
  await page.addInitScript(() => {
    localStorage.setItem('memoria-onboarding', 'complete');
    localStorage.setItem('memoria-preset-gap-dismissed', '999');
    localStorage.setItem('memoria-legacy-home-timezone-dismissed', '1');
  });
  // Supply the desktop transport in the browser harness. The real OCR engine
  // has launcher tests; this test exercises FileReader, drop events, and review.
  await page.route(/\/src\/launcher\.ts(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export const servedByLauncher = () => true; export const launcherFetch = (path, init) => fetch(path, init);',
    }),
  );
  await page.route('**/api/state', (route) => route.fulfill({ json: { state, version: 1 } }));
  await page.route('**/api/sync', (route) =>
    route.fulfill({ json: { state: route.request().postDataJSON().state, version: 1 } }),
  );
  await page.route('**/api/events', (route) => route.fulfill({ status: 503, body: '' }));
  let reads = 0;
  await page.route('**/api/ocr', (route) => {
    reads += 1;
    expect(route.request().postDataJSON().mimeType).toBe('image/png');
    return route.fulfill({ json: { text: 'Original Resin 123 / 200', capturedAt: Date.now() - 1000 } });
  });
  await page.goto('/');
  await expect(page.getByText('Screenshot game').first()).toBeAttached();
  const dataTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    // A local 1×1 PNG fixture. No file or image leaves the test server.
    const bytes = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),
      (value) => value.charCodeAt(0),
    );
    data.items.add(new File([bytes], 'screenshot.png', { type: 'image/png' }));
    return data;
  });
  await page.locator('main').dispatchEvent('drop', { dataTransfer });
  const sheet = page.getByRole('dialog', { name: 'Import game readings' });
  const text = sheet.getByRole('textbox', { name: 'Text from the screenshot' });
  await expect(text).toHaveValue('Original Resin 123 / 200');
  expect(reads).toBe(1);
  await expect(sheet.getByRole('button', { name: 'Apply reviewed readings' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Choose screenshot' }).focus();
  await expect(sheet.getByRole('button', { name: 'Choose screenshot' })).toBeFocused();
  const zone = sheet.getByRole('group', { name: 'Screenshot upload' });
  await zone.dispatchEvent('dragenter', { dataTransfer });
  await expect(zone.getByText('Release screenshot to read it')).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await zone.dispatchEvent('drop', { dataTransfer });
  expect(reads).toBe(1);
  await expect(text).toHaveValue('Original Resin 123 / 200');
  await sheet.getByRole('button', { name: 'Review readings', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Apply reviewed readings' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(accessibility.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
  await sheet.screenshot({ path: info.outputPath('screenshot-drop-review.png') });
});
