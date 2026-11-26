import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConfirmHost, confirmDialog } from '../src/components/ConfirmDialog';
import { WindowChrome } from '../src/components/WindowChrome';
import type { DesktopWindow, DesktopWindowState } from '../src/desktop-host';

function fakeHost() {
  let emit: (state: DesktopWindowState) => void = () => undefined;
  let maximized = false;
  const state = () => ({ maximized, focused: true, zoom: 1 });
  const host: DesktopWindow = {
    minimize: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => {
      maximized = !maximized;
      return state();
    }),
    close: vi.fn(async () => undefined),
    getState: vi.fn(async () => state()),
    onStateChanged: (listener) => {
      emit = listener;
      return () => (emit = () => undefined);
    },
  };
  return { host, emit: (next: DesktopWindowState) => emit(next) };
}

it('marks the page while it is shown and drives the window from its buttons', async () => {
  const { host, emit } = fakeHost();
  const { unmount } = render(<WindowChrome host={host} />);
  expect(document.documentElement).toHaveAttribute('data-desktop-chrome');
  const bar = document.querySelector('[data-window-chrome]')!;
  await waitFor(() => expect(bar).toHaveAttribute('data-active'));

  fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
  expect(await screen.findByRole('button', { name: 'Restore' })).toBeInTheDocument();
  // A change made through Windows (a double-click, Snap) arrives as an event.
  act(() => emit({ maximized: false, focused: false, zoom: 1.25 }));
  expect(screen.getByRole('button', { name: 'Maximize' })).toBeInTheDocument();
  expect(bar).not.toHaveAttribute('data-active');

  // Pressing a caption button never moves focus off what was being typed into.
  const close = screen.getByRole('button', { name: 'Close' });
  expect(fireEvent.mouseDown(close)).toBe(false);
  fireEvent.click(close);
  fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
  expect(host.close).toHaveBeenCalledOnce();
  expect(host.minimize).toHaveBeenCalledOnce();

  unmount();
  expect(document.documentElement).not.toHaveAttribute('data-desktop-chrome');
});

it('keeps a dialog open when its title bar is pressed, but not when the page is', async () => {
  render(
    <>
      <div data-window-chrome="">
        <button type="button">Minimize</button>
      </div>
      <p>Page</p>
      <ConfirmHost />
    </>,
  );
  const settled = vi.fn();
  void confirmDialog({ title: 'Discard your unsaved changes?' }).then(settled);
  const dialog = await screen.findByRole('alertdialog');
  // Radix starts listening for outside presses a moment after opening.
  await new Promise((done) => setTimeout(done, 10));

  // A press outside a dialog dismisses it on the click that ends it.
  const press = (target: HTMLElement) => {
    fireEvent.pointerDown(target);
    fireEvent.mouseDown(target);
    fireEvent.pointerUp(target);
    fireEvent.mouseUp(target);
    fireEvent.click(target);
  };
  press(screen.getByText('Minimize', { selector: 'button' }));
  await new Promise((done) => setTimeout(done, 10));
  expect(dialog).toBeInTheDocument();
  expect(settled).not.toHaveBeenCalled();

  press(screen.getByText('Page'));
  await waitFor(() => expect(settled).toHaveBeenCalledWith(false));
});
