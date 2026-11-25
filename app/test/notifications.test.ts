import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getPending: vi.fn(),
  cancel: vi.fn(),
  schedule: vi.fn(),
  checkExactNotificationSetting: vi.fn(),
  registerActionTypes: vi.fn(),
  completeDailies: vi.fn(),
  upsertEvent: vi.fn(),
  setEventProgress: vi.fn(),
  addListener: vi.fn(),
  remove: vi.fn(),
  unsubscribe: vi.fn(),
  plan: vi.fn(),
  setTab: vi.fn(),
  change: undefined as ((next: { state: object }, prior: { state: object }) => void) | undefined,
  action: undefined as
    | ((event: {
        actionId?: string;
        notification: { extra?: { memoria: unknown; gameId?: string; eventIds?: string[] } };
      }) => void)
    | undefined,
}));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: mocks }));
vi.mock('@memoria/shared', () => ({
  buildNotificationPlan: mocks.plan,
  NOTIFICATION_HORIZON_DAYS: 7,
  notificationId: (key: string) => key.length,
}));
// Codes are planned on the device; covered in codes.test.ts.
vi.mock('../src/codes', () => ({ allCodes: () => [], liveCodes: () => [] }));
vi.mock('../src/data/remote-feed', () => ({
  useRemoteFeed: { getState: () => ({ codes: [] }), subscribe: () => () => undefined },
}));
vi.mock('../src/native', () => ({ isNativeApp: true }));
vi.mock('../src/store', () => ({
  useApp: {
    getState: () => ({
      state: {
        events: [
          { id: 'open', gameId: 'game', done: false },
          { id: 'ticked', gameId: 'game', done: true },
        ],
      },
      loaded: true,
      completeDailies: mocks.completeDailies,
      upsertEvent: mocks.upsertEvent,
      setEventProgress: mocks.setEventProgress,
    }),
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
  useNotifications.setState({ enabled: false, error: '', scheduled: 0, exact: null });
  localStorage.removeItem('memoria-notification-delivery');
  mocks.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'denied' });
  mocks.registerActionTypes.mockResolvedValue(undefined);
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
  mocks.plan.mockReturnValue([
    { id: 42, title: 'Game', body: 'A reminder', at: Date.now() + 60_000, gameId: 'game', kind: 'daily' },
  ]);
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
          schedule: { at: expect.any(Date), allowWhileIdle: true },
          actionTypeId: 'memoria-daily',
          channelId: 'memoria-standard',
          extra: { memoria: true, gameId: 'game', kind: 'daily', eventIds: [], style: 'standard', tone: 'classic' },
        }),
        // Half a day before the week runs out, unless the app is opened first.
        expect.objectContaining({ id: 1_999_999_999, title: 'Open Memoria to keep reminders coming' }),
      ],
    });
    expect(useNotifications.getState()).toMatchObject({ enabled: true, scheduled: 1, error: '', exact: false });
  });

  it('uses exact alarms only once Android allows them, without opening settings itself', async () => {
    mocks.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'granted' });
    useNotifications.setState({ enabled: true });
    await rescheduleNotifications();
    expect(mocks.schedule.mock.calls[0]?.[0].notifications[0].isExactNotification).toBe(true);
    expect(useNotifications.getState().exact).toBe(true);
  });

  it('does not show a reminder again after its time has passed, even if a rebuilt plan moves it later', async () => {
    useNotifications.setState({ enabled: true });
    await rescheduleNotifications();
    vi.advanceTimersByTime(120_000);
    mocks.plan.mockReturnValue([
      { id: 42, title: 'Game', body: 'Moved', at: Date.now() + 3_600_000, gameId: 'game', kind: 'weekly' },
      {
        id: 43,
        title: 'Game',
        body: 'New',
        at: Date.now() + 3_600_000,
        gameId: 'game',
        kind: 'event',
        eventIds: ['open'],
      },
    ]);
    await rescheduleNotifications();
    const sent = mocks.schedule.mock.calls[1]?.[0].notifications as { id: number; actionTypeId?: string }[];
    expect(sent.map((item) => item.id)).toEqual([43, 1_999_999_999]);
    expect(sent[0]?.actionTypeId).toBe('memoria-event');
    expect(useNotifications.getState().scheduled).toBe(1);
  });

  it('keeps reminders disabled when opt-in permission is denied', async () => {
    mocks.requestPermissions.mockResolvedValueOnce({ display: 'denied' });
    await expect(setNotificationsEnabled(true)).rejects.toThrow('Notifications are off');
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
    expect(mocks.completeDailies).not.toHaveBeenCalled();
    mocks.action?.({ actionId: 'dailies-done', notification: { extra: { memoria: true, gameId: 'game' } } });
    expect(mocks.completeDailies).toHaveBeenCalledWith('game');
    mocks.action?.({
      actionId: 'events-done',
      notification: { extra: { memoria: true, gameId: 'game', eventIds: ['open', 'ticked', 'gone'] } },
    });
    expect(mocks.setEventProgress).toHaveBeenCalledOnce();
    expect(mocks.setEventProgress).toHaveBeenCalledWith('open', 'done');
    cleanup();
    mocks.action?.({ notification: { extra: { memoria: true } } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.setTab).toHaveBeenCalledTimes(3);
    expect(mocks.getPending).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('reminder styles on Android', () => {
  it('sends an alarm to its ring channel with Snooze, and a standard one to the standard channel', async () => {
    mocks.plan.mockReturnValue([
      {
        id: 42,
        title: 'Game',
        body: 'Wake',
        at: Date.now() + 60_000,
        gameId: 'game',
        kind: 'daily',
        style: 'alarm',
        tone: 'chime',
      },
      {
        id: 43,
        title: 'Reminder',
        body: 'Plain',
        at: Date.now() + 60_000,
        gameId: null,
        kind: 'reminder',
        style: 'alarm',
        tone: 'ring',
      },
      {
        id: 44,
        title: 'Energy',
        body: 'Soft',
        at: Date.now() + 60_000,
        gameId: 'game',
        kind: 'energy',
        style: 'gentle',
      },
    ]);
    useNotifications.setState({ enabled: true });
    await rescheduleNotifications();
    const [alarm, plain, soft] = mocks.schedule.mock.calls[0]?.[0].notifications as Record<string, unknown>[];
    expect(alarm).toMatchObject({
      channelId: 'memoria-alarm-chime',
      actionTypeId: 'memoria-daily-alarm',
      sound: 'memoria_alarm_chime.wav',
    });
    expect(plain).toMatchObject({ channelId: 'memoria-alarm-ring', actionTypeId: 'memoria-alarm' });
    expect(soft).toMatchObject({ channelId: 'memoria-gentle' });
    expect(soft).not.toHaveProperty('actionTypeId');
  });

  it('snoozes ten minutes in the same style, and a rebuilt plan leaves the snoozed one alone', async () => {
    useNotifications.setState({ enabled: true });
    const cleanup = initNotifications();
    mocks.action?.({
      actionId: 'snooze',
      notification: {
        id: 42,
        title: 'Game',
        body: 'Wake',
        extra: { memoria: true, gameId: 'game', kind: 'daily', style: 'alarm', tone: 'pulse' },
      } as never,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.setTab).not.toHaveBeenCalled();
    const snoozed = mocks.schedule.mock.calls[0]?.[0].notifications[0];
    expect(snoozed).toMatchObject({ title: 'Game', channelId: 'memoria-alarm-pulse', extra: { snoozed: true } });
    expect(snoozed.schedule.at.getTime() - Date.now()).toBe(10 * 60_000);

    mocks.getPending.mockResolvedValue({
      notifications: [
        { id: 7, extra: { memoria: true } },
        { id: 8, extra: { memoria: true, snoozed: true } },
      ],
    });
    await rescheduleNotifications();
    expect(mocks.cancel).toHaveBeenCalledWith({ notifications: [{ id: 7 }] });
    cleanup();
  });
});
