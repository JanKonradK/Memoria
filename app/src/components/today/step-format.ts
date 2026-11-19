import { DateTime } from 'luxon';
import { actBy, type Settings, type TodayStep, type TodayStepGroup } from '@memoria/shared';
import { fmtDur } from '../../util';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A countdown's tone: rose within the hour, amber before quiet hours or within a few hours, else quiet. */
export type StepTone = 'danger' | 'rose' | 'warn' | 'calm';

export function hhmm(at: number, zone: string): string {
  return DateTime.fromMillis(at, { zone }).toFormat('HH:mm');
}

/** "Thu 21:00" within the week, "Wed 25 Nov" for a day a week out. */
export function weekWhen(at: number, now: number, zone: string): string {
  const time = DateTime.fromMillis(at, { zone });
  return at - now >= 6 * DAY ? time.toFormat('ccc d LLL') : time.toFormat('ccc HH:mm');
}

/** A short countdown for a side row: "2d", "~16d", "5h 20m". */
export function shortLeft(ms: number, estimated = false): string {
  if (ms <= 0) return 'Now';
  const text = ms >= DAY ? `${Math.round(ms / DAY)}d` : fmtDur(ms);
  return estimated ? `~${text}` : text;
}

export function stepTone(step: TodayStep, group: TodayStepGroup, settings: Settings, now: number): StepTone {
  if (step.kind === 'energy' && step.full) return 'danger';
  const left = (step.done ? step.at : actBy(settings, step.at, now)) - now;
  if (left <= HOUR) return 'rose';
  if (group.kind === 'evening' || left < 8 * HOUR) return 'warn';
  return 'calm';
}

export function groupTone(group: TodayStepGroup): StepTone {
  return group.kind === 'hour' ? 'rose' : group.kind === 'evening' ? 'warn' : 'calm';
}

const CADENCE = {
  daily: ['daily', 'dailies'],
  weekly: ['weekly', 'weeklies'],
  monthly: ['monthly', 'monthlies'],
  custom: ['cycle', 'cycles'],
} as const;

export function cadenceNoun(cadence: keyof typeof CADENCE, count: number): string {
  return CADENCE[cadence][count === 1 ? 0 : 1];
}

/** "Genshin, ZZZ and HSR" */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** A step's countdown: "13h", "6h 36m", "45m", "1d 4h". Whole hours drop their minutes. */
export function countdown(ms: number): string {
  if (ms <= 0) return 'Now';
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  return rest > 0 ? `${rest}m` : '<1m';
}
