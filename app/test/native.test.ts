import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUI } from '../src/ui-store';
import { exportNativeBackup, initNative, scanPairingCode } from '../src/native';

const native = vi.hoisted(() => ({
  back: undefined as (() => void) | undefined,
  exit: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
  scan: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn((_id: string | null, _previous: string | null, update: () => void) => update()),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: (name: string) => (name === 'PairingScanner' ? { scan: native.scan } : { save: native.save }),
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (_name: string, listener: () => void) => {
      native.back = listener;
      return Promise.resolve({ remove: vi.fn() });
    },
    exitApp: native.exit,
  },
}));
vi.mock('../src/workspace-navigation', () => ({ navigateWorkspace: native.navigate }));
vi.mock('../src/store', () => ({ flushPersist: native.flush }));

beforeAll(async () => initNative());
beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
  useUI.setState({ sheet: null, focusedGameId: null, tab: 'today' });
});

describe('Android back navigation', () => {
  it('lets the open editor handle Escape instead of discarding its draft', () => {
    useUI.setState({ sheet: { kind: 'addGame' }, focusedGameId: 'game' });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    const dismiss = vi.fn((event: KeyboardEvent) => event.preventDefault());
    document.addEventListener('keydown', dismiss, { once: true });
    native.back?.();
    expect(dismiss).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
    expect(useUI.getState().sheet).toEqual({ kind: 'addGame' });
    expect(native.exit).not.toHaveBeenCalled();
  });

  it('returns from game to roster, then to Today, before exiting', async () => {
    useUI.setState({ focusedGameId: 'game', tab: 'timeline' });
    native.back?.();
    expect(native.navigate).toHaveBeenCalledWith(null, 'game', expect.any(Function));
    expect(useUI.getState().focusedGameId).toBeNull();
    expect(native.exit).not.toHaveBeenCalled();
    native.back?.();
    expect(useUI.getState().tab).toBe('today');
    expect(native.exit).not.toHaveBeenCalled();
    native.back?.();
    await vi.waitFor(() => expect(native.exit).toHaveBeenCalledOnce());
  });

  it('waits for the pending save and ignores repeated exit requests', async () => {
    let finishSave!: () => void;
    native.flush.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
    );
    native.back?.();
    native.back?.();
    expect(native.flush).toHaveBeenCalledOnce();
    expect(native.exit).not.toHaveBeenCalled();
    finishSave();
    await vi.waitFor(() => expect(native.exit).toHaveBeenCalledOnce());
  });

  it('stays open after a failed save and lets Back retry', async () => {
    native.flush.mockRejectedValueOnce(new Error('Storage is full'));
    native.back?.();
    // Let the rejected flush and its cleanup finish before the next Back.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(native.exit).not.toHaveBeenCalled();
    native.back?.();
    await vi.waitFor(() => expect(native.exit).toHaveBeenCalledOnce());
    expect(native.flush).toHaveBeenCalledTimes(2);
  });

  it('does not exit if the user navigates while a save is pending', async () => {
    let finishSave!: () => void;
    native.flush.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
    );
    native.back?.();
    useUI.setState({ tab: 'settings' });
    finishSave();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(native.exit).not.toHaveBeenCalled();
  });

  it('passes backup contents to the native document chooser', async () => {
    await exportNativeBackup('{"games":[]}', 'Memoria-backup.json');
    expect(native.save).toHaveBeenCalledWith({ text: '{"games":[]}', fileName: 'Memoria-backup.json' });
  });

  it('returns scan text unchanged so the pairing client can validate it', async () => {
    const text = '  {"version":1,"address":"http://192.168.1.2:17820"}  ';
    native.scan.mockResolvedValueOnce({ text });
    await expect(scanPairingCode()).resolves.toBe(text);
    expect(native.scan).toHaveBeenCalledOnce();
  });

  it('preserves cancellation and camera-denied errors for the pairing screen', async () => {
    for (const code of ['CANCELLED', 'CAMERA_DENIED', 'CAMERA_UNAVAILABLE']) {
      const error = Object.assign(new Error('Camera message'), { code });
      native.scan.mockRejectedValueOnce(error);
      await expect(scanPairingCode()).rejects.toBe(error);
    }
  });
});
