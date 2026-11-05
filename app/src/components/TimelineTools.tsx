/**
 * The finished-events switch and, on the timeline view, Edit, beside the view
 * switch. Finished works like the theme button: it names what a press does.
 * There is no search box: the browser's own find covers that.
 */
export function TimelineTools({
  showFinished,
  onShowFinished,
  editing,
  onEditing,
}: {
  showFinished: boolean;
  onShowFinished: (value: boolean) => void;
  /** Undefined hides the Edit button. */
  editing?: boolean;
  onEditing?: (value: boolean) => void;
}) {
  return (
    <div data-tour="timeline-tools" className="timeline-tools">
      <button
        type="button"
        className="shell-control timeline-tool-button"
        aria-label={showFinished ? 'Hide finished events' : 'Show finished events'}
        onClick={() => onShowFinished(!showFinished)}
      >
        <svg
          key={String(showFinished)}
          className="timeline-tool-icon icon h-4 w-4"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {showFinished ? (
            <path d="M3 3l14 14M8.6 5.2A8.6 8.6 0 0 1 10 5c4.5 0 7.5 5 7.5 5a14 14 0 0 1-2.1 2.7M5.4 6.6C3.5 8 2.5 10 2.5 10s3 5 7.5 5c1.3 0 2.5-.4 3.5-1M8.3 8.4a2.4 2.4 0 0 0 3.3 3.3" />
          ) : (
            <>
              <path d="M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5Z" />
              <circle cx="10" cy="10" r="2.4" />
            </>
          )}
        </svg>
        <span className="calendar-tool-label">{showFinished ? 'Hide finished' : 'Show finished'}</span>
      </button>
      {editing !== undefined && (
        <button
          type="button"
          className="shell-control timeline-tool-button"
          aria-label="Edit events"
          aria-pressed={editing}
          title={editing ? 'Done editing' : 'Reorder and tick off events'}
          onClick={() => onEditing?.(!editing)}
        >
          <svg
            className="timeline-tool-icon icon h-4 w-4"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            aria-hidden
          >
            {editing ? (
              <path d="m5 10.5 3.5 3.5L15 7" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M13.5 3.5 16.5 6.5 7 16H4v-3l9.5-9.5Z" strokeLinejoin="round" />
            )}
          </svg>
          <span className="calendar-tool-label">{editing ? 'Done' : 'Edit'}</span>
        </button>
      )}
    </div>
  );
}
