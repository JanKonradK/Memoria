import { IANAZone } from 'luxon';

/** Resolve the host's IANA timezone in both browsers and Node. */
export function detectLocalTz(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && IANAZone.isValidZone(zone) ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}
