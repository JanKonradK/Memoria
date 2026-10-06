import { useState } from 'react';
import { isNativeApp } from '../../native';
import { setNotificationsEnabled, useNotifications } from '../../notifications';
import { Btn } from '../ui';

export function DeviceNotifications() {
  const { enabled, scheduled, error } = useNotifications();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!isNativeApp) return null;
  return (
    <section className="space-y-3 border-t border-line-hairline py-4" aria-label="Phone reminders">
      <h2 className="text-heading font-semibold">Phone reminders</h2>
      <p className="text-body text-muted">
        Get your custom reminders and one upcoming deadline per game. Quiet hours apply. Reminders cover the next 24
        hours and update when you open Memoria. Android can delay delivery.
      </p>
      <p className="text-meta text-muted">
        Energy alerts use recent readings. Refresh after playing to keep them accurate.
      </p>
      <Btn
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setMessage('');
          void setNotificationsEnabled(!enabled)
            .catch((cause: unknown) =>
              setMessage(cause instanceof Error ? cause.message : 'Reminders could not be changed.'),
            )
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Updating…' : enabled ? 'Turn phone reminders off' : 'Enable phone reminders'}
      </Btn>
      {enabled && <p className="text-meta text-muted">{scheduled} reminders scheduled on this phone.</p>}
      {(message || error) && (
        <p role="alert" className="text-body text-danger-fg">
          {message || error}
        </p>
      )}
    </section>
  );
}
