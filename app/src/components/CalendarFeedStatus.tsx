import { refreshRemoteFeed, useRemoteFeed } from '../data/remote-feed';
import { fmtDur } from '../util';
import { Tooltip } from './ui';

export function CalendarFeedStatus({ now }: { now: number }) {
  const { status, error, lastSuccessAt } = useRemoteFeed();
  if (status === 'checking') return <span>Checking public calendar…</span>;
  if (status === 'error') {
    return (
      <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
        <span>Saved calendar</span>
        <Tooltip content={error}>
          <button
            type="button"
            className="min-h-11 text-accent-fg underline underline-offset-4 sm:min-h-8"
            onClick={() => void refreshRemoteFeed()}
            aria-label="Retry public calendar update"
          >
            Retry update
          </button>
        </Tooltip>
      </span>
    );
  }
  return (
    <span>
      {lastSuccessAt == null
        ? 'Bundled calendar'
        : `Calendar checked ${now - lastSuccessAt < 60_000 ? 'just now' : `${fmtDur(now - lastSuccessAt)} ago`}`}
    </span>
  );
}
