import {
  APP_VERSION,
  displayVersion,
  checkForUpdates,
  setAutoUpdateCheck,
  showUpdate,
  updateTarget,
  useAppUpdate,
} from '../../app-update';
import { Btn, Toggle, TOUCH_BUTTON } from '../ui';
import { SettingRow } from './SettingRow';

export function AppUpdates() {
  const { status, release, error, auto } = useAppUpdate();
  if (updateTarget() === 'none') return null;

  return (
    <div className="min-w-0">
      <SettingRow
        label={displayVersion(APP_VERSION)}
        hint={
          <span role="status">
            {status === 'checking'
              ? 'Checking…'
              : release
                ? `${displayVersion(release.version)} is available`
                : status === 'current'
                  ? 'Up to date'
                  : 'Not checked yet'}
          </span>
        }
      >
        {release ? (
          <Btn kind="primary" className={TOUCH_BUTTON} onClick={showUpdate}>
            See update
          </Btn>
        ) : (
          <Btn
            className={TOUCH_BUTTON}
            disabled={status === 'checking' || status === 'downloading'}
            onClick={() => void checkForUpdates()}
          >
            Check for updates
          </Btn>
        )}
      </SettingRow>
      {window.location.protocol !== 'file:' && (
        <SettingRow label="Check automatically" hint="Looks for a new version when Memoria starts.">
          <Toggle checked={auto} onChange={setAutoUpdateCheck} ariaLabel="Check automatically" />
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
