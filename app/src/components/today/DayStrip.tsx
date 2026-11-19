import type { CSSProperties } from 'react';
import { DateTime } from 'luxon';
import { actBy, nextQuietWindow, quietWindowAt, type Settings, type TodayPlan } from '@memoria/shared';
import { GameLogo } from '../GameLogo';
import type { StepGame } from './StepRow';
import { hhmm, listNames } from './step-format';

const HOUR = 3_600_000;
const KIND_WORD = { cap: 'caps', reset: 'resets', event: 'events end' } as const;

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
  const span = plan.until - now;
  const x = (at: number) => `${(((at - now) / span) * 100).toFixed(2)}%`;
  // Every third hour on the clock, the day's turn named by its weekday. Phones keep every sixth.
  const hours: Array<{ at: number; label: string; day: boolean; minor: boolean }> = [];
  for (let at = DateTime.fromMillis(now, { zone }).startOf('hour').plus({ hours: 1 }); ; at = at.plus({ hours: 1 })) {
    const ms = at.toMillis();
    if (ms > plan.until - 0.03 * span) break;
    if (at.hour % 3 !== 0 || ms - now < 0.03 * span) continue;
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
        {plan.marks.map((mark) => {
          const due = actBy(settings, mark.at, now) - now;
          const onlyResets = mark.kinds.every((kind) => kind === 'reset');
          const tone =
            due <= HOUR
              ? 'rose'
              : !onlyResets && (due < 8 * HOUR || (plan.quiet && mark.at <= plan.quiet.end))
                ? 'warn'
                : 'calm';
          const names = mark.gameIds.map((id) => games.get(id)?.game.short ?? '');
          return (
            <li
              key={`${mark.at}:${mark.gameIds.join()}`}
              className="today-strip-mark"
              data-tone={tone}
              style={{ left: x(mark.at), '--faces': Math.min(mark.gameIds.length, 4) } as CSSProperties}
            >
              <span className="today-strip-faces" aria-hidden>
                {mark.gameIds.slice(0, 4).map((id) => {
                  const game = games.get(id);
                  return game ? <GameLogo key={id} game={game.logo} size={22} /> : null;
                })}
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
