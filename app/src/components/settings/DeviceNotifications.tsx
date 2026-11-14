import { useState } from 'react';
import { isNativeApp } from '../../native';
import { requestExactReminders, setNotificationsEnabled, useNotifications } from '../../notifications';
import { Btn } from '../ui';
import { SettingRow } from './SettingRow';

export function DeviceNotifications() {
  const { enabled, scheduled, error, exact } = useNotifications();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!isNativeApp) return null;
  return (
    <div className="min-w-0">
      <SettingRow
        label="Reminders on this device"
        hint={
          enabled
            ? `${scheduled} scheduled for the next 7 days: an hour before each daily reset with dailies left, before weeklies and unfinished events run out, and before a bar caps.`
            : 'An hour before each daily reset with dailies left, before weeklies and unfinished events run out, and before a bar caps.'
        }
      >
        <Btn
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setMessage('');
            void setNotificationsEnabled(!enabled)
              .catch((cause: unknown) =>
                setMessage(cause instanceof Error ? cause.message : 'Could not change reminders.'),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Updating…' : enabled ? 'Turn reminders off' : 'Enable reminders'}
        </Btn>
      </SettingRow>
      {enabled && exact === false && (
        <SettingRow
          label="Exact timing"
          hint="Android may hold reminders back by several minutes, or longer while the phone sleeps. Allow alarms and reminders so they arrive on time."
        >
          <Btn
            disabled={busy}
            onClick={() => {
              setMessage('');
              void requestExactReminders().catch((cause: unknown) =>
                setMessage(cause instanceof Error ? cause.message : 'Could not open the Android setting.'),
              );
            }}
          >
            Allow exact timing
          </Btn>
        </SettingRow>
      )}
      {(message || error) && (
        <p role="alert" className="settings-note text-body text-danger-fg">
          {message || error}
        </p>
      )}
    </div>
  );
}
