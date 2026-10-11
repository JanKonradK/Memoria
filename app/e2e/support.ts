import { expect, type Locator, type Page } from '@playwright/test';

/** A game's row on Today. It reads "Review" beside the desktop card and "Open" where the row is the way in. */
export function gameRow(page: Page, name: string): Locator {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('button', { name: new RegExp(`^(Open|Review) ${escaped}(, paused)?$`) });
}

/** Open a game's own page from Today, at any window size. */
export async function openGame(page: Page, name: string): Promise<void> {
  await gameRow(page, name).click();
  // A wide window puts the card beside the list first; its page is one more step.
  if ((page.viewportSize()?.width ?? 0) >= 900) await page.getByRole('button', { name: 'Open full page' }).click();
  await expect(page.locator('.focus-workspace')).toBeVisible();
}

/** An event opens on its quick view; the editor is behind that view's Edit button. */
export async function editFromQuickView(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
}
