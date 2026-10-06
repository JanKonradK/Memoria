import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getPending: vi.fn(),
  cancel: vi.fn(),
  schedule: vi.fn(),
  addListener: vi.fn(),
  remove: vi.fn(),
  unsubscribe: vi.fn(),
  plan: vi.fn(),
  setTab: vi.fn(),
  change: undefined as ((next: { state: object }, prior: { state: object }) => void) | undefined,
  action: undefined as ((event: { notification: { extra?: { memoria: unknown } } }) => void) | undefined,
}));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: mocks }));
vi.mock('@memoria/shared', () => ({ buildNotificationPlan: mocks.plan }));
vi.mock('../src/native', () => ({ isNativeApp: true }));
vi.mock('../src/store', () => ({
  useApp: {
    getState: () => ({ state: {} }),
    subscribe: (callback: typeof mocks.change) => {
      mocks.change = callback;
      return mocks.unsubscribe;
    },
  },
}));
vi.mock('../src/ui-store', () => ({ useUI: { getState: () => ({ setTab: mocks.setTab }) } }));

import {
  initNotifications,
  rescheduleNotifications,
  setNotificationsEnabled,
  useNotifications,
} from '../src/notifications';

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  useNotifications.setState({ enabled: false, error: '', scheduled: 0 });
  mocks.checkPermissions.mockResolvedValue({ display: 'granted' });
  mocks.requestPermissions.mockResolvedValue({ display: 'granted' });
  mocks.getPending.mockResolvedValue({ notifications: [] });
  mocks.cancel.mockResolvedValue(undefined);
  mocks.schedule.mockResolvedValue({ notifications: [{ id: 42 }] });
  mocks.remove.mockResolvedValue(undefined);
  mocks.addListener.mockImplementation((_event, callback: typeof mocks.action) => {
    mocks.action = callback;
    return Promise.resolve({ remove: mocks.remove });
  });
  mocks.plan.mockReturnValue([{ id: 42, title: 'Game', body: 'A reminder', at: Date.now() + 60_000, gameId: 'game' }]);
});
afterEach(async () => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  await Promise.resolve();
  vi.useRealTimers();
});

describe('native notification lifecycle', () => {
  it('does not request permission or schedule work on disabled startup or state changes', async () => {
    cleanups.push(initNotifications());
    mocks.change?.({ state: {} }, { state: {} });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
    expect(mocks.checkPermissions).not.toHaveBeenCalled();
    expect(mocks.getPending).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('asks for permission only after opt-in and sends the shared plan to Android', async () => {
    await setNotificationsEnabled(true);
    expect(mocks.requestPermissions).toHaveBeenCalledOnce();
    expect(localStorage.getItem('memoria-device-notifications')).toBe('enabled');
    expect(mocks.schedule).toHaveBeenCalledWith({
      notifications: [
        expect.objectContaining({
          id: 42,
          isExactNotification: false,
          schedule: { at: expect.any(Date) },
          extra: { memoria: true, gameId: 'game' },
        }),
      ],
    });
    expect(useNotifications.getState()).toMatchObject({ enabled: true, scheduled: 1, error: '' });
  });

  it('keeps reminders disabled when opt-in permission is denied', async () => {
    mocks.requestPermissions.mockResolvedValueOnce({ display: 'denied' });
    await expect(setNotificationsEnabled(true)).rejects.toThrow('Android did not allow');
    expect(useNotifications.getState().enabled).toBe(false);
    expect(localStorage.getItem('memoria-device-notifications')).not.toBe('enabled');
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('does not let the plugin auto-request permission during an enabled startup', async () => {
    useNotifications.setState({ enabled: true });
    mocks.checkPermissions.mockResolvedValueOnce({ display: 'denied' });
    cleanups.push(initNotifications());
    await vi.advanceTimersByTimeAsync(1200);
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(useNotifications.getState().error).toContain('blocked in Android settings');
  });

  it('cancels only owned notifications on opt-out without asking for permission', async () => {
    useNotifications.setState({ enabled: true, scheduled: 2 });
    mocks.getPending.mockResolvedValueOnce({
      notifications: [{ id: 1, extra: { memoria: true } }, { id: 2, extra: { memoria: 'another-feature' } }, { id: 3 }],
    });
    await setNotificationsEnabled(false);
    expect(mocks.cancel).toHaveBeenCalledWith({ notifications: [{ id: 1 }] });
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
    expect(mocks.checkPermissions).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(useNotifications.getState()).toMatchObject({ enabled: false, scheduled: 0 });
  });

  it('reports scheduling failure without claiming cancelled reminders still exist, and can retry', async () => {
    useNotifications.setState({ enabled: true, scheduled: 3 });
    mocks.getPending.mockResolvedValue({ notifications: [{ id: 1, extra: { memoria: true } }] });
    mocks.schedule.mockRejectedValueOnce(new Error('Android could not schedule reminders'));
    await expect(rescheduleNotifications()).rejects.toThrow('could not schedule');
    expect(useNotifications.getState()).toMatchObject({ scheduled: 0, error: 'Android could not schedule reminders' });
    await rescheduleNotifications();
    expect(useNotifications.getState()).toMatchObject({ scheduled: 1, error: '' });
  });

  it('keeps opt-out retryable when Android fails to cancel pending reminders', async () => {
    localStorage.setItem('memoria-device-notifications', 'enabled');
    useNotifications.setState({ enabled: true, scheduled: 1 });
    mocks.getPending.mockResolvedValue({ notifications: [{ id: 1, extra: { memoria: true } }] });
    mocks.cancel.mockRejectedValueOnce(new Error('Android could not cancel reminders'));
    await expect(setNotificationsEnabled(false)).rejects.toThrow('could not cancel');
    expect(localStorage.getItem('memoria-device-notifications')).toBe('enabled');
    expect(useNotifications.getState()).toMatchObject({ enabled: true, scheduled: 1 });
    await setNotificationsEnabled(false);
    expect(localStorage.getItem('memoria-device-notifications')).toBe('disabled');
    expect(useNotifications.getState()).toMatchObject({ enabled: false, scheduled: 0, error: '' });
  });

  it('preserves existing notifications if planning fails before replacement', async () => {
    useNotifications.setState({ enabled: true, scheduled: 3 });
    mocks.getPending.mockResolvedValueOnce({ notifications: [{ id: 1, extra: { memoria: true } }] });
    mocks.plan.mockImplementationOnce(() => {
      throw new Error('The plan could not be built');
    });
    await expect(rescheduleNotifications()).rejects.toThrow('plan could not be built');
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(useNotifications.getState().scheduled).toBe(3);
  });

  it('handles listener failure without an unhandled rejection', async () => {
    useNotifications.setState({ enabled: true });
    mocks.addListener.mockRejectedValueOnce(new Error('Notification actions unavailable'));
    cleanups.push(initNotifications());
    await Promise.resolve();
    expect(useNotifications.getState().error).toBe('Notification actions unavailable');
  });

  it('stays quiet when the listener is unavailable and reminders are disabled', async () => {
    mocks.addListener.mockRejectedValueOnce(new Error('Native listener unavailable'));
    cleanups.push(initNotifications());
    await vi.advanceTimersByTimeAsync(2000);
    expect(useNotifications.getState().error).toBe('');
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
  });

  it('routes only owned actions and removes listeners and timers on cleanup', async () => {
    useNotifications.setState({ enabled: true });
    const cleanup = initNotifications();
    mocks.action?.({ notification: { extra: { memoria: 'other' } } });
    expect(mocks.setTab).not.toHaveBeenCalled();
    mocks.action?.({ notification: { extra: { memoria: true } } });
    expect(mocks.setTab).toHaveBeenCalledOnce();
    cleanup();
    mocks.action?.({ notification: { extra: { memoria: true } } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.setTab).toHaveBeenCalledOnce();
    expect(mocks.getPending).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
