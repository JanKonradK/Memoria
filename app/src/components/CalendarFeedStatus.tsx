import { useState } from 'react';
import { DateTime } from 'luxon';
import type { CalendarValue } from '@memoria/shared';
import { refreshRemoteFeed, useRemoteFeed } from '../data/remote-feed';
import { confirmCalendarChange, useCalendarChanges } from '../data/calendar-changes';
import { SEED_UPDATED } from '../data/seed-feed';
import { useApp } from '../store';
import { Sheet } from './Sheet';
import { Btn, Tooltip } from './ui';

/** One date style for the whole sheet, on the player's home clock: "12 Nov 2026, 17:38". */
const fmtWhen = (at: number, zone: string) => DateTime.fromMillis(at, { zone }).toFormat('d LLL yyyy, HH:mm');
/** A feed's publish date ("2026-11-04") in the same style, without a time. */
const fmtDay = (iso: string) => {
  const day = DateTime.fromISO(iso);
  return day.isValid ? day.toFormat('d LLL yyyy') : iso;
};

function Values({ label, value, zone }: { label: string; value: CalendarValue; zone: string }) {
  return (
    <p className="break-words text-meta">
      <strong>{label}:</strong> {value.name} · {fmtWhen(value.start, zone)} – {fmtWhen(value.end, zone)}
      {value.notes && <> · {value.notes}</>}
    </p>
  );
}

/**
 * The calendar's provenance stays out of the way: a current feed says nothing,
 * a failed download offers a retry, and where the feed came from and when sits
 * in the Calendar changes sheet. A game whose calendar is behind says so on its
 * own lane.
 */

export function CalendarFeedStatus() {
  const { status, error, lastSuccessAt } = useRemoteFeed();
  const published = useApp((s) => s.state.settings.remoteFeedVersion?.seedUpdated);
  const unread = useCalendarChanges((s) => s.unread);
  const zone = useApp((s) => s.state.settings.localTz);
  const [open, setOpen] = useState(false);
  const feedDay = published && published >= SEED_UPDATED ? published : SEED_UPDATED;
  return (
    <div className="flex flex-wrap items-center gap-2 text-meta text-muted">
      <Btn onClick={() => setOpen(true)} aria-label={`Calendar changes (${unread.length})`}>
        Calendar changes
        {unread.length > 0 && <span className="rounded-ui-sm bg-fill-2 px-1.5 tabular-nums">{unread.length}</span>}
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
              Feed published {fmtDay(feedDay)} ·{' '}
              {lastSuccessAt
                ? `downloaded ${fmtWhen(lastSuccessAt, zone)}`
                : published
                  ? 'not downloaded on this device'
                  : 'using the copy built into the app'}
            </p>
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
                {change.before && <Values label="Before" value={change.before} zone={zone} />}
                {change.after ? (
                  <Values label="Feed" value={change.after} zone={zone} />
                ) : (
                  <p className="text-meta">Feed: withdrawn</p>
                )}
                {change.kept && (
                  <>
                    <p className="text-meta">Your event was kept.</p>
                    <Values label="Yours" value={change.kept} zone={zone} />
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
