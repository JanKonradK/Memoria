import { setPresence, usePresence } from '../../presence';
import { Toggle } from '../ui';
import { SettingRow } from './SettingRow';

/** Windows app only: start with Windows, stay in the tray, notice games starting. */
export function DesktopPresence() {
  const { presence, error } = usePresence();
  if (!presence) return null;
  return (
    <div className="min-w-0">
      {presence.canStartWithWindows && (
        <SettingRow label="Start with Windows" hint="Memoria opens when you sign in to Windows.">
          <Toggle
            ariaLabel="Start with Windows"
            checked={presence.openAtLogin}
            onChange={(openAtLogin) => void setPresence({ openAtLogin })}
          />
        </SettingRow>
      )}
      <SettingRow
        label="Keep running in the tray when closed"
        hint="Phone sync and game notices keep working with the window closed. Quit from the tray icon."
      >
        <Toggle
          ariaLabel="Keep running in the tray when closed"
          checked={presence.closeToTray}
          onChange={(closeToTray) => void setPresence({ closeToTray })}
        />
      </SettingRow>
      <SettingRow label="Reminders on this PC" hint="If phone reminders are also on, both devices will alert.">
        <Toggle
          ariaLabel="Reminders on this PC"
          checked={presence.remindersOnPc}
          onChange={(remindersOnPc) => void setPresence({ remindersOnPc })}
        />
      </SettingRow>
      {presence.gameWatch && (
        <SettingRow label="Notify when a game starts" hint="Shows that game's dailies left when you open it.">
          <Toggle
            ariaLabel="Notify when a game starts"
            checked={presence.gameStartNotices}
            onChange={(gameStartNotices) => void setPresence({ gameStartNotices })}
          />
        </SettingRow>
      )}
      {error && (
        <p role="alert" className="settings-note text-body text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}
