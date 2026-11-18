import { expect, test, type Page } from '@playwright/test';
import { openGame, addFromShell } from './support';

const GAMES = [
  ['Honkai: Star Rail', 'HSR'],
  ['Neverness to Everness', 'NTE'],
  ['Umamusume: Pretty Derby', 'Uma'],
  ['Goddess of Victory: Nikke', 'NIKKE'],
] as const;

async function addGame(page: Page, name: string, short: string, first: boolean) {
  if (first) await page.getByRole('button', { name: 'Add a game' }).click();
  else {
    await addFromShell(page, 'Add game');
  }
  await page.getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await page.getByRole('combobox', { name: 'Server' }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByRole('button', { name: new RegExp(`^Add ${short}`) }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Words of the heading that the browser split across two lines. */
async function brokenWords(page: Page): Promise<string[]> {
  return page.locator('.focus-workspace .game-card-heading h2').evaluate((heading) => {
    const text = heading.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) return ['(no text)'];
    const broken: string[] = [];
    const value = text.textContent ?? '';
    for (const match of value.matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(text, match.index);
      range.setEnd(text, match.index + match[0].length);
      const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
      if (tops.size > 1) broken.push(match[0]);
    }
    return broken;
  });
}

test('game headings wrap between words, never inside one', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  for (const [index, [name, short]] of GAMES.entries()) await addGame(page, name, short, index === 0);
  for (const [name] of GAMES) {
    await openGame(page, name);
    expect(await brokenWords(page), name).toEqual([]);
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Today', exact: true }).click();
  }
});
