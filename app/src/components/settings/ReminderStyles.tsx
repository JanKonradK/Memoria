import { useState } from 'react';
import {
  ALARM_TONES,
  NOTIFICATION_KINDS,
  NOTIFICATION_STYLES,
  notificationStyle,
  type AlarmTone,
  type NotificationKind,
  type NotificationStyle,
} from '@memoria/shared';
import { isNativeApp } from '../../native';
import { sendTestNotification } from '../../notifications';
import { usePresence } from '../../presence';
import { useApp } from '../../store';
import { Btn, Select } from '../ui';
import { SettingRow } from './SettingRow';

export const STYLE_LABELS: Record<NotificationStyle, string> = {
  silent: 'Silent',
  gentle: 'Gentle',
  standard: 'Standard',
  alarm: 'Alarm',
};

export const STYLE_HINTS: Record<NotificationStyle, string> = {
  silent: 'No sound. It waits in the notification list.',
  gentle: 'A soft chime.',
  standard: 'Pops up with a sound.',
  alarm: 'Rings like an alarm clock until you snooze or dismiss it.',
};

const KIND_LABELS: Record<NotificationKind, string> = {
  daily: 'Dailies before reset',
  weekly: 'Weeklies before reset',
  monthly: 'Monthlies before reset',
  event: 'Events ending',
  energy: 'Energy capping',
  reminder: 'Your reminders',
  digest: 'Evening digest',
};

export const TONE_LABELS: Record<AlarmTone, string> = {
  classic: 'Classic beeps',
  pulse: 'Pulse',
  chime: 'Chime',
  ring: 'Ring',
};

/** How each kind of reminder arrives, the alarm ring, and a sample of each. Shared by every device. */
export function ReminderStyles() {
  const settings = useApp((s) => s.state.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const onPc = usePresence((s) => s.presence != null);
  const canTest = isNativeApp || onPc;
  const tone = settings.alarmTone ?? 'classic';
  const [message, setMessage] = useState('');
  const test = (style: NotificationStyle) => {
    setMessage('');
    void sendTestNotification(style, tone)
      .then(() => setMessage(`Sent a test in the ${STYLE_LABELS[style]} style.`))
      .catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : 'The test could not be sent.'));
  };
  const setStyle = (kind: NotificationKind, style: NotificationStyle) =>
    updateSettings({ notificationStyles: { ...settings.notificationStyles, [kind]: style } });

  return (
    <div className="min-w-0">
      <SettingRow
        label="How reminders arrive"
        hint="Silent waits in the list, Gentle chimes softly, Standard pops up, Alarm rings like an alarm clock until you snooze or dismiss it. Each kind can differ."
        control="below"
      >
        <ul className="w-full divide-y divide-line-hairline">
          {NOTIFICATION_KINDS.map((kind) => {
            const style = notificationStyle(settings, kind);
            return (
              <li key={kind} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 basis-40 text-body text-fg">{KIND_LABELS[kind]}</span>
                <Select
                  aria-label={`${KIND_LABELS[kind]} style`}
                  className="!w-36"
                  value={style}
                  onChange={(event) => setStyle(kind, event.target.value as NotificationStyle)}
                >
                  {NOTIFICATION_STYLES.map((option) => (
                    <option key={option} value={option}>
                      {STYLE_LABELS[option]}
                    </option>
                  ))}
                </Select>
                {canTest && (
                  <Btn onClick={() => test(style)} aria-label={`Test ${KIND_LABELS[kind]} style`}>
                    Test
                  </Btn>
                )}
              </li>
            );
          })}
        </ul>
      </SettingRow>
      <SettingRow label="Alarm ring" hint="What alarm-style reminders play until you answer them.">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Alarm ring"
            className="!w-40"
            value={tone}
            onChange={(event) => updateSettings({ alarmTone: event.target.value as AlarmTone })}
          >
            {ALARM_TONES.map((option) => (
              <option key={option} value={option}>
                {TONE_LABELS[option]}
              </option>
            ))}
          </Select>
          {canTest && <Btn onClick={() => test('alarm')}>Ring it</Btn>}
        </div>
      </SettingRow>
      {message && (
        <p role="status" className="settings-note text-body text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
