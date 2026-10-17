import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  APP_VERSION,
  dismissUpdateNotice,
  downloadUpdate,
  installUpdate,
  releaseChanges,
  updateTarget,
  useAppUpdate,
} from '../app-update';
import { Btn } from './ui';

/** Release notes are short Markdown. Show headings, bullets and link text, nothing more. */
export function ReleaseNotes({ text }: { text: string }) {
  const inline = (line: string) => line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`]/g, '');
  // The version heading is already shown above the notes.
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('|') && !/^#\s+Memoria\b/i.test(line));
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-2 text-body text-fg-soft">
      {lines.map((line, index) => {
        const heading = /^#+\s+(.*)$/.exec(line);
        if (heading) {
          return (
            <li key={index} className="pt-2 font-semibold text-fg">
              {inline(heading[1] ?? '')}
            </li>
          );
        }
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        return (
          <li key={index} className={bullet ? 'relative pl-5' : ''}>
            {bullet && (
              <span aria-hidden className="absolute left-0 text-accent-fg">
                •
              </span>
            )}
            {inline(bullet ? (bullet[1] ?? '') : line)}
          </li>
        );
      })}
    </ul>
  );
}

const BIG_BUTTON = '!min-h-12 !px-6 !text-body';

/** A newer version takes the whole screen: every change since this copy, then Update or Later. */
export function UpdateScreen() {
  const { open, status, release, progress, error } = useAppUpdate();
  const target = updateTarget();
  if (!release || target === 'none') return null;
  const changes = releaseChanges(release);
  const downloading = status === 'downloading';
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';

  const primary =
    status === 'ready' ? (
      <Btn kind="primary" className={BIG_BUTTON} onClick={() => void installUpdate()}>
        Restart and update
      </Btn>
    ) : (
      <Btn kind="primary" className={BIG_BUTTON} disabled={downloading} onClick={() => void downloadUpdate()}>
        {downloading
          ? `Downloading${progress === null ? '…' : ` ${Math.round(progress * 100)}%`}`
          : target === 'download'
            ? 'Download'
            : 'Update'}
      </Btn>
    );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && !downloading && dismissUpdateNotice()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[75] flex flex-col bg-surface-0 outline-none"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <header className="mx-auto w-full max-w-2xl px-6 pt-10 pb-6">
            <p className="text-meta text-muted">
              {APP_VERSION} → {release.version}
            </p>
            <DialogPrimitive.Title className="mt-1 text-hero font-black tracking-tight text-fg">
              Update available
            </DialogPrimitive.Title>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl space-y-8 px-6 pb-8">
              {changes.map((change) => (
                <section key={change.version} aria-label={`Version ${change.version}`}>
                  <h2 className="flex items-baseline gap-3 border-b border-line pb-2 text-title font-semibold text-fg">
                    {change.version}
                    <span className="text-meta font-normal text-muted">{date(change.publishedAt)}</span>
                  </h2>
                  <div className="pt-3">
                    <ReleaseNotes text={change.notes} />
                  </div>
                </section>
              ))}
            </div>
          </div>

          <footer className="border-t border-line">
            <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-3 px-6 py-4">
              {error && (
                <p role="alert" className="w-full text-body text-danger-fg">
                  {error}
                </p>
              )}
              {primary}
              <Btn className={BIG_BUTTON} disabled={downloading} onClick={dismissUpdateNotice}>
                Later
              </Btn>
            </div>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
