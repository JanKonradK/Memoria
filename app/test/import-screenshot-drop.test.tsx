import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { emptyState } from '@memoria/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { makeGame, makeResource } from '../../shared/test/helpers';

const launcher = vi.hoisted(() => ({ fetch: vi.fn(), available: true }));
vi.mock('../src/native', () => ({ isNativeApp: false }));
vi.mock('../src/launcher', () => ({ servedByLauncher: () => launcher.available, launcherFetch: launcher.fetch }));
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn(async () => []) }));
vi.mock('motion/react', () => ({ AnimatePresence: ({ children }: { children: ReactNode }) => children }));
vi.mock('../src/components/Sheet', () => ({
  Sheet: ({ children, footer, onClose }: { children: ReactNode; footer: ReactNode; onClose(): void }) => (
    <section role="dialog">
      <button onClick={onClose}>Close import</button>
      {children}
      {footer}
    </section>
  ),
}));
vi.mock('../src/components/GameConnections', () => ({ GameConnections: () => null }));

import { ImportCenter } from '../src/components/ImportCenter';
import { useApp } from '../src/store';

const png = () => new File(['png fixture'], 'screenshot.png', { type: 'image/png' });
const result = () => new Response(JSON.stringify({ text: 'Original Resin 123/200', capturedAt: Date.now() - 1000 }));
const transfer = (files: File[]) => ({ files, types: ['Files'] });
const drop = (files: File[], target: Element | Document = document) =>
  fireEvent.drop(target, { dataTransfer: transfer(files) });
const text = () => screen.getByRole('textbox', { name: 'Text from the screenshot' });
function open() {
  act(() => {
    document.dispatchEvent(new CustomEvent('memoria:open-import'));
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  launcher.available = true;
  launcher.fetch.mockReset().mockImplementation(async () => result());
  const state = emptyState();
  state.games = [makeGame()];
  state.resources = [makeResource({ name: 'Original Resin' })];
  useApp.setState({ state, loaded: true, importHistory: [] });
});

it('opens a dropped screenshot for review without applying readings', async () => {
  const apply = vi.spyOn(useApp.getState(), 'applyGameImport');
  render(<ImportCenter />);
  expect(drop([png()])).toBe(false);
  await waitFor(() => expect(text()).toHaveValue('Original Resin 123/200'));
  expect(launcher.fetch).toHaveBeenCalledTimes(1);
  expect(launcher.fetch).toHaveBeenCalledWith('/api/ocr', expect.objectContaining({ method: 'POST' }));
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Review readings' }));
  expect(screen.getByRole('button', { name: 'Apply reviewed readings' })).toBeEnabled();
});

it.each([
  ['multiple files', () => [png(), png()]],
  ['wrong image type', () => [new File(['gif'], 'image.gif', { type: 'image/gif' })]],
  ['empty image', () => [new File([], 'empty.png', { type: 'image/png' })]],
  ['oversized image', () => [new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })]],
])('rejects %s and preserves the existing draft', (_, files) => {
  const confirm = vi.spyOn(window, 'confirm');
  render(<ImportCenter />);
  open();
  fireEvent.change(text(), { target: { value: 'Keep this reading' } });
  drop(files());
  expect(screen.getByRole('alert')).toHaveTextContent(/one PNG or JPEG image, up to 8 MB/);
  expect(text()).toHaveValue('Keep this reading');
  expect(confirm).not.toHaveBeenCalled();
  expect(launcher.fetch).not.toHaveBeenCalled();
});

it('requires confirmation before replacing a draft, including a pending capture', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<ImportCenter />);
  act(() => {
    document.dispatchEvent(
      new CustomEvent('memoria:review-capture', { detail: { id: 'capture', text: '', capturedAt: Date.now() - 1000 } }),
    );
  });
  drop([png()]);
  expect(confirm).toHaveBeenCalledWith('Replace the current import draft?');
  expect(launcher.fetch).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  drop([png()]);
  await waitFor(() => expect(text()).toHaveValue('Original Resin 123/200'));
});

it('keeps drag feedback across nested targets and does not block text dragging', () => {
  render(<ImportCenter />);
  open();
  const zone = screen.getByRole('group', { name: 'Screenshot upload' });
  const button = screen.getByRole('button', { name: 'Choose screenshot' });
  fireEvent.dragEnter(zone, { dataTransfer: transfer([png()]) });
  fireEvent.dragEnter(button, { dataTransfer: transfer([png()]) });
  fireEvent.dragLeave(button, { dataTransfer: transfer([png()]) });
  expect(screen.getByText('Release screenshot to read it')).toBeInTheDocument();
  fireEvent.dragLeave(zone, { dataTransfer: transfer([png()]) });
  expect(screen.getByText('Drop screenshot here')).toBeInTheDocument();
  expect(fireEvent.dragOver(document, { dataTransfer: { types: ['text/plain'] } })).toBe(true);
  expect(fireEvent.drop(document, { dataTransfer: { types: ['text/plain'] } })).toBe(true);
});

it('blocks another drop during recognition and discards the result after close and reopen', async () => {
  let resolve!: (response: Response) => void;
  launcher.fetch.mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  render(<ImportCenter />);
  drop([png()]);
  await waitFor(() => expect(launcher.fetch).toHaveBeenCalledTimes(1));
  drop([png()], screen.getByRole('group', { name: 'Screenshot upload' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Wait for the current screenshot');
  expect(launcher.fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close import' }));
  open();
  await act(async () => {
    resolve(result());
  });
  expect(text()).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Choose screenshot' })).toBeEnabled();
});

it('explains the browser fallback without navigating away or clearing text', () => {
  launcher.available = false;
  render(<ImportCenter />);
  open();
  fireEvent.change(text(), { target: { value: 'Keep this reading' } });
  expect(drop([png()])).toBe(false);
  expect(screen.getByRole('alert')).toHaveTextContent('Open the Windows app to read this image');
  expect(text()).toHaveValue('Keep this reading');
  expect(launcher.fetch).not.toHaveBeenCalled();
});
