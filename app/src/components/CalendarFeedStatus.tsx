import { refreshRemoteFeed, useRemoteFeed } from '../data/remote-feed';
import { Tooltip } from './ui';

/**
 * New events go straight onto the calendar, so a current feed says nothing.
 * Only a failed download speaks, and offers a retry. A game whose calendar is
 * behind says so on its own lane.
 */
export function CalendarFeedStatus() {
  const { status, error } = useRemoteFeed();
  if (status !== 'error') return null;
  return (
    <Tooltip content={error}>
      <button
        type="button"
        className="min-h-11 text-meta text-accent-fg underline underline-offset-4 sm:min-h-8"
        onClick={() => void refreshRemoteFeed()}
      >
        Events not updated · Retry
      </button>
    </Tooltip>
  );
}
