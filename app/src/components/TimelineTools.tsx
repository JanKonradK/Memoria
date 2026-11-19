import { TIMELINE_RANGES, type TimelineRangeKey } from '../timeline-window';

const ICON = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/**
 * The finished-events switch. It works like the theme button: it names what a
 * press does. There is no search box: the browser's own find covers that.
 */
export function TimelineTools({
  showFinished,
  onShowFinished,
  compact = false,
}: {
  showFinished: boolean;
  onShowFinished: (value: boolean) => void;
  /** Icon only; the accessible name stays. */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className="calendar-tool"
      data-icon-only={compact || undefined}
      aria-label={showFinished ? 'Hide finished events' : 'Show finished events'}
      title={showFinished ? 'Hide finished' : 'Show finished'}
      onClick={() => onShowFinished(!showFinished)}
    >
      <svg key={String(showFinished)} className="icon h-4 w-4" {...ICON}>
        {showFinished ? (
          <path d="M3 3l14 14M8.6 5.2A8.6 8.6 0 0 1 10 5c4.5 0 7.5 5 7.5 5a14 14 0 0 1-2.1 2.7M5.4 6.6C3.5 8 2.5 10 2.5 10s3 5 7.5 5c1.3 0 2.5-.4 3.5-1M8.3 8.4a2.4 2.4 0 0 0 3.3 3.3" />
        ) : (
          <>
            <path d="M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5Z" />
            <circle cx="10" cy="10" r="2.4" />
          </>
        )}
      </svg>
      {!compact && <span className="calendar-tool-text">{showFinished ? 'Hide finished' : 'Show finished'}</span>}
    </button>
  );
}

/** Week, 4 weeks or Season: how much time the timeline spans. */
export function RangeSwitch({
  range,
  onRange,
}: {
  range: TimelineRangeKey;
  onRange: (range: TimelineRangeKey) => void;
}) {
  return (
    <div role="group" aria-label="Range" className="view-switch">
      {(Object.keys(TIMELINE_RANGES) as TimelineRangeKey[]).map((key) => (
        <button key={key} type="button" aria-pressed={range === key} onClick={() => onRange(key)}>
          {TIMELINE_RANGES[key].label}
        </button>
      ))}
    </div>
  );
}

/** Earlier, Today and Later. Today brings now back into view. */
export function RangeStepper({
  label,
  onStep,
  onToday,
  atToday,
}: {
  /** The dates on screen, for screen readers and the tooltip. */
  label: string;
  onStep: (weeks: number) => void;
  onToday: () => void;
  atToday: boolean;
}) {
  return (
    <div role="group" aria-label={`Dates shown: ${label}`} className="calendar-stepper">
      <button
        type="button"
        className="calendar-tool"
        data-icon-only
        aria-label="Earlier week"
        onClick={() => onStep(-1)}
      >
        <svg className="icon h-4 w-4" {...ICON}>
          <path d="m12 5-5 5 5 5" />
        </svg>
      </button>
      <button
        type="button"
        className="calendar-tool"
        data-current={atToday || undefined}
        aria-label="Show today"
        title={label}
        onClick={onToday}
      >
        Today
      </button>
      <button type="button" className="calendar-tool" data-icon-only aria-label="Later week" onClick={() => onStep(1)}>
        <svg className="icon h-4 w-4" {...ICON}>
          <path d="m8 5 5 5-5 5" />
        </svg>
      </button>
    </div>
  );
}
