import { expect, test, type Page } from '@playwright/test';
import { openSettings, showTodayGames } from './support';
import AxeBuilder from '@axe-core/playwright';
import { emptyState, PRESETS, type AppState } from '@memoria/shared';
import { makeEvent, makeGame, makeResource, makeSnapshot, makeTask } from '../../shared/test/helpers';

test.beforeEach(async ({ page }, info) => {
  test.skip(!['android-s23', 'mobile-320', 'desktop'].includes(info.project.name), 'Today phone and desktop surfaces');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
});

async function seriousViolations(page: Page) {
  // The rail's game buttons are named by their game, not their countdown; the rail is checked in its own spec.
  return (await new AxeBuilder({ page }).exclude('.rail-game').analyze()).violations.filter((issue) =>
    ['serious', 'critical'].includes(issue.impact ?? ''),
  );
}

async function merge(page: Page, state: AppState) {
  await openSettings(page, 'Data');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'today-roster.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
}

async function addGenshin(page: Page) {
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Add game', exact: true })
    .click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  // No server is chosen for you: pick the game's first one.
  await page.getByRole('combobox', { name: 'Server' }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

const NOW = Date.parse('2026-11-18T14:00:00Z');
const MIN = 60_000;

/** The mock-up's afternoon: six games, quiet hours from 23:00, NIKKE's events all ending at 19:59. */
function afternoon(): AppState {
  const state = emptyState();
  const keys = ['crumble', 'nikke', 'zzz', 'wuwa', 'genshin', 'hsr'];
  // Minutes until each game's main bar caps.
  const capIn: Record<string, number> = { crumble: 60, zzz: 396, wuwa: 396, genshin: 460, hsr: 540 };
  for (const [sort, key] of keys.entries()) {
    const preset = PRESETS.find((item) => item.key === key)!;
    const gameId = `game-${key}`;
    state.games.push(makeGame({ ...preset, id: gameId, presetKey: key, sort, updatedAt: NOW }));
    for (const [index, resource] of preset.resources.entries()) {
      const row = makeResource({ ...resource, id: `res-${key}-${index}`, gameId, sort: index, updatedAt: NOW });
      state.resources.push(row);
      const minutes = index === 0 ? capIn[key] : undefined;
      if (minutes != null && row.regenMinutes > 0) {
        state.snapshots.push(
          makeSnapshot({
            id: `snap-${row.id}`,
            resourceId: row.id,
            value: row.cap - Math.ceil(minutes / row.regenMinutes),
            takenAt: NOW,
          }),
        );
      }
    }
    for (const [index, task] of preset.tasks.entries()) {
      state.tasks.push(
        makeTask({ ...task, id: `task-${key}-${index}`, gameId, presetTaskKey: task.key, sort: index, updatedAt: NOW }),
      );
    }
  }
  const nikke = ['VOLT TRIP', 'Outpost Defense', 'Mini game', 'Rerun', 'Login', 'Shop', 'Ark', 'Story', 'Bonus'];
  nikke.forEach((name, index) =>
    state.events.push(
      makeEvent({
        id: `nikke-${index}`,
        gameId: 'game-nikke',
        name,
        type: 'event',
        start: NOW - 7 * 86_400_000,
        end: NOW + 359 * MIN,
        pinned: index === 0,
        updatedAt: NOW,
      }),
    ),
  );
  state.events.push(
    makeEvent({
      id: 'crumble-gift',
      gameId: 'game-crumble',
      name: 'Launch 100-Day login gift',
      type: 'event',
      start: NOW - 30 * 86_400_000,
      end: NOW + 60 * MIN,
      updatedAt: NOW,
    }),
    makeEvent({
      id: 'crumble-clash',
      gameId: 'game-crumble',
      name: 'Clash of the Crumbs',
      type: 'event',
      start: NOW + 25 * 60 * MIN,
      end: NOW + 20 * 86_400_000,
      updatedAt: NOW,
    }),
    makeEvent({
      id: 'zzz-stream',
      gameId: 'game-zzz',
      name: 'ZZZ 3.4 Special Program',
      type: 'livestream',
      start: NOW + 2 * 86_400_000 - 60 * MIN,
      end: NOW + 2 * 86_400_000,
      updatedAt: NOW,
    }),
  );
  state.settings = {
    ...state.settings,
    localTz: 'UTC',
    quietStart: 23 * 60,
    quietEnd: 7 * 60,
    quietHoursChosen: true,
    updatedAt: NOW,
  };
  return state;
}

test('Today starts a new roster and keeps all navigation reachable', async ({ page }, info) => {
  const primary = page.getByRole('navigation', { name: 'Primary', exact: true });
  await expect(primary.getByRole('button', { name: 'Today', exact: true })).toHaveAttribute('aria-current', 'page');
  await addGenshin(page);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  // Steps first: a new game's dailies are already there to tick.
  const view = page.getByRole('group', { name: 'Today view' });
  await expect(view.getByRole('button', { name: 'Steps', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Mark Daily Commissions ×4 done', exact: true })).toBeVisible();
  await showTodayGames(page);
  await expect(page.getByRole('list', { name: 'Games', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('today-dark.png') });
  expect(await seriousViolations(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await seriousViolations(page)).toEqual([]);
  await page.screenshot({ path: info.outputPath('today-light.png') });
  await primary.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(primary.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-current', 'page');
  await primary.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('a Today game is edited in its card on desktop and on its own page on a phone', async ({ page }) => {
  await addGenshin(page);
  await showTodayGames(page);
  const desktop = page.viewportSize()!.width >= 900;
  const row = page.getByRole('button', { name: `${desktop ? 'Review' : 'Open'} Genshin Impact`, exact: true });
  await expect(page.getByRole('button', { name: 'Open game', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Readings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play mode', exact: true })).toHaveCount(0);
  if (desktop) {
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    const card = page.getByRole('region', { name: 'Genshin Impact card', exact: true });
    const energy = card.getByLabel('Original Resin current value', { exact: true });
    await energy.fill('91');
    await energy.press('Enter');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  } else {
    await row.click();
    const energy = page.getByLabel('Original Resin current value', { exact: true });
    await energy.fill('91');
    await energy.press('Enter');
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  }
  await expect(row).toHaveAccessibleDescription(/Estimated 91 of 200 Original Resin/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('browser Back restores a scrolled Today roster', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'Phone priority opens the game directly');
  const state = emptyState();
  state.games = Array.from({ length: 12 }, (_, index) =>
    makeGame({ id: `today-${index}`, name: `Today game ${index}`, sort: index }),
  );
  await merge(page, state);
  await showTodayGames(page);
  const priority = page.getByRole('button', { name: 'Open Today game 11', exact: true });
  await priority.scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => scrollY);
  expect(position).toBeGreaterThan(0);
  await priority.click();
  await expect(page.getByRole('heading', { name: 'Today game 11', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(position, 0);
  await expect(priority).toBeFocused();
});

test.describe('Steps', () => {
  test.use({ timezoneId: 'UTC' });

  test('one ordered list across games, worked in place', async ({ page }, info) => {
    await page.clock.setFixedTime(new Date(NOW));
    await page.reload();
    await merge(page, afternoon());
    const groups = page.locator('.today-steps-group h2');
    await expect(groups.first()).toHaveText('Within the hour');
    const titles = await groups.allTextContents();
    expect(titles.indexOf('This evening')).toBeGreaterThan(0);
    expect(titles.indexOf('Before the 03:00 reset')).toBeGreaterThan(titles.indexOf('This evening'));
    expect(titles.at(-1)).toBe('This week');
    // NIKKE's nine events ending together are one step.
    await expect(page.getByRole('button', { name: /^Finish VOLT TRIP / })).toBeVisible();
    await expect(page.getByText(/and 8 more NIKKE events|\+8 more end/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'The next 24 hours' }).getByRole('listitem').first()).toHaveText(
      /15:00: Crumble/,
    );

    // Ticking a daily keeps its place while the player is still in the list, then folds into Done.
    const progress = await page.locator('.today-bar').textContent();
    const tick = page.getByRole('button', { name: 'Mark Sweet Blessing daily claim done', exact: true });
    await tick.click();
    await expect(tick).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.today-bar')).not.toHaveText(progress!);
    await page.getByRole('heading', { name: 'Today', exact: true }).click();
    await page.mouse.move(0, 0);
    await expect(page.getByRole('button', { name: /^Done today · 1/ })).toBeVisible();

    // Typing a new value keeps the reserve logic of the card and does not move the row while typing.
    const resin = page.getByLabel('Original Resin current value', { exact: true });
    const before = await page.locator('.today-step').evaluateAll((rows) => rows.map((row) => row.dataset.step));
    await resin.fill('10');
    expect(await page.locator('.today-step').evaluateAll((rows) => rows.map((row) => row.dataset.step))).toEqual(
      before,
    );
    await resin.press('Enter');
    // Ten Resin takes over a day to fill, so once entered it leaves the steps for the week.
    await expect(resin).toHaveCount(0);
    await expect(page.getByRole('listitem').filter({ hasText: 'Original Resin caps' })).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const targets = await page
      .locator('.today-step-tick, .today-step-open, .view-switch button')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    if (info.project.name !== 'desktop') expect(Math.min(...targets)).toBeGreaterThanOrEqual(44);
    expect(await seriousViolations(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath('steps-dark.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await seriousViolations(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath('steps-light.png'), fullPage: true });
  });
});
