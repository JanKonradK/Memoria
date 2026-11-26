import { useState } from 'react';
import { isNativeApp } from '../../native';
import {
  openAlarmFullScreenSettings,
  openAndroidBatterySettings,
  openAndroidNotificationSettings,
  requestExactReminders,
  setNotificationsEnabled,
  useNotifications,
} from '../../notifications';
import { Btn, Toggle } from '../ui';
import { SettingRow } from './SettingRow';

export function DeviceNotifications() {
  const { enabled, scheduled, error, exact, permission, batteryUnrestricted, blockedChannels, fullScreen } =
    useNotifications();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!isNativeApp) return null;
  return (
    <div className="min-w-0">
      <SettingRow
        label="Reminders on this device"
        hintKind={enabled ? 'fact' : 'say'}
        hint={
          enabled
            ? `${scheduled} scheduled for the next 7 days.`
            : 'Before resets with work left, unfinished event ends and full bars.'
        }
      >
        <Toggle
          ariaLabel="Reminders on this device"
          checked={enabled}
          disabled={busy}
          onChange={(on) => {
            setBusy(true);
            setMessage('');
            void setNotificationsEnabled(on)
              .catch((cause: unknown) =>
                setMessage(cause instanceof Error ? cause.message : 'Could not change reminders.'),
              )
              .finally(() => setBusy(false));
          }}
        />
      </SettingRow>
      {enabled && exact === false && (
        <SettingRow
          label="Exact timing"
          hintKind="warn"
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
      {enabled && fullScreen === false && (
        <SettingRow
          label="Alarms over the lock screen"
          hintKind="warn"
          hint="Android is keeping alarms from opening full screen, so they ring as a pop-up instead. Allow full screen alerts for Memoria to see Snooze and Dismiss on the lock screen."
        >
          <Btn onClick={() => void openAlarmFullScreenSettings()}>Allow full screen</Btn>
        </SettingRow>
      )}
      {permission === 'denied' && (
        <SettingRow
          label="Blocked by Android"
          hintKind="warn"
          hint="Android is not letting Memoria show notifications. Allow them on Memoria's page in Android settings."
        >
          <Btn onClick={() => void openAndroidNotificationSettings()}>Open Android settings</Btn>
        </SettingRow>
      )}
      {enabled && permission !== 'denied' && blockedChannels.length > 0 && (
        <SettingRow
          label="Some styles are muted"
          hintKind="warn"
          hint={`${blockedChannels.length} reminder ${blockedChannels.length === 1 ? 'style is' : 'styles are'} switched off in Android settings, so those reminders will not appear.`}
        >
          <Btn onClick={() => void openAndroidNotificationSettings()}>Open Android settings</Btn>
        </SettingRow>
      )}
      {enabled && batteryUnrestricted === false && (
        <SettingRow
          label="Battery saving"
          hintKind="warn"
          hint="Some phones hold back reminders from apps under battery optimisation. Setting Memoria to Unrestricted keeps them on time."
        >
          <Btn onClick={() => void openAndroidBatterySettings()}>Open battery settings</Btn>
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
