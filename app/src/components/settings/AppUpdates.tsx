import {
  APP_VERSION,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  releaseNotes,
  setAutoUpdateCheck,
  updateTarget,
  useAppUpdate,
} from '../../app-update';
import { Btn, Toggle, TOUCH_BUTTON } from '../ui';

/** Release notes are short Markdown. Show headings, bullets and link text, nothing more. */
function ReleaseNotes({ text }: { text: string }) {
  const inline = (line: string) => line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`]/g, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('|'));
  if (lines.length === 0) return null;
  return (
    <div className="max-h-64 space-y-1 overflow-y-auto text-meta text-muted">
      {lines.map((line, index) => {
        const heading = /^#+\s+(.*)$/.exec(line);
        if (heading) {
          return (
            <p key={index} className="pt-1 font-semibold text-fg-soft">
              {inline(heading[1] ?? '')}
            </p>
          );
        }
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        return (
          <p key={index} className={bullet ? 'pl-3 -indent-3' : ''}>
            {bullet ? `• ${inline(bullet[1] ?? '')}` : inline(line)}
          </p>
        );
      })}
    </div>
  );
}

export function AppUpdates() {
  const { status, release, progress, error, auto } = useAppUpdate();
  const target = updateTarget();
  if (target === 'none') return null;
  const busy = status === 'checking' || status === 'downloading';
  const notes = release ? releaseNotes(release) : '';

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
          Memoria {APP_VERSION}
          {status === 'checking' && ' · Checking for updates…'}
          {status === 'current' && ' · You have the latest version.'}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Btn className={TOUCH_BUTTON} disabled={busy} onClick={() => void checkForUpdates()}>
            Check for updates
          </Btn>
          {window.location.protocol !== 'file:' && (
            <Toggle checked={auto} onChange={setAutoUpdateCheck} label="Check automatically" />
          )}
        </div>

        {release && (
          <div className="space-y-2 border-l-2 border-accent/50 pl-3">
            <p className="text-body font-semibold text-fg">
              Memoria {release.version} is available
              {release.publishedAt && (
                <span className="font-normal text-muted">
                  {' '}
                  · {new Date(release.publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                </span>
              )}
            </p>
            <ReleaseNotes text={notes} />
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {status === 'ready' ? (
                <Btn kind="primary" className={TOUCH_BUTTON} onClick={() => void installUpdate()}>
                  Restart and update
                </Btn>
              ) : (
                <Btn
                  kind="primary"
                  className={TOUCH_BUTTON}
                  disabled={status === 'downloading'}
                  onClick={() => void downloadUpdate()}
                >
                  {status === 'downloading'
                    ? `Downloading…${progress === null ? '' : ` ${Math.round(progress * 100)}%`}`
                    : target === 'download'
                      ? 'Open download page'
                      : target === 'android'
                        ? 'Download and install'
                        : 'Download update'}
                </Btn>
              )}
              <a href={release.url} target="_blank" rel="noreferrer" className="text-meta text-muted underline">
                Release page
              </a>
            </div>
            {status === 'ready' && (
              <p className="text-meta text-muted">
                Memoria saves, closes, installs the update and opens again. Your data stays where it is.
              </p>
            )}
            {target === 'android' && status !== 'downloading' && (
              <p className="text-meta text-muted">
                Android asks you to confirm the update. Your data on this device is kept.
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-body text-danger-fg">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
