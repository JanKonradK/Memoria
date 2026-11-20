import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { emptyState, PRESETS, type AppState, type Game, type GameEvent } from '@memoria/shared';
import { planSeedImport } from '../src/data/seed-events';

/** A game's row on Today. It reads "Review" beside the desktop card and "Open" where the row is the way in. */
export function gameRow(page: Page, name: string): Locator {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('button', { name: new RegExp(`^(Open|Review) ${escaped}(, paused)?$`) });
}

/** Today opens on its Steps; the ranked games are its other view. */
export async function showTodayGames(page: Page): Promise<void> {
  const games = page.getByRole('group', { name: 'Today view' }).getByRole('button', { name: 'Games', exact: true });
  if ((await games.count()) > 0 && (await games.getAttribute('aria-pressed')) !== 'true') await games.click();
}

/** Open a game's own page from Today, at any window size. */
export async function openGame(page: Page, name: string): Promise<void> {
  await showTodayGames(page);
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

/**
 * Merges a backup holding preset games and every bundled calendar event they
 * have at `now`, so a Calendar view shows what a player really sees. Leaves
 * the page on Settings.
 */
export async function mergePresetCalendar(page: Page, now: number, keys: readonly string[]): Promise<AppState> {
  const games: Game[] = keys.map((key, sort) => {
    const preset = PRESETS.find((item) => item.key === key)!;
    return {
      id: `preset-${key}`,
      name: preset.name,
      short: preset.short,
      color: preset.color,
      color2: preset.color2,
      color3: preset.color3,
      titleFont: preset.titleFont,
      presetKey: key,
      icon: preset.icon,
      platform: preset.platform,
      tz: preset.tz,
      dailyResetHour: preset.dailyResetHour,
      weeklyResetDay: preset.weeklyResetDay,
      monthlyResetDay: preset.monthlyResetDay,
      paused: false,
      sort,
      updatedAt: now,
    };
  });
  const state: AppState = { ...emptyState(), games };
  state.events = planSeedImport(state, now)
    .filter((plan) => plan.kind === 'add')
    .map((plan, index): GameEvent => ({
      id: `seed-${index}`,
      gameId: plan.gameId!,
      name: plan.seed!.name,
      type: plan.seed!.type,
      category: plan.seed!.category,
      bannerKind: plan.seed!.bannerKind,
      start: plan.start!,
      end: plan.end!,
      dailyTouch: plan.seed!.dailyTouch ?? false,
      notify: plan.seed!.notify ?? true,
      notes: plan.seed!.notes ?? '',
      sourceKey: plan.seed!.sourceKey,
      seedHash: plan.hash,
      updatedAt: now,
    }));
  await openSettings(page, 'Data');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'calendar.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await expect(page.getByText('Backup merged.')).toBeVisible();
  return state;
}

/** Axe findings on the Calendar: serious and critical ones, or every one with `all`. */
export async function calendarAxe(page: Page, { all = false } = {}) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return all ? violations : violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? ''));
}

/** First-run setup ends on the guide; it closes like any sheet and leaves the app as it is. */
export async function closeGuide(page: Page): Promise<void> {
  const guide = page.getByRole('dialog', { name: 'Guide' });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
