import { create } from 'zustand';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  buildNotificationPlan,
  notificationId,
  NOTIFICATION_HORIZON_DAYS,
  type PlannedNotification,
} from '@memoria/shared';
import { allCodes, liveCodes } from './codes';
import { useRemoteFeed } from './data/remote-feed';
import { isNativeApp } from './native';
import { useApp } from './store';
import { useUI } from './ui-store';

const KEY = 'memoria-device-notifications';
/** What this device last handed to Android, and what has already been shown. Never synced. */
const DELIVERY_KEY = 'memoria-notification-delivery';
const DAILY_ACTIONS = 'memoria-daily';
const EVENT_ACTIONS = 'memoria-event';
/** Fires only if the app is not opened for most of a week, before the plan runs out. */
const RUNWAY_ID = 1_999_999_999;
const RUNWAY_LEAD_MS = 12 * 3_600_000;
function enabledOnDevice() {
  try {
    return localStorage.getItem(KEY) === 'enabled';
  } catch {
    return false;
  }
}
export const useNotifications = create<{
  enabled: boolean;
  error: string;
  scheduled: number;
  /** Android lets Memoria use exact alarms; null until checked. */
  exact: boolean | null;
  plannedAt: number | null;
}>(() => ({
  enabled: enabledOnDevice(),
  error: '',
  scheduled: 0,
  exact: null,
  plannedAt: null,
}));

interface Delivery {
  /** id -> time of the notifications last scheduled. */
  scheduled: Record<string, number>;
  /** id -> time shown. A rebuilt plan must not show the same reminder twice. */
  shown: Record<string, number>;
}
function readDelivery(): Delivery {
  try {
    const raw = JSON.parse(localStorage.getItem(DELIVERY_KEY) ?? '{}') as Partial<Delivery>;
    return { scheduled: raw.scheduled ?? {}, shown: raw.shown ?? {} };
  } catch {
    return { scheduled: {}, shown: {} };
  }
}
function writeDelivery(delivery: Delivery) {
  try {
    localStorage.setItem(DELIVERY_KEY, JSON.stringify(delivery));
  } catch {
    // Without storage a reminder may repeat after a rebuild; it is never lost.
  }
}
const CODES_SEEN_KEY = 'memoria-codes-announced';
const CODE_LEAD_MS = 6 * 3_600_000;

/**
 * A new code is announced once, soon; an unredeemed one again six hours before
 * it expires. Codes live in the signed feed, so these are planned on the device.
 */
export function codeNotices(now: number): PlannedNotification[] {
  let seen: string[] = [];
  try {
    seen = JSON.parse(localStorage.getItem(CODES_SEEN_KEY) ?? '[]') as string[];
    if (!Array.isArray(seen)) seen = [];
  } catch {
    seen = [];
  }
  let redeemed: string[] = [];
  try {
    redeemed = JSON.parse(localStorage.getItem('memoria-redeemed-codes') ?? '[]') as string[];
  } catch {
    redeemed = [];
  }
  const codes = liveCodes(useApp.getState().state.games, allCodes(useRemoteFeed.getState().codes), redeemed, now);
  const plan: PlannedNotification[] = [];
  const firstRun = localStorage.getItem(CODES_SEEN_KEY) === null;
  for (const code of codes) {
    const key = `${code.key}:${code.code.toUpperCase()}`;
    // The first run only learns what exists; announcing every old code would be noise.
    if (!seen.includes(key)) {
      seen.push(key);
      if (!firstRun)
        plan.push({
          id: notificationId(`code-new:${key}`),
          kind: 'reminder',
          title: `New ${code.game.short} code: ${code.code}`,
          body: code.rewards,
          at: now + 5_000,
          gameId: code.game.id,
        });
    }
    if (code.expiresAt && code.expiresAt - CODE_LEAD_MS > now)
      plan.push({
        id: notificationId(`code-expiry:${key}`),
        kind: 'reminder',
        title: `${code.game.short} code ${code.code} expires in 6 h`,
        body: code.rewards,
        at: code.expiresAt - CODE_LEAD_MS,
        gameId: code.game.id,
      });
  }
  try {
    localStorage.setItem(CODES_SEEN_KEY, JSON.stringify(seen.slice(-500)));
  } catch {
    // Without storage a new code may be announced again; never missed.
  }
  return plan;
}

/**
 * Android cannot rebuild the plan without the app, and the plan covers a week.
 * Half a day before it runs out, say so, rather than going silent.
 */
export function withRunway(plan: PlannedNotification[], now: number): PlannedNotification[] {
  const at = now + NOTIFICATION_HORIZON_DAYS * 24 * 3_600_000 - RUNWAY_LEAD_MS;
  return [
    ...plan.filter((item) => item.id !== RUNWAY_ID),
    {
      id: RUNWAY_ID,
      kind: 'reminder',
      title: 'Open Memoria to keep reminders coming',
      body: 'Reminders are planned a week ahead. Opening the app plans the next week.',
      at,
      gameId: null,
    },
  ];
}

/**
 * Anything scheduled earlier whose time has passed was shown by Android. Keep
 * those ids for the plan's horizon, so a rebuilt weekly reminder whose lead
 * shrank after a tick is not shown a second time.
 */
export function unseenPlan(plan: PlannedNotification[], delivery: Delivery, now: number): PlannedNotification[] {
  for (const [id, at] of Object.entries(delivery.scheduled)) if (at <= now) delivery.shown[id] = at;
  const keepFrom = now - (NOTIFICATION_HORIZON_DAYS + 1) * 24 * 3_600_000;
  for (const [id, at] of Object.entries(delivery.shown)) if (at < keepFrom) delete delivery.shown[id];
  const unseen = plan.filter((item) => !(String(item.id) in delivery.shown));
  delivery.scheduled = Object.fromEntries(unseen.map((item) => [String(item.id), item.at]));
  return unseen;
}

let actionsRegistered = false;
async function registerActions() {
  if (actionsRegistered) return;
  await LocalNotifications.registerActionTypes({
    types: [
      { id: DAILY_ACTIONS, actions: [{ id: 'dailies-done', title: 'Dailies done' }] },
      { id: EVENT_ACTIONS, actions: [{ id: 'events-done', title: 'Done' }] },
    ],
  });
  actionsRegistered = true;
}

let queue = Promise.resolve();
export function rescheduleNotifications(): Promise<void> {
  const run = async () => {
    if (!isNativeApp) return;
    const enabled = useNotifications.getState().enabled;
    if (enabled && (await LocalNotifications.checkPermissions()).display !== 'granted')
      throw new Error('Notifications are blocked in Android settings.');
    const pending = await LocalNotifications.getPending();
    const owned = pending.notifications.filter((item) => item.extra?.memoria === true);
    const now = Date.now();
    const delivery = readDelivery();
    const plan = useNotifications.getState().enabled
      ? withRunway(
          unseenPlan([...buildNotificationPlan(useApp.getState().state, now), ...codeNotices(now)], delivery, now),
          now,
        )
      : [];
    if (owned.length) await LocalNotifications.cancel({ notifications: owned.map(({ id }) => ({ id })) });
    // A later scheduling failure must not leave the old count visible after cancellation.
    useNotifications.setState({ scheduled: 0 });
    if (!useNotifications.getState().enabled) {
      useNotifications.setState({ scheduled: 0, error: '' });
      return;
    }
    // Exact alarms keep the 1-hour warning at the hour. Asking for them on
    // every schedule() would open Android's settings screen each time, so the
    // permission is checked here and requested only from Settings.
    const exact = (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted';
    if (plan.length) {
      await registerActions();
      await LocalNotifications.schedule({
        notifications: plan.map((item) => ({
          id: item.id,
          title: item.title,
          body: item.body,
          isExactNotification: exact,
          schedule: { at: new Date(item.at), allowWhileIdle: true },
          ...(item.kind === 'daily' && item.gameId ? { actionTypeId: DAILY_ACTIONS } : {}),
          ...(item.kind === 'event' && item.eventIds?.length ? { actionTypeId: EVENT_ACTIONS } : {}),
          extra: { memoria: true, gameId: item.gameId, kind: item.kind, eventIds: item.eventIds ?? [] },
        })),
      });
    }
    writeDelivery(delivery);
    const reminders = plan.filter((item) => item.id !== RUNWAY_ID).length;
    useNotifications.setState({ scheduled: reminders, error: '', exact, plannedAt: now });
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
    throw new Error('Notifications are off for Memoria in Android settings.');
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
/** An action can start the app cold; tick only once the saved data is in. */
function whenLoaded(run: () => void) {
  if (useApp.getState().loaded) return run();
  const stop = useApp.subscribe((next) => {
    if (!next.loaded) return;
    stop();
    run();
  });
}

/** Opens Android's "Alarms & reminders" page so reminders arrive on the minute. */
export async function requestExactReminders(): Promise<void> {
  if (!isNativeApp) return;
  const result = await LocalNotifications.changeExactNotificationSetting();
  useNotifications.setState({ exact: result.exact_alarm === 'granted' });
  await rescheduleNotifications().catch(() => undefined);
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
  const stopCodes = useRemoteFeed.subscribe((next, prior) => {
    if (next.codes !== prior.codes) update();
  });
  const listener = LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    const extra = event.notification.extra as
      { memoria?: boolean; gameId?: string | null; eventIds?: string[] } | undefined;
    if (!active || extra?.memoria !== true) return;
    useUI.getState().setTab('today');
    if (event.actionId === 'dailies-done' && extra.gameId)
      whenLoaded(() => useApp.getState().completeDailies(extra.gameId!));
    if (event.actionId === 'events-done' && extra.gameId && extra.eventIds?.length)
      whenLoaded(() => {
        const { state, upsertEvent } = useApp.getState();
        for (const id of extra.eventIds!) {
          const found = state.events.find((item) => item.id === id && !item.deleted);
          if (found && !found.done) upsertEvent({ id, gameId: found.gameId, done: true });
        }
      });
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
    stopCodes();
    document.removeEventListener('visibilitychange', update);
    void listener.then((handle) => handle?.remove()).catch(() => undefined);
  };
}
