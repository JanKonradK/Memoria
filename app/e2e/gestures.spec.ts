import { expect, test, type Locator, type Page } from '@playwright/test';
import { PRESETS, serversFor } from '@memoria/shared';

test.skip(({ viewport }) => viewport?.width !== 390, 'Touch gestures on a phone');

/** Adds games straight through the store: each entry is a preset and the server labels to add it on. */
async function seed(page: Page, games: [string, string[]][]) {
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('nav[aria-label="Primary"]'));
  const list = games.flatMap(([key, servers]) => {
    const preset = PRESETS.find((item) => item.key === key)!;
    return servers.map((label, index) => {
      const server = serversFor(key).find((item) => item.label === label) ?? serversFor(key)[0];
      return {
        preset,
        pick: server ? { server: server.id, tz: server.tz } : { tz: preset.tz },
        accountLabel: servers.length > 1 ? `Account ${index + 1}` : undefined,
      };
    });
  });
  await page.evaluate(async (entries) => {
    const path = '/src/store.ts';
    const { useApp, flushPersist } = await import(/* @vite-ignore */ path);
    for (const { preset, pick, accountLabel } of entries) {
      useApp.getState().addGameFromPreset(preset, { ...pick, accountLabel });
    }
    await flushPersist();
  }, list);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('nav[aria-label="Primary"]'));
}

/** A finger drag across `target`, from `from` to `to` as fractions of its width, at its middle. */
async function drag(target: Locator, from: number, to: number, steps = 6) {
  const box = (await target.boundingBox())!;
  const y = box.y + box.height / 2;
  const at = (fraction: number) => box.x + box.width * fraction;
  await target.evaluate(
    (node, { points, y }) => {
      const send = (type: string, x: number) =>
        node.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 11,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
          }),
        );
      send('pointerdown', points[0]!);
      for (const x of points.slice(1)) send('pointermove', x);
      send('pointerup', points.at(-1)!);
    },
    {
      y,
      points: Array.from({ length: steps + 1 }, (_, index) => at(from + ((to - from) * index) / steps)),
    },
  );
}

async function openGameByName(page: Page, name: RegExp) {
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const game = nav.getByRole('button', { name }).first();
  // Games raises the shelf; pressed again it would lower it.
  if (!(await game.isVisible())) await nav.getByRole('button', { name: 'Games', exact: true }).click();
  await game.click();
}

test('a task swiped right is done and swiped left is not, without changing page', async ({ page }) => {
  await seed(page, [['genshin', ['Europe']]]);
  await openGameByName(page, /^Genshin Impact/);
  const task = page.getByRole('button', { name: /Daily Commissions/ }).first();
  await expect(task).toHaveAttribute('aria-pressed', 'false');
  await drag(task, 0.2, 0.75);
  await expect(task).toHaveAttribute('aria-pressed', 'true');
  // Swiping right again has nothing to do on a done task: the page swipe has it instead.
  await drag(task, 0.75, 0.2);
  await expect(task).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('tab', { name: 'Track' })).toHaveAttribute('aria-selected', 'true');
});

test('a Today step swiped right counts as done', async ({ page }) => {
  await seed(page, [['genshin', ['Europe']]]);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  const step = page.locator('.today-step[data-kind="task"]:not([data-done])').first();
  const key = await step.getAttribute('data-step');
  await drag(step.locator('.today-step-open'), 0.1, 0.8);
  // A finished step leaves the list (or stays, ticked); Today itself stays put.
  await expect(page.locator(`.today-step[data-step="${key}"]:not([data-done])`)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Today', exact: true })).toBeVisible();
});

test('dragging along the resin bar sets the reading', async ({ page }) => {
  await seed(page, [['genshin', ['Europe']]]);
  await openGameByName(page, /^Genshin Impact/);
  const value = page.getByLabel('Original Resin current value');
  const bar = page.locator('[data-energy-row]').first().locator('.energy-scrub');
  await drag(bar, 0.05, 0.5, 10);
  await expect(value).toHaveValue('100');
  await drag(bar, 0.5, 1.1, 10);
  await expect(value).toHaveValue('200');
});

test('a swipe on a game page walks its tabs, then the next game', async ({ page }) => {
  await seed(page, [
    ['genshin', ['Europe']],
    ['hsr', ['Europe']],
  ]);
  await openGameByName(page, /^Genshin Impact/);
  const surface = page.locator('.energy-resource-name').first();
  await drag(surface, 0.9, 0.1);
  await expect(page.getByRole('tab', { name: /^Events/ })).toHaveAttribute('aria-selected', 'true');
  // From the last tab, the next swipe opens the next game on its first tab.
  await page.getByRole('tab', { name: 'Notes' }).click();
  await drag(page.getByRole('heading', { level: 1, name: 'Genshin Impact' }), 0.9, 0.1);
  await expect(page.getByRole('heading', { level: 1, name: /Honkai: Star Rail/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Track' })).toHaveAttribute('aria-selected', 'true');
});

test('the same game on two servers shows its accounts as a strip; one account shows none', async ({ page }) => {
  await seed(page, [
    ['genshin', ['Europe', 'Asia']],
    ['hsr', ['Europe']],
  ]);
  await openGameByName(page, /^Genshin Impact, Account 1/);
  const strip = page.getByRole('group', { name: 'Genshin Impact accounts' });
  await expect(strip.getByRole('button')).toHaveCount(2);
  await expect(strip.getByRole('button', { pressed: true })).toContainText('Account 1');
  await strip.getByRole('button', { name: /Account 2/ }).click();
  await expect(strip.getByRole('button', { pressed: true })).toContainText('Account 2');
  await openGameByName(page, /^Honkai: Star Rail/);
  await expect(page.getByRole('group', { name: /accounts$/ })).toHaveCount(0);
});
