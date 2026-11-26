import { setCompactShortcut, setPresence, usePresence } from '../../presence';
import type { DesktopPresence as Presence } from '../../desktop-host';
import { Btn, Toggle } from '../ui';
import { SettingRow } from './SettingRow';
import { ShortcutRecorder } from './ShortcutRecorder';

/** Windows app only: start with Windows, stay in the tray, notice games starting. Reminders live in their own section. */
export function DesktopPresence() {
  const { presence, error } = usePresence();
  if (!presence) return null;
  // Switched off in Task Manager reads as off here; switching it on undoes that.
  const blocked = presence.startupBlockedByWindows === true;
  return (
    <div className="min-w-0">
      {presence.canStartWithWindows && (
        <SettingRow
          label="Start with Windows"
          hint={blocked ? 'Switched off in Task Manager.' : 'Memoria starts in the tray when you sign in.'}
        >
          <Toggle
            ariaLabel="Start with Windows"
            checked={presence.openAtLogin && !blocked}
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
      {presence.gameWatch && (
        <SettingRow
          label="Follow the game you start"
          hint="Memoria turns to the game's page. A minute in, one notice says what is still owed."
        >
          <Toggle
            ariaLabel="Follow the game you start"
            checked={presence.gameStartNotices}
            onChange={(gameStartNotices) => void setPresence({ gameStartNotices })}
          />
        </SettingRow>
      )}
      {presence.compactAlwaysOnTop !== undefined && <QuickCardRows presence={presence} />}
      {error && (
        <p role="alert" className="settings-note text-body text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}

/** The quick card: a small card for one game's energy and dailies, from a game closing or a shortcut. */
function QuickCardRows({ presence }: { presence: Presence }) {
  const shortcut = presence.compactShortcut;
  const following = presence.gameWatch && presence.gameStartNotices;
  return (
    <>
      {presence.gameWatch && (
        <SettingRow
          label="Open quick card when a game closes"
          hint={
            following
              ? 'A small card with its energy and dailies, to update before you forget. It never takes the keyboard.'
              : 'Turn on Follow the game you start first.'
          }
          hintKind={following ? 'say' : 'warn'}
        >
          <Toggle
            ariaLabel="Open quick card when a game closes"
            checked={following && presence.compactPopOutOnStop === true}
            disabled={!following}
            onChange={(compactPopOutOnStop) => void setPresence({ compactPopOutOnStop })}
          />
        </SettingRow>
      )}
      <SettingRow
        label="Keep quick card on top"
        hint="The card floats over the game and other windows. Its pin does the same."
      >
        <Toggle
          ariaLabel="Keep quick card on top"
          checked={presence.compactAlwaysOnTop === true}
          onChange={(compactAlwaysOnTop) => void setPresence({ compactAlwaysOnTop })}
        />
      </SettingRow>
      {shortcut && (
        <>
          <SettingRow
            label="Quick card shortcut"
            hint={
              shortcut.accelerator
                ? `Press ${shortcut.accelerator} anywhere to open or close the card for the game you are in.`
                : 'Off until you choose keys, so it never takes one another app uses.'
            }
          >
            <div className="flex flex-wrap items-start justify-end gap-2">
              <Toggle
                ariaLabel="Quick card shortcut"
                checked={shortcut.enabled}
                disabled={!shortcut.accelerator}
                onChange={(on) => void setCompactShortcut(on, shortcut.accelerator)}
              />
              {/* The first keys chosen turn it on: choosing them is the opt-in. */}
              <ShortcutRecorder
                name="quick card shortcut"
                accelerator={shortcut.accelerator}
                disabled={false}
                onChange={(next) => void setCompactShortcut(shortcut.enabled || !shortcut.accelerator, next)}
              />
              {shortcut.accelerator && (
                <Btn aria-label="Clear quick card shortcut" onClick={() => void setCompactShortcut(false, '')}>
                  Clear
                </Btn>
              )}
            </div>
          </SettingRow>
          {shortcut.enabled && shortcut.registered === false && shortcut.error && (
            <p role="alert" className="settings-note text-body text-warn-fg">
              {shortcut.accelerator} could not be set: {shortcut.error} Choose another shortcut.
            </p>
          )}
        </>
      )}
    </>
  );
}
