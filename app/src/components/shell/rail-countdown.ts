const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type RailTone = 'now' | 'soon' | 'later';

/**
 * How long until a game next needs the player, short enough to sit under its
 * logo: "45m", "7h", "2d". Under two hours reads as now, under eight as soon.
 * Units are floored, as Today's countdowns are, so the two never disagree.
 */
export function railCountdown(msLeft: number): { short: string; long: string; tone: RailTone } {
  const left = Math.max(0, msLeft);
  const tone: RailTone = left < 2 * HOUR ? 'now' : left < 8 * HOUR ? 'soon' : 'later';
  if (left < HOUR) {
    const minutes = Math.max(1, Math.floor(left / MINUTE));
    return { short: left <= 0 ? 'now' : `${minutes}m`, long: left <= 0 ? 'now' : `${minutes} min`, tone };
  }
  if (left < 2 * DAY) {
    const hours = Math.floor(left / HOUR);
    return { short: `${hours}h`, long: `${hours} h ${Math.floor((left % HOUR) / MINUTE)} min`, tone };
  }
  const days = Math.floor(left / DAY);
  return { short: `${days}d`, long: `${days} days`, tone };
}
