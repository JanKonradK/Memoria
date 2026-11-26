import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { emptyState, PRESETS, type AppState, type Game, type GameEvent } from '@memoria/shared';
import { planSeedImport } from '../src/data/seed-events';

/** A game's row on Today: at every width, pressing it opens the game's page. */
export function gameRow(page: Page, name: string): Locator {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('button', { name: new RegExp(`^Open ${escaped}(, paused)?$`) });
}

/** Today opens on its Steps; the ranked games are its other view. */
export async function showTodayGames(page: Page): Promise<void> {
  const games = page.getByRole('radiogroup', { name: 'Today view' }).getByRole('radio', { name: 'Games', exact: true });
  if ((await games.count()) > 0 && (await games.getAttribute('data-state')) !== 'on') await games.click();
}

/** Open a game's own page from Today, at any window size. */
export async function openGame(page: Page, name: string): Promise<void> {
  await showTodayGames(page);
  await gameRow(page, name).click();
  await expect(page.locator('.focus-workspace')).toBeVisible();
}

/**
 * A game's settings or its events. On its own page the pencil opens settings and
 * the events have their own tab; a game card elsewhere keeps the Edit menu.
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

/**
 * The Calendar's Timeline (its lanes), every lane unfolded so its bars can be
 * found. A phone opens the Calendar on its Agenda, and a stacked lane folds
 * unless something in it ends within two days, so both are undone here.
 */
export async function showTimeline(page: Page): Promise<void> {
  const timeline = page
    .getByRole('radiogroup', { name: 'Event view' })
    .getByRole('radio', { name: 'Timeline', exact: true });
  if ((await timeline.getAttribute('data-state')) !== 'on') await timeline.click();
  await expect(timeline).toHaveAttribute('data-state', 'on');
  const folded = page.locator('.tl-head-button[aria-expanded="false"]');
  for (let left = await folded.count(); left > 0; left--) await folded.first().click();
  await expect(folded).toHaveCount(0);
}

/** Open one Settings section: from the menu beside it on a wide window, or the menu page on a narrow one. */
export async function openSettings(page: Page, section: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section }).click();
}

/**
 * Add game from the rail. Its button sits in the game list, which the dock
 * keeps behind Games (raised as a shelf), so Games is pressed first when the
 * list is folded. With no games yet, Games itself opens Add game. Returns the
 * control that opened the sheet, which gets focus back when it closes.
 */
export async function addGameFromRail(page: Page): Promise<Locator> {
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const games = nav.getByRole('button', { name: 'Games', exact: true });
  const expanded = await games.getAttribute('aria-expanded');
  if (expanded === null) {
    await games.click();
    return games;
  }
  if (expanded === 'false') await games.click();
  const add = nav.getByRole('button', { name: 'Add game', exact: true });
  const upright = await page.evaluate(() => window.matchMedia('(orientation: portrait)').matches);
  await add.click();
  return upright ? games : add;
}

/**
 * Adding now starts where the thing lives: a game from the rail, an event from
 * the Calendar (or the open game's Events tab), a reminder from Settings.
 */
export async function addFromShell(page: Page, item: 'Add game' | 'Event' | 'Reminder'): Promise<void> {
  if (item === 'Add game') {
    await addGameFromRail(page);
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
