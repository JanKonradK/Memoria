import { DateTime } from 'luxon';
import type { AlarmFreeWindow, Settings } from './types';

type QuietSettings = Pick<Settings, 'quietStart' | 'quietEnd' | 'localTz'>;

export interface QuietWindow {
  start: number;
  end: number;
}

/** True when the player has set quiet hours. Off by default. */
export function hasQuietHours(settings: QuietSettings): boolean {
  return settings.quietStart != null && settings.quietEnd != null && settings.quietStart !== settings.quietEnd;
}

function local(settings: QuietSettings, at: number): DateTime | null {
  const time = DateTime.fromMillis(at).setZone(settings.localTz || 'UTC');
  return time.isValid ? time : null;
}

function windowFrom(settings: QuietSettings, opening: DateTime): QuietWindow {
  const start = settings.quietStart!;
  const end = settings.quietEnd!;
  const length = (end - start + 1440) % 1440;
  return { start: opening.toMillis(), end: opening.plus({ minutes: length }).toMillis() };
}

/** The quiet window that contains `at`, or null when `at` is outside quiet hours. */
export function quietWindowAt(settings: QuietSettings, at: number): QuietWindow | null {
  if (!hasQuietHours(settings)) return null;
  const time = local(settings, at);
  if (!time) return null;
  const start = settings.quietStart!;
  const end = settings.quietEnd!;
  const minute = time.hour * 60 + time.minute;
  const inside = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!inside) return null;
  let opening = time.startOf('day').set({ hour: Math.floor(start / 60), minute: start % 60 });
  if (opening.toMillis() > at) opening = opening.minus({ days: 1 });
  return windowFrom(settings, opening);
}

/** The next quiet window that has not started yet at `now`, or null without quiet hours. */
export function nextQuietWindow(settings: QuietSettings, now: number): QuietWindow | null {
  if (!hasQuietHours(settings)) return null;
  const time = local(settings, now);
  if (!time) return null;
  const start = settings.quietStart!;
  let opening = time.startOf('day').set({ hour: Math.floor(start / 60), minute: start % 60 });
  if (opening.toMillis() <= now) opening = opening.plus({ days: 1 });
  return windowFrom(settings, opening);
}

/**
 * When something due at `at` must really be done by. A deadline inside quiet
 * hours has to be met before they begin, unless they already have: a player
 * awake inside quiet hours still has until the deadline itself.
 */
export function actBy(settings: QuietSettings, at: number, now: number): number {
  const window = quietWindowAt(settings, at);
  return window && window.start > now ? window.start : at;
}

/**
 * The no-alarm window (work, sleep) that `at` falls in, or null. A window
 * belongs to the day it starts on, so a 23:00–07:00 window set for Friday
 * still covers early Saturday morning.
 */
export function alarmFreeWindowAt(
  settings: Pick<Settings, 'alarmFreeWindows' | 'localTz'>,
  at: number,
): AlarmFreeWindow | null {
  const windows = settings.alarmFreeWindows;
  if (!windows?.length) return null;
  const time = DateTime.fromMillis(at).setZone(settings.localTz || 'UTC');
  if (!time.isValid) return null;
  const minute = time.hour * 60 + time.minute;
  const today = time.weekday;
  const yesterday = today === 1 ? 7 : today - 1;
  return (
    windows.find((window) =>
      window.start < window.end
        ? window.days.includes(today) && minute >= window.start && minute < window.end
        : (window.days.includes(today) && minute >= window.start) ||
          (window.days.includes(yesterday) && minute < window.end),
    ) ?? null
  );
}
