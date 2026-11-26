import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ConfirmHost, confirmDialog } from '../src/components/ConfirmDialog';

it('focuses confirm on normal prompts, cancel on danger prompts, and cancel when danger follows immediately', async () => {
  render(<ConfirmHost />);

  const first = confirmDialog({ title: 'Continue?', confirmLabel: 'Yes', cancelLabel: 'No' });
  const yes = await screen.findByRole('button', { name: 'Yes' });
  await waitFor(() => expect(yes).toHaveFocus());

  // Queued: second question arrives while first is still open.
  const second = confirmDialog({
    title: 'Delete everything?',
    danger: true,
    confirmLabel: 'Delete',
    cancelLabel: 'Keep safe',
  });
  fireEvent.click(yes);
  expect(await first).toBe(true);

  const keepSafe = await screen.findByRole('button', { name: 'Keep safe' });
  const del = screen.getByRole('button', { name: 'Delete' });
  await waitFor(() => expect(keepSafe).toHaveFocus());
  expect(del).not.toHaveFocus();

  // Rapid reopen: first settles to empty, then a danger prompt asks right away before exit finishes.
  let third!: Promise<boolean>;
  act(() => {
    fireEvent.click(keepSafe);
    third = confirmDialog({
      title: 'Remove permanently?',
      danger: true,
      confirmLabel: 'Destroy',
      cancelLabel: 'Cancel danger',
    });
  });
  expect(await second).toBe(false);

  const cancelDanger = await screen.findByRole('button', { name: 'Cancel danger' });
  const destroy = screen.getByRole('button', { name: 'Destroy' });
  await waitFor(() => expect(cancelDanger).toHaveFocus());
  expect(destroy).not.toHaveFocus();

  fireEvent.click(cancelDanger);
  expect(await third).toBe(false);
});
