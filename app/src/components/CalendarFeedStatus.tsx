import { useRemoteFeed } from '../data/remote-feed-state';
import { Tooltip } from './ui';

/** The download and signature check load on a retry, not with the calendar. */
const retry = () => void import('../data/remote-feed').then(({ refreshRemoteFeed }) => refreshRemoteFeed());

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
        className="min-h-11 text-meta text-accent-fg underline underline-offset-4 fine:min-h-8"
        onClick={retry}
      >
        Events not updated · Retry
      </button>
    </Tooltip>
  );
}
