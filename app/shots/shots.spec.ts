import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { PRESETS, serversFor } from '@memoria/shared';

/**
 * Every page, sheet and state, drawn with a player's real roster: the owner's
 * five games, readings at different fills, some dailies ticked, and the
 * bundled calendar. Friday 20 November 2026, 13:15 in Warsaw.
 */
const NOW = Date.parse('2026-11-20T12:15:00Z');
const ROSTER = ['genshin', 'hsr', 'zzz', 'wuwa', 'nte'];
const OUT = join(import.meta.dirname, '..', 'build', 'shots');

type Finding = { screen: string; kind: string; detail: string };

/** What the layout gets wrong on this screen, measured rather than eyeballed. */
async function measure(page: Page, screen: string, touch: boolean): Promise<Finding[]> {
  const found = await page.evaluate((touch) => {
    const out: { kind: string; detail: string }[] = [];
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].slice(0, 3).join('.')} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      // Screen-reader text is clipped to a pixel on purpose.
      if (r.width <= 1 || r.height <= 1 || s.clipPath === 'inset(50%)' || el.closest('.sr-only')) return false;
      if (r.bottom < 0 || r.top > innerHeight) return false;
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
    };
    if (document.documentElement.scrollWidth > innerWidth + 1)
      out.push({ kind: 'page-overflow', detail: `${document.documentElement.scrollWidth} > ${innerWidth}` });
    const top = document.querySelector('[role="dialog"]') ?? document;
    for (const el of top.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [role="checkbox"], [role="tab"], [role="radio"], [role="switch"]',
    )) {
      if (!visible(el) || el.closest('[aria-hidden="true"], .sr-only')) continue;
      const r = el.getBoundingClientRect();
      if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) continue;
      if (r.right > innerWidth + 1 || r.left < -1) out.push({ kind: 'control-offscreen', detail: name(el) });
      if (touch && (r.width < 44 || r.height < 44)) {
        // A small mark inside a larger hit area passes: check the element's own box only.
        out.push({ kind: 'touch-target', detail: `${Math.round(r.width)}x${Math.round(r.height)} ${name(el)}` });
      }
    }
    for (const el of top.querySelectorAll<HTMLElement>('body *')) {
      if (!visible(el) || el.children.length > 0 || !(el.textContent ?? '').trim()) continue;
      const s = getComputedStyle(el);
      const size = Number.parseFloat(s.fontSize);
      if (size < 12) out.push({ kind: 'tiny-text', detail: `${size}px ${name(el)}` });
      if (el.scrollWidth > el.clientWidth + 1 && s.overflow !== 'visible' && el.clientWidth > 0)
        out.push({ kind: 'clipped-text', detail: `${name(el)} (${el.clientWidth}/${el.scrollWidth})` });
    }
    return out;
  }, touch);
  return found.map((item) => ({ screen, ...item }));
}

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
    const path = '/src/store.ts';
    const { useApp, flushPersist } = await import(/* @vite-ignore */ path);
    const store = useApp.getState();
    store.updateSettings({ localTz: 'Europe/Warsaw' });
    const fills = [0.68, 1, 0.42, 0.91, 0.55];
    list.forEach(({ preset, pick }, index) => {
      const gameId = store.addGameFromPreset(preset, { ...pick, accountLabel: index === 0 ? 'Main' : undefined });
      const state = useApp.getState().state;
      for (const res of state.resources.filter(
        (item: { gameId: string; deleted?: boolean }) => item.gameId === gameId && !item.deleted,
      )) {
        if (res.cap > 0)
          useApp
            .getState()
            .setEnergy(
              res.id,
              Math.round(res.cap * fills[index]!),
              res.reserveCap ? Math.round(res.reserveCap * 0.3) : undefined,
            );
      }
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
    const events = app.useApp.getState().state.events.filter((event: { deleted?: boolean }) => !event.deleted);
    await new Function('ui', 'nav', 'games', 'events', body)(ui.useUI, nav, games, events);
  }, script);
  await page.waitForTimeout(500);
}

test('every screen', async ({ page }, info) => {
  const dir = join(OUT, info.project.name);
  mkdirSync(dir, { recursive: true });
  const touch = Boolean(info.project.use.hasTouch);
  const findings: Finding[] = [];
  const shot = async (screen: string, { full = false } = {}) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(dir, `${screen}.png`), fullPage: full });
    findings.push(...(await measure(page, screen, touch)));
  };
  const scrollShot = async (screen: string) => {
    await shot(screen);
    const tall = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight * 1.3);
    if (tall) {
      await page.evaluate(() => window.scrollTo({ top: innerHeight * 0.85, behavior: 'instant' }));
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(dir, `${screen}--2.png`) });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    }
  };

  await seed(page);

  await ui(page, "ui.getState().setTab('today'); ui.getState().setTodayView('steps');");
  await scrollShot('01-today-steps');
  await ui(page, "ui.getState().setTodayView('games');");
  await scrollShot('02-today-games');
  await ui(page, "ui.getState().setTodayView('steps');");

  const tabs = ['track', 'events', 'pulls', 'quests', 'news', 'notes'];
  for (const [index, key] of ['genshin', 'hsr', 'nte'].entries()) {
    await ui(page, `nav.openGame(games.find((g) => g.presetKey === '${key}').id);`);
    for (const tab of index === 0 ? tabs : ['track']) {
      await ui(page, `ui.getState().setGameTab('${tab}');`);
      await scrollShot(`1${index}-game-${key}-${tab}`);
    }
  }
  await ui(page, "ui.getState().setGameTab('track');");

  await ui(page, "ui.getState().setTab('timeline');");
  for (const view of ['lanes', 'agenda', 'month', 'soon']) {
    await ui(page, `ui.getState().setTimelineView('${view}');`);
    await scrollShot(`20-calendar-${view}`);
  }

  await ui(page, "ui.getState().setTab('notes');");
  await scrollShot('25-notes');

  for (const section of ['games', 'general', 'appearance', 'reminders', 'sync', 'data', 'activity']) {
    await ui(page, `ui.getState().openSettings('${section}');`);
    await scrollShot(`30-settings-${section}`);
  }

  await ui(page, "ui.getState().setTab('today');");
  const sheets: [string, string][] = [
    ['40-sheet-add-game', "ui.getState().openSheet({ kind: 'addGame' });"],
    [
      '41-sheet-game-editor',
      "ui.getState().openSheet({ kind: 'game', gameId: games.find((g) => g.presetKey === 'genshin').id });",
    ],
    [
      '42-sheet-event-peek',
      "ui.getState().openSheet({ kind: 'eventPeek', eventId: events.find((e) => e.type === 'event' && e.start < Date.now() && e.end > Date.now()).id });",
    ],
    [
      '43-sheet-event-editor',
      "ui.getState().openSheet({ kind: 'event', eventId: events.find((e) => e.type === 'event' && e.start < Date.now() && e.end > Date.now()).id });",
    ],
    ['44-sheet-reminder', "ui.getState().openSheet({ kind: 'reminder' });"],
    ['45-sheet-guide', "ui.getState().openSheet({ kind: 'guide' });"],
  ];
  for (const [name, script] of sheets) {
    await ui(page, script);
    await page.getByRole('dialog').last().waitFor();
    await page.waitForTimeout(900);
    await shot(name);
    await ui(page, 'ui.getState().closeSheet();');
  }

  // A fresh install, once setup is done: the empty app.
  await page.evaluate(async () => {
    const { useApp } = await import(/* @vite-ignore */ '/src/store.ts');
    await useApp.getState().clearLocalData();
    localStorage.removeItem('memoria-onboarding');
  });
  await page.reload();
  await page.waitForTimeout(800);
  await shot('50-empty');

  writeFileSync(join(dir, 'findings.json'), JSON.stringify(findings, null, 1));
});

/** Each look on Today, a game's page and Settings → Appearance, with the dock's shelf open. */
test('every look', async ({ page }, info) => {
  const dir = join(OUT, info.project.name, 'looks');
  mkdirSync(dir, { recursive: true });
  const touch = Boolean(info.project.use.hasTouch);
  const findings: Finding[] = [];
  const shot = async (screen: string) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(dir, `${screen}.png`) });
    findings.push(...(await measure(page, screen, touch)));
  };
  await seed(page);
  const looks = ['classic', 'instrument', 'hud', 'clean', 'glass', 'arcade', 'paper', 'neon'];
  for (const look of looks) {
    await ui(
      page,
      `ui.getState().setLook('${look}'); ui.getState().setTab('today'); ui.getState().setTodayView('steps');`,
    );
    await shot(`${look}-today`);
    await ui(page, `nav.openGame(games.find((g) => g.presetKey === 'hsr').id); ui.getState().setGameTab('track');`);
    await shot(`${look}-game`);
    // Further down the Track tab: the task lists and the event list beside them.
    await page.evaluate(() =>
      document.querySelector('.game-track-tasks')?.scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
    await shot(`${look}-game-tasks`);
    await ui(
      page,
      `nav.openGame(games.find((g) => g.presetKey === 'genshin').id); ui.getState().setGameTab('events');`,
    );
    await shot(`${look}-events`);
  }
  await ui(page, "ui.getState().setLook('hud'); ui.getState().setDetail('minimal'); ui.getState().setTab('today');");
  await shot('minimal-hud-today');
  await ui(page, "ui.getState().setDetail('elaborate'); ui.getState().openSettings('appearance');");
  await shot('appearance');
  await page.evaluate(() => window.scrollTo({ top: innerHeight * 0.8, behavior: 'instant' }));
  await shot('appearance--2');
  writeFileSync(join(dir, 'findings.json'), JSON.stringify(findings, null, 2));
});
