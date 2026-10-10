import { DateTime } from 'luxon';

const SERVER_REGIONS: Record<string, string> = {
  'Etc/GMT+5': 'NA',
  'Etc/GMT-1': 'EU',
  'Etc/GMT-8': 'ASIA',
};

function offsetLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'UTC';

  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const offset = minutes > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : String(hours);
  return `UTC${offsetMinutes > 0 ? '+' : '−'}${offset}`;
}

export function serverRegionLabel(tz: string, now: number): string {
  if (SERVER_REGIONS[tz]) return SERVER_REGIONS[tz];
  if (/^(?:Etc\/)?(?:UTC|GMT)$/i.test(tz)) return 'UTC';

  const serverNow = DateTime.fromMillis(now, { zone: tz });
  if (!serverNow.isValid) return 'Server';

  // Use the current offset so real IANA zones follow daylight-saving time.
  // The narrow ranges cover the supported server regions and their seasonal
  // offsets. Other offsets stay explicit instead of getting a regional guess.
  if (serverNow.offset >= -10 * 60 && serverNow.offset <= -4 * 60) return 'NA';
  if (serverNow.offset >= 0 && serverNow.offset <= 3 * 60) return 'EU';
  if (serverNow.offset >= 7 * 60 && serverNow.offset <= 9 * 60) return 'ASIA';
  return offsetLabel(serverNow.offset);
}
