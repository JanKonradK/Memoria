import { expect, test } from '@playwright/test';

test('a sideways swipe moves the page with the finger, then changes tab', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-390', 'Touch gesture on a phone');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const send = (type: string, x: number) =>
    page.evaluate(
      ([type, x]) => {
        const target = document.querySelector('.today-heading p') ?? document.getElementById('main-content')!;
        target.dispatchEvent(
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
      [type, x] as const,
    );
  await send('pointerdown', 300);
  await send('pointermove', 260);
  await send('pointermove', 200);
  // Mid-drag the page has moved a little towards the finger.
  await expect(page.locator('.page-enter[data-swiping]')).toHaveCount(1);
  const shift = await page
    .locator('.page-enter')
    .evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m41);
  expect(shift).toBeLessThan(-10);
  await send('pointerup', 180);
  await expect(nav.getByRole('button', { name: 'Pulls', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.page-enter[data-swiping]')).toHaveCount(0);
});
