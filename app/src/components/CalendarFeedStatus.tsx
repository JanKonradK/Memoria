import { useState } from 'react';
import type { CalendarValue } from '@memoria/shared';
import { refreshRemoteFeed, useRemoteFeed } from '../data/remote-feed';
import { confirmCalendarChange, useCalendarChanges } from '../data/calendar-changes';
import { SEED_UPDATED } from '../data/seed-feed';
import { useApp } from '../store';
import { Sheet } from './Sheet';
import { Btn, Tooltip } from './ui';

function Values({ label, value }: { label: string; value: CalendarValue }) {
  return (
    <p className="break-words text-meta">
      <strong>{label}:</strong> {value.name} · {new Date(value.start).toLocaleString()} –{' '}
      {new Date(value.end).toLocaleString()}
      {value.notes && <> · {value.notes}</>}
    </p>
  );
}

export function CalendarFeedStatus() {
  const { status, error, lastSuccessAt } = useRemoteFeed();
  const published = useApp((s) => s.state.settings.remoteFeedVersion?.seedUpdated);
  const unread = useCalendarChanges((s) => s.unread);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 text-meta text-muted">
      <span>Feed published {published && published >= SEED_UPDATED ? published : SEED_UPDATED}</span>
      <span>
        {lastSuccessAt
          ? `Downloaded ${new Date(lastSuccessAt).toLocaleString()}`
          : published
            ? 'No download on this device'
            : 'Using bundled feed'}
      </span>
      <Btn onClick={() => setOpen(true)} aria-label={`Calendar changes (${unread.length})`}>
        Calendar changes <span className="rounded-ui-sm bg-fill-2 px-1.5 tabular-nums">{unread.length}</span>
      </Btn>
      {status === 'error' && (
        <Tooltip content={error}>
          <button
            type="button"
            className="min-h-11 text-accent-fg underline underline-offset-4 sm:min-h-8"
            onClick={() => void refreshRemoteFeed()}
            aria-label="Retry event update"
          >
            Events not updated · Retry
          </button>
        </Tooltip>
      )}
      {open && (
        <Sheet open={open} onClose={() => setOpen(false)} title="Calendar changes">
          <div className="space-y-3">
            <p className="text-meta text-muted">
              Confirm each change when you have read it. Read status stays on this device.
            </p>
            {unread.length === 0 && <p>No unread changes.</p>}
            {unread.map((change) => (
              <article key={change.id} className="space-y-2 rounded-ui-lg border border-line-edge p-3">
                <p className="text-body font-semibold">
                  {change.after?.name ?? change.before?.name} · {change.kind}
                </p>
                <p className="text-meta text-muted">
                  {change.game} · Published {change.published}
                </p>
                {change.before && <Values label="Before" value={change.before} />}
                {change.after ? (
                  <Values label="Feed" value={change.after} />
                ) : (
                  <p className="text-meta">Feed: withdrawn</p>
                )}
                {change.kept && (
                  <>
                    <p className="text-meta">Your event was kept.</p>
                    <Values label="Yours" value={change.kept} />
                  </>
                )}
                <Btn onClick={() => confirmCalendarChange(change.id)}>Confirm read</Btn>
              </article>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
