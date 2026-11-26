import { useUI } from '../ui-store';
import { Tooltip } from './ui';

/** "Now", "13m", "5h", "3d": an age small enough to sit beside a mark. */
export function shortAge(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** "Updated 13 min ago", "Updated just now": the age said in full. */
export function longAge(verb: string, ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return `${verb} just now`;
  if (minutes < 60) return `${verb} ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${verb} ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${verb} ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Two arrows chasing round: synced, updated, read. */
function SyncMark() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden className="ago-mark">
      <path d="M15.5 8a6 6 0 0 0-10.6-2.3M4.5 12a6 6 0 0 0 10.6 2.3" strokeLinecap="round" />
      <path d="M4.6 3v3h3M15.4 17v-3h-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * How long ago something was updated or synced. Elaborate says it ("Updated
 * 13 min ago"); Minimal shows the sync mark and the age ("13m", "Now"), with
 * the full phrase kept as its tooltip and accessible name. `mark` shows the
 * short form in either mode, for places too narrow for the phrase.
 */
export function Ago({
  at,
  now,
  verb = 'Updated',
  mark = false,
  className = '',
}: {
  at: number;
  now: number;
  verb?: string;
  mark?: boolean;
  className?: string;
}) {
  const minimal = useUI((s) => s.detail === 'minimal');
  const elapsed = Math.max(0, now - at);
  const full = longAge(verb, elapsed);
  if (!minimal && !mark) return <span className={className}>{full}</span>;
  return (
    <Tooltip content={full}>
      <span className={`ago ${className}`}>
        <SyncMark />
        <span aria-hidden>{shortAge(elapsed)}</span>
        <span className="sr-only">{full}</span>
      </span>
    </Tooltip>
  );
}
