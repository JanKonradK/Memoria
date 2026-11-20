import { nextReminderAt } from '@memoria/shared';
import { isNativeApp } from '../../native';
import { setPresence, usePresence } from '../../presence';
import { useApp } from '../../store';
import { useUI } from '../../ui-store';
import { fmtDateTimeLocalInput } from '../../util';
import { Btn, ConfirmDelete, Toggle } from '../ui';
import { DeviceNotifications } from './DeviceNotifications';
import { DigestField } from './DigestField';
import { ReminderStyles, STYLE_LABELS } from './ReminderStyles';
import { useNotifications } from '../../notifications';
import { QuietHoursField } from './QuietHoursField';
import { AlarmFreeTimes } from './AlarmFreeTimes';
import { repeatLabel } from './reminder-repeat';
import { SettingRow } from './SettingRow';

/** Reminders on the Windows app. */
function PcReminders() {
  const { presence } = usePresence();
  const windows = useNotifications((s) => s.windows);
  if (!presence) return null;
  const blocked = presence.remindersOnPc && windows != null && windows !== 'enabled' && windows !== 'unknown';
  return (
    <div className="min-w-0">
      <SettingRow
        label="Reminders on this PC"
        hint="Before resets with work left, unfinished event ends and full bars."
      >
        <Toggle
          ariaLabel="Reminders on this PC"
          checked={presence.remindersOnPc}
          onChange={(remindersOnPc) => void setPresence({ remindersOnPc })}
        />
      </SettingRow>
      {blocked && (
        <SettingRow
          label="Windows is hiding them"
          hint={
            windows === 'user'
              ? 'Notifications are off for every app in Windows. Switch them on so reminders can appear.'
              : windows === 'policy'
                ? 'An administrator has turned notifications off on this PC.'
                : 'Notifications are off for Memoria in Windows. Switch Memoria on so reminders can appear.'
          }
        >
          <Btn onClick={() => void window.memoriaDesktop?.presence?.openNotificationSettings?.()}>
            Open Windows settings
          </Btn>
        </SettingRow>
      )}
    </div>
  );
}

/** Every custom reminder, across games, with its next time. */
function CustomReminders() {
  const state = useApp((s) => s.state);
  const deleteReminder = useApp((s) => s.deleteReminder);
  const openSheet = useUI((s) => s.openSheet);
  const zone = state.settings.localTz;
  const now = Date.now();
  const names = new Map(state.games.filter((game) => !game.deleted).map((game) => [game.id, game.name]));
  const reminders = state.reminders
    .filter((item) => !item.deleted)
    .map((item) => ({ item, next: nextReminderAt(item, now, zone) }))
    .sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity));
  return (
    <SettingRow label="Your reminders" hint="Anything else, once or on repeat.">
      <Btn onClick={() => openSheet({ kind: 'reminder' })}>New reminder</Btn>
      {reminders.length > 0 && (
        <ul className="mt-3 w-full divide-y divide-line-hairline">
          {reminders.map(({ item, next }) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1 basis-48">
                <p className="break-words text-body text-fg">{item.message}</p>
                <p className="mt-1 text-label text-muted">
                  {[
                    item.gameId ? (names.get(item.gameId) ?? 'Removed game') : null,
                    repeatLabel(item.repeatDays),
                    item.style ? STYLE_LABELS[item.style] : null,
                    next == null ? 'Done' : `Next ${fmtDateTimeLocalInput(next, zone).replace('T', ' · ')}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <ConfirmDelete what={`reminder ${item.message}`} onConfirm={() => deleteReminder(item.id)} />
            </li>
          ))}
        </ul>
      )}
    </SettingRow>
  );
}

/** One place for everything that reaches you outside the app. */
export function RemindersPane() {
  const { presence } = usePresence();
  return (
    <div className="settings-rows">
      <DeviceNotifications />
      <PcReminders />
      {!isNativeApp && !presence && (
        <p className="say settings-note text-body text-muted">
          Reminders ring on the Android and Windows apps, with these settings.
        </p>
      )}
      <ReminderStyles />
      <QuietHoursField />
      <AlarmFreeTimes />
      <DigestField />
      <CustomReminders />
    </div>
  );
}
