import { DateTime } from 'luxon';
import { actBy, nextQuietWindow, quietWindowAt, type Settings, type TodayMark, type TodayPlan } from '@memoria/shared';
import { useMediaQuery } from '../../hooks';
import { GameLogo } from '../GameLogo';
import { gameWithAccount, type StepGame } from './StepRow';
import { hhmm, listNames } from './step-format';

const HOUR = 3_600_000;
const KIND_WORD = { cap: 'caps', reset: 'resets', event: 'events end' } as const;
/** Coins shown on one marker; the rest are counted in a pill. */
const MAX_FACES = 3;
/** On a phone, markers nearer than this share of the strip become one. */
const MERGE_SHARE = 0.07;

/** Folds each marker into the one before it when they would overlap; the earlier time leads. */
function mergeClose(marks: TodayMark[], gap: number): TodayMark[] {
  const out: TodayMark[] = [];
  for (const mark of marks) {
    const last = out.at(-1);
    if (last && mark.at - last.at < gap) {
      out[out.length - 1] = {
        at: last.at,
        gameIds: [...new Set([...last.gameIds, ...mark.gameIds])],
        kinds: [...new Set([...last.kinds, ...mark.kinds])],
      };
    } else out.push(mark);
  }
  return out;
}

/**
 * The next day as one line: hours, now, the quiet hours when set, and a marker
 * carrying each game's logo where something caps, resets or ends. Each marker
 * is read out as a list item; the drawing itself is decoration.
 */
export function DayStrip({
  plan,
  now,
  settings,
  games,
}: {
  plan: TodayPlan;
  now: number;
  settings: Settings;
  games: Map<string, StepGame>;
}) {
  const zone = settings.localTz;
  const phone = useMediaQuery('(max-width: 767px)');
  const span = plan.until - now;
  const x = (at: number) => `${(((at - now) / span) * 100).toFixed(2)}%`;
  const marks = phone ? mergeClose(plan.marks, MERGE_SHARE * span) : plan.marks;
  // Every third hour on the clock, the day's turn named by its weekday. Phones keep every sixth.
  const hours: Array<{ at: number; label: string; day: boolean; minor: boolean }> = [];
  for (let at = DateTime.fromMillis(now, { zone }).startOf('hour').plus({ hours: 1 }); ; at = at.plus({ hours: 1 })) {
    const ms = at.toMillis();
    // Clear of "Now" at the start and of the edge at the end.
    if (ms > plan.until - 0.06 * span) break;
    if (at.hour % 3 !== 0 || ms - now < 0.11 * span) continue;
    hours.push({
      at: ms,
      label: at.hour === 0 ? at.toFormat('ccc') : at.toFormat('HH:mm'),
      day: at.hour === 0,
      minor: at.hour % 6 !== 0,
    });
  }
  const quiet = quietWindowAt(settings, now) ?? nextQuietWindow(settings, now);
  const band =
    quiet && quiet.start < plan.until
      ? {
          left: x(Math.max(now, quiet.start)),
          width: `${((Math.min(plan.until, quiet.end) - Math.max(now, quiet.start)) / span) * 100}%`,
        }
      : null;

  return (
    <section className="today-strip" aria-labelledby="today-strip-heading">
      <h2 id="today-strip-heading" className="sr-only">
        The next 24 hours
      </h2>
      {band && (
        <div className="today-strip-quiet" style={band}>
          <span>Quiet hours</span>
          <span className="sr-only">
            {' '}
            {hhmm(quiet!.start, zone)} to {hhmm(quiet!.end, zone)}
          </span>
        </div>
      )}
      <div className="today-strip-axis" aria-hidden />
      {hours.map((hour) => (
        <span
          key={hour.at}
          className="today-strip-hour numeral"
          data-day={hour.day || undefined}
          data-minor={hour.minor || undefined}
          style={{ left: x(hour.at) }}
          aria-hidden
        >
          {hour.label}
        </span>
      ))}
      <ol className="today-strip-marks">
        {marks.map((mark) => {
          const due = actBy(settings, mark.at, now) - now;
          const onlyResets = mark.kinds.every((kind) => kind === 'reset');
          const tone =
            due <= HOUR
              ? 'rose'
              : !onlyResets && (due < 8 * HOUR || (plan.quiet && mark.at <= plan.quiet.end))
                ? 'warn'
                : 'calm';
          const names = mark.gameIds.map((id) => {
            const game = games.get(id);
            return game ? gameWithAccount(game, true) : '';
          });
          return (
            <li
              key={`${mark.at}:${mark.gameIds.join()}`}
              className="today-strip-mark"
              data-tone={tone}
              title={`${hhmm(mark.at, zone)} · ${listNames(names)}`}
              // Kept off the very edges, where half the coin would hang outside the strip.
              style={{ left: `clamp(2%, ${x(mark.at)}, 98%)` }}
            >
              <span className="today-strip-faces" aria-hidden>
                {mark.gameIds.slice(0, MAX_FACES).map((id) => {
                  const game = games.get(id);
                  return game ? <GameLogo key={id} game={game.logo} size={22} /> : null;
                })}
                {mark.gameIds.length > MAX_FACES && (
                  <span className="today-strip-more numeral">+{mark.gameIds.length - MAX_FACES}</span>
                )}
              </span>
              <span className="today-strip-stem" aria-hidden />
              <span className="today-strip-dot" aria-hidden />
              <span className="sr-only">
                {hhmm(mark.at, zone)}: {listNames(names)}, {mark.kinds.map((kind) => KIND_WORD[kind]).join(' and ')}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="today-strip-now" aria-hidden>
        <span>Now</span>
      </div>
    </section>
  );
}
