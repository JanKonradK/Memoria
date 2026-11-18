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

/**
 * A game's settings or its events. On its own page the pencil opens settings and
 * the events have their own tab; the card beside Today keeps the Edit menu.
 */
export async function chooseFromEdit(
  page: Page,
  game: string,
  item: 'Game settings' | 'Manage events' | 'Close events',
): Promise<void> {
  const tabs = page.getByRole('tablist', { name: `${game} sections`, exact: true });
  const onPage = await tabs.isVisible();
  if (onPage && item !== 'Game settings') {
    await tabs.getByRole('tab', { name: item === 'Manage events' ? /^Events/ : 'Track' }).click();
    return;
  }
  await page
    .getByRole('button', { name: `Edit ${game}`, exact: true })
    .last()
    .click();
  if (onPage) return;
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

/**
 * Adding now starts where the thing lives: a game from the rail, an event from
 * the Calendar (or the open game's Events tab), a reminder from Settings.
 */
export async function addFromShell(page: Page, item: 'Add game' | 'Event' | 'Reminder'): Promise<void> {
  if (item === 'Add game') {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'Add game', exact: true })
      .click();
    return;
  }
  if (item === 'Reminder') {
    await openSettings(page, 'Reminders');
    await page.getByRole('button', { name: 'New reminder', exact: true }).click();
    return;
  }
  if (await page.locator('.focus-workspace').isVisible()) {
    await page.getByRole('tab', { name: /^Events/ }).click();
    await page.getByRole('button', { name: 'Add event', exact: true }).click();
    return;
  }
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Calendar', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add an event', exact: true }).click();
}
