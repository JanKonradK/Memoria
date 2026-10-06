import { expect, test, type Page } from '@playwright/test';
import { emptyState, latestSnapshots, type AppState } from '@memoria/shared';
import { makeGame, makeResource, makeSnapshot } from '../../shared/test/helpers';
import type { CapturedReading, PlayModeConfig, PlayModeStatus } from '../src/desktop-play';

const NOW = Date.UTC(2026, 9, 7, 12, 10, 30, 456);
type Harness = {
  value: PlayModeStatus;
  windows: { id: string; name: string }[];
  saved: PlayModeConfig[];
  removed: string[];
  notify(): void;
  open(): void;
};
declare global {
  interface Window {
    __playTest: Harness;
  }
}

async function stored(page: Page): Promise<AppState> {
  return page.evaluate(
    () =>
      new Promise<AppState>((resolve, reject) => {
        const request = indexedDB.open('keyval-store');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction('keyval').objectStore('keyval').get('memoria-state');
          read.onsuccess = () => {
            resolve(read.result);
            db.close();
          };
          read.onerror = () => {
            reject(read.error);
            db.close();
          };
        };
      }),
  );
}

async function queueCapture(page: Page, gameId: string) {
  const capture: CapturedReading = {
    id: `capture-${gameId}`,
    gameId,
    gameName: 'Captured game',
    name: 'Game window',
    text: 'Original Resin 88 / 200',
    capturedAt: NOW,
    detectedAt: NOW,
  };
  await page.evaluate((entry) => {
    window.__playTest.value.pending = [entry];
    window.__playTest.value.count = 1;
    window.__playTest.notify();
  }, capture);
}

async function openPlay(page: Page) {
  await page.getByRole('button', { name: 'Play mode', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Play mode', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Refresh windows', exact: true })).toBeEnabled();
  return panel;
}

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Native PC bridge flow; capture itself has native controller tests');
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(() => {
    localStorage.setItem('memoria-onboarding', 'complete');
    localStorage.setItem('memoria-preset-gap-dismissed', '999');
    localStorage.setItem('memoria-legacy-home-timezone-dismissed', '1');
    const changed = new Set<() => void>();
    const opened = new Set<() => void>();
    const fixture: Harness = {
      value: {
        enabled: false,
        background: false,
        hotkey: 'CommandOrControl+Shift+M',
        sourceId: '',
        sourceName: '',
        gameId: '',
        gameName: '',
        registered: false,
        busy: false,
        count: 0,
        pending: [],
      },
      windows: [{ id: 'window:123:0', name: 'Genshin Impact game' }],
      saved: [],
      removed: [],
      notify: () => changed.forEach((listener) => listener()),
      open: () => opened.forEach((listener) => listener()),
    };
    const status = () => structuredClone(fixture.value);
    window.__playTest = fixture;
    window.memoriaDesktop = {
      version: 1,
      onCloseRequested: () => () => undefined,
      completeClose: () => undefined,
      play: {
        status: async () => status(),
        sources: async () => structuredClone(fixture.windows),
        configure: async (config) => {
          fixture.saved.push(structuredClone(config));
          Object.assign(fixture.value, config, { registered: config.enabled });
          fixture.notify();
          return status();
        },
        capture: async () => status(),
        remove: async (id) => {
          fixture.removed.push(id);
          fixture.value.pending = fixture.value.pending.filter((entry) => entry.id !== id);
          fixture.value.count = fixture.value.pending.length;
          fixture.notify();
          return status();
        },
        onChanged: (listener) => {
          changed.add(listener);
          return () => {
            changed.delete(listener);
          };
        },
        onOpen: (listener) => {
          opened.add(listener);
          return () => {
            opened.delete(listener);
          };
        },
      },
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const state = emptyState();
  state.games = [
    makeGame({ id: 'primary', name: 'Primary game', updatedAt: NOW - 600_000 }),
    makeGame({ id: 'secondary', name: 'Second account', sort: 1, updatedAt: NOW - 600_000 }),
  ];
  state.resources = state.games.map((game) =>
    makeResource({
      id: `resin-${game.id}`,
      gameId: game.id,
      name: 'Original Resin',
      cap: 200,
      updatedAt: NOW - 600_000,
    }),
  );
  state.snapshots = state.resources.map((resource) =>
    makeSnapshot({ id: `seed-${resource.id}`, resourceId: resource.id, value: 20, takenAt: NOW - 600_000 }),
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: 'play-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
});

test('play setup preserves drafts on native reopen and shows explicit background behavior', async ({ page }, info) => {
  const panel = await openPlay(page);
  await panel.getByRole('combobox', { name: 'Game account for captures', exact: true }).click();
  await page.getByRole('option', { name: 'Second account', exact: true }).click();
  await panel.getByRole('combobox', { name: 'Game window', exact: true }).click();
  await page.getByRole('option', { name: 'Genshin Impact game', exact: true }).click();
  await panel.getByRole('switch', { name: 'Use the capture shortcut', exact: true }).click();
  await panel.getByRole('switch', { name: 'Keep Memoria in the system tray', exact: true }).click();
  await page.evaluate(() => {
    window.__playTest.notify();
    window.__playTest.open();
  });
  await expect(panel.getByRole('combobox', { name: 'Game account for captures', exact: true })).toHaveText(
    'Second account',
  );
  await expect(panel.getByRole('combobox', { name: 'Game window', exact: true })).toHaveText('Genshin Impact game');
  await expect(panel.getByRole('switch', { name: 'Keep Memoria in the system tray', exact: true })).toBeChecked();
  await expect(panel.getByText(/When enabled, closing the window keeps account checks/)).toBeVisible();
  expect(await page.evaluate(() => window.__playTest.saved)).toEqual([]);
  await page.setViewportSize({ width: 640, height: 500 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('play-setup-short-window.png') });
  await panel.getByRole('button', { name: 'Save play mode', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__playTest.saved))
    .toEqual([
      {
        enabled: true,
        background: true,
        hotkey: 'CommandOrControl+Shift+M',
        sourceId: 'window:123:0',
        gameId: 'secondary',
      },
    ]);
  await page.evaluate(() => {
    window.__playTest.windows = [];
  });
  await panel.getByRole('button', { name: 'Refresh windows', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Game window', exact: true })).toContainText(
    'Selected window is closed',
  );
});

test('capture inbox keeps data pending until review and saves only its selected account', async ({ page }) => {
  await queueCapture(page, 'secondary');
  const panel = await openPlay(page);
  await expect(panel.getByRole('region', { name: 'Capture inbox' })).toContainText('1 to review');
  await panel.getByRole('button', { name: 'Review capture', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Import game readings', exact: true });
  await expect(review.getByRole('combobox', { name: 'Game account', exact: true })).toHaveText('Second account');
  expect(latestSnapshots((await stored(page)).snapshots).get('resin-secondary')?.value).toBe(20);
  expect(await page.evaluate(() => window.__playTest.removed)).toEqual([]);
  await review.getByRole('button', { name: 'Review readings', exact: true }).click();
  await expect(review.getByRole('spinbutton', { name: 'Original Resin', exact: true })).toHaveValue('88');
  await review.getByRole('button', { name: 'Apply reviewed readings', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__playTest.removed)).toEqual(['capture-secondary']);
  const saved = latestSnapshots((await stored(page)).snapshots);
  expect(saved.get('resin-primary')?.value).toBe(20);
  expect(saved.get('resin-secondary')?.value).toBe(88);
  expect(saved.get('resin-secondary')?.takenAt).toBe(NOW);
});

test('a capture from a removed account requires explicit reassignment and keeps its text', async ({ page }) => {
  await queueCapture(page, 'removed-account');
  const panel = await openPlay(page);
  await panel.getByRole('button', { name: 'Review capture', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Import game readings', exact: true });
  const account = review.getByRole('combobox', { name: 'Game account', exact: true });
  await expect(account).toHaveText('Choose a game account');
  await expect(review.getByRole('button', { name: 'Review readings', exact: true })).toBeDisabled();
  await account.click();
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await page.getByRole('option', { name: 'Primary game', exact: true }).click();
  await expect(account).toHaveText('Choose a game account');
  await account.click();
  page.once('dialog', (confirmation) => confirmation.accept());
  await page.getByRole('option', { name: 'Second account', exact: true }).click();
  await expect(review.getByRole('textbox', { name: 'Text from the screenshot', exact: true })).toHaveValue(
    'Original Resin 88 / 200',
  );
  await review.getByRole('button', { name: 'Review readings', exact: true }).click();
  await review.getByRole('button', { name: 'Apply reviewed readings', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__playTest.removed)).toEqual(['capture-removed-account']);
  const saved = latestSnapshots((await stored(page)).snapshots);
  expect(saved.get('resin-primary')?.value).toBe(20);
  expect(saved.get('resin-secondary')?.value).toBe(88);
  expect(saved.get('resin-secondary')?.takenAt).toBe(NOW);
});

test('reviewing a capture cannot replace a declined import draft', async ({ page }) => {
  await queueCapture(page, 'secondary');
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('memoria:open-import', { detail: { gameId: 'primary' } })),
  );
  const review = page.getByRole('dialog', { name: 'Import game readings', exact: true });
  await review.getByRole('textbox', { name: 'Text from the screenshot', exact: true }).fill('Original Resin 77 / 200');
  await page.evaluate(() => window.__playTest.open());
  const panel = page.getByRole('dialog', { name: 'Play mode', exact: true });
  await expect(panel).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await panel.getByRole('button', { name: 'Review capture', exact: true }).click();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(review.getByRole('textbox', { name: 'Text from the screenshot', exact: true })).toHaveValue(
    'Original Resin 77 / 200',
  );
  expect(await page.evaluate(() => window.__playTest.removed)).toEqual([]);
});
