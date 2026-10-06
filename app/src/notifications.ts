import { create } from 'zustand';
import { LocalNotifications } from '@capacitor/local-notifications';
import { buildNotificationPlan } from '@memoria/shared';
import { isNativeApp } from './native';
import { useApp } from './store';
import { useUI } from './ui-store';

const KEY = 'memoria-device-notifications';
function enabledOnDevice() {
  try {
    return localStorage.getItem(KEY) === 'enabled';
  } catch {
    return false;
  }
}
export const useNotifications = create<{ enabled: boolean; error: string; scheduled: number }>(() => ({
  enabled: enabledOnDevice(),
  error: '',
  scheduled: 0,
}));
let queue = Promise.resolve();
export function rescheduleNotifications(): Promise<void> {
  const run = async () => {
    if (!isNativeApp) return;
    const enabled = useNotifications.getState().enabled;
    if (enabled && (await LocalNotifications.checkPermissions()).display !== 'granted')
      throw new Error('Notifications are blocked in Android settings. Enable them there or turn reminders off.');
    const pending = await LocalNotifications.getPending();
    const owned = pending.notifications.filter((item) => item.extra?.memoria === true);
    const plan = useNotifications.getState().enabled ? buildNotificationPlan(useApp.getState().state, Date.now()) : [];
    if (owned.length) await LocalNotifications.cancel({ notifications: owned.map(({ id }) => ({ id })) });
    // A later scheduling failure must not leave the old count visible after cancellation.
    useNotifications.setState({ scheduled: 0 });
    if (!useNotifications.getState().enabled) {
      useNotifications.setState({ scheduled: 0, error: '' });
      return;
    }
    if (plan.length)
      await LocalNotifications.schedule({
        notifications: plan.map((item) => ({
          id: item.id,
          title: item.title,
          body: item.body,
          isExactNotification: false,
          schedule: { at: new Date(item.at) },
          extra: { memoria: true, gameId: item.gameId },
        })),
      });
    useNotifications.setState({ scheduled: plan.length, error: '' });
  };
  queue = queue.catch(() => undefined).then(run);
  return queue.catch((cause: unknown) => {
    useNotifications.setState({
      error: cause instanceof Error ? cause.message : 'Notifications could not be updated.',
    });
    throw cause;
  });
}
export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  if (!isNativeApp) throw new Error('Device reminders are available in the Android app.');
  if (enabled && (await LocalNotifications.requestPermissions()).display !== 'granted')
    throw new Error('Android did not allow notifications. You can change this in system settings.');
  const previous = useNotifications.getState().enabled;
  if (enabled) localStorage.setItem(KEY, 'enabled');
  useNotifications.setState({ enabled });
  try {
    await rescheduleNotifications();
    // Persist opt-out only after Android confirms cancellation. A failed cancellation
    // must remain retryable after restarting the app.
    if (!enabled) localStorage.setItem(KEY, 'disabled');
  } catch (cause) {
    if (!enabled) useNotifications.setState({ enabled: previous });
    useNotifications.setState({ error: cause instanceof Error ? cause.message : 'Reminders could not be changed.' });
    throw cause;
  }
}
export function initNotifications(): () => void {
  if (!isNativeApp) return () => undefined;
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    clearTimeout(timer);
    if (!useNotifications.getState().enabled) return;
    timer = setTimeout(() => void rescheduleNotifications().catch(() => undefined), 1200);
  };
  const unsubscribe = useApp.subscribe((next, prior) => {
    if (next.state !== prior.state) update();
  });
  const listener = LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    if (active && event.notification.extra?.memoria === true) useUI.getState().setTab('today');
  }).catch((cause: unknown) => {
    if (active && useNotifications.getState().enabled)
      useNotifications.setState({
        error: cause instanceof Error ? cause.message : 'Notification actions could not be enabled.',
      });
    return undefined;
  });
  document.addEventListener('visibilitychange', update);
  update();
  return () => {
    active = false;
    clearTimeout(timer);
    unsubscribe();
    document.removeEventListener('visibilitychange', update);
    void listener.then((handle) => handle?.remove()).catch(() => undefined);
  };
}
