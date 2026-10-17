import { refreshRemoteFeed, useRemoteFeed } from '../data/remote-feed';
import { Tooltip } from './ui';

/** Says nothing while the calendar is fine; offers a retry when an update failed. */
export function CalendarFeedStatus() {
  const { status, error } = useRemoteFeed();
  if (status !== 'error') return null;
  return (
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
  );
}
