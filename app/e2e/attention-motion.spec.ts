import { expect, test } from '@playwright/test';
import { openGame } from './support';

test('urgent indicators breathe, pause during interaction, and respect reduced motion', async ({ page }, info) => {
  test.skip(!['desktop', 'android-s23'].includes(info.project.name), 'Desktop and touch motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Add a game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // A phone shows the indicator on the game's page; a wide window in the card beside Today's list.
  const phone = info.project.name === 'android-s23';
  if (phone) await openGame(page, 'Genshin Impact');
  const value = page.getByLabel('Original Resin current value');
  await value.fill('200');
  await value.press('Enter');
  const navigation = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today' });
  await navigation.focus();
  await page.mouse.move(0, 0);
  const ring = page.locator('.attention-indicator').first();
  await expect(ring).toHaveCSS('width', '8px');
  await expect(ring).toHaveCSS('height', '8px');
  await expect(ring).toHaveCSS('position', 'static');
  await expect(ring).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('.attention-ring')).toHaveCount(0);
  await expect(ring).toHaveCSS('animation-play-state', 'running');
  const opacity = await ring.evaluate(async (node) => {
    const samples: number[] = [];
    const start = performance.now();
    while (performance.now() - start < 900) {
      samples.push(Number(getComputedStyle(node).opacity));
      await new Promise(requestAnimationFrame);
    }
    return samples;
  });
  expect(Math.max(...opacity) - Math.min(...opacity)).toBeGreaterThan(0.04);
  expect(Math.min(...opacity)).toBeGreaterThanOrEqual(0.44);
  if (!phone) {
    await page.getByRole('button', { name: 'Edit Genshin Impact', exact: true }).focus();
    await expect(ring).toHaveCSS('animation-play-state', 'paused');
    await navigation.focus();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(ring).toHaveCSS('animation-name', 'none');
  await expect(ring).toHaveCSS('opacity', '0.45');
  await page.screenshot({ path: info.outputPath('quiet-urgency.png') });
  await expect(value).toHaveValue('200');
});
