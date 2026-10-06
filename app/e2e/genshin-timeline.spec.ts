import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { emptyState } from '@memoria/shared';
import { makeEvent, makeGame } from '../../shared/test/helpers';
import { eventFingerprint, planSeedImport } from '../src/data/seed-events';

test('Genshin timeline separates worlds and refreshes legacy selectors with confirmed calendar dates', async ({
  page,
}, info) => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  const game = makeGame({
    name: 'Genshin Impact',
    presetKey: 'genshin',
    accountLabel: 'Technoplane!!',
    updatedAt: now,
  });
  const state = { ...emptyState(), games: [game] };
  state.events = planSeedImport(state, now)
    .filter((plan) => plan.kind === 'add')
    .map((plan, index) => {
      const event = makeEvent({
        id: `seed-${index}`,
        gameId: game.id,
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
        // Deliberately interleave old manual positions. Sections must still take precedence.
        sort: -index,
      });
      if (event.sourceKey?.endsWith('-selector')) {
        event.name = `Anniversary ${event.sourceKey.includes('standard') ? 'standard' : 'limited'} character selection — time TBC`;
        event.end -= 86_400_000;
        event.seedHash = eventFingerprint(event);
        delete event.category;
      }
      return event;
    });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'genshin-legacy.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)),
  });
  await page.getByRole('button', { name: 'Merge backup', exact: true }).click();
  // Loading the stored document is when the app safely refreshes bundled facts.
  await page.getByRole('button', { name: 'Refresh data', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  const view = page.getByRole('radiogroup', { name: 'Event view' });
  await view.getByRole('radio', { name: 'Timeline', exact: true }).click();
  const groups = page.locator('[data-timeline-event-group]');
  await expect
    .poll(() => groups.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-timeline-event-group'))))
    .toEqual(['teyvat', 'miliastra', 'banners']);
  const teyvat = page.locator('[data-timeline-event-group="teyvat"]');
  const mw = page.locator('[data-timeline-event-group="miliastra"]');
  const banners = page.locator('[data-timeline-event-group="banners"]');
  await expect(
    teyvat.getByRole('button', { name: /Open Genshin Impact event: Imaginarium Theater/ }).first(),
  ).toHaveCount(1);
  await expect(
    teyvat.getByRole('button', { name: /Open Genshin Impact event: Stygian Onslaught/ }).first(),
  ).toHaveCount(1);
  await expect(mw.locator('[data-event-tag]')).not.toHaveCount(0);
  await expect(
    banners.getByRole('button', { name: /Open Genshin Impact event: Wonderland Treasures/ }).first(),
  ).toHaveCount(1);
  for (const [key, label] of [
    ['predictive-victory', '12–20 Oct'],
    ['snowball', '21 Oct–2 Nov'],
    ['overflowing-favor', '26 Oct–2 Nov'],
  ]) {
    const event = state.events.find((event) => event.sourceKey === `seed:genshin:7.1-${key}`)!;
    await expect(
      page.locator(`[data-event-id="${event.id}"] [data-event-countdown]`).getByText(label, { exact: true }),
    ).toHaveCount(1);
  }
  const selectors = state.events.filter((event) => event.sourceKey?.endsWith('-selector'));
  for (const event of selectors) {
    const open = page.locator(`[data-event-id="${event.id}"] button[aria-label^="Open "]`);
    await expect(open).not.toHaveAttribute('aria-label', /TBC/);
    await expect(open).toHaveAttribute('aria-description', /3 Nov 2026/);
  }
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((issue) =>
        ['serious', 'critical'].includes(issue.impact ?? ''),
      ),
    ).toEqual([]);
    await teyvat.getByRole('heading').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`genshin-timeline-${theme}.png`) });
    await banners.getByRole('heading').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`genshin-timeline-banners-${theme}.png`) });
  }
  await view.getByRole('radio', { name: 'List', exact: true }).click();
  const predictive = state.events.find((event) => event.sourceKey === 'seed:genshin:7.1-predictive-victory')!;
  const listRow = page.locator(`[data-list-event="${predictive.id}"]`);
  await expect(listRow).toContainText('12–20 Oct');
  await expect(listRow).toContainText('UTC+8');
  await listRow.getByRole('button', { name: /^Edit / }).click();
  await expect(page.getByRole('dialog', { name: 'Edit event' })).toContainText('Official calendar: 12–20 Oct (UTC+8).');
});
