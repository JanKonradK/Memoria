import { DateTime, IANAZone } from 'luxon';

/** Resolve the host's IANA timezone in both browsers and Node. */
export function detectLocalTz(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && IANAZone.isValidZone(zone) ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Convert a publisher's wall-clock date using its explicit or server timezone. */
export function parseServerDateTime(value: string, timezone: string): number | null {
  const date = DateTime.fromFormat(value, 'yyyy-LL-dd HH:mm', { zone: timezone });
  return date.isValid ? date.toMillis() : null;
}
