import { detectLocalTz, SERVER_TZ_OPTIONS } from '@memoria/shared';
import { DateTime } from 'luxon';

export const SYSTEM_TIMEZONE_VALUE = '__memoria_system_timezone__';

type SupportedValuesIntl = typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[];
};

export interface HomeTimeZoneOption {
  label: string;
  tz: string;
}

/** Full platform timezone list, with a compact preset fallback for older engines. */
export function homeTimeZoneOptions(currentTz: string): HomeTimeZoneOption[] {
  let options: HomeTimeZoneOption[];
  try {
    const supportedValuesOf = (Intl as SupportedValuesIntl).supportedValuesOf;
    const zones = supportedValuesOf?.call(Intl, 'timeZone');
    options = zones?.length ? zones.map((tz) => ({ label: tz, tz })) : [...SERVER_TZ_OPTIONS];
  } catch {
    options = [...SERVER_TZ_OPTIONS];
  }

  if (currentTz && !options.some((option) => option.tz === currentTz)) {
    options.push({ label: currentTz, tz: currentTz });
  }
  return options;
}

export function resolveHomeTimeZone(value: string): string {
  return value === SYSTEM_TIMEZONE_VALUE ? detectLocalTz() : value;
}

/** Current offset in a form that is easy to compare, for example UTC+01:00. */
export function utcOffsetLabel(zone: string, at = Date.now()): string {
  const date = DateTime.fromMillis(at, { zone });
  return date.isValid ? `UTC${date.toFormat('ZZ')}` : 'UTC offset unavailable';
}
