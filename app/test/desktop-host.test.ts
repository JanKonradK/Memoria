import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDesktopHost, isDesktopApp, useUnsavedDraft, type DesktopCloseResult } from '../src/desktop-host';

const lifecycle = vi.hoisted(() => ({
  persist: vi.fn<() => Promise<void>>(),
  sync: vi.fn<() => Promise<void>>(),
  store: { loaded: true, loadError: '', state: {} },
}));
vi.mock('../src/store', () => ({
  flushPersist: lifecycle.persist,
  useApp: { getState: () => lifecycle.store, subscribe: () => vi.fn() },
}));
vi.mock('../src/sync', () => ({ flushSync: lifecycle.sync }));

let close: (requestId: string) => void;
let stop: (() => void) | undefined;
const complete = vi.fn<(requestId: string, result: DesktopCloseResult) => void>();
const unsubscribe = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  lifecycle.store = { loaded: true, loadError: '', state: {} };
  lifecycle.persist.mockResolvedValue(undefined);
  lifecycle.sync.mockResolvedValue(undefined);
  window.memoriaDesktop = {
    version: 1,
    onCloseRequested: (listener) => {
      close = listener;
      return unsubscribe;
    },
    completeClose: complete,
  };
  stop = initDesktopHost();
});

afterEach(() => {
  stop?.();
  delete window.memoriaDesktop;
  vi.restoreAllMocks();
});

describe('installed PC close lifecycle', () => {
  it('saves local data, drains PC sync, then saves the merged response before closing', async () => {
    const order: string[] = [];
    lifecycle.persist.mockImplementation(async () => {
      order.push('local');
    });
    lifecycle.sync.mockImplementation(async () => {
      order.push('pc');
    });
    close('close-1');
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith('close-1', { allow: true }));
    expect(order).toEqual(['local', 'pc', 'local']);
  });

  it('commits the active inline editor before saving', async () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const blur = vi.fn();
    input.addEventListener('blur', blur);
    lifecycle.persist.mockImplementation(async () => {
      expect(blur).toHaveBeenCalledOnce();
    });
    close('close-2');
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith('close-2', { allow: true }));
    input.remove();
  });

  it('keeps a dirty draft when the user cancels and asks only once when they discard', async () => {
    renderHook(() => useUnsavedDraft(true));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    close('keep-draft');
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith('keep-draft', { allow: false }));
    expect(lifecycle.persist).not.toHaveBeenCalled();
    close('discard-draft');
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith('discard-draft', { allow: true }));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it.each(['persist', 'sync'] as const)('stays open if %s fails and permits a retry', async (operation) => {
    lifecycle[operation].mockRejectedValueOnce(new Error('Disk is full'));
    close('failed-save');
    await vi.waitFor(() =>
      expect(complete).toHaveBeenCalledWith('failed-save', { allow: false, error: 'Disk is full' }),
    );
    close('retry-save');
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith('retry-save', { allow: true }));
  });

  it('ignores repeated close requests while the save is pending', async () => {
    let finish!: () => void;
    lifecycle.sync.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    close('first-close');
    close('duplicate-close');
    await vi.waitFor(() => expect(lifecycle.sync).toHaveBeenCalledOnce());
    expect(complete).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith('first-close', { allow: true }));
    expect(complete).toHaveBeenCalledOnce();
  });

  it('stays open if the user starts another edit during the final save', async () => {
    let finish!: () => void;
    lifecycle.sync.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    close('editing');
    await vi.waitFor(() => expect(lifecycle.sync).toHaveBeenCalledOnce());
    document.dispatchEvent(new Event('input', { bubbles: true }));
    finish();
    await vi.waitFor(() =>
      expect(complete).toHaveBeenCalledWith('editing', {
        allow: false,
        error: expect.stringContaining('Changes arrived'),
      }),
    );
  });

  it('keeps a late cloud merge open until its new state has reached the PC', async () => {
    lifecycle.persist.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      // replaceState from cloud sync does not emit the local mutation event.
      lifecycle.store.state = { incoming: 'cloud edit' };
    });
    close('late-cloud-merge');
    await vi.waitFor(() =>
      expect(complete).toHaveBeenCalledWith('late-cloud-merge', {
        allow: false,
        error: expect.stringContaining('Changes arrived'),
      }),
    );
    close('retry-cloud-merge');
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith('retry-cloud-merge', { allow: true }));
  });

  it('protects loading and failed restoration from an early close', async () => {
    lifecycle.store.loaded = false;
    close('not-loaded');
    await vi.waitFor(() =>
      expect(complete).toHaveBeenCalledWith('not-loaded', { allow: false, error: expect.any(String) }),
    );
    expect(lifecycle.sync).not.toHaveBeenCalled();
  });

  it('can close a clean failed first launch without pushing defaults to the PC', async () => {
    stop?.();
    lifecycle.store = { loaded: false, loadError: 'The PC file could not be opened.', state: {} };
    stop = initDesktopHost();
    close('failed-first-open');
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith('failed-first-open', { allow: true }));
    expect(lifecycle.persist).toHaveBeenCalledOnce();
    expect(lifecycle.sync).not.toHaveBeenCalled();
  });

  it('does not treat a later load error as a clean first launch', async () => {
    lifecycle.store = { loaded: false, loadError: 'The PC file could not be opened.', state: {} };
    close('failed-reload');
    await vi.waitFor(() =>
      expect(complete).toHaveBeenCalledWith('failed-reload', { allow: false, error: expect.any(String) }),
    );
    expect(lifecycle.sync).not.toHaveBeenCalled();
  });

  it('does not acknowledge a close after the app listener unmounts', async () => {
    let finish!: () => void;
    lifecycle.sync.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    close('unmounted');
    await vi.waitFor(() => expect(lifecycle.sync).toHaveBeenCalledOnce());
    stop?.();
    stop = undefined;
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('is inactive in a normal browser', () => {
    stop?.();
    stop = undefined;
    delete window.memoriaDesktop;
    expect(isDesktopApp()).toBe(false);
    expect(initDesktopHost()).toBeUndefined();
  });
});
