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

/** A game's one Edit menu: its layout editor and its events panel. */
export async function chooseFromEdit(
  page: Page,
  game: string,
  item: 'Edit layout' | 'Manage events' | 'Close events',
): Promise<void> {
  await page
    .getByRole('button', { name: `Edit ${game}`, exact: true })
    .last()
    .click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** An event opens on its quick view; the editor is behind that view's Edit button. */
export async function editFromQuickView(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
}

/** Open one Settings section. A wide window shows one beside a menu; a narrow one shows them all. */
export async function openSettings(page: Page, section: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) >= 900)
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section }).click();
}
