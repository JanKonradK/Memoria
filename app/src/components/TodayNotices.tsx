import { useState, type ReactNode } from 'react';
import { missingPresetTasks } from '@memoria/shared';
import '../surfaces.css';
import { useApp } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { isNativeApp } from '../native';
import {
  openAndroidBatterySettings,
  openAndroidNotificationSettings,
  requestExactReminders,
  setNotificationsEnabled,
  useNotifications,
} from '../notifications';
import { setPresence, usePresence } from '../presence';

const PRESET_GAP_KEY = 'memoria-preset-gap-dismissed';
/** The key this counter shipped under before the rename. */
const LEGACY_PRESET_GAP_KEY = 'void-preset-gap-dismissed';
/** Which reminder prompt was last waved away on this device. Each problem asks once. */
const REMINDER_PROMPT_KEY = 'memoria-reminder-prompt-dismissed';

function readReminderDismissed(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(REMINDER_PROMPT_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

interface ReminderProblem {
  id: string;
  title: string;
  detail: string;
  action: string;
  run: () => Promise<void>;
}

/**
 * The first thing that stops reminders reaching this device, if any: reminders
 * switched off here, the permission refused, Windows muting Memoria, exact
 * timing withheld, or battery saving holding them back.
 */
function useReminderProblem(): ReminderProblem | null {
  const { enabled, permission, exact, batteryUnrestricted, windows } = useNotifications();
  const presence = usePresence((s) => s.presence);
  if (presence) {
    if (!presence.remindersOnPc)
      return {
        id: 'pc-off',
        title: 'Reminders are off on this PC',
        detail: 'Turn them on to hear about dailies, weeklies and events before they reset.',
        action: 'Turn on',
        run: () => setPresence({ remindersOnPc: true }),
      };
    if (windows && windows !== 'enabled' && windows !== 'unknown')
      return {
        id: `pc-windows-${windows}`,
        title: 'Windows is hiding Memoria’s reminders',
        detail:
          windows === 'user'
            ? 'Notifications are off for every app. Switch them on in Windows settings.'
            : windows === 'policy'
              ? 'An administrator has turned notifications off on this PC.'
              : 'Notifications are off for Memoria. Switch Memoria on in Windows settings.',
        action: 'Open Windows settings',
        run: () => window.memoriaDesktop?.presence?.openNotificationSettings?.() ?? Promise.resolve(),
      };
    return null;
  }
  if (!isNativeApp) return null;
  if (!enabled)
    return {
      id: 'phone-off',
      title: 'Turn on reminders on this phone',
      detail: 'An hour before each daily reset with dailies left, and before events and weeklies run out.',
      action: 'Allow reminders',
      run: () => setNotificationsEnabled(true),
    };
  if (permission === 'denied')
    return {
      id: 'phone-denied',
      title: 'Android is blocking Memoria’s reminders',
      detail: 'Allow notifications for Memoria in Android settings.',
      action: 'Open settings',
      run: openAndroidNotificationSettings,
    };
  if (exact === false)
    return {
      id: 'phone-exact',
      title: 'Let reminders arrive on time',
      detail: 'Without “Alarms & reminders”, Android can hold a reminder back by many minutes.',
      action: 'Allow exact timing',
      run: requestExactReminders,
    };
  if (batteryUnrestricted === false)
    return {
      id: 'phone-battery',
      title: 'Battery saving can delay reminders',
      detail: 'Some phones hold back reminders from apps under battery optimisation. Set Memoria to Unrestricted.',
      action: 'Open battery settings',
      run: openAndroidBatterySettings,
    };
  return null;
}

function readDismissedGap(): number {
  return Number(localStorage.getItem(PRESET_GAP_KEY) ?? localStorage.getItem(LEGACY_PRESET_GAP_KEY) ?? '0');
}

/**
 * A dismissible line across the top of Today: something the app noticed, the
 * one thing to do about it, and a way to say "not now".
 *
 * Both notices are the same object — a sentence, a verb and an ✕ — so they are
 * one component rather than two copies that can drift a padding apart.
 */
function Notice({
  label,
  title,
  detail,
  action,
  onAction,
  dismissLabel,
  onDismiss,
}: {
  /** Names the region for assistive tech; the visible title is the heading line. */
  label: string;
  title: ReactNode;
  detail: ReactNode;
  action: string;
  onAction: () => void;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <section className="surface-notice mb-3" aria-label={label}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-fg">{title}</p>
          <p className="aside mt-0.5 text-meta text-muted">{detail}</p>
        </div>
        <button
          type="button"
          onClick={onAction}
          className="min-h-11 shrink-0 rounded-ui-md border border-line-strong bg-inset px-3 py-1 text-meta font-medium text-fg transition-colors hover:border-line-strong hover:bg-surface-2"
        >
          {action}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ui-md text-muted transition-colors hover:text-fg"
          aria-label={dismissLabel}
        >
          ✕
        </button>
      </div>
    </section>
  );
}

export function TodayNotices() {
  const state = useApp(useShallow((s) => ({ games: s.state.games, tasks: s.state.tasks })));
  const addMissingPresetTasksEverywhere = useApp((s) => s.addMissingPresetTasksEverywhere);

  // Presets only apply when a game is ADDED, so a preset that grows later is
  // invisible to everyone already tracking that game — which is exactly the case
  // where the new routines matter. The banner is dismissed against the COUNT, so
  // it comes back when a later update adds more.
  const presetShortfalls = state.games
    .filter((game) => !game.deleted)
    .map(
      (game) =>
        missingPresetTasks(
          game,
          state.tasks.filter((task) => task.gameId === game.id),
        ).length,
    );
  const presetGap = presetShortfalls.reduce((sum, count) => sum + count, 0);
  const presetGamesBehind = presetShortfalls.filter((count) => count > 0).length;
  const [dismissedGap, setDismissedGap] = useState(readDismissedGap);
  const presetGapDismissed = dismissedGap >= presetGap;
  const showPresetGap = presetGap > 0 && !presetGapDismissed;
  const reminderProblem = useReminderProblem();
  const [reminderDismissed, setReminderDismissed] = useState(readReminderDismissed);
  const [reminderError, setReminderError] = useState('');
  const showReminder = reminderProblem != null && !reminderDismissed.includes(reminderProblem.id);

  if (!showPresetGap && !showReminder) return null;

  return (
    <div className="today-notices">
      {showReminder && (
        <Notice
          label="Reminders"
          title={reminderProblem.title}
          detail={reminderError || reminderProblem.detail}
          action={reminderProblem.action}
          onAction={() => {
            setReminderError('');
            void reminderProblem
              .run()
              .catch((cause: unknown) =>
                setReminderError(
                  cause instanceof Error ? cause.message : 'That did not work. Try Settings → Time & reminders.',
                ),
              );
          }}
          dismissLabel="Not now: reminders"
          onDismiss={() => {
            const next = [...reminderDismissed, reminderProblem.id];
            try {
              localStorage.setItem(REMINDER_PROMPT_KEY, JSON.stringify(next));
            } catch {
              // Without storage the prompt returns next launch.
            }
            setReminderDismissed(next);
          }}
        />
      )}
      {showPresetGap && (
        <Notice
          label="New preset routines"
          title={`${presetGap} new ${presetGap === 1 ? 'routine' : 'routines'} for ${presetGamesBehind} ${
            presetGamesBehind === 1 ? 'game' : 'games'
          }`}
          detail="Deleted routines stay deleted."
          action="Add them"
          onAction={() => addMissingPresetTasksEverywhere()}
          dismissLabel="Dismiss new routines"
          onDismiss={() => {
            localStorage.setItem(PRESET_GAP_KEY, String(presetGap));
            setDismissedGap(presetGap);
          }}
        />
      )}
    </div>
  );
}
