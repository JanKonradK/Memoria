import { expect, test } from '@playwright/test';

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`phone check-in preserves its origin, scroll and focus (${reducedMotion})`, async ({ page }, info) => {
    test.skip(info.project.name !== 'android-s23', 'Phone workspace continuity');
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
    for (const [name, short] of [
      ['Genshin Impact', 'Genshin'],
      ['Honkai: Star Rail', 'HSR'],
      ['Zenless Zone Zero', 'ZZZ'],
      ['Wuthering Waves', 'WuWa'],
      ['Neverness to Everness', 'NTE'],
      ['Umamusume', 'Uma'],
      ['Goddess of Victory', 'NIKKE'],
    ]) {
      if (name === 'Genshin Impact') await page.getByRole('button', { name: 'Add your first game' }).click();
      else {
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Add game', exact: true }).click();
      }
      await page.getByRole('button', { name: new RegExp(name) }).click();
      await page.getByRole('button', { name: `Add ${short}`, exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    const row = page.locator('[data-roster-game]').last();
    const rowName = await row.getAttribute('aria-label');
    await row.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => scrollY);
    expect(scroll).toBeGreaterThan(0);
    await row.click();
    const back = page.getByRole('button', { name: 'Back to dashboard', exact: true });
    await expect(back).toBeFocused();
    await expect(page.locator('.focus-workspace')).toBeVisible();
    if (reducedMotion === 'no-preference') {
      // Pause the actual content arrival partway through, then reverse with
      // the focused Back button. A pointer click would wait for it to settle.
      const arrival = await page.locator('.focus-workspace').evaluate((node) => {
        const animation = node.getAnimations()[0];
        if (!animation) return null;
        animation.pause();
        animation.currentTime = 80;
        const style = getComputedStyle(node);
        return { x: new DOMMatrixReadOnly(style.transform).m41, opacity: Number(style.opacity) };
      });
      expect(arrival).not.toBeNull();
      expect(arrival!.x).toBeGreaterThan(0);
      expect(arrival!.x).toBeLessThanOrEqual(24);
      expect(arrival!.opacity).toBeGreaterThan(0);
      expect(arrival!.opacity).toBeLessThan(1);
      await page.screenshot({ path: info.outputPath('workspace-expanding.png') });
    } else {
      await expect(page.locator('.focus-workspace')).toHaveCSS('transform', 'none');
      await expect(page.locator('.focus-workspace')).toHaveCSS('opacity', '1');
    }
    await back.press('Enter');
    const returned = page.getByRole('button', { name: rowName!, exact: true });
    await expect(returned).toBeFocused();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0);
    await expect(page.locator('.mobile-game-roster')).toHaveCSS('transform', 'none');
    await expect(page.locator('.mobile-game-roster')).toHaveCSS('opacity', '1');
    await returned.press('Enter');
    await expect(back).toBeFocused();
    await expect(page.locator('.focus-workspace')).toBeVisible();
    await expect(page.locator('.focus-workspace')).toHaveCSS('transform', 'none');
    await expect(page.locator('.focus-workspace')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: info.outputPath(`workspace-${reducedMotion}.png`) });
  });
}
