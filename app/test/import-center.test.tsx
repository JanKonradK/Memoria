import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { emptyState, type GameImportBatch } from '@memoria/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeGame, makeResource, makeTask } from '../../shared/test/helpers';

const native = vi.hoisted(() => ({ choose: vi.fn(), batch: undefined as GameImportBatch | undefined }));
vi.mock('../src/native', () => ({ isNativeApp: true }));
vi.mock('../src/launcher', () => ({ servedByLauncher: () => false, launcherFetch: vi.fn() }));
vi.mock('../src/screenshot-native', () => ({
  chooseScreenshot: native.choose,
  getPendingScreenshot: vi.fn(async () => null),
  onScreenshotReceived: vi.fn(async () => ({ remove: vi.fn() })),
}));
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
vi.mock('../src/components/GameConnections', () => ({
  GameConnections: ({ onReview }: { onReview(batch: GameImportBatch): void }) => (
    <button onClick={() => onReview(native.batch!)}>Review account response</button>
  ),
}));

import { ImportCenter } from '../src/components/ImportCenter';
import { useApp } from '../src/store';

function open(gameId = 'g1') {
  act(() => {
    document.dispatchEvent(new CustomEvent('memoria:open-import', { detail: { gameId } }));
  });
}
function localTime(at: number) {
  const date = new Date(at);
  return new Date(at - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
}

beforeEach(() => {
  vi.restoreAllMocks();
  native.choose.mockReset();
  localStorage.clear();
  const state = emptyState();
  state.games = [makeGame(), makeGame({ id: 'g2', name: 'Other game' })];
  state.resources = [makeResource({ name: 'Original Resin', reserveCap: 2400, reserveLabel: 'Stored reserve' })];
  state.tasks = [makeTask()];
  useApp.setState({ state, importHistory: [], loaded: true });
  native.batch = {
    id: 'review',
    gameId: 'g1',
    observedAt: Date.now() - 1000,
    source: { kind: 'account', provider: 'hoyolab' },
    resources: [{ resourceId: 'r1', value: 123, reserve: 456 }],
    tasks: [{ taskId: 't1', done: true }],
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('import review draft safety', () => {
  it('reports an undo error without closing history or hiding its receipt', () => {
    useApp.setState({
      importHistory: [
        {
          batchId: 'receipt',
          gameId: 'g1',
          source: { kind: 'account', provider: 'hoyolab' },
          observedAt: Date.now(),
          importedAt: Date.now(),
          applied: 1,
          skipped: 0,
          issues: [],
          status: 'applied',
          resources: [],
          tasks: [],
        },
      ],
    });
    vi.spyOn(useApp.getState(), 'undoGameImport').mockImplementation(() => {
      throw new Error('The correction could not be saved.');
    });
    render(<ImportCenter />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'History', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo import' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The correction could not be saved.');
    expect(screen.getByRole('button', { name: 'Undo import' })).toBeEnabled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('locks draft inputs during recognition and discards a response after closing', async () => {
    let resolve!: (value: { text: string; capturedAt: number }) => void;
    native.choose.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<ImportCenter />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Choose screenshot' }));
    expect(screen.getByRole('textbox', { name: 'Text from the screenshot' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close import' }));
    await act(async () => {
      resolve({ text: 'Original Resin 99/200', capturedAt: Date.now() - 1000 });
    });
    open();
    expect(screen.getByRole('textbox', { name: 'Text from the screenshot' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Choose screenshot' })).toBeEnabled();
  });

  it('discards OCR results after an external game-selection change', async () => {
    let resolve!: (value: { text: string; capturedAt: number }) => void;
    native.choose.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<ImportCenter />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Choose screenshot' }));
    open('g2');
    await act(async () => {
      resolve({ text: 'Original Resin 99/200', capturedAt: Date.now() - 1000 });
    });
    expect(screen.getByRole('textbox', { name: 'Text from the screenshot' })).toHaveValue('');
  });

  it('requires another review after changing capture time with Taken just now', async () => {
    render(<ImportCenter />);
    open();
    fireEvent.change(screen.getByRole('textbox', { name: 'Text from the screenshot' }), {
      target: { value: 'Original Resin 123/200' },
    });
    fireEvent.change(screen.getByLabelText('Screenshot capture time (this device’s local time)'), {
      target: { value: localTime(Date.now() - 60_000) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review readings' }));
    expect(screen.getByRole('button', { name: 'Apply reviewed readings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Taken just now' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Apply reviewed readings' })).not.toBeInTheDocument(),
    );
  });

  it('reviews reserve values and can omit an unwanted task without marking it incomplete', () => {
    render(<ImportCenter />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Accounts', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Review account response' }));
    expect(screen.getByRole('spinbutton', { name: 'Stored reserve' })).toHaveValue(456);
    const apply = vi
      .spyOn(useApp.getState(), 'applyGameImport')
      .mockReturnValue({ batchId: 'review', applied: 1, skipped: 0, issues: [] });
    fireEvent.click(screen.getAllByRole('button', { name: 'Skip', exact: true })[1]!);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Stored reserve' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed readings' }));
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ tasks: [], resources: [expect.objectContaining({ value: 123, reserve: null })] }),
    );
  });

  it('keeps a current draft when replacement by account readings is declined', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ImportCenter />);
    open();
    fireEvent.change(screen.getByRole('textbox', { name: 'Text from the screenshot' }), {
      target: { value: 'My unfinished reading' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Accounts', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Review account response' }));
    expect(screen.queryByRole('button', { name: 'Apply reviewed readings' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot', exact: true }));
    expect(screen.getByRole('textbox', { name: 'Text from the screenshot' })).toHaveValue('My unfinished reading');
  });
});
