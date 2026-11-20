import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { useUI } from './ui-store';

/**
 * What a buzz means, never how long it is:
 * - `tick`: a value crossed a step, or a swipe reached the point where letting go acts.
 * - `light`: a tap that changed something.
 * - `success`: something was completed.
 * - `undo`: something was taken back.
 * - `edge`: the end of a range, or a swipe with nothing to do.
 */
export type Buzz = 'tick' | 'light' | 'success' | 'undo' | 'edge';

/** The browser fallback, in milliseconds: short enough to feel like a click, not a ring. */
export const BUZZ_PATTERN: Record<Buzz, number | number[]> = {
  tick: 6,
  light: 10,
  success: [12, 40, 18],
  undo: 14,
  edge: [8, 30, 8],
};

/** Only a touch screen has a motor worth using, and only while the player wants it. */
export function canBuzz(): boolean {
  try {
    if (!useUI.getState().vibration) return false;
    return Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  } catch {
    return false;
  }
}

const native = (() => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
})();

function nativeBuzz(kind: Buzz): Promise<void> {
  switch (kind) {
    case 'tick':
      return Haptics.selectionChanged();
    case 'light':
      return Haptics.impact({ style: ImpactStyle.Light });
    case 'success':
      return Haptics.notification({ type: NotificationType.Success });
    case 'undo':
      return Haptics.impact({ style: ImpactStyle.Medium });
    case 'edge':
      return Haptics.notification({ type: NotificationType.Warning });
  }
}

/** One physical cue. Never throws, never waits: a missed buzz is not an error. */
export function buzz(kind: Buzz = 'light'): void {
  if (!canBuzz()) return;
  try {
    if (native) {
      void nativeBuzz(kind).catch(() => navigator.vibrate?.(BUZZ_PATTERN[kind]));
      return;
    }
    navigator.vibrate?.(BUZZ_PATTERN[kind]);
  } catch {
    // Some WebViews throw when vibration is blocked; the action itself still happened.
  }
}
