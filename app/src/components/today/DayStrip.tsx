import { DateTime } from 'luxon';
import { actBy, nextQuietWindow, quietWindowAt, type Settings, type TodayMark, type TodayPlan } from '@memoria/shared';
import { useElementWidth, useMediaQuery } from '../../hooks';
import { GameLogo } from '../GameLogo';
import { Tooltip } from '../ui';
import { gameWithAccount, type StepGame } from './StepRow';
import { hhmm, listNames } from './step-format';

const HOUR = 3_600_000;
const KIND_WORD = { cap: 'caps', reset: 'resets', event: 'events end' } as const;
/** Coins shown on one marker; the rest are counted in a pill. */
const MAX_FACES = 3;
/** A marker's coin, and how far the next coin on it tucks under (today-steps.css). */
const COIN_PX = { phone: 18, wide: 22 } as const;
const COIN_OVERLAP_PX = 6;
/** The least room between two markers' centres, whatever they carry. */
const MIN_GAP_PX = { phone: 26, wide: 34 } as const;

/** How wide a marker's coins draw: each after the first tucks under, then a count pill past three. */
function facesPx(count: number, coin: number): number {
  const shown = Math.min(count, MAX_FACES);
  return coin + (shown - 1) * (coin - COIN_OVERLAP_PX) + (count > MAX_FACES ? coin - COIN_OVERLAP_PX : 0);
}

/**
 * Folds each marker into the one before it when their coins would touch at the
 * strip's real width; the earlier time leads. Without a width yet, none fold.
 */
function mergeClose(marks: TodayMark[], msPerPx: number, coin: number, minGapPx: number): TodayMark[] {
  if (!(msPerPx > 0) || !Number.isFinite(msPerPx)) return marks;
  const out: TodayMark[] = [];
  for (const mark of marks) {
    const last = out.at(-1);
    const room = last
      ? Math.max(minGapPx, (facesPx(last.gameIds.length, coin) + facesPx(mark.gameIds.length, coin)) / 2 + 4)
      : 0;
    if (last && (mark.at - last.at) / msPerPx < room) {
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
  // Markers fold by the strip's measured width, so coins never overlap at any size.
  const [stripRef, stripPx] = useElementWidth();
  const span = plan.until - now;
  const x = (at: number) => `${(((at - now) / span) * 100).toFixed(2)}%`;
  const size = phone ? 'phone' : 'wide';
  const marks = mergeClose(plan.marks, span / stripPx, COIN_PX[size], MIN_GAP_PX[size]);
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
    <section ref={stripRef} className="today-strip" aria-labelledby="today-strip-heading">
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
            <Tooltip key={`${mark.at}:${mark.gameIds.join()}`} content={`${hhmm(mark.at, zone)} · ${listNames(names)}`}>
              <li
                className="today-strip-mark"
                data-tone={tone}
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
            </Tooltip>
          );
        })}
      </ol>
      <div className="today-strip-now" aria-hidden>
        <span>Now</span>
      </div>
    </section>
  );
}
