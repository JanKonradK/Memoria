import { useState } from 'react';
import { isNativeApp } from '../../native';
import { setNotificationsEnabled, useNotifications } from '../../notifications';
import { Btn } from '../ui';
import { SettingRow } from './SettingRow';

export function DeviceNotifications() {
  const { enabled, scheduled, error } = useNotifications();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!isNativeApp) return null;
  return (
    <div className="min-w-0">
      <SettingRow
        label="Reminders on this device"
        hint={
          enabled
            ? `${scheduled} scheduled. Your reminders and one deadline per game, for the next 24 hours.`
            : 'Your reminders and one deadline per game, for the next 24 hours.'
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
      {(message || error) && (
        <p role="alert" className="settings-note text-body text-danger-fg">
          {message || error}
        </p>
      )}
    </div>
  );
}
