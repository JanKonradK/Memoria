import { expect, test } from '@playwright/test';

test('failed local saves keep edits available for retry and backup', async ({ page }, info) => {
  test.skip(!['android-s23', 'desktop'].includes(info.project.name), 'Phone and desktop storage recovery');
  await page.addInitScript(() => {
    localStorage.setItem('memoria-onboarding', 'complete');
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (sessionStorage.getItem('test-fail-save')) throw new DOMException('Storage is full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Add your first game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const open = page.getByRole('button', { name: /^(Open|Expand) Genshin Impact controls$/ });
  const energy = page.getByLabel('Original Resin current value');
  const openControls = async () => {
    await expect.poll(async () => (await energy.isVisible()) || (await open.isVisible())).toBe(true);
    if (!(await energy.isVisible())) await open.click();
  };
  await openControls();
  await expect(energy).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('test-fail-save', '1'));
  await energy.fill('37');
  await energy.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Your latest changes could not be saved');
  await page.getByRole('button', { name: 'Refresh data' }).click();
  await expect(energy).toHaveValue('37');
  await page.getByRole('button', { name: 'Open backup settings' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const backup = JSON.parse(Buffer.concat(chunks).toString());
  expect(backup.snapshots.some((snapshot: { value: number }) => snapshot.value === 37)).toBe(true);
  await page.evaluate(() => sessionStorage.removeItem('test-fail-save'));
  await page.getByRole('button', { name: 'Try saving again' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: 'Games', exact: true }).click();
  await openControls();
  await expect(energy).toHaveValue('37');
});
