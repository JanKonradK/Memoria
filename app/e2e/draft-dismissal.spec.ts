import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }, info) => {
  test.skip(!['android-s23', 'desktop'].includes(info.project.name), 'Phone and desktop draft protection');
  await page.addInitScript(() => localStorage.setItem('memoria-onboarding', 'complete'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add your first game' }).click();
  await page.getByRole('button', { name: /Genshin Impact/ }).click();
  await page.getByRole('button', { name: 'Add Genshin', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-layer=sheet]')).toHaveCount(0);
});

for (const kind of ['Event', 'Reminder'] as const) {
  test(`${kind} keeps its draft when dismissal is rejected`, async ({ page }, info) => {
    const open = async () => {
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('menuitem', { name: kind, exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    };
    await open();
    // An untouched editor closes without an unnecessary prompt.
    let prompts = 0;
    let discard = false;
    page.on('dialog', async (dialog) => {
      prompts++;
      expect(dialog.message()).toBe('Discard your unsaved changes?');
      if (discard) await dialog.accept();
      else await dialog.dismiss();
    });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-layer=sheet]')).toHaveCount(0);
    expect(prompts).toBe(0);
    await open();
    const field = page.getByLabel(kind === 'Event' ? 'Name' : 'Message', { exact: true });
    await field.fill('Keep this draft');
    if (kind === 'Reminder') {
      const when = page.getByLabel('When', { exact: true });
      const originalWhen = await when.inputValue();
      await when.fill('');
      await expect(when).toHaveValue('');
      await expect(page.getByRole('alert')).toHaveText('Enter a valid date and time.');
      await expect(page.getByRole('button', { name: 'Add reminder', exact: true })).toBeDisabled();
      await when.fill(originalWhen);
    }
    // Android Back is routed through this same Escape event.
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue('Keep this draft');
    expect(prompts).toBe(1);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(field).toHaveValue('Keep this draft');
    expect(prompts).toBe(2);
    if (info.project.name === 'android-s23') {
      const dialog = page.getByRole('dialog');
      const box = (await dialog.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + 180, { steps: 8 });
      await page.mouse.up();
      await expect(field).toHaveValue('Keep this draft');
      await expect.poll(async () => (await dialog.boundingBox())!.y).toBeCloseTo(box.y, 0);
      expect(prompts).toBe(3);
    }
    // Save commits without asking to discard.
    const beforeSave = prompts;
    await page.getByRole('button', { name: kind === 'Event' ? 'Add event' : 'Add reminder', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-layer=sheet]')).toHaveCount(0);
    expect(prompts).toBe(beforeSave);
    await open();
    await field.fill('Discard this draft');
    discard = true;
    await page.getByRole('button', { name: kind === 'Event' ? 'Cancel' : 'Close', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-layer=sheet]')).toHaveCount(0);
    await open();
    await expect(field).toHaveValue('');
  });
}

test('game settings protect unfinished tasks and reminders through dismissal and event navigation', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Game settings for Genshin Impact', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Genshin Impact', exact: true });
  let prompts = 0;
  page.on('dialog', async (dialog) => {
    prompts++;
    expect(dialog.message()).toBe('Discard your unsaved changes?');
    await dialog.dismiss();
  });

  await editor.getByRole('tab', { name: 'Tasks', exact: true }).click();
  const taskName = editor.getByLabel('New task name');
  await taskName.fill('Keep this routine');
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(taskName).toHaveValue('Keep this routine');
  expect(prompts).toBe(1);
  await editor.getByRole('button', { name: '+ Task', exact: true }).click();

  await editor.getByRole('tab', { name: 'Reminders', exact: true }).click();
  await editor.getByLabel('Reminder message').fill('Keep this reminder');
  await page.keyboard.press('Escape');
  await expect(editor.getByLabel('Reminder message')).toHaveValue('Keep this reminder');
  expect(prompts).toBe(2);
  await editor.getByRole('tab', { name: 'Events', exact: true }).click();
  await editor.getByRole('button', { name: 'Add event', exact: true }).click();
  await expect(editor).toBeVisible();
  expect(prompts).toBe(3);

  await editor.getByRole('tab', { name: 'Reminders', exact: true }).click();
  await expect(editor.getByLabel('Reminder message')).toHaveValue('Keep this reminder');
  await editor.getByRole('button', { name: 'Add reminder', exact: true }).click();
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(prompts).toBe(3);
});

test('event and reminder forms save from Enter and explain invalid dates', async ({ page }) => {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Event', exact: true }).click();
  const event = page.getByRole('dialog', { name: 'New event', exact: true });
  await event.getByLabel('Name', { exact: true }).fill('Keyboard event');
  const starts = event.getByLabel('Starts', { exact: true });
  const startValue = await starts.inputValue();
  await starts.fill('');
  await expect(starts).toHaveAttribute('aria-invalid', 'true');
  await expect(event.getByRole('alert')).toContainText('Enter valid dates');
  await expect(event.getByRole('button', { name: 'Add event', exact: true })).toBeDisabled();
  await starts.fill(startValue);
  await event.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep a second line');
  await event.getByRole('textbox', { name: 'Notes', exact: true }).press('Enter');
  await expect(event).toBeVisible();
  await event.getByLabel('Name', { exact: true }).press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-layer=sheet]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Reminder', exact: true }).click();
  const reminder = page.getByRole('dialog', { name: 'New reminder', exact: true });
  await reminder.getByLabel('Message', { exact: true }).fill('Keyboard reminder');
  const when = reminder.getByLabel('When', { exact: true });
  const whenValue = await when.inputValue();
  await when.fill('');
  await expect(when).toHaveAttribute('aria-invalid', 'true');
  await expect(reminder.getByRole('alert')).toHaveText('Enter a valid date and time.');
  await when.fill(whenValue);
  await reminder.getByRole('combobox', { name: 'Game (optional)' }).click();
  await page.getByRole('option', { name: 'Genshin Impact', exact: true }).click();
  await reminder.getByLabel('Message', { exact: true }).press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-layer=sheet]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Game settings for Genshin Impact', exact: true }).click();
  await page.getByRole('tab', { name: 'Reminders', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit reminder Keyboard reminder', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('[data-layer=sheet]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.getByRole('radio', { name: 'List', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit Genshin Impact event: Keyboard event', exact: true }),
  ).toBeVisible();
});
