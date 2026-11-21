import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { PRESETS, serversFor } from '@memoria/shared';

/**
 * The screens round 3 changed (docs/round3-plan.md): the rail, a game's Track
 * tab, Notes, Month and Ending soon. `npx playwright test -c
 * playwright.shots.config.ts round3`, into build/shots/<screen>/round3.
 */
const NOW = Date.parse('2026-11-21T10:15:00Z');
const ROSTER = ['genshin', 'hsr', 'zzz', 'wuwa', 'nte'];
const OUT = join(import.meta.dirname, '..', 'build', 'shots');

async function seed(page: Page) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(() => {
    localStorage.setItem('memoria-onboarding', 'complete');
    localStorage.setItem('memoria-preset-gap-dismissed', '999');
    localStorage.setItem('memoria-legacy-home-timezone-dismissed', '1');
  });
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('nav[aria-label="Primary"]'));
  const presets = ROSTER.map((key) => {
    const preset = PRESETS.find((item) => item.key === key)!;
    const server = serversFor(key).find((item) => item.label === 'Europe') ?? serversFor(key)[0];
    return { preset, pick: server ? { server: server.id, tz: server.tz } : { tz: preset.tz } };
  });
  await page.evaluate(async (list) => {
    const { useApp, flushPersist } = await import(/* @vite-ignore */ '/src/store.ts');
    const store = useApp.getState();
    store.updateSettings({ localTz: 'Europe/Warsaw' });
    const ids: string[] = [];
    list.forEach(({ preset, pick }, index) => {
      const gameId = store.addGameFromPreset(preset, { ...pick, accountLabel: index === 0 ? 'Main' : undefined });
      ids.push(gameId);
      for (const res of useApp
        .getState()
        .state.resources.filter(
          (item: { gameId: string; deleted?: boolean }) => item.gameId === gameId && !item.deleted,
        ))
        if (res.cap > 0) useApp.getState().setEnergy(res.id, Math.round(res.cap * 0.6));
    });
    // An old single notes box, to be moved into a note on the next load.
    useApp.getState().updateGame(ids[1]!, { notes: 'Reserve TB Power stores overflow (up to 2400).' });
    const save = useApp.getState().saveNote;
    save({
      gameId: null,
      title: 'This patch',
      body: '- [x] Spend Starglitter\n- [ ] Clear the new domain\n- [ ] Farm Nod-Krai specialties',
    });
    save({
      gameId: ids[0]!,
      title: 'Builds',
      body: 'Furina: 4pc Golden Troupe, HP sands.\nMavuika: Obsidian Codex.',
      color: 'game',
      pinned: true,
    });
    save({ gameId: ids[0]!, title: '', body: 'Craft Condensed daily; it counts 60 Dire Prestige in Stygian.' });
    save({
      gameId: ids[2]!,
      title: 'Pulls',
      body: 'Save for Severian. 92 pity on the W-Engine banner.',
      color: 'violet',
    });
    save({
      gameId: ids[3]!,
      title: 'Routes',
      body: 'Echo route: Lahai-Roi north, then the coast.\n- [ ] Tacet fields x4\n- [ ] Weekly boss',
      color: 'blue',
    });
    save({
      gameId: ids[4]!,
      title: '',
      body: 'Verify City Stamina cap for your account; it refills fully each Monday.',
    });
    // Some of this week's events done, one started.
    const events = useApp
      .getState()
      .state.events.filter(
        (event: { deleted?: boolean; type: string; start: number; end: number }) =>
          !event.deleted && event.type === 'event' && event.start < Date.now() && event.end > Date.now(),
      )
      .slice(0, 6);
    events.forEach((event: { id: string; gameId: string }, index: number) => {
      if (index % 3 === 0)
        useApp.getState().upsertEvent({ id: event.id, gameId: event.gameId, done: true, partsDone: 2 });
      if (index === 1) useApp.getState().upsertEvent({ id: event.id, gameId: event.gameId, partsDone: 1 });
    });
    await flushPersist();
  }, presets);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('nav[aria-label="Primary"]'));
  await page.waitForTimeout(400);
}

async function ui(page: Page, script: string) {
  await page.evaluate(async (body) => {
    const ui = await import(/* @vite-ignore */ '/src/ui-store.ts');
    const nav = await import(/* @vite-ignore */ '/src/workspace-navigation.ts');
    const app = await import(/* @vite-ignore */ '/src/store.ts');
    const games = app.useApp.getState().state.games.filter((game: { deleted?: boolean }) => !game.deleted);
    await new Function('ui', 'nav', 'games', body)(ui.useUI, nav, games);
  }, script);
  await page.waitForTimeout(500);
}

test('round 3 screens', async ({ page }, info) => {
  const dir = join(OUT, info.project.name, 'round3');
  mkdirSync(dir, { recursive: true });
  const shot = async (name: string, full = false) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(dir, `${name}.png`), fullPage: full });
  };
  await seed(page);
  await ui(page, "ui.getState().setTab('today');");
  await shot('01-today');
  await ui(page, "nav.openGame(games.find((g) => g.presetKey === 'genshin').id); ui.getState().setGameTab('track');");
  await shot('02-game-track');
  await ui(page, "ui.getState().setGameTab('notes');");
  await shot('03-game-notes');
  await ui(page, "ui.getState().setTab('notes');");
  await shot('04-notes-by-game', true);
  await ui(page, "ui.getState().setNotesView({ group: 'wall' });");
  await shot('05-notes-wall', true);
  await ui(page, "ui.getState().setNotesView({ group: 'game', density: 'compact' });");
  await shot('06-notes-compact', true);
  await ui(page, "ui.getState().setNotesView({ density: 'comfortable' });");
  await page.locator('.note-icon[aria-label^="Edit"]').first().click();
  await page.waitForTimeout(300);
  await shot('07-notes-editing');
  await page.keyboard.press('Escape');
  await ui(page, "ui.getState().setTab('timeline'); ui.getState().setTimelineView('month');");
  await shot('08-month', true);
  await ui(page, "ui.getState().setTimelineView('soon');");
  await shot('09-soon', true);
  await ui(page, "ui.getState().setTab('settings');");
  await shot('10-settings');
});

test('icon sets and game icons', async ({ page }, info) => {
  const dir = join(OUT, info.project.name, 'round3');
  mkdirSync(dir, { recursive: true });
  await seed(page);
  await ui(page, "ui.getState().setTab('today');");
  for (const set of ['outline', 'solid', 'colour', 'tiles', 'minimal', 'pixel']) {
    await ui(page, `ui.getState().setIconSet('${set}');`);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await nav.screenshot({ path: join(dir, `20-icons-${set}.png`) });
  }
  await ui(page, "ui.getState().setIconSet('outline');");
  for (const style of ['badge', 'monogram', 'symbol']) {
    await ui(page, `ui.getState().setLogoStyle('${style}');`);
    await page.getByRole('navigation', { name: 'Primary' }).screenshot({ path: join(dir, `21-logos-${style}.png`) });
  }
  await ui(
    page,
    "ui.getState().setLogoStyle('coin'); ui.getState().setGameIcon('zzz', { style: 'symbol', glyph: 'bolt' }); ui.getState().setGameIcon('hsr', { style: 'badge' }); ui.getState().openSettings('appearance');",
  );
  await page.getByRole('group', { name: 'Icons' }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(dir, '22-settings-icons.png'), fullPage: true });
  await page
    .locator('.icon-set-grid')
    .first()
    .screenshot({ path: join(dir, '23-icon-grid.png') });
  await page
    .locator('.icon-set-grid')
    .nth(1)
    .screenshot({ path: join(dir, '24-logo-grid.png') });
});
