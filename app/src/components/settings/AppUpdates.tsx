import {
  APP_VERSION,
  checkForUpdates,
  setAutoUpdateCheck,
  showUpdate,
  updateTarget,
  useAppUpdate,
} from '../../app-update';
import { Btn, Toggle, TOUCH_BUTTON } from '../ui';

export function AppUpdates() {
  const { status, release, error, auto } = useAppUpdate();
  if (updateTarget() === 'none') return null;

  return (
    <section id="settings-updates" className="mb-5 min-w-0" aria-labelledby="settings-updates-heading">
      <div className="today-group-rule">
        <h2 id="settings-updates-heading" className="text-meta font-semibold text-fg-soft">
          Updates
        </h2>
        <span aria-hidden />
      </div>
      <div className="mx-2 space-y-3">
        <p className="text-body text-muted" role="status">
          Version {APP_VERSION}
          {status === 'checking' && ' · Checking…'}
          {status === 'current' && ' · Up to date'}
          {release && ` · ${release.version} available`}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
          {window.location.protocol !== 'file:' && (
            <Toggle checked={auto} onChange={setAutoUpdateCheck} label="Check automatically" />
          )}
        </div>
        {error && (
          <p role="alert" className="text-body text-danger-fg">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
