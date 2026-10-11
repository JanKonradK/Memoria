import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeGame, makeResource } from '../../shared/test/helpers';

for (const method of ['drop', 'paste'] as const) {
  test(`a screenshot ${method} saves what is certain and asks in the card about the rest`, async ({ page }, info) => {
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
    // has launcher tests; this test exercises FileReader, drop events, and the card.
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
    await page.route('**/api/connections', (route) => route.fulfill({ json: { connections: [] } }));
    // The first image states its cap. The second does not, so it must be checked.
    const texts = ['Original Resin 123 / 200', 'Original Resin 140'];
    let reads = 0;
    await page.route('**/api/ocr', (route) => {
      expect(route.request().postDataJSON().mimeType).toBe('image/png');
      const text = texts[Math.min(reads, texts.length - 1)]!;
      reads += 1;
      return route.fulfill({ json: { text, capturedAt: Date.now() - 1000 } });
    });
    await page.goto('/');
    await expect(page.getByText('Screenshot game').first()).toBeAttached();
    // Wait for the lazy intake and its document listeners to mount.
    await expect(page.locator('[data-reading-intake]')).toBeAttached();
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
    const send = async () => {
      if (method === 'paste') {
        await page.locator('main').evaluate((target, clipboardData) => {
          target.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
        }, dataTransfer);
      } else {
        await page.locator('main').dispatchEvent('drop', { dataTransfer });
      }
    };

    await send();
    await expect(page.getByRole('status').filter({ hasText: 'Saved 1 reading to Screenshot game.' })).toBeVisible();
    expect(reads).toBe(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('region', { name: /^Check this reading/ })).toHaveCount(0);

    await send();
    const review = page.getByRole('region', { name: 'Check this reading for Screenshot game', exact: true });
    await expect(review.getByRole('spinbutton', { name: 'Original Resin / 200', exact: true })).toHaveValue('140');
    expect(reads).toBe(2);

    // Dragging a file over the window says what a drop will do.
    await page.locator('main').dispatchEvent('dragover', { dataTransfer });
    await expect(page.getByText('Drop the screenshot to read it')).toBeVisible();
    await page.locator('main').dispatchEvent('dragend');
    await expect(page.getByText('Drop the screenshot to read it')).toHaveCount(0);

    // A reading still being checked is not replaced without consent.
    page.once('dialog', (dialog) => dialog.dismiss());
    await send();
    expect(reads).toBe(2);
    await expect(review.getByRole('spinbutton', { name: 'Original Resin / 200', exact: true })).toHaveValue('140');

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Scan the settled card, not a frame of the Reading notice fading out.
    await expect(page.getByText('Reading…', { exact: true })).toHaveCount(0);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
    await page.screenshot({ path: info.outputPath(`screenshot-${method}-check.png`) });
    await review.getByRole('button', { name: 'Save 1 reading', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved 1 reading to Screenshot game.' })).toBeVisible();
    await expect(page.getByLabel('Original Resin current value', { exact: true })).toHaveValue('140');
  });
}
